// Regras de negócio: contas a pagar, lançamentos, contas, cartões e faturas.
import * as db from './db.js';
import { uid, todayStr, monthKey, addMonthsKey, dateInMonth, daysInMonth } from './util.js';

let data;
export const D = () => data;

const empty = () => ({
  app: 'financas',
  version: 1,
  settings: { pin: null, lastBackup: null, lastAccount: null, onboarded: false, drive: null },
  // updatedAt: momento da última alteração nos dados; compara este aparelho com o Google Drive.
  meta: { updatedAt: null },
  categories: [],
  accounts: [],
  cards: [],
  bills: [],
  series: {},
  txs: [],
  txSeries: {},
  invoicePayments: [],
});

function normalize(obj) {
  const base = empty();
  if (!obj || typeof obj !== 'object') return base;
  for (const k of Object.keys(base)) if (k !== 'settings' && k !== 'meta' && obj[k] != null) base[k] = obj[k];
  base.settings = { ...base.settings, ...(obj.settings || {}) };
  base.meta = { ...base.meta, ...(obj.meta || {}) };
  fixCardBillPayments(base);
  return base;
}

// Correção (v1.7): contas a pagar ligadas a um cartão ("Pagar com" = cartão) eram pagas usando
// o próprio cartão, o que criava uma compra nova na fatura seguinte e contava o valor duas vezes.
// Aqui o pagamento deixa de ser compra no cartão, e pagamentos de fatura que ficaram sem
// nenhuma compra são removidos. Roda sempre ao abrir; não muda nada se não houver o problema.
function fixCardBillPayments(d) {
  let changed = false;
  for (const t of d.txs) {
    if (!t.billId || !t.cardId) continue;
    const b = d.bills.find((x) => x.id === t.billId);
    if (b && b.payWith === `c:${t.cardId}`) { t.cardId = null; t.invoice = null; changed = true; }
  }
  if (!changed) return;
  const orphan = d.invoicePayments.filter((p) => !d.txs.some((t) => t.cardId === p.cardId && t.invoice === p.invoice));
  if (!orphan.length) return;
  const txIds = new Set(orphan.map((p) => p.txId));
  d.invoicePayments = d.invoicePayments.filter((p) => !orphan.includes(p));
  d.txs = d.txs.filter((t) => !txIds.has(t.id));
}

// Marca que os dados mudaram (usado para decidir o que enviar ou baixar do Drive).
export function touch() { data.meta.updatedAt = new Date().toISOString(); }
const isEmptyData = (o) => !o.txs.length && !o.bills.length && !o.accounts.length && !o.cards.length && !o.categories.length;
export const hasData = () => !isEmptyData(data);

export async function load() {
  data = normalize(await db.get('state'));
  await persist();
}
export async function persist() {
  ensureRecurring();
  await db.set('state', data);
}

export const byId = (list, id) => (id ? data[list].find((x) => x.id === id) : undefined);
const remove = (list, pred) => { data[list] = data[list].filter((x) => !pred(x)); };

// ---------- Cartões e faturas ----------
// Cada fatura é identificada pelo mês de vencimento ('AAAA-MM').
// Compras feitas no dia do fechamento ou depois entram na fatura seguinte.
export function invoiceKeyFor(card, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let closeKey = dateStr.slice(0, 7);
  if (d >= Math.min(card.closeDay, daysInMonth(y, m))) closeKey = addMonthsKey(closeKey, 1);
  return card.dueDay > card.closeDay ? closeKey : addMonthsKey(closeKey, 1);
}
export const invoiceDue = (card, key) => dateInMonth(key, card.dueDay);
export function invoiceClose(card, key) {
  const closeKey = card.dueDay > card.closeDay ? key : addMonthsKey(key, -1);
  return dateInMonth(closeKey, card.closeDay);
}

