import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { criarCombobox } from '../componentes/combobox.js';
import { criarBarraRateio } from '../componentes/barra-rateio.js';
import { criarTabela } from '../componentes/tabela.js';
import { criarSelo } from '../componentes/selo.js';
import { toast } from '../componentes/toast.js';
import { formatarMoeda, formatarData, formatarPercentual, mascararMoeda, moedaParaNumero } from '../formato.js';
import { resolverPercentualSugerido, calcularRateioMaiorResto } from '../rateio.js';
import { podeEscrever } from '../sessao.js';
import { irCriarERetornar, consumirAutoRetomar } from '../navegacao-cadastro.js';

export const titulo = 'Lançar';

const CHAVE_RASCUNHO = 'honorarios-rascunho-lancamento';
const FORMAS_PAGAMENTO = ['PIX', 'Transferência', 'Boleto', 'Cartão', 'Dinheiro'];
const PAPEL_LABEL = {
  responsavel: 'Responsável',
  indicacao: 'Indicação',
  parceria: 'Parceria',
  correspondente: 'Correspondente',
  sucumbencia: 'Sucumbência',
};
const PAPEIS = Object.keys(PAPEL_LABEL);

let desinscrever = [];
let intervaloRascunho = null;
let ultimoSalvo = null; // payload exato do último lançamento salvo nesta sessão (Alt+D)
let contadorLinha = 0;
let recentesCache = [];
let barraRateio = null;
let tabelaRecentes = null;
let elFicha = null;
let elErroSoma = null;
let elBtnSalvar = null;
let comboCliente = null;
let comboProcesso = null;
let comboTipoProcesso = null;
let comboTipoServico = null;

function estadoVazio() {
  return {
    clienteId: null,
    processoId: null,
    tipoProcessoId: null,
    tipoServicoId: null,
    dataCompetencia: hojeISO(),
    dataPagamento: '',
    formaPagamento: FORMAS_PAGAMENTO[0],
    valorBrutoCentavos: 0,
    descontarBase: false,
    valorBaseCentavos: 0,
    motivoDeducao: '',
    descricao: '',
    linhas: [],
    linhaIndicacaoUid: null,
  };
}

let estado = estadoVazio();

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function destroy() {
  desinscrever.forEach((fn) => fn());
  desinscrever = [];
  if (intervaloRascunho) { clearInterval(intervaloRascunho); intervaloRascunho = null; }
  document.removeEventListener('keydown', aoTeclaGlobal);
}

export function render(container) {
  destroy();

  const rascunho = lerRascunho();
  // Quem voltou de "+ novo cliente/advogado/tipo" (navegacao-cadastro.js) já
  // sabe que quer continuar de onde parou — retoma direto, sem perguntar.
  const autoRetomar = consumirAutoRetomar() && !!rascunho && podeEscrever();
  container.innerHTML = `
    <div class="container">
      <div class="tela-cabecalho"><h1>Lançar</h1></div>
      ${(rascunho && !autoRetomar) ? `
        <div class="rascunho-aviso" id="aviso-rascunho">
          <span>${textoAvisoRascunho(rascunho)}</span>
          <div class="rascunho-aviso-acoes">
            <button class="botao botao-secundario" id="btn-descartar-rascunho">Descartar</button>
            <button class="botao botao-primario" id="btn-retomar-rascunho">Retomar</button>
          </div>
        </div>
      ` : ''}
      <div id="area-formulario"></div>
      <div class="lancamentos-recentes">
        <h2>Lançamentos recentes</h2>
        <div id="lista-recentes"></div>
      </div>
    </div>
  `;

  const area = container.querySelector('#area-formulario');

  container.querySelector('#btn-descartar-rascunho')?.addEventListener('click', () => {
    limparRascunho();
    container.querySelector('#aviso-rascunho')?.remove();
  });
  container.querySelector('#btn-retomar-rascunho')?.addEventListener('click', () => {
    container.querySelector('#aviso-rascunho')?.remove();
    retomarRascunho(area, rascunho);
  });

  if (!podeEscrever()) {
    area.innerHTML = '<p class="tela-vazia">Seu perfil não tem permissão para lançar honorários.</p>';
  } else if (autoRetomar) {
    retomarRascunho(area, rascunho);
  } else {
    estado = estadoVazio();
    montarFormulario(area);
  }

  document.addEventListener('keydown', aoTeclaGlobal);
  intervaloRascunho = setInterval(() => gravarRascunho(), 2000);

  desinscrever.push(store.on('clientes', () => comboCliente?.atualizarItens?.(store.listarClientes({ ativos: true }))));

  const listaRecentesEl = container.querySelector('#lista-recentes');
  carregarRecentes().then((dados) => {
    recentesCache = dados;
    renderRecentes(listaRecentesEl);
  });
}

function retomarRascunho(area, rascunho) {
  estado = rascunho;
  montarFormulario(area);
  repovoarProcessos(area, estado.clienteId);
}

