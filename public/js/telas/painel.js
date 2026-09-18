import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { criarMultiSelect } from '../componentes/multi-select.js';
import { toast } from '../componentes/toast.js';
import { formatarMoeda, formatarPercentual, mascararMoeda, moedaParaNumero } from '../formato.js';

export const titulo = 'Painel';

const PAPEL_LABEL = {
  responsavel: 'Responsável', indicacao: 'Indicação', parceria: 'Parceria',
  correspondente: 'Correspondente', sucumbencia: 'Sucumbência',
};
const FORMAS_PAGAMENTO = ['PIX', 'Transferência', 'Boleto', 'Cartão', 'Dinheiro'];
const STATUS_LABEL = { confirmado: 'Confirmado', recebido: 'Recebido' };
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Paleta do painel sobre os tokens da identidade visual (especificação §6.2/§8.2).
const CORES = {
  tinta900: '#12332C', tinta700: '#1F4A40', tinta500: '#35675B', tinta300: '#7FA096', tinta150: '#A8C0B8',
  ambar: '#9C6F1C', carimbo: '#8C2D26', confirma: '#2E7D62', linha: '#DCE2DF', texto2: '#4A5A54', texto3: '#7C8A84',
};
const SERIE_CORES = [CORES.tinta900, CORES.tinta700, CORES.tinta500, CORES.tinta300, CORES.tinta150, CORES.ambar];

let echarts = null;
let graficos = {};
let filtros = filtrosPadrao();
let combosMulti = {};

function descartarGraficos() {
  Object.values(graficos).forEach((g) => { try { g?.dispose(); } catch { /* já destruído */ } });
  graficos = {};
}

export function destroy() {
  descartarGraficos();
  window.removeEventListener('resize', aoRedimensionar);
}

function aoRedimensionar() {
  Object.values(graficos).forEach((g) => g?.resize());
}

// ===== Filtros: estado <-> URL (#/painel?de=...&adv=...) =====

function filtrosPadrao() {
  const hoje = new Date();
  const de = new Date(hoje);
  de.setMonth(de.getMonth() - 12);
  return {
    periodo: '12m',
    de: isoData(de),
    ate: isoData(hoje),
    adv: [], cli: [], tp: [], ts: [], papel: [], status: [], forma: [],
    valorMin: '', valorMax: '',
    estornados: false, manual: false,
  };
}

function isoData(d) { return d.toISOString().slice(0, 10); }

function listaOuVazio(v) { return v ? v.split(',').filter(Boolean) : []; }

function lerFiltrosDaUrl() {
  const query = location.hash.split('?')[1] ?? '';
  const p = new URLSearchParams(query);
  const base = filtrosPadrao();
  return {
    periodo: p.get('periodo') || (p.get('de') || p.get('ate') ? 'personalizado' : base.periodo),
    de: p.get('de') || base.de,
    ate: p.get('ate') || base.ate,
    adv: listaOuVazio(p.get('adv')),
    cli: listaOuVazio(p.get('cli')),
    tp: listaOuVazio(p.get('tp')),
    ts: listaOuVazio(p.get('ts')),
    papel: listaOuVazio(p.get('papel')),
    status: listaOuVazio(p.get('status')),
    forma: listaOuVazio(p.get('forma')),
    valorMin: p.get('valorMin') || '',
    valorMax: p.get('valorMax') || '',
    estornados: p.get('estornados') === '1',
    manual: p.get('manual') === '1',
  };
}

function escreverFiltrosNaUrl() {
  const p = new URLSearchParams();
  if (filtros.periodo !== '12m') p.set('periodo', filtros.periodo);
  if (filtros.de) p.set('de', filtros.de);
  if (filtros.ate) p.set('ate', filtros.ate);
  if (filtros.adv.length) p.set('adv', filtros.adv.join(','));
  if (filtros.cli.length) p.set('cli', filtros.cli.join(','));
  if (filtros.tp.length) p.set('tp', filtros.tp.join(','));
  if (filtros.ts.length) p.set('ts', filtros.ts.join(','));
  if (filtros.papel.length) p.set('papel', filtros.papel.join(','));
  if (filtros.status.length) p.set('status', filtros.status.join(','));
  if (filtros.forma.length) p.set('forma', filtros.forma.join(','));
  if (filtros.valorMin) p.set('valorMin', filtros.valorMin);
  if (filtros.valorMax) p.set('valorMax', filtros.valorMax);
  if (filtros.estornados) p.set('estornados', '1');
  if (filtros.manual) p.set('manual', '1');
  const query = p.toString();
  // pushState (não location.hash=) para não disparar hashchange/re-render de
  // rota a cada filtro — o histórico ainda fica navegável pelo botão voltar,
  // e um link colado com filtros funciona porque render() lê a URL ao entrar.
  history.pushState(null, '', `#/painel${query ? '?' + query : ''}`);
}