export function invoice(card, key) {
  const items = data.txs
    .filter((t) => t.cardId === card.id && t.invoice === key)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  const payments = data.invoicePayments.filter((p) => p.cardId === card.id && p.invoice === key);
  const total = items.reduce((s, t) => s + t.amount, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, total - paid);
  return {
    id: `fat:${card.id}:${key}`, card, key, items, payments, total, paid, remaining,
    due: invoiceDue(card, key), close: invoiceClose(card, key),
    isPaid: total > 0 && remaining === 0,
  };
}

function cardInvoiceKeys(card) {
  const keys = new Set();
  for (const t of data.txs) if (t.cardId === card.id && t.invoice) keys.add(t.invoice);
  for (const p of data.invoicePayments) if (p.cardId === card.id) keys.add(p.invoice);
  return [...keys];
}
export const allInvoices = () => data.cards.flatMap((c) => cardInvoiceKeys(c).map((k) => invoice(c, k)));

// Contas a pagar com "Pagar com" = este cartão. Entram na fatura do mês do vencimento.
const linkedBills = (card) => data.bills.filter((b) => b.payWith === `c:${card.id}`);
const billValue = (b) => (b.paid ? (b.paidAmount ?? b.amount) : b.amount);

// Fatura completa do mês: compras lançadas no cartão + contas a pagar ligadas ao cartão.
export function cardStatement(card, key) {
  const inv = invoice(card, key);
  const bills = linkedBills(card).filter((b) => monthKey(b.due) === key).sort((a, b) => a.due.localeCompare(b.due) || a.desc.localeCompare(b.desc));
  const billsTotal = bills.reduce((s, b) => s + billValue(b), 0);
  const billsPaid = bills.filter((b) => b.paid).reduce((s, b) => s + billValue(b), 0);
  return {
    ...inv, bills,
    grandTotal: inv.total + billsTotal,
    grandPaid: inv.paid + billsPaid,
    grandPending: inv.remaining + (billsTotal - billsPaid),
    count: inv.items.length + bills.length,
  };
}
// Valor que ainda vai cair nas faturas depois do mês `key` (parcelas e contas futuras).
export function cardFuture(card, key) {
  const bills = linkedBills(card).filter((b) => !b.paid && monthKey(b.due) > key).reduce((s, b) => s + b.amount, 0);
  const invs = cardInvoiceKeys(card).filter((k) => k > key).reduce((s, k) => s + invoice(card, k).remaining, 0);
  return bills + invs;
}
// Limite usado: tudo o que ainda não foi pago no cartão.
export const cardUsed = (card) => cardInvoiceKeys(card).reduce((s, k) => s + invoice(card, k).remaining, 0)
  + linkedBills(card).filter((b) => !b.paid).reduce((s, b) => s + b.amount, 0);

export function payInvoice(inv, { date, amount, source }) {
  const accId = source?.startsWith('a:') ? source.slice(2) : null;
  const tx = {
    id: uid(), type: 'fatura', desc: `Fatura ${inv.card.name}`, amount, date, categoryId: null, notes: '',
    accountId: byId('accounts', accId) ? accId : null, cardId: null, invoice: null,
    payCard: inv.card.id, payInvoice: inv.key, created: Date.now(),
  };
  data.txs.push(tx);
  data.invoicePayments.push({ id: uid(), cardId: inv.card.id, invoice: inv.key, amount, date, txId: tx.id });
}
export function unpayInvoice(inv) {
  const ids = new Set(inv.payments.map((p) => p.txId));
  remove('txs', (t) => ids.has(t.id));
  remove('invoicePayments', (p) => p.cardId === inv.card.id && p.invoice === inv.key);
}

// ---------- Lançamentos (receitas, despesas, pagamentos de fatura) ----------
function applySource(tx, source) {
  tx.accountId = null; tx.cardId = null; tx.invoice = null;
  if (!source) return;
  const kind = source[0], id = source.slice(2);
  if (kind === 'a' && byId('accounts', id)) tx.accountId = id;
  if (kind === 'c') {
    const card = byId('cards', id);
    if (card) { tx.cardId = id; tx.invoice = invoiceKeyFor(card, tx.date); }
  }
}

