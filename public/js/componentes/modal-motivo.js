const MOTIVOS_FREQUENTES = {
  inativar_advogado: ['Desligamento do escritório', 'Suspensão da OAB', 'Solicitação do próprio advogado', 'Outro'],
  inativar_cliente: ['Cliente sem processos ativos', 'Relacionamento encerrado', 'Cadastro duplicado', 'Outro'],
  ativar_advogado: ['Retorno ao escritório', 'Inativação por engano', 'Fim da suspensão da OAB', 'Outro'],
  ativar_cliente: ['Novo processo/relacionamento retomado', 'Inativação por engano', 'Outro'],
  percentual_padrao: ['Renegociação de contrato', 'Correção de cadastro', 'Promoção/mudança de papel', 'Outro'],
  remover_indicacao: ['Indicação encerrada por acordo', 'Erro de cadastro', 'Outro'],
};

const MINIMO_CARACTERES = 10;

/**
 * @returns {Promise<string|null>} motivo confirmado, ou null se cancelado
 */
export function abrirModalMotivo({ titulo, contexto, diferencas = [], categoriaMotivos }) {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const h2 = document.createElement('h2');
    h2.textContent = titulo;
    modal.appendChild(h2);

    if (contexto) {
      const p = document.createElement('p');
      p.textContent = contexto;
      p.style.marginBottom = 'var(--e4)';
      p.style.color = 'var(--texto-2)';
      modal.appendChild(p);
    }

    if (diferencas.length) {
      const bloco = document.createElement('div');
      bloco.className = 'modal-diferenca';
      diferencas.forEach(({ campo, de, para }) => {
        const linha = document.createElement('div');
        linha.innerHTML = `<span>${campo}</span><span>${de} → ${para}</span>`;
        bloco.appendChild(linha);
      });
      modal.appendChild(bloco);
    }

    const grupoMotivo = document.createElement('div');
    grupoMotivo.className = 'campo-grupo';

    const rotulo = document.createElement('label');
    rotulo.className = 'rotulo-campo';
    rotulo.textContent = 'Motivo da alteração *';
    grupoMotivo.appendChild(rotulo);

    const opcoes = MOTIVOS_FREQUENTES[categoriaMotivos] ?? [];
    if (opcoes.length) {
      const select = document.createElement('select');
      select.className = 'campo';
      select.style.marginBottom = 'var(--e2)';
      const optVazia = document.createElement('option');
      optVazia.value = '';
      optVazia.textContent = 'Selecionar motivo frequente…';
      select.appendChild(optVazia);
      opcoes.forEach((texto) => {
        const opt = document.createElement('option');
        opt.value = texto === 'Outro' ? '' : texto;
        opt.textContent = texto;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        if (select.value) { textarea.value = select.value; atualizarContador(); }
      });
      grupoMotivo.appendChild(select);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'campo';
    textarea.rows = 3;
    textarea.setAttribute('aria-describedby', 'contador-motivo');
    grupoMotivo.appendChild(textarea);

    const contador = document.createElement('div');
    contador.className = 'modal-contador';
    contador.id = 'contador-motivo';
    grupoMotivo.appendChild(contador);

    modal.appendChild(grupoMotivo);

    const rodape = document.createElement('div');
    rodape.className = 'modal-rodape';
    const botaoCancelar = document.createElement('button');
    botaoCancelar.className = 'botao botao-secundario';
    botaoCancelar.textContent = 'Cancelar';
    const botaoSalvar = document.createElement('button');
    botaoSalvar.className = 'botao botao-primario';
    botaoSalvar.textContent = titulo.toLowerCase().includes('estorn') ? 'Estornar lançamento' : 'Salvar alteração';
    botaoSalvar.disabled = true;
    rodape.appendChild(botaoCancelar);
    rodape.appendChild(botaoSalvar);
    modal.appendChild(rodape);

    function atualizarContador() {
      const restante = MINIMO_CARACTERES - textarea.value.trim().length;
      contador.textContent = restante > 0 ? `mínimo ${MINIMO_CARACTERES} caracteres (faltam ${restante})` : 'mínimo atingido';
      botaoSalvar.disabled = restante > 0;
    }
    textarea.addEventListener('input', atualizarContador);
    atualizarContador();

    function encerrar(valor) {
      document.removeEventListener('keydown', onKeydown);
      fundo.remove();
      resolve(valor);
    }

    function onKeydown(ev) {
      if (ev.key === 'Escape') encerrar(null);
    }
    document.addEventListener('keydown', onKeydown);

    botaoCancelar.addEventListener('click', () => encerrar(null));
    botaoSalvar.addEventListener('click', () => encerrar(textarea.value.trim()));

    fundo.appendChild(modal);
    document.body.appendChild(fundo);
    textarea.focus();
  });
}
