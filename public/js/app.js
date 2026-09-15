import { supabase } from './supabase.js';
import { store } from './store.js';
import { sessao } from './sessao.js';
import * as telaLogin from './telas/login.js';

const ROTAS = {
  '#/advogados': () => import('./telas/advogados.js'),
  '#/clientes': () => import('./telas/clientes.js'),
  '#/tabelas': () => import('./telas/tabelas.js'),
  '#/lancar': () => import('./telas/lancamento.js'),
  '#/painel': () => import('./telas/painel.js'),
  '#/logs': () => import('./telas/logs.js'),
};
const ROTA_PADRAO = '#/advogados'; // trocar para '#/lancar' quando a Fase 3 existir

const ITENS_RAIL = [
  { hash: '#/lancar', icone: 'icone-lancar', texto: 'Lançar' },
  { hash: '#/painel', icone: 'icone-painel', texto: 'Painel' },
  { hash: '#/clientes', icone: 'icone-clientes', texto: 'Clientes' },
  { hash: '#/advogados', icone: 'icone-advogados', texto: 'Advogados' },
  { hash: '#/tabelas', icone: 'icone-tabelas', texto: 'Tabelas' },
  { hash: '#/logs', icone: 'icone-logs', texto: 'Registro de alterações' },
];

let telaAtual = null;
let sprite;

async function carregarSprite() {
  if (sprite) return;
  const resp = await fetch('/assets/icones.svg');
  const texto = await resp.text();
  const div = document.createElement('div');
  div.style.display = 'none';
  div.innerHTML = texto;
  document.body.appendChild(div);
  sprite = true;
}

function normalizarHash() {
  const [rota] = location.hash.split('/').slice(0, 3).join('/').split('?');
  const partes = location.hash.split('/');
  return `#/${partes[1] ?? ''}`;
}

function mostrarLogin(mensagemErro) {
  document.getElementById('app-shell').hidden = true;
  const telaLoginEl = document.getElementById('tela-login');
  telaLoginEl.hidden = false;
  telaLogin.render(telaLoginEl, mensagemErro);
}

function montarShell() {
  document.getElementById('tela-login').hidden = true;
  const shell = document.getElementById('app-shell');
  shell.hidden = false;
  shell.innerHTML = `
    <nav class="rail" id="rail">
      <div class="rail-logo"><img src="/assets/img/logo.png" alt="Honorários" /></div>
      ${ITENS_RAIL.map((item) => `
        <a class="rail-item" data-hash="${item.hash}" href="${item.hash}">
          <svg><use href="#${item.icone}"/></svg>
          <span class="rail-item-texto">${item.texto}</span>
        </a>
      `).join('')}
    </nav>
    <header class="topbar">
      <h1 class="topbar-titulo" id="topbar-titulo"></h1>
      <div class="topbar-acoes">
        <div class="topbar-busca"><svg width="16" height="16"><use href="#icone-busca"/></svg> Buscar (/)</div>
        <button class="topbar-usuario" id="menu-usuario">
          ${sessao.usuario.nome} <svg width="14" height="14"><use href="#icone-seta"/></svg>
        </button>
      </div>
    </header>
    <main id="conteudo"></main>
  `;

  document.getElementById('menu-usuario').addEventListener('click', async () => {
    const confirmado = window.confirm('Sair da sua conta?');
    if (confirmado) await supabase.auth.signOut();
  });

  let railExpandido = localStorage.getItem('honorarios-rail-expandido') === '1';
  const railEl = document.getElementById('rail');
  railEl.classList.toggle('rail-expandido', railExpandido);
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === 'b') {
      railExpandido = !railExpandido;
      railEl.classList.toggle('rail-expandido', railExpandido);
      localStorage.setItem('honorarios-rail-expandido', railExpandido ? '1' : '0');
    }
  });
}

function atualizarRailAtivo(hash) {
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.classList.toggle('ativo', el.dataset.hash === hash);
  });
}

async function renderRota() {
  const hash = ROTAS[normalizarHash()] ? normalizarHash() : ROTA_PADRAO;
  const carregar = ROTAS[hash];
  telaAtual?.destroy?.();
  const modulo = await carregar();
  telaAtual = modulo;
  atualizarRailAtivo(hash);
  document.title = `${modulo.titulo} · Honorários`;
  document.getElementById('topbar-titulo').textContent = modulo.titulo;
  await modulo.render(document.getElementById('conteudo'));
}

async function carregarPerfilEMostrarShell() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return mostrarLogin();

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, perfil, advogado_id, ativo')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error || !usuario) {
    await supabase.auth.signOut();
    return mostrarLogin('Sua conta não está liberada para acessar o sistema. Fale com o administrador.');
  }
  if (!usuario.ativo) {
    await supabase.auth.signOut();
    return mostrarLogin('Seu acesso foi desativado. Fale com o administrador.');
  }

  sessao.usuario = usuario;
  await carregarSprite();
  await store.init();
  montarShell();
  await renderRota();
}

async function boot() {
  await carregarSprite();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return mostrarLogin();
  await carregarPerfilEMostrarShell();
}

window.addEventListener('honorarios:login', carregarPerfilEMostrarShell);
window.addEventListener('hashchange', () => { if (!document.getElementById('app-shell').hidden) renderRota(); });
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    telaAtual?.destroy?.();
    store.destruir();
    sessao.usuario = null;
    mostrarLogin();
  }
});

boot();