const sourceOf = (t) => (t.cardId ? `c:${t.cardId}` : t.accountId ? `a:${t.accountId}` : null);

// Despesa no cartão com parcelas vira N lançamentos, um em cada fatura.
// Com f.repeat, o lançamento se repete todo mês (até f.repeatEnd, se informado).
export function addTx(f) {
  const base = { type: f.type, desc: f.desc, categoryId: f.categoryId || null, notes: f.notes || '', billId: f.billId || null, created: Date.now() };
  const card = f.source?.startsWith('c:') ? byId('cards', f.source.slice(2)) : null;
  const n = f.type === 'despesa' && card ? Math.max(1, f.parcels || 1) : 1;
  if (n === 1) {
    const tx = { id: uid(), ...base, amount: f.amount, date: f.date };
    applySource(tx, f.source);
    if (f.repeat && (f.type === 'receita' || f.type === 'despesa')) {
      tx.seriesId = uid();
      data.txSeries[tx.seriesId] = { day: +f.date.slice(8), until: monthKey(f.date), end: f.repeatEnd || null, stopped: false };
    }
    data.txs.push(tx);
    return tx;
  }
  const groupId = uid();
  const each = Math.floor(f.amount / n);
  const firstInv = invoiceKeyFor(card, f.date);
  const day = +f.date.slice(8);
  let first;
  for (let i = 0; i < n; i++) {
    const tx = {
      id: uid(), ...base,
      amount: each + (i === 0 ? f.amount - each * n : 0),
      date: dateInMonth(addMonthsKey(monthKey(f.date), i), day),
      accountId: null, cardId: card.id, invoice: addMonthsKey(firstInv, i),
      groupId, purchaseDate: f.date, totalAmount: f.amount, installment: { n: i + 1, total: n },
    };
    data.txs.push(tx);
    first ??= tx;
  }
  return first;
}

export function updateTx(tx, f, applyFuture) {
  const toParcels = !tx.seriesId && f.type === 'despesa' && f.source?.startsWith('c:') && f.parcels > 1;
  if (tx.groupId || toParcels) {
    remove('txs', (t) => (tx.groupId ? t.groupId === tx.groupId : t.id === tx.id));
    const first = addTx({ ...f, billId: tx.billId });
    const b = byId('bills', tx.billId);
    if (b) Object.assign(b, { txId: first.id, paidAmount: f.amount, paidDate: f.date });
    return;
  }
  const oldDay = +tx.date.slice(8);
  Object.assign(tx, { desc: f.desc, amount: f.amount, date: f.date, categoryId: f.categoryId || null, notes: f.notes || '' });
  applySource(tx, f.source);
  const b = byId('bills', tx.billId);
  if (b) Object.assign(b, { paidAmount: tx.amount, paidDate: tx.date });
  const s = data.txSeries[tx.seriesId];
  if (applyFuture && s) {
    const newDay = +f.date.slice(8);
    s.end = f.repeatEnd || null;
    if (newDay !== oldDay) s.day = newDay;
    remove('txs', (o) => o.seriesId === tx.seriesId && s.end && monthKey(o.date) > s.end);
    for (const o of data.txs) {
      if (o.seriesId !== tx.seriesId || o.id === tx.id || o.date <= tx.date) continue;
      Object.assign(o, { desc: tx.desc, amount: tx.amount, categoryId: tx.categoryId, notes: tx.notes });
      if (newDay !== oldDay) o.date = dateInMonth(monthKey(o.date), newDay);
      applySource(o, f.source);
    }
  }
}

// scope: 'one' = só este; 'future' = este e os próximos da repetição (encerra a repetição).
export function deleteTx(tx, scope = 'one') {
  if (scope === 'future' && tx.seriesId) {
    remove('txs', (t) => t.seriesId === tx.seriesId && t.date >= tx.date);
    if (data.txSeries[tx.seriesId]) data.txSeries[tx.seriesId].stopped = true;
  } else if (tx.groupId) remove('txs', (t) => t.groupId === tx.groupId);
  else remove('txs', (t) => t.id === tx.id);
  const b = byId('bills', tx.billId);
  if (b) resetPaid(b);
  if (tx.type === 'fatura') remove('invoicePayments', (p) => p.txId === tx.id);
}