function textoAvisoRascunho(rascunho) {
  const nome = rascunho.clienteId ? store.obterCliente(rascunho.clienteId)?.nome : null;
  return nome
    ? `Há um lançamento não concluído de ${nome} — deseja retomar?`
    : 'Há um lançamento não concluído — deseja retomar?';
}

// ===== Rascunho automático (sessionStorage) =====

function gravarRascunho() {
  // A tela sempre nasce com uma linha de rateio em branco (sem advogado) —
  // isso sozinho não é "conteúdo digitado", senão toda visita à tela vira
  // rascunho depois de 2s mesmo sem o usuário ter feito nada.
  const temLinhaPreenchida = estado.linhas.some((l) => l.advogadoId);
  const temConteudo = estado.clienteId || estado.valorBrutoCentavos > 0 || temLinhaPreenchida;
  if (!temConteudo) return;
  const serializavel = {
    ...estado,
    linhas: estado.linhas.map((l) => ({
      advogadoId: l.advogadoId, papel: l.papel, percentual: l.percentual,
      percentualSugerido: l.percentualSugerido, origem: l.origem, bloqueado: l.bloqueado,
    })),
  };
  sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(serializavel));
}

function lerRascunho() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_RASCUNHO);
    if (!bruto) return null;
    const dados = JSON.parse(bruto);
    const temLinhaPreenchida = (dados.linhas ?? []).some((l) => l.advogadoId);
    if (!dados.clienteId && !(dados.valorBrutoCentavos > 0) && !temLinhaPreenchida) return null;
    dados.linhaIndicacaoUid = null;
    return dados;
  } catch {
    return null;
  }
}

function limparRascunho() {
  sessionStorage.removeItem(CHAVE_RASCUNHO);
}

// ===== Atalhos de teclado =====

function aoTeclaGlobal(ev) {
  if (!podeEscrever()) return;
  if (ev.ctrlKey && ev.key.toLowerCase() === 's') {
    ev.preventDefault();
    acionarSalvar({ eNovo: false });
  } else if (ev.ctrlKey && ev.key === 'Enter') {
    ev.preventDefault();
    acionarSalvar({ eNovo: true });
  } else if (ev.altKey && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    adicionarLinhaRateio();
  } else if (ev.altKey && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    duplicarUltimoSalvo();
  }
}

// ===== Montagem do formulário =====

