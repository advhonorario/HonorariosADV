// Estado de sessão do usuário logado, compartilhado entre app.js e as telas.
export const sessao = {
  usuario: null, // { id, nome, email, perfil, advogado_id }
};

export function podeEscrever() {
  return sessao.usuario?.perfil === 'admin' || sessao.usuario?.perfil === 'financeiro';
}
