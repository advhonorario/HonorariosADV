import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { criarTabela } from '../componentes/tabela.js';
import { criarSelo } from '../componentes/selo.js';
import { criarCombobox } from '../componentes/combobox.js';
import { abrirGaveta, fecharGaveta } from '../componentes/gaveta.js';
import { abrirModalMotivo } from '../componentes/modal-motivo.js';
import { toast } from '../componentes/toast.js';
import { formatarPercentual, formatarMoeda, mascararCpfCnpj, validarCpfCnpj, debounce } from '../formato.js';
import { podeEscrever } from '../sessao.js';

export const titulo = 'Clientes';

let desinscrever = [];
let filtroTexto = '';
let clientesCache = [];

export function destroy() {
  desinscrever.forEach((fn) => fn());
  desinscrever = [];
  fecharGaveta();
}

async function carregarClientes() {
  const { data, error } = await supabase.from('vw_clientes').select('*').order('nome');
  if (error) { toast.erro('Não foi possível carregar os clientes.'); return []; }
  return data ?? [];
}

export function render(container) {
  destroy();
  container.innerHTML = `
    <div class="container">
      <div class="tela-cabecalho">
        <h1>Clientes</h1>
        ${podeEscrever() ? '<button class="botao botao-primario" id="btn-novo-cliente"><svg width="16" height="16"><use href="#icone-adicionar"/></svg> Novo cliente</button>' : ''}
      </div>
      <div class="tela-filtros">
        <input class="campo" id="busca-clientes" type="search" placeholder="Buscar por nome ou CPF/CNPJ…" style="max-width:280px" />
      </div>
      <div id="lista-clientes"></div>
    </div>
  `;

  const listaEl = container.querySelector('#lista-clientes');
  const busca = container.querySelector('#busca-clientes');

  function nomeIndicador(id) {
    if (!id) return '—';
    return store.obterAdvogado(id)?.nome ?? '—';
  }

  function renderLista() {
    let dados = clientesCache;
    if (filtroTexto.trim()) {
      const termo = filtroTexto.trim().toLowerCase();
      dados = dados.filter((c) => c.nome.toLowerCase().includes(termo) || (c.cpf_cnpj ?? '').includes(termo));
    }
    listaEl.innerHTML = '';
    if (dados.length === 0) {
      listaEl.innerHTML = '<p class="tela-vazia">Nenhum cliente encontrado.</p>';
      return;
    }
    const tabela = criarTabela({
      colunas: [
        { rotulo: 'Nome', campo: 'nome' },
        { rotulo: 'CPF/CNPJ' },
        { rotulo: 'Cidade/UF' },
        { rotulo: 'Indicado por' },
        { rotulo: '% indicação' },
        { rotulo: 'Faturado (período)' },
        { rotulo: 'Último lançamento' },
        { rotulo: 'Situação' },
      ],
      linhas: dados,
      chave: 'id',
      classeLinha: (c) => (c.ativo ? '' : 'linha-inativa'),
      renderLinha(tr, c) {
        tr.innerHTML = `
          <td>${c.nome}</td>
          <td>${c.cpf_cnpj ?? '—'}</td>
          <td>${c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : '—'}</td>
          <td>${nomeIndicador(c.advogado_indicacao_id)}</td>
          <td class="campo-percentual">${c.advogado_indicacao_id ? formatarPercentual(c.percentual_indicacao) : '—'}</td>
          <td class="campo-valor" title="Disponível a partir da Fase 3">${formatarMoeda(0)}</td>
          <td>—</td>
        `;
        const tdS = document.createElement('td');
        tdS.appendChild(c.ativo ? criarSelo({ texto: 'ativo', tom: 'confirma' }) : criarSelo({ texto: 'inativo', tom: 'neutro' }));
        tr.appendChild(tdS);
      },
      aoClicarLinha: (c) => abrirFichaCliente(c, recarregarERenderizar),
    });
    listaEl.appendChild(tabela.el);
  }

  busca.addEventListener('input', debounce(() => { filtroTexto = busca.value; renderLista(); }, 200));
  container.querySelector('#btn-novo-cliente')?.addEventListener('click', () => abrirFichaCliente(null, recarregarERenderizar));

  async function recarregarERenderizar() {
    clientesCache = await carregarClientes();
    renderLista();
  }

  desinscrever.push(store.on('advogados', renderLista));
  recarregarERenderizar();
}

