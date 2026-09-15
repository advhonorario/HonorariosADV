const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatadorData = new Intl.DateTimeFormat('pt-BR');

export function formatarMoeda(valor) {
  const n = Number(valor);
  if (Number.isNaN(n)) return formatadorMoeda.format(0);
  return formatadorMoeda.format(n);
}

export function formatarPercentual(valor) {
  const n = Number(valor);
  if (Number.isNaN(n)) return '0,0%';
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 3 })}%`;
}

export function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatadorData.format(d);
}

export function apenasDigitos(str) {
  return String(str ?? '').replace(/\D/g, '');
}

export function mascararCpfCnpj(valor) {
  const digitos = apenasDigitos(valor).slice(0, 14);
  if (digitos.length <= 11) {
    return digitos
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digitos
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function validarCpf(digitos) {
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;
  const calcularDigito = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(digitos[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = calcularDigito(9);
  const d2 = calcularDigito(10);
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
}

function validarCnpj(digitos) {
  if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calcularDigito = (base) => {
    const soma = base.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calcularDigito(pesos1);
  const d2 = calcularDigito(pesos2);
  return d1 === Number(digitos[12]) && d2 === Number(digitos[13]);
}

export function validarCpfCnpj(valor) {
  const digitos = apenasDigitos(valor);
  if (digitos.length === 0) return true; // campo opcional
  if (digitos.length === 11) return validarCpf(digitos);
  if (digitos.length === 14) return validarCnpj(digitos);
  return false;
}

export function debounce(fn, ms = 250) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), ms);
  };
}
