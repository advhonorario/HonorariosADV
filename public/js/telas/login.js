import { supabase } from '../supabase.js';

export const titulo = 'Entrar';

export function render(container, mensagemInicial) {
  container.innerHTML = '';

  const raiz = document.createElement('div');
  raiz.className = 'tela-login';
  raiz.innerHTML = `
    <div class="cartao-login">
      <img src="/assets/img/logo.png" alt="" />
      <h1>Honorários</h1>
      <form novalidate>
        <div class="campo-grupo">
          <label class="rotulo-campo" for="campo-email">E-mail</label>
          <input class="campo" type="email" id="campo-email" name="email" autocomplete="username" autofocus required />
        </div>
        <div class="campo-grupo">
          <label class="rotulo-campo" for="campo-senha">Senha</label>
          <input class="campo" type="password" id="campo-senha" name="senha" autocomplete="current-password" required />
        </div>
        <div id="erro-login" role="alert" aria-live="polite"></div>
        <button class="botao botao-primario" type="submit" style="width:100%; justify-content:center; margin-top: var(--e3)">Entrar</button>
      </form>
    </div>
  `;
  container.appendChild(raiz);

  const form = raiz.querySelector('form');
  const campoErro = raiz.querySelector('#erro-login');
  const botao = form.querySelector('button[type="submit"]');

  function mostrarErro(msg) {
    campoErro.innerHTML = msg ? `<div class="mensagem-erro">${msg}</div>` : '';
  }

  if (mensagemInicial) mostrarErro(mensagemInicial);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mostrarErro('');
    botao.disabled = true;
    const email = form.email.value.trim();
    const senha = form.senha.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      mostrarErro('E-mail ou senha inválidos.');
      botao.disabled = false;
      return;
    }
    window.dispatchEvent(new CustomEvent('honorarios:login'));
  });
}
