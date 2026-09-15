import { supabase } from './supabase.js';
import { toast } from './componentes/toast.js';

const advogados = new Map();
const tiposProcesso = new Map();
const tiposServico = new Map();
const ouvintes = new Map(); // entidade -> Set<fn>

let canais = [];

function notificar(entidade) {
  ouvintes.get(entidade)?.forEach((fn) => fn());
}

async function recarregarAdvogado(id) {
  const { data } = await supabase.from('vw_advogados').select('*').eq('id', id).maybeSingle();
  if (data) advogados.set(data.id, data);
  else advogados.delete(id);
  notificar('advogados');
}

export const store = {
  async init() {
    try {
      const [resAdv, resTP, resTS] = await Promise.all([
        supabase.from('vw_advogados').select('*'),
        supabase.from('tipos_processo').select('*').order('ordem'),
        supabase.from('tipos_servico').select('*').order('ordem'),
      ]);
      (resAdv.data ?? []).forEach((a) => advogados.set(a.id, a));
      (resTP.data ?? []).forEach((t) => tiposProcesso.set(t.id, t));
      (resTS.data ?? []).forEach((t) => tiposServico.set(t.id, t));
    } catch (err) {
      toast.erro('Não foi possível carregar os cadastros. Algumas listas podem ficar vazias.');
    }

    // Realtime: para `advogados`, o payload chega da tabela crua (não da view
    // mascarada) — usamos só como gatilho para reconsultar `vw_advogados`,
    // nunca lendo payload.new/old diretamente, para não vazar CPF/CNPJ e
    // dados bancários a perfis sem RLS de admin/financeiro (ex.: `socio`).
    const canalAdv = supabase
      .channel('store-advogados')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'advogados' }, (payload) => {
        const id = payload.new?.id ?? payload.old?.id;
        if (payload.eventType === 'DELETE') { advogados.delete(id); notificar('advogados'); }
        else recarregarAdvogado(id);
      })
      .subscribe();

    const canalTP = supabase
      .channel('store-tipos-processo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tipos_processo' }, (payload) => {
        if (payload.eventType === 'DELETE') tiposProcesso.delete(payload.old.id);
        else tiposProcesso.set(payload.new.id, payload.new);
        notificar('tiposProcesso');
      })
      .subscribe();

    const canalTS = supabase
      .channel('store-tipos-servico')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tipos_servico' }, (payload) => {
        if (payload.eventType === 'DELETE') tiposServico.delete(payload.old.id);
        else tiposServico.set(payload.new.id, payload.new);
        notificar('tiposServico');
      })
      .subscribe();

    canais = [canalAdv, canalTP, canalTS];
  },

  destruir() {
    canais.forEach((c) => supabase.removeChannel(c));
    canais = [];
    advogados.clear();
    tiposProcesso.clear();
    tiposServico.clear();
    ouvintes.clear();
  },

  listarAdvogados({ ativos } = {}) {
    let lista = Array.from(advogados.values());
    if (ativos === true) lista = lista.filter((a) => a.ativo);
    if (ativos === false) lista = lista.filter((a) => !a.ativo);
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  obterAdvogado(id) { return advogados.get(id) ?? null; },

  listarTiposProcesso() { return Array.from(tiposProcesso.values()).sort((a, b) => a.ordem - b.ordem); },
  listarTiposServico() { return Array.from(tiposServico.values()).sort((a, b) => a.ordem - b.ordem); },

  on(entidade, fn) {
    if (!ouvintes.has(entidade)) ouvintes.set(entidade, new Set());
    ouvintes.get(entidade).add(fn);
    return () => ouvintes.get(entidade)?.delete(fn);
  },
};