function periodoParaIntervalo(preset) {
  const hoje = new Date();
  if (preset === 'mes_atual') {
    return { de: isoData(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: isoData(hoje) };
  }
  if (preset === 'mes_anterior') {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { de: isoData(inicio), ate: isoData(fim) };
  }
  if (preset === 'trimestre') {
    const inicio = new Date(hoje); inicio.setMonth(inicio.getMonth() - 3);
    return { de: isoData(inicio), ate: isoData(hoje) };
  }
  if (preset === 'ano') {
    return { de: isoData(new Date(hoje.getFullYear(), 0, 1)), ate: isoData(hoje) };
  }
  if (preset === '12m') {
    const inicio = new Date(hoje); inicio.setMonth(inicio.getMonth() - 12);
    return { de: isoData(inicio), ate: isoData(hoje) };
  }
  return { de: filtros.de, ate: filtros.ate };
}

// ===== Render principal =====

export function render(container) {
  destroy();
  filtros = lerFiltrosDaUrl();

  container.innerHTML = `
    <div class="container container-painel">
      <div class="tela-cabecalho"><h1>Painel</h1></div>
      <div id="filtros-painel"></div>
      <div id="chips-painel" class="filtro-chips-ativos"></div>
      <div id="indicadores-painel" class="grade-indicadores"></div>
      <div id="graficos-painel" class="grade-graficos"></div>
    </div>
  `;

  montarFiltros(container.querySelector('#filtros-painel'));
  window.addEventListener('resize', aoRedimensionar);
  atualizarTudo(container);
}

async function atualizarTudo(container) {
  escreverFiltrosNaUrl();
  renderChipsAtivos(container.querySelector('#chips-painel'), container);

  const indicadoresEl = container.querySelector('#indicadores-painel');
  const graficosEl = container.querySelector('#graficos-painel');
  indicadoresEl.innerHTML = '<p class="tela-vazia">Carregando…</p>';

  const dados = await carregarPainel();
  if (!dados) { indicadoresEl.innerHTML = '<p class="tela-vazia">Não foi possível carregar o painel.</p>'; return; }

  renderIndicadores(indicadoresEl, dados.indicadores, dados.indicadores_secundarios);
  await renderGraficos(graficosEl, dados.series, dados.indicadores, container);
}

async function carregarPainel() {
  const p_filtros = {
    de: filtros.de || undefined,
    ate: filtros.ate || undefined,
    advogados: filtros.adv.length ? filtros.adv : undefined,
    clientes: filtros.cli.length ? filtros.cli : undefined,
    tipos_processo: filtros.tp.length ? filtros.tp : undefined,
    tipos_servico: filtros.ts.length ? filtros.ts : undefined,
    papeis: filtros.papel.length ? filtros.papel : undefined,
    status: filtros.status.length ? filtros.status : undefined,
    formas_pagamento: filtros.forma.length ? filtros.forma : undefined,
    valor_min: filtros.valorMin ? Number(filtros.valorMin) : undefined,
    valor_max: filtros.valorMax ? Number(filtros.valorMax) : undefined,
    incluir_estornados: filtros.estornados,
    somente_manual: filtros.manual,
  };
  const { data, error } = await supabase.rpc('rpc_painel', { p_filtros });
  if (error) { toast.erro('Não foi possível carregar o painel. ' + error.message); return null; }
  return data;
}

// ===== Barra de filtros =====

function montarFiltros(area) {
  area.innerHTML = `
    <div class="filtros-painel-grade">
      <div>
        <label class="rotulo-campo" for="f-periodo">Período</label>
        <select class="campo" id="f-periodo">
          <option value="mes_atual">Mês atual</option>
          <option value="mes_anterior">Mês anterior</option>
          <option value="trimestre">Trimestre</option>
          <option value="ano">Ano</option>
          <option value="12m">Últimos 12 meses</option>
          <option value="personalizado">Personalizado…</option>
        </select>
      </div>
      <div id="periodo-datas" ${filtros.periodo === 'personalizado' ? '' : 'hidden'}>
        <label class="rotulo-campo" for="f-de">De</label>
        <input class="campo" type="date" id="f-de" value="${filtros.de}" />
        <label class="rotulo-campo" for="f-ate" style="margin-top:var(--e2)">Até</label>
        <input class="campo" type="date" id="f-ate" value="${filtros.ate}" />
      </div>
      <div>
        <label class="rotulo-campo">Advogado</label>
        <div id="multi-advogado"></div>
      </div>
      <div>
        <label class="rotulo-campo">Cliente</label>
        <div id="multi-cliente"></div>
      </div>
      <div>
        <label class="rotulo-campo">Tipo de processo</label>
        <div id="multi-tipo-processo"></div>
      </div>
      <div>
        <label class="rotulo-campo">Tipo de serviço</label>
        <div id="multi-tipo-servico"></div>
      </div>
      <div>
        <label class="rotulo-campo">Papel no rateio</label>
        <div class="filtro-checkboxes" id="check-papel">
          ${Object.entries(PAPEL_LABEL).map(([v, l]) => `
            <label><input type="checkbox" value="${v}" ${filtros.papel.includes(v) ? 'checked' : ''}/> ${l}</label>
          `).join('')}
        </div>
      </div>
      <div>
        <label class="rotulo-campo">Status</label>
        <div class="filtro-checkboxes" id="check-status">
          ${Object.entries(STATUS_LABEL).map(([v, l]) => `
            <label><input type="checkbox" value="${v}" ${filtros.status.includes(v) ? 'checked' : ''}/> ${l}</label>
          `).join('')}
        </div>
      </div>
      <div>
        <label class="rotulo-campo">Forma de pagamento</label>
        <div class="filtro-checkboxes" id="check-forma">
          ${FORMAS_PAGAMENTO.map((f) => `
            <label><input type="checkbox" value="${f}" ${filtros.forma.includes(f) ? 'checked' : ''}/> ${f}</label>
          `).join('')}
        </div>
      </div>
      <div>
        <label class="rotulo-campo" for="f-valor-min">Valor mínimo</label>
        <input class="campo" id="f-valor-min" inputmode="numeric" value="${filtros.valorMin ? formatarMoeda(filtros.valorMin) : ''}" />
        <label class="rotulo-campo" for="f-valor-max" style="margin-top:var(--e2)">Valor máximo</label>
        <input class="campo" id="f-valor-max" inputmode="numeric" value="${filtros.valorMax ? formatarMoeda(filtros.valorMax) : ''}" />
      </div>
      <div class="filtro-chaves">
        <label><input type="checkbox" id="f-estornados" ${filtros.estornados ? 'checked' : ''}/> Incluir estornados</label>
        <label><input type="checkbox" id="f-manual" ${filtros.manual ? 'checked' : ''}/> Somente alterados manualmente</label>
      </div>
    </div>
  `;

  const container = area.closest('.container');
  const selPeriodo = area.querySelector('#f-periodo');
  selPeriodo.value = filtros.periodo;
  const blocoDatas = area.querySelector('#periodo-datas');
  selPeriodo.addEventListener('change', () => {
    filtros.periodo = selPeriodo.value;
    if (filtros.periodo === 'personalizado') {
      blocoDatas.hidden = false;
    } else {
      blocoDatas.hidden = true;
      const { de, ate } = periodoParaIntervalo(filtros.periodo);
      filtros.de = de; filtros.ate = ate;
      atualizarTudo(container);
    }
  });
  area.querySelector('#f-de').addEventListener('change', (ev) => { filtros.de = ev.target.value; if (filtros.periodo === 'personalizado') atualizarTudo(container); });
  area.querySelector('#f-ate').addEventListener('change', (ev) => { filtros.ate = ev.target.value; if (filtros.periodo === 'personalizado') atualizarTudo(container); });

  combosMulti.adv = criarMultiSelect({
    itens: store.listarAdvogados({ ativos: true }), campoTexto: 'nome', campoValor: 'id',
    placeholder: 'Buscar advogado…', valoresIniciais: filtros.adv,
    aoMudar: (v) => { filtros.adv = v; atualizarTudo(container); },
  });
  area.querySelector('#multi-advogado').appendChild(combosMulti.adv.el);

  combosMulti.cli = criarMultiSelect({
    itens: store.listarClientes({ ativos: true }), campoTexto: 'nome', campoValor: 'id',
    placeholder: 'Buscar cliente…', valoresIniciais: filtros.cli,
    aoMudar: (v) => { filtros.cli = v; atualizarTudo(container); },
  });
  area.querySelector('#multi-cliente').appendChild(combosMulti.cli.el);

  combosMulti.tp = criarMultiSelect({
    itens: store.listarTiposProcesso(), campoTexto: 'nome', campoValor: 'id',
    placeholder: 'Buscar tipo de processo…', valoresIniciais: filtros.tp,
    aoMudar: (v) => { filtros.tp = v; atualizarTudo(container); },
  });
  area.querySelector('#multi-tipo-processo').appendChild(combosMulti.tp.el);

  combosMulti.ts = criarMultiSelect({
    itens: store.listarTiposServico(), campoTexto: 'nome', campoValor: 'id',
    placeholder: 'Buscar tipo de serviço…', valoresIniciais: filtros.ts,
    aoMudar: (v) => { filtros.ts = v; atualizarTudo(container); },
  });
  area.querySelector('#multi-tipo-servico').appendChild(combosMulti.ts.el);

  area.querySelector('#check-papel').addEventListener('change', (ev) => {
    if (ev.target.type !== 'checkbox') return;
    filtros.papel = marcarDesmarcar(filtros.papel, ev.target.value, ev.target.checked);
    atualizarTudo(container);
  });
  area.querySelector('#check-status').addEventListener('change', (ev) => {
    if (ev.target.type !== 'checkbox') return;
    filtros.status = marcarDesmarcar(filtros.status, ev.target.value, ev.target.checked);
    atualizarTudo(container);
  });
  area.querySelector('#check-forma').addEventListener('change', (ev) => {
    if (ev.target.type !== 'checkbox') return;
    filtros.forma = marcarDesmarcar(filtros.forma, ev.target.value, ev.target.checked);
    atualizarTudo(container);
  });

  const inputMin = area.querySelector('#f-valor-min');
  const inputMax = area.querySelector('#f-valor-max');
  inputMin.addEventListener('change', (ev) => {
    ev.target.value = ev.target.value ? mascararMoeda(ev.target.value) : '';
    filtros.valorMin = ev.target.value ? String(moedaParaNumero(ev.target.value)) : '';
    atualizarTudo(container);
  });
  inputMax.addEventListener('change', (ev) => {
    ev.target.value = ev.target.value ? mascararMoeda(ev.target.value) : '';
    filtros.valorMax = ev.target.value ? String(moedaParaNumero(ev.target.value)) : '';
    atualizarTudo(container);
  });

  area.querySelector('#f-estornados').addEventListener('change', (ev) => { filtros.estornados = ev.target.checked; atualizarTudo(container); });
  area.querySelector('#f-manual').addEventListener('change', (ev) => { filtros.manual = ev.target.checked; atualizarTudo(container); });
}

function marcarDesmarcar(lista, valor, marcado) {
  return marcado ? [...lista, valor] : lista.filter((v) => v !== valor);
}

// ===== Chips de filtros ativos (removíveis) =====

function renderChipsAtivos(container, telaContainer) {
  const chips = [];
  filtros.adv.forEach((id) => chips.push({ texto: store.obterAdvogado(id)?.nome ?? id, remover: () => { filtros.adv = filtros.adv.filter((v) => v !== id); combosMulti.adv?.definirValores(filtros.adv); } }));
  filtros.cli.forEach((id) => chips.push({ texto: store.obterCliente(id)?.nome ?? id, remover: () => { filtros.cli = filtros.cli.filter((v) => v !== id); combosMulti.cli?.definirValores(filtros.cli); } }));
  filtros.tp.forEach((id) => chips.push({ texto: store.listarTiposProcesso().find((t) => t.id === id)?.nome ?? id, remover: () => { filtros.tp = filtros.tp.filter((v) => v !== id); combosMulti.tp?.definirValores(filtros.tp); } }));
  filtros.ts.forEach((id) => chips.push({ texto: store.listarTiposServico().find((t) => t.id === id)?.nome ?? id, remover: () => { filtros.ts = filtros.ts.filter((v) => v !== id); combosMulti.ts?.definirValores(filtros.ts); } }));
  filtros.papel.forEach((v) => chips.push({ texto: PAPEL_LABEL[v] ?? v, remover: () => { filtros.papel = filtros.papel.filter((x) => x !== v); } }));
  filtros.status.forEach((v) => chips.push({ texto: STATUS_LABEL[v] ?? v, remover: () => { filtros.status = filtros.status.filter((x) => x !== v); } }));
  filtros.forma.forEach((v) => chips.push({ texto: v, remover: () => { filtros.forma = filtros.forma.filter((x) => x !== v); } }));
  if (filtros.estornados) chips.push({ texto: 'Incluindo estornados', remover: () => { filtros.estornados = false; } });
  if (filtros.manual) chips.push({ texto: 'Só alterados manualmente', remover: () => { filtros.manual = false; } });

  container.innerHTML = '';
  chips.forEach(({ texto, remover }) => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-removivel chip-filtro';
    const span = document.createElement('span');
    span.textContent = texto;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.setAttribute('aria-label', `Remover filtro ${texto}`);
    btn.addEventListener('click', () => { remover(); montarFiltros(telaContainer.querySelector('#filtros-painel')); atualizarTudo(telaContainer); });
    chip.appendChild(span);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

// ===== Indicadores (KPIs) =====

function variacaoTexto(pct) {
  if (pct === null || pct === undefined) return '';
  const seta = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
  const tom = pct > 0 ? 'confirma' : pct < 0 ? 'carimbo' : 'neutro';
  return `<span class="indicador-variacao indicador-variacao-${tom}">${seta} ${formatarPercentual(Math.abs(pct))} vs. período anterior</span>`;
}

function cartaoIndicador(rotulo, valorTexto, extra) {
  return `
    <div class="cartao-indicador">
      <div class="indicador-valor">${valorTexto}</div>
      <div class="indicador-rotulo">${rotulo}</div>
      ${extra ?? ''}
    </div>
  `;
}

function renderIndicadores(container, ind, sec) {
  container.innerHTML = `
    <div class="grade-indicadores-linha">
      ${cartaoIndicador('Honorários no período', formatarMoeda(ind.honorarios_periodo.valor), variacaoTexto(ind.honorarios_periodo.variacao_pct))}
      ${cartaoIndicador('Receita por indicação', formatarMoeda(ind.receita_indicacao.valor), ind.receita_indicacao.percentual_do_total != null ? `<span class="indicador-variacao">${formatarPercentual(ind.receita_indicacao.percentual_do_total)} do total</span>` : '')}
      ${cartaoIndicador('Repasse a advogados', formatarMoeda(ind.repasse_advogados.valor), variacaoTexto(ind.repasse_advogados.variacao_pct))}
      ${cartaoIndicador('Retenção do escritório', formatarMoeda(ind.retencao_escritorio.valor), ind.retencao_escritorio.percentual != null ? `<span class="indicador-variacao">${formatarPercentual(ind.retencao_escritorio.percentual)} da base</span>` : '')}
    </div>
    <div class="grade-indicadores-linha">
      ${cartaoIndicador('Ticket médio Lançamento', formatarMoeda(ind.ticket_medio.valor))}
      ${cartaoIndicador('Ticket médio Advogados', formatarMoeda(ind.ticket_medio_advogado.valor))}
      ${cartaoIndicador('Ticket médio de Tipos de Processos', formatarMoeda(ind.ticket_medio_tipo_processo.valor))}
      ${cartaoIndicador('Ticket médio de Cliente', formatarMoeda(ind.ticket_medio_cliente.valor))}
    </div>
    <div class="grade-indicadores-secundarios">
      <span>${sec.estornos.quantidade} estorno(s) · ${formatarMoeda(sec.estornos.valor)}</span>
      <span>${sec.lancamentos_sem_processo.quantidade} lançamento(s) sem processo vinculado</span>
      <span>${sec.clientes_novos.quantidade} cliente(s) novo(s) no período</span>
    </div>
  `;
}

// ===== Gráficos (ECharts) =====

async function carregarEcharts() {
  if (echarts) return echarts;
  echarts = await import('https://esm.sh/echarts@5');
  return echarts;
}

function criarPainelGrafico(id, titulo) {
  const bloco = document.createElement('div');
  bloco.className = 'cartao-grafico';
  const h3 = document.createElement('h3');
  h3.textContent = titulo;
  const area = document.createElement('div');
  area.className = 'area-grafico';
  area.id = id;
  bloco.appendChild(h3);
  bloco.appendChild(area);
  return bloco;
}

async function renderGraficos(container, series, indicadores, telaContainer) {
  descartarGraficos();
  container.innerHTML = '';
  let ec;
  try {
    ec = await carregarEcharts();
  } catch {
    container.innerHTML = '<p class="tela-vazia">Não foi possível carregar a biblioteca de gráficos.</p>';
    return;
  }

  const blocoEvolucao = criarPainelGrafico('g-evolucao', 'Evolução mensal (13 meses)');
  const blocoMapa = criarPainelGrafico('g-mapa', 'Onde o escritório ganha');
  const blocoRanking = criarPainelGrafico('g-ranking', 'Ranking de advogados');
  const blocoPareto = criarPainelGrafico('g-pareto', 'Concentração de clientes');
  const blocoIndicacao = criarPainelGrafico('g-indicacao', 'Indicação × carteira própria');
  const blocoComposicao = criarPainelGrafico('g-composicao', 'Composição por tipo de processo');
  const blocoProcessosAno = criarPainelGrafico('g-processos-ano', 'Processos distribuídos por ano');
  const blocoVariacaoAnual = criarPainelGrafico('g-variacao-anual', 'Variação plurianual (escritório × advogados)');
  const blocoDivisaoIndicador = criarPainelGrafico('g-divisao-indicador', 'Divisão por indicação (por indicador)');
  const blocoFaixaValor = criarPainelGrafico('g-faixa-valor', 'Divisão por faixa de valor');
  const blocoCadAdvogados = criarPainelGrafico('g-cad-advogados', 'Evolução de advogados');
  const blocoCadClientes = criarPainelGrafico('g-cad-clientes', 'Evolução de clientes');
  const blocoCadProcessos = criarPainelGrafico('g-cad-processos', 'Evolução de processos');
  const blocoCadLancamentos = criarPainelGrafico('g-cad-lancamentos', 'Evolução de lançamentos');
  [
    blocoEvolucao, blocoMapa, blocoRanking, blocoPareto, blocoIndicacao, blocoComposicao,
    blocoProcessosAno, blocoVariacaoAnual, blocoDivisaoIndicador, blocoFaixaValor,
    blocoCadAdvogados, blocoCadClientes, blocoCadProcessos, blocoCadLancamentos,
  ].forEach((b) => container.appendChild(b));

  desenharEvolucaoMensal(ec, series.evolucao_mensal, telaContainer);
  desenharMapaCalor(ec, series.mapa_calor_tipo_servico, telaContainer);
  desenharRankingAdvogados(ec, series.ranking_advogados, indicadores.retencao_escritorio.valor, telaContainer);
  desenharPareto(ec, series.concentracao_clientes, telaContainer);
  desenharIndicacaoVsPropria(ec, series.indicacao_vs_propria);
  desenharComposicaoTipoProcesso(ec, series.composicao_tipo_processo, telaContainer);
  desenharProcessosPorAno(ec, series.processos_por_ano);
  desenharVariacaoAnual(ec, series.variacao_anual);
  desenharDivisaoIndicador(ec, series.divisao_por_indicador);
  desenharDivisaoFaixaValor(ec, series.divisao_faixa_valor);
  desenharEvolucaoCadastros(ec, series.evolucao_cadastros);

  renderMaioresHonorarios(container, series.maiores_honorarios_advogado);
}

function baseGrafico() {
  return {
    textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', color: CORES.texto2 },
    color: SERIE_CORES,
    grid: { left: 8, right: 16, top: 64, bottom: 8, containLabel: true },
    tooltip: { trigger: 'item', confine: true },
  };
}

// Eixo de valor escondido de propósito (pedido do usuário 2026-09-16): os
// valores já aparecem como rótulo em cima/dentro de cada barra ou ponto,
// igual aos slides do "Contabilidade 2025.pptx" — a régua numérica do eixo
// fica redundante e polui o gráfico.
function eixoValorOculto() {
  return { type: 'value', show: false };
}

// Rótulo por fora, em cima da barra, em cor de destaque (tinta-900, a mesma
// dos valores em Spectral nos cartões de indicador) — pedido do usuário
// 2026-09-17, mesmo raciocínio das barras horizontais: por fora fica mais
// legível do que sobre o preenchimento colorido da barra.
function rotuloBarraValor(cor = CORES.tinta900) {
  return { show: true, position: 'top', color: cor, fontSize: 11, fontWeight: 700, formatter: (p) => formatarMoeda(p.value) };
}

// Rótulo pra fora, à direita da ponta da barra — com `position:'insideRight'`
// o texto ficava colado perto do eixo em barras curtas, dando a impressão de
// estar "à esquerda" (pedido do usuário 2026-09-17). Por estar fora da barra
// (não mais sobre o preenchimento colorido), usa a cor de texto padrão.
function rotuloBarraHorizontalValor(cor = CORES.texto2) {
  return { show: true, position: 'right', color: cor, fontSize: 11, fontWeight: 600, formatter: (p) => formatarMoeda(p.value) };
}

function rotuloLinhaValor() {
  return { show: true, position: 'top', color: CORES.texto2, fontSize: 11, fontWeight: 600, formatter: (p) => formatarMoeda(p.value) };
}

function rotuloMes(mesIso) {
  const d = new Date(`${mesIso}T00:00:00`);
  return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

function desenharEvolucaoMensal(ec, dadosOriginais, telaContainer) {
  const el = document.getElementById('g-evolucao');
  const g = ec.init(el);
  graficos.evolucao = g;
  // Não mostrar meses sem nenhum movimento (pedido do usuário 2026-09-17) —
  // um mês só some se não teve honorários nem retenção.
  const dados = dadosOriginais.filter((d) => d.honorarios !== 0 || d.retencao !== 0);
  const meses = dados.map((d) => rotuloMes(d.mes));
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'axis' },
    legend: { data: ['Honorários', 'Retenção', 'Ano anterior'], top: 0, textStyle: { color: CORES.texto2 } },
    xAxis: { type: 'category', data: meses, axisLine: { lineStyle: { color: CORES.linha } } },
    yAxis: eixoValorOculto(),
    series: [
      { name: 'Ano anterior', type: 'bar', data: dados.map((d) => d.honorarios_ano_anterior), itemStyle: { color: 'transparent', borderColor: CORES.tinta150, borderType: 'dashed', borderWidth: 1 }, barGap: '-100%', z: 1 },
      { name: 'Honorários', type: 'bar', data: dados.map((d) => d.honorarios), itemStyle: { color: CORES.tinta500 }, label: rotuloBarraValor(), z: 2 },
      { name: 'Retenção', type: 'line', data: dados.map((d) => d.retencao), itemStyle: { color: CORES.ambar }, label: rotuloLinhaValor(), smooth: true, z: 3 },
    ],
  });
  g.on('click', (params) => {
    if (params.componentType !== 'series' || params.seriesName !== 'Honorários') return;
    const mesIso = dados[params.dataIndex]?.mes;
    if (!mesIso) return;
    const d = new Date(`${mesIso}T00:00:00`);
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    filtros.periodo = 'personalizado';
    filtros.de = isoData(d);
    filtros.ate = isoData(fim);
    montarFiltros(telaContainer.querySelector('#filtros-painel'));
    atualizarTudo(telaContainer);
  });
}

function desenharMapaCalor(ec, dados, telaContainer) {
  const el = document.getElementById('g-mapa');
  const g = ec.init(el);
  graficos.mapa = g;
  const tiposProcesso = [...new Set(dados.map((d) => d.tipo_processo))];
  const tiposServico = [...new Set(dados.map((d) => d.tipo_servico))];
  const dadosGrade = dados.map((d) => [tiposServico.indexOf(d.tipo_servico), tiposProcesso.indexOf(d.tipo_processo), d.valor]);
  const max = Math.max(1, ...dados.map((d) => d.valor));
  g.setOption({
    ...baseGrafico(),
    tooltip: { position: 'top', formatter: (p) => `${tiposProcesso[p.value[1]]} × ${tiposServico[p.value[0]]}<br/>${formatarMoeda(p.value[2])}` },
    grid: { left: 8, right: 16, top: 16, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: tiposServico, splitArea: { show: true } },
    yAxis: { type: 'category', data: tiposProcesso, splitArea: { show: true } },
    visualMap: { min: 0, max, show: false, inRange: { color: [CORES.linha, CORES.tinta500, CORES.tinta900] } },
    series: [{
      type: 'heatmap', data: dadosGrade,
      label: { show: true, fontSize: 10, fontWeight: 600, color: '#fff', formatter: (p) => formatarMoeda(p.value[2]) },
    }],
  });
  g.on('click', (params) => {
    if (!params.value) return;
    const tp = tiposProcesso[params.value[1]];
    const ts = tiposServico[params.value[0]];
    const objTp = store.listarTiposProcesso().find((t) => t.nome === tp);
    const objTs = store.listarTiposServico().find((t) => t.nome === ts);
    if (objTp && !filtros.tp.includes(objTp.id)) filtros.tp = [...filtros.tp, objTp.id];
    if (objTs && !filtros.ts.includes(objTs.id)) filtros.ts = [...filtros.ts, objTs.id];
    montarFiltros(telaContainer.querySelector('#filtros-painel'));
    atualizarTudo(telaContainer);
  });
}

function desenharRankingAdvogados(ec, dadosAdvogados, retencaoEscritorio, telaContainer) {
  const el = document.getElementById('g-ranking');
  const g = ec.init(el);
  graficos.ranking = g;
  // Escritório entra como mais uma barra, pra comparar o repasse de cada
  // advogado com o que o escritório reteve (pedido do usuário 2026-09-17) —
  // sem advogado_id, pra não entrar no clique-pra-filtrar dos advogados.
  const comEscritorio = [...dadosAdvogados, { advogado_id: null, nome: 'Escritório (retenção)', repasse: retencaoEscritorio, percentual_medio: null }];
  const ordenado = [...comEscritorio].reverse(); // ECharts desenha de baixo pra cima
  const cores = ordenado.map((d) => (d.advogado_id ? CORES.tinta500 : CORES.ambar));
  g.setOption({
    ...baseGrafico(),
    grid: { left: 8, right: 80, top: 56, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (p) => {
        const item = ordenado[p[0].dataIndex];
        const media = item?.percentual_medio != null ? ` · ${formatarPercentual(item.percentual_medio)} em média` : '';
        return `${p[0].name}<br/>${formatarMoeda(p[0].value)}${media}`;
      },
    },
    xAxis: eixoValorOculto(),
    yAxis: { type: 'category', data: ordenado.map((d) => d.nome) },
    series: [{
      type: 'bar', data: ordenado.map((d) => d.repasse),
      itemStyle: { color: (p) => cores[p.dataIndex] },
      label: rotuloBarraHorizontalValor(),
    }],
  });
  g.on('click', (params) => {
    const item = ordenado[params.dataIndex];
    if (!item?.advogado_id || filtros.adv.includes(item.advogado_id)) return;
    filtros.adv = [...filtros.adv, item.advogado_id];
    combosMulti.adv?.definirValores(filtros.adv);
    atualizarTudo(telaContainer);
  });
}

function desenharPareto(ec, dados, telaContainer) {
  const el = document.getElementById('g-pareto');
  const g = ec.init(el);
  graficos.pareto = g;
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'axis' },
    legend: { data: ['Valor', 'Acumulado'], top: 0, textStyle: { color: CORES.texto2 } },
    xAxis: { type: 'category', data: dados.map((d) => d.nome), axisLabel: { interval: 0, rotate: 30 } },
    yAxis: [
      { ...eixoValorOculto() },
      { type: 'value', show: false, min: 0, max: 100 },
    ],
    series: [
      { name: 'Valor', type: 'bar', data: dados.map((d) => d.valor), itemStyle: { color: CORES.tinta500 }, label: rotuloBarraValor() },
      {
        name: 'Acumulado', type: 'line', yAxisIndex: 1, data: dados.map((d) => d.percentual_acumulado), itemStyle: { color: CORES.ambar },
        label: { show: true, position: 'top', color: CORES.texto2, fontSize: 11, fontWeight: 600, formatter: (p) => formatarPercentual(p.value) },
      },
    ],
  });
  g.on('click', (params) => {
    if (params.seriesType !== 'bar') return;
    const item = dados[params.dataIndex];
    if (!item || filtros.cli.includes(item.cliente_id)) return;
    filtros.cli = [...filtros.cli, item.cliente_id];
    combosMulti.cli?.definirValores(filtros.cli);
    atualizarTudo(telaContainer);
  });
}