function abrirFichaCliente(cliente, aoSalvar) {
  const ehNovo = !cliente;
  let alterado = false;
  let comboIndicador;

  abrirGaveta({
    titulo: ehNovo ? 'Novo cliente' : cliente.nome,
    temAlteracoes: () => alterado,
    montarConteudo(corpo, fechar) {
      corpo.innerHTML = `
        <section class="gaveta-bloco">
          <h3>Identificação</h3>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-nome">Nome</label>
            <input class="campo" id="f-nome" value="${cliente?.nome ?? ''}" />
          </div>
          <div class="gaveta-linha">
            <div>
              <label class="rotulo-campo" for="f-tipo-pessoa">Tipo de pessoa</label>
              <select class="campo" id="f-tipo-pessoa">
                <option value="fisica" ${cliente?.tipo_pessoa === 'fisica' ? 'selected' : ''}>Física</option>
                <option value="juridica" ${cliente?.tipo_pessoa === 'juridica' ? 'selected' : ''}>Jurídica</option>
              </select>
            </div>
            <div><label class="rotulo-campo" for="f-cpf">CPF/CNPJ</label><input class="campo" id="f-cpf" value="${cliente?.cpf_cnpj ?? ''}" /></div>
          </div>
          <div id="erro-cpf"></div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-email">E-mail</label><input class="campo" id="f-email" type="email" value="${cliente?.email ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-telefone">Telefone</label><input class="campo" id="f-telefone" value="${cliente?.telefone ?? ''}" /></div>
          </div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-cidade">Cidade</label><input class="campo" id="f-cidade" value="${cliente?.cidade ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-uf">UF</label><input class="campo" id="f-uf" maxlength="2" value="${cliente?.uf ?? ''}" /></div>
          </div>
        </section>

        <section class="gaveta-bloco">
          <h3>Origem</h3>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="combo-indicador">Advogado indicador</label>
            <div id="combo-indicador"></div>
          </div>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-percentual-indicacao">Percentual de indicação</label>
            <input class="campo" id="f-percentual-indicacao" type="number" step="0.001" value="${cliente?.percentual_indicacao ?? 0}" />
          </div>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-origem">Origem (texto livre)</label>
            <input class="campo" id="f-origem" value="${cliente?.origem ?? ''}" />
          </div>
          <div id="previa-indicacao"></div>
        </section>

        <section class="gaveta-bloco">
          <h3>Últimos lançamentos</h3>
          <p class="tela-vazia" style="padding: var(--e4) 0">Nenhum lançamento registrado ainda.</p>
        </section>

        ${podeEscrever() ? '<button class="botao botao-primario" id="btn-salvar-cliente">Salvar</button>' : ''}
      `;

      corpo.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', () => { alterado = true; }));
      corpo.querySelector('#f-cpf')?.addEventListener('input', (ev) => { ev.target.value = mascararCpfCnpj(ev.target.value); });

      const containerCombo = corpo.querySelector('#combo-indicador');
      function atualizarPrevia() {
        const idIndicador = comboIndicador.obterValor();
        const pct = Number(corpo.querySelector('#f-percentual-indicacao').value);
        const previa = corpo.querySelector('#previa-indicacao');
        if (idIndicador && pct > 0) {
          const nome = store.obterAdvogado(idIndicador)?.nome ?? '';
          previa.innerHTML = `<div class="previa-indicacao">Toda vez que este cliente for lançado, ${nome} entra no rateio com ${pct}% como indicação — é possível remover linha a linha no lançamento.</div>`;
        } else {
          previa.innerHTML = '';
        }
      }
      comboIndicador = criarCombobox({
        itens: store.listarAdvogados({ ativos: true }),
        campoTexto: 'nome',
        campoValor: 'id',
        placeholder: 'Buscar advogado por nome…',
        valorInicial: cliente?.advogado_indicacao_id ?? null,
        onSelecionar: () => { alterado = true; atualizarPrevia(); },
      });
      containerCombo.appendChild(comboIndicador.el);
      corpo.querySelector('#f-percentual-indicacao').addEventListener('input', atualizarPrevia);
      atualizarPrevia();

      corpo.querySelector('#btn-salvar-cliente')?.addEventListener('click', async () => {
        const cpf = corpo.querySelector('#f-cpf').value;
        if (!validarCpfCnpj(cpf)) {
          corpo.querySelector('#erro-cpf').innerHTML = '<div class="mensagem-erro">CPF/CNPJ inválido.</div>';
          return;
        }
        corpo.querySelector('#erro-cpf').innerHTML = '';

        const dadosBase = {
          nome: corpo.querySelector('#f-nome').value.trim(),
          tipo_pessoa: corpo.querySelector('#f-tipo-pessoa').value,
          cpf_cnpj: cpf || null,
          email: corpo.querySelector('#f-email').value.trim() || null,
          telefone: corpo.querySelector('#f-telefone').value.trim() || null,
          cidade: corpo.querySelector('#f-cidade').value.trim() || null,
          uf: corpo.querySelector('#f-uf').value.trim() || null,
          origem: corpo.querySelector('#f-origem').value.trim() || null,
        };
        const novoIndicador = comboIndicador.obterValor();
        const novoPercentual = Number(corpo.querySelector('#f-percentual-indicacao').value) || 0;

        if (ehNovo) {
          const { data, error } = await supabase.from('clientes').insert({
            ...dadosBase, advogado_indicacao_id: novoIndicador, percentual_indicacao: novoPercentual,
          }).select().single();
          if (error) return toast.erro('Não foi possível criar o cliente. ' + error.message);
          toast.sucesso('Cliente criado.');
          alterado = false;
          fechar();
          aoSalvar?.();
          return;
        }

        const { error: erroBase } = await supabase.from('clientes').update(dadosBase).eq('id', cliente.id);
        if (erroBase) return toast.erro('Não foi possível salvar. ' + erroBase.message);

        const indicadorMudou = cliente.advogado_indicacao_id !== novoIndicador;
        const percentualMudou = cliente.percentual_indicacao !== novoPercentual;
        if (indicadorMudou || percentualMudou) {
          let motivo = null;
          const removendoOuTrocando = cliente.advogado_indicacao_id && cliente.advogado_indicacao_id !== novoIndicador;
          if (removendoOuTrocando) {
            motivo = await abrirModalMotivo({
              titulo: 'Confirmar alteração',
              contexto: `Cliente ${cliente.nome}`,
              diferencas: [{ campo: 'Advogado indicador', de: nomeIndicadorAtual(cliente), para: novoIndicador ? (store.obterAdvogado(novoIndicador)?.nome ?? '') : '—' }],
              categoriaMotivos: 'remover_indicacao',
            });
            if (motivo === null) return;
          }
          const { error: erroInd } = await supabase.rpc('rpc_atualizar_indicacao_cliente', {
            p_cliente_id: cliente.id,
            p_advogado_indicacao_id: novoIndicador,
            p_percentual_indicacao: novoPercentual,
            p_motivo: motivo,
          });
          if (erroInd) return toast.erro(erroInd.message);
        }

        toast.sucesso('Alteração salva.');
        alterado = false;
        fechar();
        aoSalvar?.();
      });

      if (!ehNovo && podeEscrever() && cliente.ativo) {
        const rodape = document.createElement('div');
        rodape.className = 'gaveta-rodape';
        const btnInativar = document.createElement('button');
        btnInativar.className = 'botao botao-perigo';
        btnInativar.textContent = 'Inativar';
        btnInativar.addEventListener('click', async () => {
          const motivo = await abrirModalMotivo({
            titulo: 'Inativar cliente',
            contexto: `${cliente.nome} deixará de aparecer nos seletores de novos lançamentos.`,
            categoriaMotivos: 'inativar_cliente',
          });
          if (motivo === null) return;
          const { error } = await supabase.rpc('rpc_inativar_cliente', { p_id: cliente.id, p_motivo: motivo });
          if (error) return toast.erro(error.message);
          toast.sucesso('Cliente inativado.');
          alterado = false;
          fechar();
          aoSalvar?.();
        });
        rodape.appendChild(btnInativar);
        return rodape;
      }
    },
  });
}

function nomeIndicadorAtual(cliente) {
  if (!cliente.advogado_indicacao_id) return '—';
  return store.obterAdvogado(cliente.advogado_indicacao_id)?.nome ?? '—';
}
