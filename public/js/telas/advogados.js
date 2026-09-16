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
import { consumirAbrirNovo, voltarParaLancamento } from '../navegacao-cadastro.js';

export const titulo = 'Advogados';

const PAPEIS = ['responsavel', 'indicacao', 'parceria', 'correspondente', 'sucumbencia'];

let desinscrever = [];
let filtroTexto = '';
let filtroSituacao = 'ativos';
let tabelaAtual = null;

export function destroy() {
  desinscrever.forEach((fn) => fn());
  desinscrever = [];
  fecharGaveta();
}

function listaFiltrada() {
  let lista = store.listarAdvogados({ ativos: filtroSituacao === 'todos' ? undefined : filtroSituacao === 'ativos' });
  if (filtroTexto.trim()) {
    const termo = filtroTexto.trim().toLowerCase();
    lista = lista.filter((a) => a.nome.toLowerCase().includes(termo) || (a.oab_numero ?? '').includes(termo));
  }
  return lista;
}

export function render(container) {
  destroy();
  container.innerHTML = `
    <div class="container">
      <div class="tela-cabecalho">
        <h1>Advogados</h1>
        ${podeEscrever() ? '<button class="botao botao-primario" id="btn-novo-advogado"><svg width="16" height="16"><use href="#icone-adicionar"/></svg> Novo advogado</button>' : ''}
      </div>
      <div class="tela-filtros">
        <input class="campo" id="busca-advogados" type="search" placeholder="Buscar por nome ou OAB…" style="max-width:280px" />
        <select class="campo" id="filtro-situacao" style="width:auto">
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </div>
      <div id="lista-advogados"></div>
    </div>
  `;

  const listaEl = container.querySelector('#lista-advogados');
  const busca = container.querySelector('#busca-advogados');
  const filtroSel = container.querySelector('#filtro-situacao');
  filtroSel.value = filtroSituacao;

  function renderLista() {
    const dados = listaFiltrada();
    listaEl.innerHTML = '';
    if (dados.length === 0) {
      listaEl.innerHTML = '<p class="tela-vazia">Nenhum advogado encontrado.</p>';
      return;
    }
    tabelaAtual = criarTabela({
      colunas: [
        { rotulo: 'Nome', campo: 'nome' },
        { rotulo: 'OAB', campo: 'oab_numero' },
        { rotulo: '% padrão', campo: 'percentual_padrao' },
        { rotulo: 'Papel', campo: 'papel_preferencial' },
        { rotulo: 'Lançamentos (período)' },
        { rotulo: 'Recebido (período)' },
        { rotulo: 'Situação' },
      ],
      linhas: dados,
      chave: 'id',
      classeLinha: (a) => (a.ativo ? '' : 'linha-inativa'),
      renderLinha(tr, a) {
        const tdSituacao = document.createElement('td');
        tdSituacao.appendChild(a.ativo ? criarSelo({ texto: 'ativo', tom: 'confirma' }) : criarSelo({ texto: 'inativo', tom: 'neutro' }));
        tr.innerHTML = `
          <td>${a.nome}</td>
          <td>${a.oab_numero ? `${a.oab_numero}${a.oab_uf ? '/' + a.oab_uf : ''}` : '—'}</td>
          <td class="campo-percentual">${formatarPercentual(a.percentual_padrao)}</td>
          <td>${a.papel_preferencial}</td>
          <td class="campo-valor" title="Disponível a partir da Fase 3">—</td>
          <td class="campo-valor" title="Disponível a partir da Fase 3">${formatarMoeda(0)}</td>
        `;
        const tdS = document.createElement('td');
        tdS.appendChild(tdSituacao.firstChild);
        tr.appendChild(tdS);
      },
      aoClicarLinha: (a) => abrirFichaAdvogado(a),
    });
    listaEl.appendChild(tabelaAtual.el);
  }

  busca.addEventListener('input', debounce(() => { filtroTexto = busca.value; renderLista(); }, 200));
  filtroSel.addEventListener('change', () => { filtroSituacao = filtroSel.value; renderLista(); });
  container.querySelector('#btn-novo-advogado')?.addEventListener('click', () => abrirFichaAdvogado(null));

  desinscrever.push(store.on('advogados', renderLista));
  renderLista();

  if (consumirAbrirNovo() && podeEscrever()) {
    abrirFichaAdvogado(null, voltarParaLancamento);
  }
}