function desenharIndicacaoVsPropria(ec, dados) {
  const el = document.getElementById('g-indicacao');
  const g = ec.init(el);
  graficos.indicacao = g;
  const meses = dados.map((d) => rotuloMes(d.mes));
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'axis' },
    legend: { data: ['Indicação', 'Própria'], top: 0, textStyle: { color: CORES.texto2 } },
    xAxis: { type: 'category', data: meses },
    yAxis: eixoValorOculto(),
    series: [
      // Empilhado: rótulo por fora ("top") ficaria no meio da pilha para o
      // segmento de baixo — o usuário pediu pra manter esse aqui como estava,
      // valor dentro de cada segmento (2026-09-17).
      { name: 'Própria', type: 'bar', stack: 'total', data: dados.map((d) => d.propria ?? 0), itemStyle: { color: CORES.tinta500 }, label: { show: true, position: 'inside', color: '#fff', fontSize: 11, fontWeight: 600, formatter: (p) => formatarMoeda(p.value) } },
      { name: 'Indicação', type: 'bar', stack: 'total', data: dados.map((d) => d.indicacao ?? 0), itemStyle: { color: CORES.ambar }, label: { show: true, position: 'inside', color: '#fff', fontSize: 11, fontWeight: 600, formatter: (p) => formatarMoeda(p.value) } },
    ],
  });
}

