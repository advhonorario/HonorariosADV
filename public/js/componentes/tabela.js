// Tabela genérica ordenável, sem virtualização (fora de escopo da Fase 2).
export function criarTabela({ colunas, linhas, chave, renderLinha, aoClicarLinha, classeLinha }) {
  const wrap = document.createElement('div');
  wrap.className = 'tabela-wrap';

  const tabela = document.createElement('table');
  tabela.className = 'tabela-dados';

  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  let ordenacao = { campo: null, direcao: 1 };

  colunas.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col.rotulo;
    if (col.campo) {
      th.addEventListener('click', () => {
        ordenacao = ordenacao.campo === col.campo
          ? { campo: col.campo, direcao: -ordenacao.direcao }
          : { campo: col.campo, direcao: 1 };
        renderCorpo();
      });
    }
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const tbody = document.createElement('tbody');

  function renderCorpo() {
    let dados = linhas.slice();
    if (ordenacao.campo) {
      dados.sort((a, b) => {
        const va = a[ordenacao.campo];
        const vb = b[ordenacao.campo];
        if (va == null) return 1;
        if (vb == null) return -1;
        return va > vb ? ordenacao.direcao : va < vb ? -ordenacao.direcao : 0;
      });
    }
    tbody.innerHTML = '';
    dados.forEach((item) => {
      const tr = document.createElement('tr');
      tr.dataset.chave = item[chave];
      if (classeLinha) {
        const c = classeLinha(item);
        if (c) tr.className = c;
      }
      renderLinha(tr, item);
      if (aoClicarLinha) {
        tr.addEventListener('click', (ev) => {
          if (ev.target.closest('button, a, input, select, [data-sem-clique]')) return;
          aoClicarLinha(item);
        });
      }
      tbody.appendChild(tr);
    });
  }

  tabela.appendChild(thead);
  tabela.appendChild(tbody);
  wrap.appendChild(tabela);
  renderCorpo();

  return {
    el: wrap,
    atualizar(novasLinhas) { linhas = novasLinhas; renderCorpo(); },
    marcarSalva(id) {
      const tr = tbody.querySelector(`tr[data-chave="${id}"]`);
      if (tr) { tr.classList.add('linha-salva'); setTimeout(() => tr.classList.remove('linha-salva'), 1200); }
    },
  };
}
