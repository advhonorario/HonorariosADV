import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { criarSelo } from '../componentes/selo.js';
import { toast } from '../componentes/toast.js';
import { podeEscrever } from '../sessao.js';

export const titulo = 'Tabelas';

const ABAS = {
  processo: { tabela: 'tipos_processo', rotulo: 'Tipos de processo', colunas: ['codigo', 'nome', 'area'] },
  servico: { tabela: 'tipos_servico', rotulo: 'Tipos de serviço', colunas: ['codigo', 'nome', 'natureza', 'percentual_sugerido'] },
};

let desinscrever = [];

export function destroy() {
  desinscrever.forEach((fn) => fn());
  desinscrever = [];
}

export function render(container) {
  destroy();
  const abaInicial = (location.hash.split('/')[2]) === 'servico' ? 'servico' : 'processo';
  let abaAtual = abaInicial;

  container.innerHTML = `
    <div class="container">
      <div class="tela-cabecalho">
        <h1>Tabelas</h1>
        ${podeEscrever() ? '<button class="botao botao-primario" id="btn-novo-tipo"><svg width="16" height="16"><use href="#icone-adicionar"/></svg> Novo</button>' : ''}
      </div>
      <div class="abas" role="tablist">
        <button class="aba" data-aba="processo" role="tab">Tipos de processo</button>
        <button class="aba" data-aba="servico" role="tab">Tipos de serviço</button>
      </div>
      <div class="tabela-wrap" id="corpo-tabela"></div>
    </div>
  `;

  const abasEl = container.querySelectorAll('.aba');
  const corpo = container.querySelector('#corpo-tabela');
  const btnNovo = container.querySelector('#btn-novo-tipo');

  function atualizarAbas() {
    abasEl.forEach((b) => b.classList.toggle('ativa', b.dataset.aba === abaAtual));
    location.hash = `#/tabelas/${abaAtual}`;
  }

  function renderTabela() {
    const cfg = ABAS[abaAtual];
    const dados = abaAtual === 'processo' ? store.listarTiposProcesso() : store.listarTiposServico();

    const tabela = document.createElement('table');
    tabela.className = 'tabela-dados';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      ${podeEscrever() ? '<th></th>' : ''}
      <th>Código</th><th>Nome</th>
      ${abaAtual === 'processo' ? '<th>Área</th>' : '<th>Natureza</th><th>% sugerido</th>'}
      <th>Situação</th>
      ${podeEscrever() ? '<th>Ações</th>' : ''}
    </tr>`;
    const tbody = document.createElement('tbody');

    dados.forEach((item) => {
      const tr = document.createElement('tr');
      tr.className = `linha-arrastavel${item.ativo ? '' : ' linha-inativa'}`;
      tr.draggable = podeEscrever();
      tr.dataset.id = item.id;

      const colArrastar = podeEscrever() ? `<td><svg width="16" height="16"><use href="#icone-arrastar"/></svg></td>` : '';
      const colSituacao = document.createElement('td');
      colSituacao.appendChild(criarSelo(item.ativo ? { texto: 'ativo', tom: 'confirma' } : { texto: 'inativo', tom: 'neutro' }));

      if (abaAtual === 'processo') {
        tr.innerHTML = `${colArrastar}
          <td class="celula-editavel" data-campo="codigo">${item.codigo}</td>
          <td class="celula-editavel" data-campo="nome">${item.nome}</td>
          <td class="celula-editavel" data-campo="area">${item.area}</td>
          <td data-col-situacao></td>
          ${podeEscrever() ? '<td class="acoes-linha"></td>' : ''}`;
      } else {
        tr.innerHTML = `${colArrastar}
          <td class="celula-editavel" data-campo="codigo">${item.codigo}</td>
          <td class="celula-editavel" data-campo="nome">${item.nome}</td>
          <td class="celula-editavel" data-campo="natureza">${item.natureza}</td>
          <td class="celula-editavel" data-campo="percentual_sugerido">${item.percentual_sugerido ?? ''}</td>
          <td data-col-situacao></td>
          ${podeEscrever() ? '<td class="acoes-linha"></td>' : ''}`;
      }
      tr.querySelector('[data-col-situacao]').appendChild(colSituacao);

      if (podeEscrever()) {
        const tdAcoes = tr.querySelector('.acoes-linha');
        const btnEditar = document.createElement('button');
        btnEditar.className = 'botao-texto';
        btnEditar.textContent = 'Editar';
        btnEditar.addEventListener('click', () => entrarModoEdicao(tr, item, cfg));
        const btnToggle = document.createElement('button');
        btnToggle.className = 'botao-texto';
        btnToggle.textContent = item.ativo ? 'Inativar' : 'Ativar';
        btnToggle.addEventListener('click', () => alternarAtivo(item, cfg));
        tdAcoes.appendChild(btnEditar);
        tdAcoes.appendChild(btnToggle);
      }

      tbody.appendChild(tr);
    });

    tabela.appendChild(thead);
    tabela.appendChild(tbody);
    corpo.innerHTML = '';
    corpo.appendChild(tabela);

    if (podeEscrever()) habilitarArraste(tbody, dados, cfg);
  }

  async function alternarAtivo(item, cfg) {
    const { error } = await supabase.from(cfg.tabela).update({ ativo: !item.ativo }).eq('id', item.id);
    if (error) return toast.erro('Não foi possível atualizar a situação.');
    toast.sucesso('Situação atualizada.');
  }

  function entrarModoEdicao(tr, item, cfg) {
    const celulas = tr.querySelectorAll('.celula-editavel');
    const valoresOriginais = {};
    celulas.forEach((td) => {
      const campo = td.dataset.campo;
      valoresOriginais[campo] = item[campo] ?? '';
      const input = document.createElement('input');
      input.className = 'campo';
      input.value = valoresOriginais[campo];
      if (campo === 'percentual_sugerido') { input.type = 'number'; input.step = '0.001'; }
      td.textContent = '';
      td.appendChild(input);
    });
    const tdAcoes = tr.querySelector('.acoes-linha');
    tdAcoes.innerHTML = '';
    const btnSalvar = document.createElement('button');
    btnSalvar.className = 'botao-texto';
    btnSalvar.textContent = 'Salvar';
    const btnCancelar = document.createElement('button');
    btnCancelar.className = 'botao-texto';
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.addEventListener('click', () => renderTabela());
    btnSalvar.addEventListener('click', async () => {
      const patch = {};
      celulas.forEach((td) => { patch[td.dataset.campo] = td.querySelector('input').value; });
      const { error } = await supabase.from(cfg.tabela).update(patch).eq('id', item.id);
      if (error) return toast.erro('Não foi possível salvar. Confira os dados.');
      toast.sucesso('Alteração salva.');
    });
    tdAcoes.appendChild(btnSalvar);
    tdAcoes.appendChild(btnCancelar);
  }

  function habilitarArraste(tbody, dados, cfg) {
    let arrastando = null;
    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('dragstart', () => { arrastando = tr; tr.classList.add('arrastando'); });
      tr.addEventListener('dragend', () => { arrastando?.classList.remove('arrastando'); arrastando = null; });
      tr.addEventListener('dragover', (ev) => { ev.preventDefault(); });
      tr.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        if (!arrastando || arrastando === tr) return;
        const linhas = Array.from(tbody.children);
        const de = linhas.indexOf(arrastando);
        const para = linhas.indexOf(tr);
        if (de < para) tr.after(arrastando); else tr.before(arrastando);
        const novaOrdem = Array.from(tbody.children).map((el) => el.dataset.id);
        await Promise.all(novaOrdem.map((id, i) => supabase.from(cfg.tabela).update({ ordem: i }).eq('id', id)));
        toast.sucesso('Ordem atualizada.');
      });
    });
  }

  function trocarAba(nova) {
    abaAtual = nova;
    atualizarAbas();
    renderTabela();
  }

  abasEl.forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));

  btnNovo?.addEventListener('click', async () => {
    const cfg = ABAS[abaAtual];
    const base = abaAtual === 'processo'
      ? { codigo: 'NOVO', nome: 'Novo tipo', area: '—', ordem: store.listarTiposProcesso().length }
      : { codigo: 'NOVO', nome: 'Novo tipo', natureza: 'fixo', percentual_sugerido: 0, ordem: store.listarTiposServico().length };
    const { error } = await supabase.from(cfg.tabela).insert(base);
    if (error) return toast.erro('Não foi possível criar. Código pode já existir.');
    toast.sucesso('Tipo criado — edite os campos.');
  });

  desinscrever.push(store.on('tiposProcesso', () => { if (abaAtual === 'processo') renderTabela(); }));
  desinscrever.push(store.on('tiposServico', () => { if (abaAtual === 'servico') renderTabela(); }));

  atualizarAbas();
  renderTabela();
}