function desenharComposicaoTipoProcesso(ec, dados, telaContainer) {
  const el = document.getElementById('g-composicao');
  const g = ec.init(el);
  graficos.composicao = g;
  const ordenado = [...dados].reverse();
  g.setOption({
    ...baseGrafico(),
    grid: { left: 8, right: 80, top: 56, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `${p[0].name}<br/>${formatarMoeda(p[0].value)}` },
    xAxis: eixoValorOculto(),
    yAxis: { type: 'category', data: ordenado.map((d) => d.tipo_processo) },
    series: [{ type: 'bar', data: ordenado.map((d) => d.valor), itemStyle: { color: CORES.tinta500 }, label: rotuloBarraHorizontalValor() }],
  });
  g.on('click', (params) => {
    const item = ordenado[params.dataIndex];
    const objTp = item ? store.listarTiposProcesso().find((t) => t.nome === item.tipo_processo) : null;
    if (!objTp || filtros.tp.includes(objTp.id)) return;
    filtros.tp = [...filtros.tp, objTp.id];
    montarFiltros(telaContainer.querySelector('#filtros-painel'));
    atualizarTudo(telaContainer);
  });
}

// ===== Indicadores reconciliados com o Contabilidade 2025.pptx (§2 P1) =====

function desenharProcessosPorAno(ec, dados) {
  const el = document.getElementById('g-processos-ano');
  const g = ec.init(el);
  graficos.processosAno = g;
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: dados.map((d) => d.ano), axisLine: { lineStyle: { color: CORES.linha } } },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'line', data: dados.map((d) => d.quantidade), itemStyle: { color: CORES.tinta500 },
      label: { show: true, position: 'top', color: CORES.texto2, fontSize: 11, fontWeight: 600 },
    }],
  });
}

