import { criarCombobox } from './combobox.js';

// Combobox de busca (já existente) + chips removíveis — usado pelos filtros
// de múltipla escolha do painel (advogado, cliente etc., especificação §8.3).
// Não reaproveita criarCombobox como seletor único: cada escolha vira um chip
// e o campo de busca volta a ficar vazio, pronto pra próxima escolha.
export function criarMultiSelect({ itens, campoTexto, campoValor, placeholder = '', valoresIniciais = [], aoMudar }) {
  const raiz = document.createElement('div');
  raiz.className = 'multi-select';

  const comboContainer = document.createElement('div');
  const chipsEl = document.createElement('div');
  chipsEl.className = 'multi-select-chips';

  let selecionados = [...valoresIniciais];

  function itemPorValor(valor) {
    return itens.find((it) => it[campoValor] === valor) ?? null;
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    selecionados.forEach((valor) => {
      const item = itemPorValor(valor);
      const rotulo = item ? item[campoTexto] : valor;
      const chip = document.createElement('span');
      chip.className = 'chip chip-removivel';
      const texto = document.createElement('span');
      texto.textContent = rotulo;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = '×';
      botao.setAttribute('aria-label', `Remover ${rotulo}`);
      botao.addEventListener('click', () => remover(valor));
      chip.appendChild(texto);
      chip.appendChild(botao);
      chipsEl.appendChild(chip);
    });
  }

  function remover(valor) {
    selecionados = selecionados.filter((v) => v !== valor);
    renderChips();
    aoMudar?.(selecionados);
  }

  function adicionar(valor) {
    if (!valor || selecionados.includes(valor)) return;
    selecionados = [...selecionados, valor];
    renderChips();
    aoMudar?.(selecionados);
  }

  const combo = criarCombobox({
    itens,
    campoTexto,
    campoValor,
    placeholder,
    onSelecionar: (id) => {
      if (id) { adicionar(id); combo.limpar(); }
    },
  });
  comboContainer.appendChild(combo.el);

  raiz.appendChild(comboContainer);
  raiz.appendChild(chipsEl);
  renderChips();

  return {
    el: raiz,
    obterValores: () => selecionados,
    definirValores(valores) { selecionados = [...valores]; renderChips(); },
    atualizarItens(novosItens) { itens = novosItens; combo.atualizarItens(novosItens); renderChips(); },
  };
}
