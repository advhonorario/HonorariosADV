let area;

function garantirArea() {
  if (area) return area;
  area = document.createElement('div');
  area.className = 'toast-area';
  area.setAttribute('role', 'status');
  document.body.appendChild(area);
  return area;
}

function mostrar(mensagem, tipo) {
  const container = garantirArea();
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('aria-live', tipo === 'erro' ? 'assertive' : 'polite');
  el.textContent = mensagem;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export const toast = {
  sucesso: (msg) => mostrar(msg, 'sucesso'),
  erro: (msg) => mostrar(msg, 'erro'),
};