function rotuloDataSnapshot(dataIso) {
  const d = new Date(`${dataIso}T00:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${MESES_ABREV[d.getMonth()]}`;
}

// Um gráfico por item (pedido do usuário 2026-09-18), não um combinado — as
// escalas de advogados/clientes/processos/lançamentos são bem diferentes
// entre si, então juntar tudo num eixo só esconderia a variação dos menores.
function desenharEvolucaoCadastros(ec, dados) {
  const eixoX = dados.map((d) => rotuloDataSnapshot(d.data));
  const desenhar = (id, chave, cor) => {
    const el = document.getElementById(id);
    if (!el) return;
    const g = ec.init(el);
    graficos[id] = g;
    g.setOption({
      ...baseGrafico(),
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: eixoX, axisLine: { lineStyle: { color: CORES.linha } } },
      yAxis: eixoValorOculto(),
      series: [{
        type: 'line', data: dados.map((d) => d[chave]), itemStyle: { color: cor }, smooth: true,
        label: { show: true, position: 'top', color: CORES.texto2, fontSize: 11, fontWeight: 600 },
      }],
    });
  };
  desenhar('g-cad-advogados', 'advogados', CORES.tinta500);
  desenhar('g-cad-clientes', 'clientes', CORES.tinta700);
  desenhar('g-cad-processos', 'processos', CORES.ambar);
  desenhar('g-cad-lancamentos', 'lancamentos', CORES.tinta900);
}

