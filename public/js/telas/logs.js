import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { criarSelo } from '../componentes/selo.js';
import { toast } from '../componentes/toast.js';
import { formatarMoeda, formatarPercentual, formatarData } from '../formato.js';
import { sessao } from '../sessao.js';

export const titulo = 'Registro de alterações';

const CAMPOS_TECNICOS = new Set(['id', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por']);

const ROTULOS_CAMPO = {
  valor_bruto: 'Valor bruto', valor_base: 'Valor base', valor: 'Valor',
  percentual_padrao: 'Percentual padrão', percentual_sugerido: 'Percentual sugerido',
  percentual_indicacao: 'Percentual de indicação', percentual: 'Percentual',
  cliente_id: 'Cliente', advogado_id: 'Advogado', advogado_indicacao_id: 'Advogado indicador',
  tipo_processo_id: 'Tipo de processo', tipo_servico_id: 'Tipo de serviço', processo_id: 'Processo',
  data_competencia: 'Competência', data_pagamento: 'Pagamento', data_repasse: 'Data de repasse',
  data_cadastro: 'Data de cadastro', data_distribuicao: 'Data de distribuição',
  forma_pagamento: 'Forma de pagamento', papel: 'Papel', papel_preferencial: 'Papel preferencial',
  origem_percentual: 'Origem do percentual', status: 'Status', ativo: 'Ativo', pago: 'Pago',
  encerrado: 'Encerrado', cpf_cnpj: 'CPF/CNPJ', oab_numero: 'OAB (número)', oab_uf: 'OAB (UF)',
  chave_pix: 'Chave PIX', banco: 'Banco', agencia: 'Agência', conta: 'Conta',
  motivo_estorno: 'Motivo do estorno', observacao: 'Observação', descricao: 'Descrição',
  nome: 'Nome', email: 'E-mail', telefone: 'Telefone', numero: 'Número', numero_cnj: 'Número CNJ',
  cidade: 'Cidade', uf: 'UF', origem: 'Origem', codigo: 'Código', area: 'Área', natureza: 'Natureza',
  ordem: 'Ordem', tipo_pessoa: 'Tipo de pessoa', perfil: 'Perfil', comarca: 'Comarca', vara: 'Vara',
  valor_causa: 'Valor da causa',
};

const ENTIDADE_LABEL = {
  lancamentos: 'Lançamentos', lancamento_rateio: 'Rateio de lançamento', advogados: 'Advogados',
  clientes: 'Clientes', tipos_processo: 'Tipos de processo', tipos_servico: 'Tipos de serviço',
  advogado_percentual: 'Percentuais por combinação', processos: 'Processos', usuarios: 'Usuários',
};

const TELA_LABEL = { lancamento: 'Lançar', advogados: 'Advogados', clientes: 'Clientes' };

const ACAO_CFG = {
  INSERT: { label: 'Criação', tom: 'neutro' },
  UPDATE: { label: 'Alteração', tom: 'ambar' },
  DELETE: { label: 'Exclusão', tom: 'carimbo' },
  LOGIN: { label: 'Login', tom: 'neutro' },
  EXPORT: { label: 'Exportação', tom: 'neutro' },
};

let filtros = { periodo: '30d', de: '', ate: '', tela: '', entidade: '', acao: '', busca: '' };
let registroIdFiltro = null;
let logsCache = [];

export function destroy() {}

export function render(container) {
  registroIdFiltro = location.hash.split('/')[2] || null;
  filtros = { periodo: '30d', de: '', ate: '', tela: '', entidade: '', acao: '', busca: '' };

  if (sessao.usuario?.perfil === 'leitura') {
    container.innerHTML = '<div class="container"><p class="tela-vazia">Seu perfil não tem acesso ao registro de alterações.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="container">
      <div class="tela-cabecalho"><h1>Registro de alterações</h1></div>
      <div id="aviso-registro"></div>
      <div class="tela-filtros" id="filtros-logs">
        <select class="campo" id="f-periodo" style="width:auto">
          <option value="hoje">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d" selected>Últimos 30 dias</option>
          <option value="mes">Mês atual</option>
          <option value="personalizado">Personalizado…</option>
        </select>
        <input class="campo" type="date" id="f-de" style="width:auto" hidden />
        <input class="campo" type="date" id="f-ate" style="width:auto" hidden />
        <select class="campo" id="f-tela" style="width:auto">
          <option value="">Todas as telas</option>
          <option value="lancamento">Lançar</option>
          <option value="advogados">Advogados</option>
          <option value="clientes">Clientes</option>
        </select>
        <select class="campo" id="f-entidade" style="width:auto">
          <option value="">Todas as entidades</option>
          ${Object.entries(ENTIDADE_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select class="campo" id="f-acao" style="width:auto">
          <option value="">Todas as ações</option>
          ${Object.entries(ACAO_CFG).map(([v, c]) => `<option value="${v}">${c.label}</option>`).join('')}
        </select>
        <input class="campo" type="search" id="f-busca" placeholder="Buscar no motivo…" style="max-width:240px" />
      </div>
      <div id="lista-logs"></div>
    </div>
  `;

  const listaEl = container.querySelector('#lista-logs');
  const avisoEl = container.querySelector('#aviso-registro');

  if (registroIdFiltro) {
    avisoEl.innerHTML = `
      <div class="rascunho-aviso">
        <span>Mostrando o histórico completo deste registro.</span>
        <a class="botao botao-secundario" href="#/logs">Ver todo o registro de alterações</a>
      </div>
    `;
    container.querySelector('#filtros-logs').hidden = true;
  } else {
    const selPeriodo = container.querySelector('#f-periodo');
    const inputDe = container.querySelector('#f-de');
    const inputAte = container.querySelector('#f-ate');
    selPeriodo.addEventListener('change', () => {
      filtros.periodo = selPeriodo.value;
      const personalizado = filtros.periodo === 'personalizado';
      inputDe.hidden = !personalizado;
      inputAte.hidden = !personalizado;
      if (!personalizado) recarregar();
    });
    inputDe.addEventListener('change', () => { filtros.de = inputDe.value; if (filtros.periodo === 'personalizado') recarregar(); });
    inputAte.addEventListener('change', () => { filtros.ate = inputAte.value; if (filtros.periodo === 'personalizado') recarregar(); });
    container.querySelector('#f-tela').addEventListener('change', (ev) => { filtros.tela = ev.target.value; recarregar(); });
    container.querySelector('#f-entidade').addEventListener('change', (ev) => { filtros.entidade = ev.target.value; recarregar(); });
    container.querySelector('#f-acao').addEventListener('change', (ev) => { filtros.acao = ev.target.value; recarregar(); });
    let debounceBusca;
    container.querySelector('#f-busca').addEventListener('input', (ev) => {
      clearTimeout(debounceBusca);
      debounceBusca = setTimeout(() => { filtros.busca = ev.target.value; recarregar(); }, 300);
    });
  }

  async function recarregar() {
    listaEl.innerHTML = '<p class="tela-vazia">Carregando…</p>';
    logsCache = await carregarLogs();
    renderLista(listaEl, logsCache);
  }

  recarregar();
}

function periodoParaIntervalo() {
  if (filtros.periodo === 'personalizado') {
    return {
      de: filtros.de ? `${filtros.de}T00:00:00` : null,
      ate: filtros.ate ? `${filtros.ate}T23:59:59` : null,
    };
  }
  const agora = new Date();
  if (filtros.periodo === 'mes') {
    return { de: new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString(), ate: null };
  }
  const dias = { hoje: 0, '7d': 7, '30d': 30 }[filtros.periodo] ?? 30;
  const de = new Date(agora);
  de.setDate(de.getDate() - dias);
  de.setHours(0, 0, 0, 0);
  return { de: de.toISOString(), ate: null };
}

async function carregarLogs() {
  let query = supabase.from('logs_auditoria').select('*').order('ocorrido_em', { ascending: false }).limit(300);

  if (registroIdFiltro) {
    query = query.eq('registro_id', registroIdFiltro);
  } else {
    const { de, ate } = periodoParaIntervalo();
    if (de) query = query.gte('ocorrido_em', de);
    if (ate) query = query.lte('ocorrido_em', ate);
    if (filtros.tela) query = query.eq('tela', filtros.tela);
    if (filtros.entidade) query = query.eq('entidade', filtros.entidade);
    if (filtros.acao) query = query.eq('acao', filtros.acao);
    if (filtros.busca.trim()) query = query.ilike('motivo', `%${filtros.busca.trim()}%`);
  }

  const { data, error } = await query;
  if (error) { toast.erro('Não foi possível carregar o registro de alterações.'); return []; }
  return data ?? [];
}

// ===== Lista agrupada por dia =====

function tituloDia(iso) {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const mesmoDiA = (a, b) => a.toDateString() === b.toDateString();
  if (mesmoDiA(data, hoje)) return 'Hoje';
  if (mesmoDiA(data, ontem)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(data);
}

function renderLista(container, logs) {
  container.innerHTML = '';
  if (logs.length === 0) {
    container.innerHTML = '<p class="tela-vazia">Nenhum registro encontrado.</p>';
    return;
  }
  let diaAtual = null;
  let secaoAtual = null;
  logs.forEach((log) => {
    const dia = tituloDia(log.ocorrido_em);
    if (dia !== diaAtual) {
      diaAtual = dia;
      secaoAtual = document.createElement('section');
      secaoAtual.className = 'logs-dia';
      const h3 = document.createElement('h3');
      h3.className = 'logs-dia-titulo';
      h3.textContent = dia;
      secaoAtual.appendChild(h3);
      container.appendChild(secaoAtual);
    }
    secaoAtual.appendChild(construirLinhaLog(log));
  });
}

function ehEstorno(log) {
  return log.entidade === 'lancamentos' && log.acao === 'UPDATE'
    && (log.campos ?? []).includes('status') && log.dados_depois?.status === 'estornado';
}

function configAcao(log) {
  if (ehEstorno(log)) return { label: 'Estorno', tom: 'carimbo' };
  return ACAO_CFG[log.acao] ?? { label: log.acao, tom: 'neutro' };
}

function referenciaLegivel(log) {
  const dados = log.dados_depois ?? log.dados_antes ?? {};
  switch (log.entidade) {
    case 'lancamentos': {
      const numero = dados.numero ? `#${String(dados.numero).padStart(6, '0')}` : null;
      const cliente = dados.cliente_id ? store.obterCliente(dados.cliente_id)?.nome : null;
      return [numero, cliente].filter(Boolean).join(' — ') || 'Lançamento';
    }
    case 'lancamento_rateio': {
      const advogado = dados.advogado_id ? store.obterAdvogado(dados.advogado_id)?.nome : null;
      return advogado ? `Rateio — ${advogado}` : 'Rateio';
    }
    case 'advogado_percentual': {
      const advogado = dados.advogado_id ? store.obterAdvogado(dados.advogado_id)?.nome : null;
      return advogado ? `Exceção — ${advogado}` : 'Exceção de percentual';
    }
    case 'processos':
      return dados.numero_cnj ?? 'Processo';
    default:
      return dados.nome ?? ENTIDADE_LABEL[log.entidade] ?? log.entidade;
  }
}

function construirLinhaLog(log) {
  const item = document.createElement('div');
  item.className = 'log-item';

  const cabecalho = document.createElement('button');
  cabecalho.type = 'button';
  cabecalho.className = 'log-item-cabecalho';
  const cfg = configAcao(log);
  const hora = new Date(log.ocorrido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  cabecalho.innerHTML = `
    <span class="log-hora">${hora}</span>
    <span class="log-selo"></span>
    <span class="log-autor">${log.usuario_nome ?? 'Sistema'}</span>
    <span class="log-ref">${escaparHtml(referenciaLegivel(log))}${log.tela && TELA_LABEL[log.tela] ? ` <span class="log-tela">· ${TELA_LABEL[log.tela]}</span>` : ''}</span>
    <span class="log-motivo">${escaparHtml((log.motivo ?? '').split('\n')[0])}</span>
  `;
  cabecalho.querySelector('.log-selo').appendChild(criarSelo({ texto: cfg.label, tom: cfg.tom }));

  const detalhe = document.createElement('div');
  detalhe.className = 'log-detalhe';
  detalhe.hidden = true;
  cabecalho.addEventListener('click', () => {
    detalhe.hidden = !detalhe.hidden;
    if (!detalhe.hidden && !detalhe.dataset.montado) {
      detalhe.appendChild(construirDetalheDiff(log));
      detalhe.dataset.montado = '1';
    }
  });

  item.appendChild(cabecalho);
  item.appendChild(detalhe);
  return item;
}

// ===== Detalhe: diff antes/depois =====

function resolverNomeEntidade(chave, id) {
  if (id == null) return null;
  if (chave === 'cliente_id') return store.obterCliente(id)?.nome ?? id;
  if (chave === 'advogado_id' || chave === 'advogado_indicacao_id') return store.obterAdvogado(id)?.nome ?? id;
  if (chave === 'tipo_processo_id') return store.listarTiposProcesso().find((t) => t.id === id)?.nome ?? id;
  if (chave === 'tipo_servico_id') return store.listarTiposServico().find((t) => t.id === id)?.nome ?? id;
  return id;
}

function formatarValorDiff(chave, valor) {
  if (valor === undefined || valor === null) return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (chave.endsWith('_id')) return escaparHtml(String(resolverNomeEntidade(chave, valor)));
  if (/^valor(_bruto|_base)?$/.test(chave)) return formatarMoeda(valor);
  if (chave.includes('percentual')) return formatarPercentual(valor);
  if ((chave.startsWith('data_') || chave.endsWith('_em')) && typeof valor === 'string' && valor.length >= 10) {
    return formatarData(valor);
  }
  return escaparHtml(String(valor));
}

function humanizarCampo(chave) {
  return ROTULOS_CAMPO[chave] ?? chave.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function linhaDiff(chave, antes, depois, destaque) {
  const tr = document.createElement('tr');
  if (destaque) tr.className = 'linha-diff-destaque';
  tr.innerHTML = `
    <td>${humanizarCampo(chave)}</td>
    <td>${formatarValorDiff(chave, antes)}</td>
    <td>${formatarValorDiff(chave, depois)}</td>
  `;
  return tr;
}

function construirDetalheDiff(log) {
  const wrap = document.createElement('div');
  wrap.className = 'log-diff';

  if (log.motivo) {
    const motivoEl = document.createElement('p');
    motivoEl.className = 'log-motivo-completo';
    motivoEl.textContent = `Motivo: ${log.motivo}`;
    wrap.appendChild(motivoEl);
  }

  const antes = log.dados_antes ?? {};
  const depois = log.dados_depois ?? {};
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((k) => !CAMPOS_TECNICOS.has(k));
  const alteradas = new Set(log.campos ?? []);
  const emDestaque = chaves.filter((k) => alteradas.size === 0 || alteradas.has(k));
  const recolhidos = chaves.filter((k) => !emDestaque.includes(k));

  const cabecalhoTabela = document.createElement('div');
  cabecalhoTabela.className = 'log-diff-cabecalho';
  cabecalhoTabela.innerHTML = '<span>Campo</span><span>Antes</span><span>Depois</span>';
  wrap.appendChild(cabecalhoTabela);

  const tabela = document.createElement('table');
  tabela.className = 'tabela-diff';
  const corpo = document.createElement('tbody');
  emDestaque.forEach((k) => corpo.appendChild(linhaDiff(k, antes[k], depois[k], true)));
  tabela.appendChild(corpo);
  wrap.appendChild(tabela);

  if (recolhidos.length) {
    const btnMais = document.createElement('button');
    btnMais.type = 'button';
    btnMais.className = 'botao-texto';
    btnMais.textContent = `+ ver mais ${recolhidos.length} campo(s)`;
    btnMais.addEventListener('click', () => {
      recolhidos.forEach((k) => corpo.appendChild(linhaDiff(k, antes[k], depois[k], false)));
      btnMais.remove();
    });
    wrap.appendChild(btnMais);
  }

  if (sessao.usuario?.perfil === 'admin') {
    const tecnico = document.createElement('details');
    tecnico.className = 'log-tecnico';
    const resumo = document.createElement('summary');
    resumo.textContent = 'Ver dados técnicos';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ antes: log.dados_antes, depois: log.dados_depois }, null, 2);
    tecnico.appendChild(resumo);
    tecnico.appendChild(pre);
    wrap.appendChild(tecnico);
  }

  return wrap;
}