function abrirFichaAdvogado(advogado, aoCriar) {
  const ehNovo = !advogado;
  let alterado = false;

  abrirGaveta({
    titulo: ehNovo ? 'Novo advogado' : advogado.nome,
    temAlteracoes: () => alterado,
    montarConteudo(corpo, fechar) {
      corpo.innerHTML = `
        <section class="gaveta-bloco">
          <h3>Identificação</h3>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-nome">Nome</label>
            <input class="campo" id="f-nome" value="${advogado?.nome ?? ''}" />
          </div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-oab-numero">OAB (número)</label><input class="campo" id="f-oab-numero" value="${advogado?.oab_numero ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-oab-uf">OAB (UF)</label><input class="campo" id="f-oab-uf" maxlength="2" value="${advogado?.oab_uf ?? ''}" /></div>
          </div>
          <div class="campo-grupo">
            <label class="rotulo-campo" for="f-cpf">CPF/CNPJ</label>
            <input class="campo" id="f-cpf" value="${advogado?.cpf_cnpj ?? ''}" />
            <div id="erro-cpf"></div>
          </div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-email">E-mail</label><input class="campo" id="f-email" type="email" value="${advogado?.email ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-telefone">Telefone</label><input class="campo" id="f-telefone" value="${advogado?.telefone ?? ''}" /></div>
          </div>
          ${!ehNovo && podeEscrever() ? '<button class="botao botao-primario" id="btn-salvar-identificacao">Salvar identificação</button>' : ''}
        </section>

        <section class="gaveta-bloco">
          <h3>Repasse</h3>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-percentual">Percentual padrão</label><input class="campo" id="f-percentual" type="number" step="0.001" value="${advogado?.percentual_padrao ?? 0}" /></div>
            <div><label class="rotulo-campo" for="f-papel">Papel preferencial</label>
              <select class="campo" id="f-papel">
                ${PAPEIS.map((p) => `<option value="${p}" ${advogado?.papel_preferencial === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-banco">Banco</label><input class="campo" id="f-banco" value="${advogado?.banco ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-agencia">Agência</label><input class="campo" id="f-agencia" value="${advogado?.agencia ?? ''}" /></div>
          </div>
          <div class="gaveta-linha">
            <div><label class="rotulo-campo" for="f-conta">Conta</label><input class="campo" id="f-conta" value="${advogado?.conta ?? ''}" /></div>
            <div><label class="rotulo-campo" for="f-pix">Chave PIX</label><input class="campo" id="f-pix" value="${advogado?.chave_pix ?? ''}" /></div>
          </div>
          ${!ehNovo && podeEscrever() ? '<button class="botao botao-primario" id="btn-salvar-repasse">Salvar repasse</button>' : ''}
        </section>

        ${!ehNovo ? `<section class="gaveta-bloco">
          <h3>Percentuais por combinação</h3>
          <div id="lista-excecoes"></div>
          ${podeEscrever() ? '<button class="botao-texto" id="btn-add-excecao">+ adicionar exceção</button>' : ''}
        </section>` : ''}

        ${ehNovo && podeEscrever() ? '<button class="botao botao-primario" id="btn-criar-advogado">Criar advogado</button>' : ''}
      `;

      corpo.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', () => { alterado = true; }));

      corpo.querySelector('#f-cpf')?.addEventListener('input', (ev) => {
        ev.target.value = mascararCpfCnpj(ev.target.value);
      });

      corpo.querySelector('#btn-salvar-identificacao')?.addEventListener('click', async () => {
        const cpf = corpo.querySelector('#f-cpf').value;
        if (!validarCpfCnpj(cpf)) {
          corpo.querySelector('#erro-cpf').innerHTML = '<div class="mensagem-erro">CPF/CNPJ inválido.</div>';
          return;
        }
        corpo.querySelector('#erro-cpf').innerHTML = '';
        const patch = {
          nome: corpo.querySelector('#f-nome').value.trim(),
          oab_numero: corpo.querySelector('#f-oab-numero').value.trim() || null,
          oab_uf: corpo.querySelector('#f-oab-uf').value.trim() || null,
          cpf_cnpj: cpf || null,
          email: corpo.querySelector('#f-email').value.trim() || null,
          telefone: corpo.querySelector('#f-telefone').value.trim() || null,
        };
        if (await salvarAdvogado(advogado, patch, fechar)) alterado = false;
      });

      corpo.querySelector('#btn-salvar-repasse')?.addEventListener('click', async () => {
        const novoPercentual = Number(corpo.querySelector('#f-percentual').value);
        const papel = corpo.querySelector('#f-papel').value;
        const banco = corpo.querySelector('#f-banco').value.trim() || null;
        const agencia = corpo.querySelector('#f-agencia').value.trim() || null;
        const conta = corpo.querySelector('#f-conta').value.trim() || null;
        const pix = corpo.querySelector('#f-pix').value.trim() || null;

        if (advogado.percentual_padrao !== novoPercentual) {
          const motivo = await abrirModalMotivo({
            titulo: 'Confirmar alteração',
            contexto: `Advogado ${advogado.nome}`,
            diferencas: [{ campo: 'Percentual padrão', de: formatarPercentual(advogado.percentual_padrao), para: formatarPercentual(novoPercentual) }],
            categoriaMotivos: 'percentual_padrao',
          });
          if (motivo === null) return;
          const { error } = await supabase.rpc('rpc_atualizar_percentual_padrao', {
            p_advogado_id: advogado.id, p_percentual: novoPercentual, p_motivo: motivo,
          });
          if (error) return toast.erro(error.message);
        }

        if (await salvarAdvogado(advogado, { papel_preferencial: papel, banco, agencia, conta, chave_pix: pix }, fechar)) alterado = false;
      });

      corpo.querySelector('#btn-criar-advogado')?.addEventListener('click', async () => {
        const cpf = corpo.querySelector('#f-cpf').value;
        if (!validarCpfCnpj(cpf)) {
          corpo.querySelector('#erro-cpf').innerHTML = '<div class="mensagem-erro">CPF/CNPJ inválido.</div>';
          return;
        }
        corpo.querySelector('#erro-cpf').innerHTML = '';
        const nome = corpo.querySelector('#f-nome').value.trim();
        if (!nome) return toast.erro('Informe o nome do advogado.');

        const patch = {
          nome,
          oab_numero: corpo.querySelector('#f-oab-numero').value.trim() || null,
          oab_uf: corpo.querySelector('#f-oab-uf').value.trim() || null,
          cpf_cnpj: cpf || null,
          email: corpo.querySelector('#f-email').value.trim() || null,
          telefone: corpo.querySelector('#f-telefone').value.trim() || null,
          percentual_padrao: Number(corpo.querySelector('#f-percentual').value) || 0,
          papel_preferencial: corpo.querySelector('#f-papel').value,
          banco: corpo.querySelector('#f-banco').value.trim() || null,
          agencia: corpo.querySelector('#f-agencia').value.trim() || null,
          conta: corpo.querySelector('#f-conta').value.trim() || null,
          chave_pix: corpo.querySelector('#f-pix').value.trim() || null,
        };
        await salvarAdvogado(null, patch, () => { alterado = false; fechar(); aoCriar?.(); });
      });

      if (!ehNovo) renderExcecoes(corpo.querySelector('#lista-excecoes'), advogado.id);
      corpo.querySelector('#btn-add-excecao')?.addEventListener('click', () => adicionarExcecao(advogado.id, corpo.querySelector('#lista-excecoes')));

      if (!ehNovo && podeEscrever()) {
        const rodape = document.createElement('div');
        rodape.className = 'gaveta-rodape';
        const btn = document.createElement('button');
        if (advogado.ativo) {
          btn.className = 'botao botao-perigo';
          btn.textContent = 'Inativar';
          btn.addEventListener('click', async () => {
            const motivo = await abrirModalMotivo({
              titulo: 'Inativar advogado',
              contexto: `${advogado.nome} deixará de aparecer nos seletores de novos lançamentos.`,
              categoriaMotivos: 'inativar_advogado',
            });
            if (motivo === null) return;
            const { error } = await supabase.rpc('rpc_inativar_advogado', { p_id: advogado.id, p_motivo: motivo });
            if (error) return toast.erro(error.message);
            await store.recarregarAdvogado(advogado.id);
            toast.sucesso('Advogado inativado.');
            alterado = false;
            fechar();
          });
        } else {
          btn.className = 'botao botao-primario';
          btn.textContent = 'Ativar';
          btn.addEventListener('click', async () => {
            const motivo = await abrirModalMotivo({
              titulo: 'Ativar advogado',
              contexto: `${advogado.nome} volta a aparecer nos seletores de novos lançamentos.`,
              categoriaMotivos: 'ativar_advogado',
            });
            if (motivo === null) return;
            const { error } = await supabase.rpc('rpc_ativar_advogado', { p_id: advogado.id, p_motivo: motivo });
            if (error) return toast.erro(error.message);
            await store.recarregarAdvogado(advogado.id);
            toast.sucesso('Advogado ativado.');
            alterado = false;
            fechar();
          });
        }
        rodape.appendChild(btn);
        return rodape;
      }
    },
  });
}

async function salvarAdvogado(advogado, patch, fechar) {
  if (!advogado) {
    const { data, error } = await supabase.from('advogados').insert(patch).select('id').single();
    if (error) { toast.erro('Não foi possível criar o advogado. ' + error.message); return false; }
    await store.recarregarAdvogado(data.id);
    toast.sucesso('Advogado criado.');
    fechar();
    return true;
  }
  const { error } = await supabase.from('advogados').update(patch).eq('id', advogado.id);
  if (error) { toast.erro('Não foi possível salvar. ' + error.message); return false; }
  await store.recarregarAdvogado(advogado.id);
  toast.sucesso('Alteração salva.');
  return true;
}

async function renderExcecoes(container, advogadoId) {
  const { data } = await supabase.from('advogado_percentual').select('*').eq('advogado_id', advogadoId);
  const linhas = data ?? [];
  const tabela = document.createElement('table');
  tabela.className = 'tabela-excecoes';
  tabela.innerHTML = '<tbody></tbody>';
  const tbody = tabela.querySelector('tbody');

  linhas.forEach((exc) => {
    const tp = exc.tipo_processo_id ? store.listarTiposProcesso().find((t) => t.id === exc.tipo_processo_id)?.nome : '—';
    const ts = exc.tipo_servico_id ? store.listarTiposServico().find((t) => t.id === exc.tipo_servico_id)?.nome : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${tp}</td><td>${ts}</td><td class="campo-percentual">${formatarPercentual(exc.percentual)}</td>`;
    if (podeEscrever()) {
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'botao-texto';
      btn.textContent = 'Remover';
      btn.addEventListener('click', async () => {
        await supabase.from('advogado_percentual').delete().eq('id', exc.id);
        renderExcecoes(container, advogadoId);
      });
      td.appendChild(btn);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  container.appendChild(tabela);
}

function adicionarExcecao(advogadoId, container) {
  const tr = document.createElement('tr');
  const tdTP = document.createElement('td');
  const tdTS = document.createElement('td');
  const tdPct = document.createElement('td');
  const tdAcao = document.createElement('td');

  const comboTP = criarCombobox({
    itens: store.listarTiposProcesso(), campoTexto: 'nome', campoValor: 'id', placeholder: 'Tipo de processo (opcional)',
  });
  const comboTS = criarCombobox({
    itens: store.listarTiposServico(), campoTexto: 'nome', campoValor: 'id', placeholder: 'Tipo de serviço (opcional)',
  });
  const inputPct = document.createElement('input');
  inputPct.className = 'campo';
  inputPct.type = 'number';
  inputPct.step = '0.001';
  inputPct.placeholder = '%';

  const btnSalvar = document.createElement('button');
  btnSalvar.className = 'botao-texto';
  btnSalvar.textContent = 'Salvar';
  btnSalvar.addEventListener('click', async () => {
    const percentual = Number(inputPct.value);
    if (Number.isNaN(percentual)) return toast.erro('Informe o percentual da exceção.');
    const { error } = await supabase.from('advogado_percentual').insert({
      advogado_id: advogadoId,
      tipo_processo_id: comboTP.obterValor(),
      tipo_servico_id: comboTS.obterValor(),
      percentual,
    });
    if (error) return toast.erro('Não foi possível salvar a exceção. ' + error.message);
    renderExcecoes(container, advogadoId);
  });

  tdTP.appendChild(comboTP.el);
  tdTS.appendChild(comboTS.el);
  tdPct.appendChild(inputPct);
  tdAcao.appendChild(btnSalvar);
  tr.appendChild(tdTP); tr.appendChild(tdTS); tr.appendChild(tdPct); tr.appendChild(tdAcao);
  container.querySelector('tbody')?.appendChild(tr) ?? container.appendChild(tr);
}