function desenharVariacaoAnual(ec, dados) {
  const el = document.getElementById('g-variacao-anual');
  const g = ec.init(el);
  graficos.variacaoAnual = g;
  const anos = dados.map((d) => String(d.ano));
  const nomesAdvogados = [...new Set(dados.flatMap((d) => Object.keys(d.advogados ?? {})))];
  const seriesAdvogados = nomesAdvogados.map((nome, i) => ({
    name: nome,
    type: 'line',
    data: dados.map((d) => d.advogados?.[nome] ?? 0),
    itemStyle: { color: SERIE_CORES[(i + 1) % SERIE_CORES.length] },
    label: rotuloLinhaValor(),
    smooth: true,
  }));
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'axis' },
    legend: { data: ['Escritório', 'Retenção do escritório', ...nomesAdvogados], top: 0, textStyle: { color: CORES.texto2 } },
    xAxis: { type: 'category', data: anos },
    yAxis: eixoValorOculto(),
    series: [
      { name: 'Escritório', type: 'line', data: dados.map((d) => d.escritorio), itemStyle: { color: CORES.tinta900 }, label: rotuloLinhaValor(), smooth: true },
      { name: 'Retenção do escritório', type: 'line', data: dados.map((d) => d.retencao), itemStyle: { color: CORES.ambar }, lineStyle: { type: 'dashed' }, label: rotuloLinhaValor(), smooth: true },
      ...seriesAdvogados,
    ],
  });
}

