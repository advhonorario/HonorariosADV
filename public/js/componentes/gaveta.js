let gavetaAtual = null;

function seletorFocavel(container) {
  return container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
}

export function abrirGaveta({ titulo, montarConteudo, aoFechar, temAlteracoes }) {
  fecharGaveta();

  const elementoQueAbriu = document.activeElement;

  const fundo = document.createElement('div');
  fundo.className = 'gaveta-fundo';

  const gaveta = document.createElement('div');
  gaveta.className = 'gaveta';
  gaveta.setAttribute('role', 'dialog');
  gaveta.setAttribute('aria-modal', 'true');

  const cabecalho = document.createElement('div');
  cabecalho.className = 'gaveta-cabecalho';
  const h2 = document.createElement('h2');
  h2.textContent = titulo;
  const botaoFechar = document.createElement('button');
  botaoFechar.className = 'botao-texto';
  botaoFechar.setAttribute('aria-label', 'Fechar');
  botaoFechar.innerHTML = '<svg width="20" height="20"><use href="#icone-fechar"/></svg>';
  botaoFechar.addEventListener('click', tentarFechar);
  cabecalho.appendChild(h2);
  cabecalho.appendChild(botaoFechar);

  const corpo = document.createElement('div');
  corpo.className = 'gaveta-corpo';

  gaveta.appendChild(cabecalho);
  gaveta.appendChild(corpo);

  function tentarFechar() {
    if (typeof temAlteracoes === 'function' && temAlteracoes()) {
      const confirmado = window.confirm('Existem alterações não salvas. Fechar mesmo assim?');
      if (!confirmado) return;
    }
    fecharGaveta();
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') { tentarFechar(); return; }
    if (ev.key === 'Tab') {
      const focaveis = Array.from(seletorFocavel(gaveta));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (ev.shiftKey && document.activeElement === primeiro) {
        ev.preventDefault(); ultimo.focus();
      } else if (!ev.shiftKey && document.activeElement === ultimo) {
        ev.preventDefault(); primeiro.focus();
      }
    }
  }
  gaveta.addEventListener('keydown', onKeydown);

  document.body.appendChild(fundo);
  document.body.appendChild(gaveta);

  gavetaAtual = { fundo, gaveta, elementoQueAbriu, aoFechar };

  const rodape = montarConteudo(corpo, () => tentarFechar());
  if (rodape) gaveta.appendChild(rodape);

  const primeiroFocavel = seletorFocavel(gaveta)[0];
  (primeiroFocavel ?? gaveta).focus();
}

export function fecharGaveta() {
  if (!gavetaAtual) return;
  const { fundo, gaveta, elementoQueAbriu, aoFechar } = gavetaAtual;
  fundo.remove();
  gaveta.remove();
  gavetaAtual = null;
  elementoQueAbriu?.focus?.();
  aoFechar?.();
}
