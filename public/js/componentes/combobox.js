// Combobox com busca incremental sobre uma lista já carregada em memória
// (vinda do store.js) — nenhuma ida ao servidor a cada tecla.
export function criarCombobox({ itens, campoTexto, campoValor, onSelecionar, placeholder = '', valorInicial = null }) {
  const raiz = document.createElement('div');
  raiz.className = 'combobox';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'campo';
  input.placeholder = placeholder;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  const lista = document.createElement('ul');
  lista.className = 'combobox-lista';
  lista.hidden = true;
  lista.setAttribute('role', 'listbox');

  raiz.appendChild(input);
  raiz.appendChild(lista);

  let valorAtual = valorInicial;
  let destaqueIndex = -1;
  let itensFiltrados = [];

  function itemPorValor(valor) {
    return itens.find((it) => it[campoValor] === valor) ?? null;
  }

  if (valorInicial != null) {
    const item = itemPorValor(valorInicial);
    if (item) input.value = item[campoTexto];
  }

  function renderLista() {
    lista.innerHTML = '';
    itensFiltrados.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = `combobox-opcao${i === destaqueIndex ? ' destacada' : ''}`;
      li.setAttribute('role', 'option');
      li.textContent = item[campoTexto];
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        selecionar(item);
      });
      lista.appendChild(li);
    });
    lista.hidden = itensFiltrados.length === 0;
    input.setAttribute('aria-expanded', String(!lista.hidden));
  }

  function filtrar(texto) {
    const termo = texto.trim().toLowerCase();
    itensFiltrados = termo
      ? itens.filter((it) => it[campoTexto].toLowerCase().includes(termo))
      : itens.slice(0, 50);
    destaqueIndex = itensFiltrados.length ? 0 : -1;
    renderLista();
  }

  function selecionar(item) {
    valorAtual = item ? item[campoValor] : null;
    input.value = item ? item[campoTexto] : '';
    lista.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    onSelecionar?.(valorAtual, item);
  }

  input.addEventListener('input', () => filtrar(input.value));
  input.addEventListener('focus', () => filtrar(input.value));
  input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 100));
  input.addEventListener('keydown', (ev) => {
    if (lista.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      filtrar(input.value);
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      destaqueIndex = Math.min(destaqueIndex + 1, itensFiltrados.length - 1);
      renderLista();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      destaqueIndex = Math.max(destaqueIndex - 1, 0);
      renderLista();
    } else if (ev.key === 'Enter') {
      if (!lista.hidden && itensFiltrados[destaqueIndex]) {
        ev.preventDefault();
        selecionar(itensFiltrados[destaqueIndex]);
      }
    } else if (ev.key === 'Escape') {
      lista.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });

  return {
    el: raiz,
    obterValor: () => valorAtual,
    definirValor(valor) {
      const item = itemPorValor(valor);
      valorAtual = valor;
      input.value = item ? item[campoTexto] : '';
    },
    // Permite refletir mudanças do store (ex.: Realtime) sem recriar o combobox
    // e perder o texto/foco atual — a lista filtrada só é reconsultada na
    // próxima interação (input/focus), então não interrompe a digitação.
    atualizarItens(novosItens) { itens = novosItens; },
    limpar() { selecionar(null); },
  };
}