function desenharDivisaoIndicador(ec, dados) {
  const el = document.getElementById('g-divisao-indicador');
  const g = ec.init(el);
  graficos.divisaoIndicador = g;
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${formatarMoeda(p.value)} (${p.percent}%)` },
    legend: { top: 0, textStyle: { color: CORES.texto2 } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: dados.map((d) => ({ name: d.nome, value: d.valor })),
      label: { show: true, formatter: (p) => `${p.name}\n${formatarMoeda(p.value)}`, fontSize: 11, color: CORES.texto2 },
    }],
  });
}

function desenharDivisaoFaixaValor(ec, dados) {
  const el = document.getElementById('g-faixa-valor');
  const g = ec.init(el);
  graficos.faixaValor = g;
  g.setOption({
    ...baseGrafico(),
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>${formatarMoeda(p.data.value)} · ${p.data.quantidade} caso(s) · ${p.percent}%` },
    legend: { top: 0, textStyle: { color: CORES.texto2 } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: dados.map((d) => ({ name: d.faixa, value: d.valor, quantidade: d.quantidade })),
      label: { show: true, formatter: (p) => `${p.name}\n${formatarMoeda(p.value)}`, fontSize: 11, color: CORES.texto2 },
    }],
  });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function renderMaioresHonorarios(container, dados) {
  const existente = container.querySelector('.cartao-maiores-honorarios');
  existente?.remove();
  if (filtros.adv.length !== 1) return;
  const nomeAdvogado = store.obterAdvogado(filtros.adv[0])?.nome ?? '';
  const bloco = document.createElement('div');
  bloco.className = 'cartao-grafico cartao-maiores-honorarios';
  bloco.innerHTML = `<h3>Maiores honorários — ${escaparHtml(nomeAdvogado)}</h3>`;
  if (!dados || dados.length === 0) {
    bloco.innerHTML += '<p class="tela-vazia">Nenhum lançamento no período para este advogado.</p>';
  } else {
    const tabela = document.createElement('table');
    tabela.className = 'tabela-dados';
    tabela.innerHTML = `
      <thead><tr><th>Cliente</th><th>Descrição</th><th>Valor</th></tr></thead>
      <tbody>
        ${dados.map((d) => `<tr><td>${escaparHtml(d.cliente)}</td><td>${escaparHtml(d.descricao ?? '—')}</td><td class="campo-valor">${formatarMoeda(d.valor)}</td></tr>`).join('')}
      </tbody>
    `;
    const wrap = document.createElement('div');
    wrap.className = 'tabela-wrap';
    wrap.appendChild(tabela);
    bloco.appendChild(wrap);
  }
  container.appendChild(bloco);
}
