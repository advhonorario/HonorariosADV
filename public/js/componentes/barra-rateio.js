import { formatarMoeda, formatarPercentual } from '../formato.js';

// Barra horizontal única (especificação §7.5/§6.2): segmentos proporcionais
// por advogado em tons da família tinta (mais escuro = maior fatia), residual
// do escritório em hachura diagonal. Se a soma passar de 100%, a borda vira
// `--carimbo` e a mensagem abaixo mostra o percentual atual. Redesenha a cada
// chamada de `atualizar` (~120ms via CSS).
export function criarBarraRateio() {
  const raiz = document.createElement('div');
  raiz.className = 'barra-rateio-bloco';

  const valorTotal = document.createElement('div');
  valorTotal.className = 'valor-destaque barra-rateio-total';

  const trilho = document.createElement('div');
  trilho.className = 'barra-rateio';

  const legenda = document.createElement('div');
  legenda.className = 'barra-rateio-legenda';

  const avisoExcesso = document.createElement('div');
  avisoExcesso.className = 'mensagem-erro';
  avisoExcesso.hidden = true;

  raiz.appendChild(valorTotal);
  raiz.appendChild(trilho);
  raiz.appendChild(avisoExcesso);
  raiz.appendChild(legenda);

  const TONS = ['tom-1', 'tom-2', 'tom-3', 'tom-4', 'tom-5'];

  function atualizar(valorBase, resultado) {
    valorTotal.textContent = formatarMoeda(valorBase);
    trilho.innerHTML = '';
    legenda.innerHTML = '';

    const soma = resultado.somaPercentual;
    const estourou = soma > 100;
    trilho.classList.toggle('barra-rateio-estourada', estourou);

    resultado.linhas.forEach((linha, i) => {
      // Sem estouro, cada segmento ocupa exatamente seu percentual (a sobra
      // vira o residual do escritório). Com estouro, os segmentos são
      // proporcionais entre si (somam 100% do contêiner) — o alerta em si é
      // a borda `--carimbo` + a mensagem abaixo, não uma barra que vaza da tela.
      const pctLargura = estourou ? (100 * Number(linha.percentual || 0)) / soma : Number(linha.percentual) || 0;
      const seg = document.createElement('div');
      seg.className = `barra-rateio-segmento ${TONS[i % TONS.length]}`;
      seg.style.width = `${pctLargura}%`;
      seg.title = `${linha.nome ?? 'Advogado'} · ${formatarPercentual(linha.percentual)} · ${formatarMoeda(linha.valor)}`;
      trilho.appendChild(seg);

      const item = document.createElement('div');
      item.className = 'barra-rateio-item';
      item.innerHTML = `
        <span class="barra-rateio-cor ${TONS[i % TONS.length]}"></span>
        <span class="barra-rateio-nome">${linha.nome ?? 'Advogado'}${linha.papel ? ` (${linha.papel})` : ''}</span>
        <span class="barra-rateio-pct">${formatarPercentual(linha.percentual)}</span>
        <span class="barra-rateio-valor">${formatarMoeda(linha.valor)}</span>
      `;
      legenda.appendChild(item);
    });

    if (!estourou) {
      const pctEscritorio = Math.max(100 - soma, 0);
      const segEscritorio = document.createElement('div');
      segEscritorio.className = 'barra-rateio-segmento barra-rateio-escritorio';
      segEscritorio.style.width = `${pctEscritorio}%`;
      segEscritorio.title = `Escritório · ${formatarPercentual(pctEscritorio)} · ${formatarMoeda(resultado.residualEscritorio)}`;
      trilho.appendChild(segEscritorio);

      const itemEscritorio = document.createElement('div');
      itemEscritorio.className = 'barra-rateio-item';
      itemEscritorio.innerHTML = `
        <span class="barra-rateio-cor barra-rateio-escritorio"></span>
        <span class="barra-rateio-nome">Escritório</span>
        <span class="barra-rateio-pct">${formatarPercentual(pctEscritorio)}</span>
        <span class="barra-rateio-valor">${formatarMoeda(resultado.residualEscritorio)}</span>
      `;
      legenda.appendChild(itemEscritorio);
    }

    if (estourou) {
      avisoExcesso.hidden = false;
      avisoExcesso.textContent = `A soma dos percentuais é ${formatarPercentual(soma)}. Ajuste para no máximo 100%.`;
    } else {
      avisoExcesso.hidden = true;
    }
  }

  return { el: raiz, atualizar };
}