// ---------- Contas a pagar ----------
function newBill(f) {
  return {
    id: uid(), desc: f.desc, amount: f.amount, due: f.due, categoryId: f.categoryId || null,
    payWith: f.payWith || null, notes: f.notes || '', recur: 'none', seriesId: null, installment: null,
    paid: false, paidDate: null, paidAmount: null, txId: null, created: Date.now(),
  };
}

export function addBill(f) {
  if (f.mode === 'mensal') {
    const b = newBill(f);
    b.recur = 'mensal';
    b.seriesId = uid();
    data.series[b.seriesId] = { day: +f.due.slice(8), until: monthKey(f.due), end: f.end || null, stopped: false };
    data.bills.push(b);
  } else if (f.mode === 'parcelada') {
    const sid = uid(), day = +f.due.slice(8);
    for (let i = 0; i < f.parcels; i++) {
      const b = newBill({ ...f, due: dateInMonth(addMonthsKey(monthKey(f.due), i), day) });
      b.seriesId = sid;
      b.installment = { n: i + 1, total: f.parcels };
      data.bills.push(b);
    }
  } else {
    data.bills.push(newBill(f));
  }
}

// Repetições mensais (contas, receitas e despesas): mantém criadas as ocorrências
// dos próximos 12 meses, respeitando a data de término (s.end), se houver.
export const HORIZON_MONTHS = 12;
function ensureRecurring() {
  const limit = addMonthsKey(monthKey(todayStr()), HORIZON_MONTHS);
  for (const [sid, s] of Object.entries(data.series)) {
    if (s.stopped) continue;
    const items = data.bills.filter((b) => b.seriesId === sid);
    if (!items.length) { s.stopped = true; continue; }
    const tpl = items.reduce((a, b) => (b.due > a.due ? b : a));
    const stop = s.end && s.end < limit ? s.end : limit;
    while (s.until < stop) {
      s.until = addMonthsKey(s.until, 1);
      data.bills.push({ ...newBill({ ...tpl, due: dateInMonth(s.until, s.day) }), recur: 'mensal', seriesId: sid });
    }
  }
  for (const [sid, s] of Object.entries(data.txSeries)) {
    if (s.stopped) continue;
    const items = data.txs.filter((t) => t.seriesId === sid);
    if (!items.length) { s.stopped = true; continue; }
    const tpl = items.reduce((a, b) => (b.date > a.date ? b : a));
    const stop = s.end && s.end < limit ? s.end : limit;
    while (s.until < stop) {
      s.until = addMonthsKey(s.until, 1);
      const tx = {
        id: uid(), type: tpl.type, desc: tpl.desc, amount: tpl.amount, categoryId: tpl.categoryId, notes: tpl.notes,
        billId: null, seriesId: sid, created: Date.now(), date: dateInMonth(s.until, s.day),
      };
      applySource(tx, sourceOf(tpl));
      data.txs.push(tx);
    }
  }
}

export function updateBill(b, f, applyFuture) {
  const oldDay = +b.due.slice(8);
  Object.assign(b, { desc: f.desc, amount: f.amount, due: f.due, categoryId: f.categoryId || null, payWith: f.payWith || null, notes: f.notes || '' });
  const t = byId('txs', b.txId);
  if (t) Object.assign(t, { desc: b.desc, categoryId: b.categoryId });
  if (applyFuture && b.seriesId) {
    const newDay = +f.due.slice(8);
    for (const o of data.bills) {
      if (o.seriesId !== b.seriesId || o.id === b.id || o.paid || o.due <= b.due) continue;
      Object.assign(o, { desc: b.desc, amount: b.amount, categoryId: b.categoryId, payWith: b.payWith, notes: b.notes });
      if (newDay !== oldDay) o.due = dateInMonth(monthKey(o.due), newDay);
    }
    const s = data.series[b.seriesId];
    if (s && newDay !== oldDay) s.day = newDay;
    if (s && b.recur === 'mensal') {
      s.end = f.end || null;
      if (s.end) remove('bills', (o) => o.seriesId === b.seriesId && !o.paid && monthKey(o.due) > s.end);
    }
  }
}

