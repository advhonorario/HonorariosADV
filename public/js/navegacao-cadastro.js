// Usado pelos botões "+ novo ..." da tela de Lançar (advogado/cliente/tipo de
// processo/tipo de serviço): navega para a tela de cadastro correspondente,
// sinaliza para ela abrir o formulário de criação automaticamente e, ao
// salvar, volta para #/lancar retomando o rascunho em andamento sem pedir
// confirmação — o usuário só foi lá para cadastrar algo que faltava.
const CHAVE_ABRIR_NOVO = 'honorarios-abrir-novo-cadastro';
const CHAVE_AUTO_RETOMAR = 'honorarios-auto-retomar-lancamento';

export function irCriarERetornar(rota) {
  sessionStorage.setItem(CHAVE_ABRIR_NOVO, '1');
  location.hash = rota;
}

export function consumirAbrirNovo() {
  const marcado = sessionStorage.getItem(CHAVE_ABRIR_NOVO) === '1';
  if (marcado) sessionStorage.removeItem(CHAVE_ABRIR_NOVO);
  return marcado;
}

export function voltarParaLancamento() {
  sessionStorage.setItem(CHAVE_AUTO_RETOMAR, '1');
  location.hash = '#/lancar';
}

export function consumirAutoRetomar() {
  const marcado = sessionStorage.getItem(CHAVE_AUTO_RETOMAR) === '1';
  if (marcado) sessionStorage.removeItem(CHAVE_AUTO_RETOMAR);
  return marcado;
}