function montarFormulario(area) {
  area.innerHTML = `
    <div class="tela-lancamento-grade">
      <div class="ficha-lancamento">
        <div class="campo-grupo">
          <div class="rotulo-linha">
            <label class="rotulo-campo" for="combo-cliente">Cliente</label>
            <button type="button" class="botao-texto botao-novo-cadastro" data-rota="#/clientes">+ novo cliente</button>
          </div>
          <div id="combo-cliente"></div>
        </div>
        <div class="campo-grupo">
          <label class="rotulo-campo" for="combo-processo">Processo</label>
          <div id="combo-processo"></div>
        </div>
        <div class="gaveta-linha">
          <div>
            <div class="rotulo-linha">
              <label class="rotulo-campo" for="combo-tipo-processo">Tipo de processo</label>
              <button type="button" class="botao-texto botao-novo-cadastro" data-rota="#/tabelas/processo">+ novo</button>
            </div>
            <div id="combo-tipo-processo"></div>
          </div>
          <div>
            <div class="rotulo-linha">
              <label class="rotulo-campo" for="combo-tipo-servico">Tipo de serviço</label>
              <button type="button" class="botao-texto botao-novo-cadastro" data-rota="#/tabelas/servico">+ novo</button>
            </div>
            <div id="combo-tipo-servico"></div>
          </div>
        </div>
        <div class="gaveta-linha">
          <div><label class="rotulo-campo" for="f-competencia">Competência</label><input class="campo" type="date" id="f-competencia" value="${estado.dataCompetencia}" /></div>
          <div><label class="rotulo-campo" for="f-pagamento">Pagamento</label><input class="campo" type="date" id="f-pagamento" value="${estado.dataPagamento}" /></div>
        </div>
        <div class="campo-grupo">
          <label class="rotulo-campo" for="f-forma">Forma de pagamento</label>
          <select class="campo" id="f-forma">
            ${FORMAS_PAGAMENTO.map((f) => `<option value="${f}" ${estado.formaPagamento === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="campo-grupo">
          <label class="rotulo-campo" for="f-valor-bruto">Valor bruto</label>
          <input class="campo campo-valor" id="f-valor-bruto" inputmode="numeric" value="${formatarMoeda(estado.valorBrutoCentavos / 100)}" />
        </div>
        <button type="button" class="botao-texto" id="btn-descontar-base">${estado.descontarBase ? '▾' : '▸'} descontar da base do rateio</button>
        <div class="campo-deducao" id="bloco-deducao" ${estado.descontarBase ? '' : 'hidden'}>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-valor-base">Valor base do rateio</label>
            <input class="campo campo-valor" id="f-valor-base" inputmode="numeric" value="${formatarMoeda((estado.valorBaseCentavos || estado.valorBrutoCentavos) / 100)}" />
          </div>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-motivo-deducao">Justificativa (custas, taxa de cartão, repasse a terceiro)</label>
            <input class="campo" id="f-motivo-deducao" value="${estado.motivoDeducao ?? ''}" />
          </div>
        </div>

        <div class="campo-grupo" style="margin-top: var(--e5)">
          <div class="tela-cabecalho" style="margin-bottom: var(--e3)">
            <span class="rotulo-campo" style="margin:0">Advogados</span>
            <button type="button" class="botao-texto" id="btn-add-linha">+ adicionar (Alt+A)</button>
          </div>
          <div class="rateio-linhas" id="rateio-linhas"></div>
        </div>

        <div class="campo-grupo">
          <label class="rotulo-campo" for="f-descricao">Descrição</label>
          <input class="campo" id="f-descricao" value="${estado.descricao ?? ''}" />
        </div>
      </div>
      <div class="painel-rateio" id="painel-rateio">
        <div id="erro-soma"></div>
        <div class="painel-rateio-acoes">
          <button type="button" class="botao botao-primario" id="btn-salvar">Salvar (Ctrl+S)</button>
          <button type="button" class="botao botao-secundario" id="btn-salvar-novo">Salvar e novo (Ctrl+↵)</button>
        </div>
      </div>
    </div>
  `;

  elFicha = area.querySelector('.ficha-lancamento');
  elErroSoma = area.querySelector('#erro-soma');
  elBtnSalvar = area.querySelector('#btn-salvar');

  barraRateio = criarBarraRateio();
  area.querySelector('#painel-rateio').prepend(barraRateio.el);

  montarComboCliente(area);
  montarComboProcesso(area, []);
  montarComboTipos(area);

  area.querySelectorAll('.botao-novo-cadastro').forEach((btn) => {
    btn.addEventListener('click', () => {
      gravarRascunho();
      irCriarERetornar(btn.dataset.rota);
    });
  });

  area.querySelector('#f-competencia').addEventListener('input', (ev) => { estado.dataCompetencia = ev.target.value; });
  area.querySelector('#f-pagamento').addEventListener('input', (ev) => { estado.dataPagamento = ev.target.value; });
  area.querySelector('#f-forma').addEventListener('change', (ev) => { estado.formaPagamento = ev.target.value; });
  area.querySelector('#f-descricao').addEventListener('input', (ev) => { estado.descricao = ev.target.value; });

  const inputValorBruto = area.querySelector('#f-valor-bruto');
  inputValorBruto.addEventListener('input', (ev) => {
    ev.target.value = mascararMoeda(ev.target.value);
    estado.valorBrutoCentavos = Math.round(moedaParaNumero(ev.target.value) * 100);
    if (!estado.descontarBase) estado.valorBaseCentavos = estado.valorBrutoCentavos;
    atualizarBarra();
  });

  const btnDescontar = area.querySelector('#btn-descontar-base');
  const blocoDeducao = area.querySelector('#bloco-deducao');
  const inputValorBase = area.querySelector('#f-valor-base');
  btnDescontar.addEventListener('click', () => {
    estado.descontarBase = !estado.descontarBase;
    btnDescontar.textContent = `${estado.descontarBase ? '▾' : '▸'} descontar da base do rateio`;
    blocoDeducao.hidden = !estado.descontarBase;
    if (estado.descontarBase) {
      // O campo só existe/é usado a partir daqui — sincroniza com o valor
      // bruto atual em vez de mostrar o que estava congelado na montagem do
      // formulário (que pode ter sido "R$ 0,00" se o valor ainda não existia).
      inputValorBase.value = formatarMoeda(estado.valorBaseCentavos / 100);
    } else {
      estado.valorBaseCentavos = estado.valorBrutoCentavos;
      atualizarBarra();
    }
  });
  inputValorBase.addEventListener('input', (ev) => {
    ev.target.value = mascararMoeda(ev.target.value);
    estado.valorBaseCentavos = Math.round(moedaParaNumero(ev.target.value) * 100);
    atualizarBarra();
  });
  area.querySelector('#f-motivo-deducao').addEventListener('input', (ev) => { estado.motivoDeducao = ev.target.value; });

  area.querySelector('#btn-add-linha').addEventListener('click', () => adicionarLinhaRateio());
  area.querySelector('#btn-salvar').addEventListener('click', () => acionarSalvar({ eNovo: false }));
  area.querySelector('#btn-salvar-novo').addEventListener('click', () => acionarSalvar({ eNovo: true }));

  const containerLinhas = area.querySelector('#rateio-linhas');
  estado.linhas.forEach((l) => containerLinhas.appendChild(construirLinhaDom(l)));
  // Linha em branco automática, só pra ter onde começar — não rouba o foco do
  // Cliente, que é o primeiro campo que o usuário deve preencher.
  if (estado.linhas.length === 0) adicionarLinhaRateio(undefined, { focar: false });

  atualizarBarra();

  // Cliente é o ponto de partida do lançamento; a partir dele é que se resolve
  // advogado de indicação, tipos sugeridos etc. — foco vai pra lá, não pro
  // advogado da linha de rateio em branco.
  if (!estado.clienteId) area.querySelector('#combo-cliente input')?.focus();
}

// ===== Combobox de cliente/processo/tipos =====

function montarComboCliente(area) {
  const alvo = area.querySelector('#combo-cliente');
  comboCliente = criarCombobox({
    itens: store.listarClientes({ ativos: true }),
    campoTexto: 'nome',
    campoValor: 'id',
    placeholder: 'Buscar cliente por nome…',
    valorInicial: estado.clienteId,
    onSelecionar: (id) => aoSelecionarCliente(area, id),
  });
  alvo.appendChild(comboCliente.el);
}

async function repovoarProcessos(area, clienteId) {
  if (!clienteId) { montarComboProcesso(area, []); return; }
  const { data } = await supabase.from('processos').select('*').eq('cliente_id', clienteId).eq('encerrado', false);
  montarComboProcesso(area, data ?? []);
}

function montarComboProcesso(area, processos) {
  const alvo = area.querySelector('#combo-processo');
  alvo.innerHTML = '';
  const itens = processos.map((p) => ({
    ...p,
    rotulo: p.numero_cnj ?? `Processo sem número (${formatarData(p.data_distribuicao)})`,
  }));
  comboProcesso = criarCombobox({
    itens,
    campoTexto: 'rotulo',
    campoValor: 'id',
    placeholder: itens.length ? 'Buscar processo…' : 'Sem processos ativos para este cliente',
    valorInicial: estado.processoId,
    onSelecionar: (id, item) => {
      estado.processoId = id;
      if (item?.tipo_processo_id) {
        estado.tipoProcessoId = item.tipo_processo_id;
        comboTipoProcesso.definirValor(item.tipo_processo_id);
        recalcularSugestoesTodasLinhas();
      }
    },
  });
  alvo.appendChild(comboProcesso.el);
}

function montarComboTipos(area) {
  const alvoTP = area.querySelector('#combo-tipo-processo');
  comboTipoProcesso = criarCombobox({
    itens: store.listarTiposProcesso(),
    campoTexto: 'nome',
    campoValor: 'id',
    placeholder: 'Tipo de processo…',
    valorInicial: estado.tipoProcessoId,
    onSelecionar: (id) => { estado.tipoProcessoId = id; recalcularSugestoesTodasLinhas(); },
  });
  alvoTP.appendChild(comboTipoProcesso.el);

  const alvoTS = area.querySelector('#combo-tipo-servico');
  comboTipoServico = criarCombobox({
    itens: store.listarTiposServico(),
    campoTexto: 'nome',
    campoValor: 'id',
    placeholder: 'Tipo de serviço…',
    valorInicial: estado.tipoServicoId,
    onSelecionar: (id) => { estado.tipoServicoId = id; recalcularSugestoesTodasLinhas(); },
  });
  alvoTS.appendChild(comboTipoServico.el);
}

async function aoSelecionarCliente(area, clienteId) {
  estado.clienteId = clienteId;
  estado.processoId = null;
  if (!clienteId) { montarComboProcesso(area, []); return; }

  const cliente = store.obterCliente(clienteId);

  const [{ data: processos }, { data: sugestao, error: erroSugestao }] = await Promise.all([
    supabase.from('processos').select('*').eq('cliente_id', clienteId).eq('encerrado', false),
    supabase.rpc('rpc_sugestao_cliente', { p_cliente_id: clienteId }),
  ]);
  montarComboProcesso(area, processos ?? []);

  if (!erroSugestao && sugestao) {
    if (sugestao.tipo_processo_id) { estado.tipoProcessoId = sugestao.tipo_processo_id; comboTipoProcesso.definirValor(sugestao.tipo_processo_id); }
    if (sugestao.tipo_servico_id) { estado.tipoServicoId = sugestao.tipo_servico_id; comboTipoServico.definirValor(sugestao.tipo_servico_id); }
  }

  // Remove a linha de indicação automática anterior (se o cliente mudou) e
  // qualquer linha ainda em branco (placeholder), para não deixar uma linha
  // vazia duplicada ao lado da linha de indicação recém-adicionada.
  if (estado.linhaIndicacaoUid) {
    removerLinhaRateio(estado.linhaIndicacaoUid);
    estado.linhaIndicacaoUid = null;
  }
  [...estado.linhas].filter((l) => !l.advogadoId).forEach((l) => removerLinhaRateio(l.uid));

  if (cliente?.advogado_indicacao_id && Number(cliente.percentual_indicacao) > 0) {
    const linha = adicionarLinhaRateio({
      advogadoId: cliente.advogado_indicacao_id,
      papel: 'indicacao',
      percentual: Number(cliente.percentual_indicacao),
      origem: 'padrao_advogado',
      bloqueado: true,
    });
    estado.linhaIndicacaoUid = linha.uid;
  }
  if (estado.linhas.length === 0) adicionarLinhaRateio(undefined, { focar: false });

  recalcularSugestoesTodasLinhas();
}

// ===== Linhas de rateio =====

function novaLinhaEstado(dados) {
  contadorLinha += 1;
  return {
    uid: `linha-${contadorLinha}`,
    advogadoId: dados?.advogadoId ?? null,
    papel: dados?.papel ?? 'responsavel',
    percentual: dados?.percentual ?? 0,
    percentualSugerido: dados?.percentual ?? 0,
    origem: dados?.origem ?? 'manual',
    bloqueado: dados?.bloqueado ?? true,
    excecoes: [],
  };
}

function adicionarLinhaRateio(dadosIniciais, { focar = !dadosIniciais } = {}) {
  const linha = novaLinhaEstado(dadosIniciais);
  estado.linhas.push(linha);
  const containerLinhas = elFicha?.querySelector('#rateio-linhas');
  if (containerLinhas) {
    const el = construirLinhaDom(linha);
    containerLinhas.appendChild(el);
    if (focar) el.querySelector('.combobox input')?.focus();
  }
  atualizarBarra();
  return linha;
}

function removerLinhaRateio(uid) {
  const indice = estado.linhas.findIndex((l) => l.uid === uid);
  if (indice === -1) return;
  estado.linhas.splice(indice, 1);
  elFicha?.querySelector(`[data-uid="${uid}"]`)?.remove();
  atualizarBarra();
}

function existeDuplicidade(uid, advogadoId, papel) {
  return estado.linhas.some((l) => l.uid !== uid && l.advogadoId === advogadoId && l.papel === papel && advogadoId);
}

async function excecoesDoAdvogado(linha) {
  if (!linha.advogadoId) return [];
  const { data } = await supabase.from('advogado_percentual').select('*').eq('advogado_id', linha.advogadoId).eq('ativo', true);
  linha.excecoes = data ?? [];
  return linha.excecoes;
}

function recalcularSugestaoLinha(linha) {
  if (!linha.advogadoId) return;
  // Papel `indicacao` não segue a cascata do §4.4 — o percentual vem de
  // `clientes.percentual_indicacao` (aplicado uma vez, ao escolher o cliente).
  if (linha.papel === 'indicacao') return;
  const advogado = store.obterAdvogado(linha.advogadoId);
  const tipoServico = estado.tipoServicoId ? store.listarTiposServico().find((t) => t.id === estado.tipoServicoId) : null;
  const { percentual, origem } = resolverPercentualSugerido({
    tipoProcessoId: estado.tipoProcessoId,
    tipoServicoId: estado.tipoServicoId,
    excecoes: linha.excecoes,
    advogado,
    tipoServico,
  });
  linha.percentualSugerido = percentual;
  if (linha.bloqueado) {
    linha.percentual = percentual;
    linha.origem = origem;
  }
}

function recalcularSugestoesTodasLinhas() {
  estado.linhas.forEach((linha) => recalcularSugestaoLinha(linha));
  sincronizarDomLinhas();
  atualizarBarra();
}

function sincronizarDomLinhas() {
  estado.linhas.forEach((linha) => {
    const el = elFicha?.querySelector(`[data-uid="${linha.uid}"]`);
    if (!el) return;
    const input = el.querySelector('.linha-rateio-percentual input');
    if (input && document.activeElement !== input) {
      input.value = String(linha.percentual);
    }
    atualizarEstiloAlterado(el, linha);
  });
}

function atualizarEstiloAlterado(el, linha) {
  const input = el.querySelector('.linha-rateio-percentual input');
  const selo = el.querySelector('.selo-alterado-linha');
  const alterado = linha.origem === 'manual' && Number(linha.percentual) !== Number(linha.percentualSugerido);
  input?.classList.toggle('percentual-alterado', alterado);
  if (selo) {
    selo.hidden = !alterado;
    selo.title = `padrão: ${formatarPercentual(linha.percentualSugerido)} · alterado para ${formatarPercentual(linha.percentual)}`;
  }
}

function construirLinhaDom(linha) {
  const el = document.createElement('div');
  el.className = 'linha-rateio';
  el.dataset.uid = linha.uid;

  const colAdvogado = document.createElement('div');
  const combo = criarCombobox({
    itens: store.listarAdvogados({ ativos: true }),
    campoTexto: 'nome',
    campoValor: 'id',
    placeholder: 'Advogado…',
    valorInicial: linha.advogadoId,
    onSelecionar: async (id) => {
      linha.advogadoId = id;
      if (existeDuplicidade(linha.uid, linha.advogadoId, linha.papel)) {
        mostrarAvisoLinha(el, 'Este advogado já aparece com este papel no rateio.');
      } else {
        mostrarAvisoLinha(el, null);
      }
      const advogado = id ? store.obterAdvogado(id) : null;
      if (advogado?.papel_preferencial) { linha.papel = advogado.papel_preferencial; selectPapel.value = linha.papel; }
      await excecoesDoAdvogado(linha);
      recalcularSugestaoLinha(linha);
      sincronizarDomLinhas();
      atualizarBarra();
    },
  });
  colAdvogado.appendChild(combo.el);
  const btnNovoAdvogado = document.createElement('button');
  btnNovoAdvogado.type = 'button';
  btnNovoAdvogado.className = 'botao-texto botao-novo-cadastro-linha';
  btnNovoAdvogado.textContent = '+ novo advogado';
  btnNovoAdvogado.addEventListener('click', () => {
    gravarRascunho();
    irCriarERetornar('#/advogados');
  });
  colAdvogado.appendChild(btnNovoAdvogado);

  const selectPapel = document.createElement('select');
  selectPapel.className = 'campo';
  selectPapel.innerHTML = PAPEIS.map((p) => `<option value="${p}" ${linha.papel === p ? 'selected' : ''}>${PAPEL_LABEL[p]}</option>`).join('');
  selectPapel.addEventListener('change', () => {
    const anterior = linha.papel;
    linha.papel = selectPapel.value;
    if (existeDuplicidade(linha.uid, linha.advogadoId, linha.papel)) {
      mostrarAvisoLinha(el, 'Este advogado já aparece com este papel no rateio.');
      linha.papel = anterior;
      selectPapel.value = anterior;
    } else {
      mostrarAvisoLinha(el, null);
    }
  });

  const colPercentual = document.createElement('div');
  colPercentual.className = 'linha-rateio-percentual';
  const inputPct = document.createElement('input');
  inputPct.className = 'campo campo-percentual';
  inputPct.type = 'text';
  inputPct.inputMode = 'decimal';
  inputPct.value = String(linha.percentual);
  inputPct.readOnly = linha.bloqueado;
  const btnCadeado = document.createElement('button');
  btnCadeado.type = 'button';
  btnCadeado.className = 'botao-cadeado';
  btnCadeado.setAttribute('aria-label', linha.bloqueado ? 'Destravar percentual' : 'Travar e restaurar sugestão');
  btnCadeado.textContent = linha.bloqueado ? '🔒' : '🔓';
  btnCadeado.classList.toggle('cadeado-destravado', !linha.bloqueado);
  const seloAlterado = criarSelo({ texto: 'alterado', tom: 'ambar' });
  seloAlterado.classList.add('selo-alterado-linha');
  seloAlterado.hidden = true;

  function alternarCadeado() {
    if (linha.bloqueado) {
      linha.bloqueado = false;
      inputPct.readOnly = false;
      inputPct.focus();
      inputPct.select();
    } else {
      linha.bloqueado = true;
      linha.percentual = linha.percentualSugerido;
      inputPct.value = String(linha.percentual);
      inputPct.readOnly = true;
    }
    btnCadeado.textContent = linha.bloqueado ? '🔒' : '🔓';
    btnCadeado.setAttribute('aria-label', linha.bloqueado ? 'Destravar percentual' : 'Travar e restaurar sugestão');
    btnCadeado.classList.toggle('cadeado-destravado', !linha.bloqueado);
    atualizarEstiloAlterado(el, linha);
    atualizarBarra();
  }
  btnCadeado.addEventListener('click', alternarCadeado);
  inputPct.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && linha.bloqueado) { ev.preventDefault(); alternarCadeado(); }
  });
  inputPct.addEventListener('input', () => {
    const valor = Number(inputPct.value.replace(',', '.'));
    linha.percentual = Number.isNaN(valor) ? 0 : valor;
    linha.origem = 'manual';
    atualizarEstiloAlterado(el, linha);
    atualizarBarra();
  });

  colPercentual.appendChild(inputPct);
  colPercentual.appendChild(btnCadeado);
  colPercentual.appendChild(seloAlterado);

  const btnRemover = document.createElement('button');
  btnRemover.type = 'button';
  btnRemover.className = 'botao-remover-linha';
  btnRemover.setAttribute('aria-label', 'Remover linha');
  btnRemover.textContent = '×';
  btnRemover.addEventListener('click', () => {
    if (linha.uid === estado.linhaIndicacaoUid) estado.linhaIndicacaoUid = null;
    removerLinhaRateio(linha.uid);
  });

  el.appendChild(colAdvogado);
  el.appendChild(selectPapel);
  el.appendChild(colPercentual);
  el.appendChild(btnRemover);

  if (linha.advogadoId) excecoesDoAdvogado(linha).then(() => { recalcularSugestaoLinha(linha); sincronizarDomLinhas(); atualizarBarra(); });

  return el;
}

function mostrarAvisoLinha(el, mensagem) {
  let aviso = el.querySelector('.aviso-linha-rateio');
  if (!mensagem) { aviso?.remove(); return; }
  if (!aviso) {
    aviso = document.createElement('div');
    aviso.className = 'aviso-linha-rateio';
    el.appendChild(aviso);
  }
  aviso.textContent = mensagem;
}

// ===== Barra de rateio =====

function valorBaseAtual() {
  return (estado.descontarBase ? estado.valorBaseCentavos : estado.valorBrutoCentavos) / 100;
}

function atualizarBarra() {
  if (!barraRateio) return;
  const base = valorBaseAtual();
  const linhasValidas = estado.linhas.filter((l) => l.advogadoId);
  const resultado = calcularRateioMaiorResto(base, linhasValidas.map((l) => ({ advogadoId: l.advogadoId, papel: l.papel, percentual: l.percentual })));
  resultado.linhas = resultado.linhas.map((l) => ({ ...l, nome: store.obterAdvogado(l.advogadoId)?.nome, papel: PAPEL_LABEL[l.papel] ?? l.papel }));
  barraRateio.atualizar(base, resultado);

  const estourou = resultado.somaPercentual > 100;
  if (elBtnSalvar) elBtnSalvar.disabled = estourou || !podeEscrever();
  if (elErroSoma) {
    elErroSoma.innerHTML = estourou
      ? `<div class="mensagem-erro">A soma dos percentuais é ${formatarPercentual(resultado.somaPercentual)}. Ajuste para no máximo 100%.</div>`
      : '';
  }
}

// ===== Salvar =====

function montarPayload() {
  const base = valorBaseAtual();
  const linhasValidas = estado.linhas.filter((l) => l.advogadoId);
  const observacaoPartes = [];
  if (estado.descricao?.trim()) observacaoPartes.push(estado.descricao.trim());
  if (estado.descontarBase && estado.motivoDeducao?.trim()) observacaoPartes.push(`Dedução da base: ${estado.motivoDeducao.trim()}`);

  const p_lancamento = {
    data_competencia: estado.dataCompetencia || hojeISO(),
    data_pagamento: estado.dataPagamento || null,
    cliente_id: estado.clienteId,
    processo_id: estado.processoId,
    tipo_processo_id: estado.tipoProcessoId,
    tipo_servico_id: estado.tipoServicoId,
    descricao: estado.descricao?.trim() || null,
    valor_bruto: estado.valorBrutoCentavos / 100,
    valor_base: base,
    forma_pagamento: estado.formaPagamento,
    observacao: observacaoPartes.length ? observacaoPartes.join(' — ') : null,
  };
  const p_rateio = linhasValidas.map((l) => ({
    advogado_id: l.advogadoId,
    papel: l.papel,
    percentual: l.percentual,
    percentual_sugerido: l.percentualSugerido,
    origem_percentual: l.origem,
  }));
  return { p_lancamento, p_rateio };
}

function validarAntesDeSalvar() {
  if (!estado.clienteId) return 'Informe o cliente.';
  if (!estado.tipoProcessoId) return 'Informe o tipo de processo.';
  if (!estado.tipoServicoId) return 'Informe o tipo de serviço.';
  if (!(estado.valorBrutoCentavos > 0)) return 'Informe o valor bruto.';
  const semAdvogado = estado.linhas.some((l) => !l.advogadoId);
  if (semAdvogado) return 'Selecione o advogado em todas as linhas do rateio, ou remova a linha vazia.';
  const somaPercentual = estado.linhas.reduce((acc, l) => acc + Number(l.percentual || 0), 0);
  if (somaPercentual > 100.001) return 'A soma dos percentuais excede 100%.';
  return null;
}

async function acionarSalvar({ eNovo }) {
  if (!podeEscrever() || !elBtnSalvar || elBtnSalvar.disabled) return;
  const erro = validarAntesDeSalvar();
  if (erro) { toast.erro(erro); return; }

  const { p_lancamento, p_rateio } = montarPayload();
  elBtnSalvar.disabled = true;
  const areaFicha = elFicha;
  areaFicha?.classList.add('linha-salvando');

  const { data: id, error } = await supabase.rpc('rpc_salvar_lancamento', {
    p_lancamento, p_rateio, p_motivo: null,
  });

  areaFicha?.classList.remove('linha-salvando');
  if (error) {
    toast.erro('Não foi salvo — tentar de novo. ' + error.message);
    elBtnSalvar.disabled = false;
    return;
  }

  toast.sucesso('Lançamento salvo.');
  ultimoSalvo = { p_lancamento: { ...p_lancamento }, p_rateio: p_rateio.map((r) => ({ ...r })) };
  limparRascunho();

  const clienteId = estado.clienteId;
  const tipoProcessoId = estado.tipoProcessoId;
  const tipoServicoId = estado.tipoServicoId;

  const container = document.querySelector('#conteudo');
  const area = container?.querySelector('#area-formulario');
  if (area) {
    estado = estadoVazio();
    if (eNovo) {
      estado.clienteId = clienteId;
      estado.tipoProcessoId = tipoProcessoId;
      estado.tipoServicoId = tipoServicoId;
    }
    montarFormulario(area);
    // "Salvar e novo" mantém cliente e tipos (§7.5) — repete a seleção do
    // cliente para recarregar processos/sugestões/indicação como se o
    // usuário tivesse acabado de escolhê-lo.
    if (eNovo && clienteId) await aoSelecionarCliente(area, clienteId);
  }

  const listaRecentesEl = container?.querySelector('#lista-recentes');
  if (listaRecentesEl) {
    recentesCache = await carregarRecentes();
    renderRecentes(listaRecentesEl);
    tabelaRecentes?.marcarSalva(id);
  }
}

function duplicarUltimoSalvo() {
  if (!ultimoSalvo || !podeEscrever()) { toast.erro('Nenhum lançamento salvo nesta sessão ainda.'); return; }
  const area = document.querySelector('#area-formulario');
  if (!area) return;

  estado = estadoVazio();
  const { p_lancamento, p_rateio } = ultimoSalvo;
  estado.clienteId = p_lancamento.cliente_id;
  estado.processoId = p_lancamento.processo_id;
  estado.tipoProcessoId = p_lancamento.tipo_processo_id;
  estado.tipoServicoId = p_lancamento.tipo_servico_id;
  estado.formaPagamento = p_lancamento.forma_pagamento || FORMAS_PAGAMENTO[0];
  estado.valorBrutoCentavos = Math.round(Number(p_lancamento.valor_bruto) * 100);
  estado.descontarBase = Number(p_lancamento.valor_base) !== Number(p_lancamento.valor_bruto);
  estado.valorBaseCentavos = Math.round(Number(p_lancamento.valor_base) * 100);
  estado.descricao = p_lancamento.descricao || '';
  estado.linhas = p_rateio.map((r) => novaLinhaEstado({
    advogadoId: r.advogado_id, papel: r.papel, percentual: Number(r.percentual),
    origem: r.origem_percentual, bloqueado: false,
  }));

  montarFormulario(area);
  repovoarProcessos(area, estado.clienteId);
  toast.sucesso('Último lançamento duplicado — confira os dados antes de salvar.');
}

// ===== Lançamentos recentes (somente leitura nesta fase — edição/estorno ficam para a Fase 4) =====

async function carregarRecentes() {
  const { data, error } = await supabase
    .from('lancamentos')
    .select('id, numero, data_competencia, valor_bruto, status, clientes(nome), tipos_processo(nome), lancamento_rateio(advogado_id, papel, valor)')
    .order('criado_em', { ascending: false })
    .limit(20);
  if (error) { toast.erro('Não foi possível carregar os lançamentos recentes.'); return []; }
  return data ?? [];
}

function iniciais(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase();
}

const SELO_STATUS = {
  confirmado: { texto: 'confirmado', tom: 'confirma' },
  recebido: { texto: 'recebido', tom: 'confirma' },
  rascunho: { texto: 'rascunho', tom: 'neutro' },
  estornado: { texto: 'estornado', tom: 'carimbo' },
};

function renderRecentes(container) {
  container.innerHTML = '';
  if (recentesCache.length === 0) {
    container.innerHTML = '<p class="tela-vazia">Nenhum lançamento registrado ainda.</p>';
    return;
  }
  tabelaRecentes = criarTabela({
    colunas: [
      { rotulo: 'Número' }, { rotulo: 'Data' }, { rotulo: 'Cliente' },
      { rotulo: 'Tipo' }, { rotulo: 'Valor' }, { rotulo: 'Advogados' }, { rotulo: 'Status' },
    ],
    linhas: recentesCache,
    chave: 'id',
    classeLinha: (l) => (l.status === 'estornado' ? 'linha-estornada' : ''),
    renderLinha(tr, l) {
      const avatares = document.createElement('div');
      avatares.className = 'avatares-rateio';
      (l.lancamento_rateio ?? []).forEach((r) => {
        const nome = store.obterAdvogado(r.advogado_id)?.nome;
        const av = document.createElement('span');
        av.className = 'avatar-inicial';
        av.title = nome ?? '';
        av.textContent = iniciais(nome);
        avatares.appendChild(av);
      });
      tr.innerHTML = `
        <td>#${String(l.numero).padStart(6, '0')}</td>
        <td>${formatarData(l.data_competencia)}</td>
        <td>${l.clientes?.nome ?? '—'}</td>
        <td>${l.tipos_processo?.nome ?? '—'}</td>
        <td class="campo-valor">${formatarMoeda(l.valor_bruto)}</td>
      `;
      const tdAv = document.createElement('td');
      tdAv.appendChild(avatares);
      tr.appendChild(tdAv);
      const tdStatus = document.createElement('td');
      const cfg = SELO_STATUS[l.status] ?? SELO_STATUS.confirmado;
      tdStatus.appendChild(criarSelo({ texto: cfg.texto, tom: cfg.tom }));
      tr.appendChild(tdStatus);
    },
  });
  container.appendChild(tabelaRecentes.el);
}