// scope: 'one' = só esta; 'future' = esta e as próximas não pagas (encerra a repetição).
export function deleteBill(b, scope) {
  const unlink = (x) => { const t = byId('txs', x.txId); if (t) t.billId = null; };
  if (scope === 'future' && b.seriesId) {
    const gone = data.bills.filter((o) => o.seriesId === b.seriesId && (o.id === b.id || (o.due >= b.due && !o.paid)));
    gone.forEach(unlink);
    const ids = new Set(gone.map((o) => o.id));
    remove('bills', (o) => ids.has(o.id));
    if (data.series[b.seriesId]) data.series[b.seriesId].stopped = true;
  } else {
    unlink(b);
    remove('bills', (o) => o.id === b.id);
  }
}

export function payBill(b, { date, amount, source }) {
  // Conta que já faz parte da fatura de um cartão: pagar não cria compra nova nesse cartão.
  if (b.payWith?.startsWith('c:') && source === b.payWith) source = null;
  const tx = addTx({ type: 'despesa', desc: b.desc, amount, date, categoryId: b.categoryId, source, billId: b.id });
  Object.assign(b, { paid: true, paidDate: date, paidAmount: amount, txId: tx.id });
}
function resetPaid(b) { Object.assign(b, { paid: false, paidDate: null, paidAmount: null, txId: null }); }
export function unpayBill(b) {
  if (b.txId) remove('txs', (t) => t.id === b.txId);
  resetPaid(b);
}

// Contas avulsas, recorrentes, parceladas e faturas de cartão numa lista só.
export function payables() {
  const bills = data.bills.map((b) => ({
    kind: 'bill', id: b.id, bill: b, desc: b.desc, due: b.due, paid: b.paid, paidDate: b.paidDate,
    amount: b.paid ? (b.paidAmount ?? b.amount) : b.amount,
    categoryId: b.categoryId, installment: b.installment, recur: b.recur,
  }));
  const invs = allInvoices().filter((i) => i.total > 0).map((i) => ({
    kind: 'fatura', id: i.id, inv: i, desc: `Fatura ${i.card.name}`, due: i.due, paid: i.isPaid,
    paidDate: i.payments.at(-1)?.date, amount: i.isPaid ? i.total : i.remaining,
    open: todayStr() < i.close,
  }));
  return [...bills, ...invs].sort((a, b) => a.due.localeCompare(b.due) || a.desc.localeCompare(b.desc));
}

// ---------- Saldos e resumos ----------
export function accountBalance(a) {
  const today = todayStr();
  let s = a.initial || 0;
  for (const t of data.txs) {
    if (t.accountId !== a.id || t.date > today) continue;
    s += t.type === 'receita' ? t.amount : -t.amount;
  }
  return s;
}
export function monthSummary(key) {
  let receitas = 0, despesas = 0;
  for (const t of data.txs) {
    if (t.date.slice(0, 7) !== key) continue;
    if (t.type === 'receita') receitas += t.amount;
    else if (t.type === 'despesa') despesas += t.amount;
  }
  return { receitas, despesas, saldo: receitas - despesas };
}

// Saldo previsto em `end`: saldo de hoje + receitas futuras − despesas futuras nas contas
// − contas a pagar e faturas pendentes que vencem até `end` (inclusive as atrasadas).
export function forecast(end) {
  const today = todayStr();
  const saldo = data.accounts.reduce((s, a) => s + accountBalance(a), 0);
  let receber = 0, pagar = 0;
  for (const t of data.txs) {
    if (t.date <= today || t.date > end || t.cardId) continue;
    if (t.type === 'receita') receber += t.amount;
    else pagar += t.amount;
  }
  for (const p of payables()) if (!p.paid && p.due <= end) pagar += p.amount;
  return { saldo: saldo + receber - pagar, receber, pagar };
}

