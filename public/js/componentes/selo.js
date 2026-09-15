export function criarSelo({ texto, tom = 'neutro' }) {
  const el = document.createElement('span');
  el.className = `selo selo-${tom}`;
  el.textContent = texto;
  return el;
}
