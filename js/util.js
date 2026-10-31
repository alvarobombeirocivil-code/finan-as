// Utilidades de datas, dinheiro e texto.
// Datas são sempre strings 'AAAA-MM-DD' (hora local); meses são 'AAAA-MM'.
// Valores em dinheiro são inteiros em centavos.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = (n) => String(n).padStart(2, '0');

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthKey = (s) => s.slice(0, 7);
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

export function addMonthsKey(key, n) {
  let [y, m] = key.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
// Dia `day` do mês `key`, limitado ao último dia (ex.: 31 em fevereiro vira 28/29).
export function dateInMonth(key, day) {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}
export const diffDays = (a, b) => Math.round((parseDate(a) - parseDate(b)) / 86400000);

export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const monthShort = (key) => MONTHS[+key.slice(5, 7) - 1].slice(0, 3).toLowerCase();

export const fmtDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
export const fmtShort = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDayLong = (s) => dayFmt.format(parseDate(s));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => brl.format((cents || 0) / 100);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#8b94a8');
export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