// Despesas do mês por categoria ('' = sem categoria), contando compras no cartão pela data.
export function spendingByCategory(key) {
  const m = new Map();
  for (const t of data.txs) {
    if (t.type !== 'despesa' || t.date.slice(0, 7) !== key) continue;
    const k = t.categoryId || '';
    m.set(k, (m.get(k) || 0) + t.amount);
  }
  return m;
}

// ---------- Categorias ----------
export const COLORS = ['#4c8dff', '#ff8a2a', '#35d6a4', '#ff6170', '#b67cff', '#ffd23f', '#2ec5d3', '#ff7ac6', '#9aa4b8'];
export function addCategory({ name, type, color }) {
  const c = { id: uid(), name, type, color: color || COLORS[data.categories.length % COLORS.length] };
  data.categories.push(c);
  return c;
}
export function deleteCategory(c) {
  remove('categories', (x) => x.id === c.id);
  for (const x of [...data.bills, ...data.txs]) if (x.categoryId === c.id) x.categoryId = null;
}

// ---------- Contas bancárias ----------
export function saveAccount(acc, f) {
  if (acc) { Object.assign(acc, f); return acc; }
  acc = { id: uid(), ...f };
  data.accounts.push(acc);
  return acc;
}
export function deleteAccount(acc) {
  const src = 'a:' + acc.id;
  remove('accounts', (a) => a.id === acc.id);
  for (const t of data.txs) if (t.accountId === acc.id) t.accountId = null;
  for (const b of data.bills) if (b.payWith === src) b.payWith = null;
  for (const c of data.cards) if (c.payAccount === src) c.payAccount = null;
  if (data.settings.lastAccount === src) data.settings.lastAccount = null;
}

// ---------- Cartões ----------
export function saveCard(card, f) {
  if (card) {
    const changed = card.closeDay !== f.closeDay || card.dueDay !== f.dueDay;
    Object.assign(card, f);
    // Recalcula a fatura das compras à vista ainda não pagas se mudaram os dias.
    if (changed) for (const t of data.txs) if (t.cardId === card.id && !t.groupId) {
      const inv = invoice(card, t.invoice);
      if (!inv.payments.length) t.invoice = invoiceKeyFor(card, t.date);
    }
    return card;
  }
  card = { id: uid(), ...f };
  data.cards.push(card);
  return card;
}
export function deleteCard(card) {
  const src = 'c:' + card.id;
  for (const t of data.txs) if (t.cardId === card.id) { const b = byId('bills', t.billId); if (b) resetPaid(b); }
  remove('txs', (t) => t.cardId === card.id);
  remove('invoicePayments', (p) => p.cardId === card.id);
  remove('cards', (c) => c.id === card.id);
  for (const b of data.bills) if (b.payWith === src) b.payWith = null;
}

// ---------- PIN ----------
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setPin(pin) {
  if (!pin) { data.settings.pin = null; return; }
  const salt = uid();
  data.settings.pin = { salt, hash: await hashPin(pin, salt) };
}
export async function checkPin(pin) {
  const p = data.settings.pin;
  return !p || (await hashPin(pin, p.salt)) === p.hash;
}

// ---------- Backup ----------
// PIN, digital e conexão com o Drive são deste aparelho e nunca entram no backup.
export function exportData() {
  const copy = structuredClone(data);
  copy.settings.pin = null;
  copy.settings.bio = null;
  copy.settings.drive = null;
  copy.exportedAt = new Date().toISOString();
  return copy;
}
export const isValidBackup = (o) => !!o && typeof o === 'object' && Array.isArray(o.txs) && Array.isArray(o.bills) && Array.isArray(o.accounts);
export function replaceAll(o) {
  const { pin, bio, drive } = data.settings;
  data = normalize(o);
  delete data.exportedAt;
  Object.assign(data.settings, { pin, bio: bio ?? null, drive: drive ?? null });
}
export function wipe() { data = empty(); }
