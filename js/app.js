// Interface: telas, formulários e navegação.
import * as S from './store.js';
import {
  todayStr, monthKey, addMonthsKey, monthLabel, monthShort, money, fmtDate, fmtShort, fmtDayLong,
  diffDays, esc, safeColor, range,
} from './util.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ui = { tab: 'inicio', month: monthKey(todayStr()), pagarFilter: 'pendentes', lancFilter: 'todos' };
const TABS = [
  { id: 'inicio', label: 'Início', icon: 'home' },
  { id: 'pagar', label: 'Pagar', icon: 'bill' },
  { id: 'lanc', label: 'Lançamentos', icon: 'swap' },
  { id: 'contas', label: 'Contas', icon: 'wallet' },
];
const CONTACT = {
  name: 'Alvaro Henrique',
  phone: '(11) 94583-5215',
  whatsapp: 'https://wa.me/5511945835215',
  tel: 'tel:+5511945835215',
};
const ACCOUNT_KINDS ={ corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Carteira', investimento: 'Investimento', outro: 'Outro' };

// ================= Inicialização =================
async function boot() {
  try {
    await S.load();
  } catch (err) {
    $('#view').innerHTML = `<div class="empty">${icon('alert')}<p>Não foi possível abrir o armazenamento do aparelho.<br><small>${esc(err.message)}</small></p></div>`;
    return;
  }
  navigator.storage?.persist?.();
  setTheme(isLight() ? 'light' : 'dark');
  $('#tabbar').innerHTML = TABS.map((t) => `<a href="#${t.id}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  $('#fab').innerHTML = icon('plus');
  $('#fab').addEventListener('click', () => openEntryForm({ type: ui.tab === 'lanc' ? 'despesa' : 'bill' }));
  window.addEventListener('hashchange', route);
  route();
  if (S.D().settings.pin) await lockApp();
  handleShortcut();
  registerSW();
}

function handleShortcut() {
  const novo = new URLSearchParams(location.search).get('novo');
  if (!novo) return;
  history.replaceState(null, '', location.pathname + location.hash);
  openEntryForm({ type: novo === 'despesa' || novo === 'receita' ? novo : 'bill' });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Nova versão disponível', { action: 'Atualizar', onAction: () => nw.postMessage('skip'), duration: 15000 });
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

// ================= Navegação e renderização =================
let lastTab;
function route() {
  const tab = location.hash.slice(1) || 'inicio';
  ui.tab = ['inicio', 'pagar', 'lanc', 'contas', 'config'].includes(tab) ? tab : 'inicio';
  render();
}

function render() {
  $('#view').innerHTML = VIEWS[ui.tab]() + footer();
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === ui.tab));
  $('#fab').classList.toggle('hidden', ui.tab === 'config');
  if (lastTab !== ui.tab) { window.scrollTo(0, 0); lastTab = ui.tab; }
}

async function commit() {
  try {
    await S.persist();
  } catch (err) {
    toast('Erro ao salvar: ' + err.message);
  }
  render();
  sheets.forEach((w) => w._refresh?.());
}

// ================= Componentes =================
const greeting = () => {
  const h = new Date().getHours();
  const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return `${g} · ${fmtDayLong(todayStr())}`;
};

// ---------- Tema claro/escuro (escolha salva só neste aparelho) ----------
const isLight = () => document.documentElement.dataset.theme === 'light';
function setTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('avr-theme', theme); } catch {}
  $('meta[name=theme-color]').content = theme === 'light' ? '#f3ebdd' : '#050608';
}
const themeBtn = () => `
  <button class="icon-btn theme-btn" data-act="theme" aria-label="${isLight() ? 'Usar tema escuro' : 'Usar tema claro'}">${icon(isLight() ? 'moon' : 'sun')}</button>`;
const logo = () => `
  <img class="logo-dark" src="icons/logo.svg" alt="AVR Auditoria &amp; Assessoria">
  <img class="logo-light" src="icons/logo-brown.svg" alt="AVR Auditoria &amp; Assessoria">`;

const header = (title, sub = '') => `
  <div class="brand">${logo()}</div>
  <header class="top">
    <div><p class="eyebrow">${sub}</p><h1>${title}</h1></div>
    <div class="top-actions">
      ${themeBtn()}
      <a class="icon-btn" href="#config" aria-label="Configurações">${icon('sliders')}</a>
    </div>
  </header>`;

const monthNav = () => `
  <div class="month-nav">
    <button class="icon-btn" data-act="month" data-d="-1" aria-label="Mês anterior">${icon('chevL')}</button>
    <button class="month-label" data-act="month-today">${monthLabel(ui.month)}${ui.month !== monthKey(todayStr()) ? '<small>toque para voltar a hoje</small>' : ''}</button>
    <button class="icon-btn" data-act="month" data-d="1" aria-label="Próximo mês">${icon('chevR')}</button>
  </div>`;

const seg = (key, opts) => `
  <div class="seg">${opts.map(([v, l]) => `<button class="${ui[key] === v ? 'on' : ''}" data-act="filter" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;

// ---------- Rodapé e contato do desenvolvedor ----------
const footer = () => `
  <footer class="app-footer">
    <p>Desenvolvido por <b>${CONTACT.name}</b> · ${CONTACT.phone}</p>
    <button class="link-btn" data-act="contact">${icon('chat')}Entre em contato</button>
  </footer>`;

const contactCard = () => `
  <div class="contact">
    <p class="contact-name">${CONTACT.name}</p>
    <p class="contact-phone">${CONTACT.phone}</p>
    <div class="btn-col">
      <a class="btn whats" href="${CONTACT.whatsapp}" target="_blank" rel="noopener">${icon('chat')}Conversar no WhatsApp</a>
      <a class="btn ghost" href="${CONTACT.tel}">${icon('phone')}Ligar</a>
    </div>
    <figure class="qr">
      <img src="icons/whatsapp-qr.png" alt="QR Code do WhatsApp de ${CONTACT.name}" onerror="this.closest('figure').remove()">
      <figcaption>Aponte a câmera para abrir o WhatsApp</figcaption>
    </figure>
  </div>`;

function openContact() {
  openSheet(`${sheetHead('Entre em contato')}<p class="muted contact-intro">Dúvidas, sugestões ou suporte do app:</p>${contactCard()}`);
}

const emptyState = (ic, text) => `<div class="empty">${icon(ic)}<p>${text}</p></div>`;
const sumOf = (items) => items.reduce((s, p) => s + p.amount, 0);

function dueText(p) {
  const dd = diffDays(p.due, todayStr());
  if (p.paid) return p.paidDate ? `Paga em ${fmtShort(p.paidDate)}` : 'Paga';
  if (dd < 0) return `Venceu há ${-dd} dia${dd < -1 ? 's' : ''}`;
  if (dd === 0) return 'Vence hoje';
  if (dd === 1) return 'Vence amanhã';
  if (dd <= 7) return `Vence em ${dd} dias`;
  return `Vence ${fmtShort(p.due)}`;
}
function dueClass(p) {
  if (p.paid) return 'paid';
  const dd = diffDays(p.due, todayStr());
  return dd < 0 ? 'overdue' : dd === 0 ? 'today' : '';
}

function payRow(p) {
  const cat = p.kind === 'bill' ? S.byId('categories', p.categoryId) : null;
  const sub = [
    dueText(p),
    p.installment && `${p.installment.n}/${p.installment.total}`,
    p.recur === 'mensal' && 'Mensal',
    p.kind === 'fatura' && p.open && 'Fatura aberta',
    cat && esc(cat.name),
  ].filter(Boolean).join(' · ');
  return `
    <div class="row ${dueClass(p)}" role="button" tabindex="0" data-act="open-pay" data-id="${p.id}">
      <div class="row-ic ${p.kind === 'fatura' ? 'fatura' : ''}">${icon(p.kind === 'fatura' ? 'card' : 'bill')}${cat ? `<i class="cat-dot" style="background:${safeColor(cat.color)}"></i>` : ''}</div>
      <div class="row-main"><div class="row-title">${esc(p.desc)}</div><div class="row-sub">${sub}</div></div>
      <div class="row-amt">${money(p.amount)}</div>
      ${p.paid
        ? `<span class="chk done">${icon('check')}</span>`
        : `<button class="chk" data-act="quick-pay" data-id="${p.id}" aria-label="Marcar como paga">${icon('check')}</button>`}
    </div>`;
}

function txRow(t) {
  const cat = S.byId('categories', t.categoryId);
  const isF = t.type === 'fatura';
  const src = t.cardId ? S.byId('cards', t.cardId)?.name : t.accountId ? S.byId('accounts', t.accountId)?.name : '';
  const sub = isF
    ? ['Pagamento de fatura', src && esc(src)].filter(Boolean).join(' · ')
    : [cat ? esc(cat.name) : 'Sem categoria', src && esc(src), t.installment && `${t.installment.n}/${t.installment.total}`].filter(Boolean).join(' · ');
  const sign = t.type === 'receita' ? '+' : isF ? '' : '−';
  const cls = t.type === 'receita' ? 't-in' : isF ? 't-muted' : 't-out';
  const ic = isF || t.cardId ? 'card' : t.type === 'receita' ? 'up' : 'down';
  return `
    <div class="row" role="button" tabindex="0" data-act="open-tx" data-id="${t.id}">
      <div class="row-ic ${t.type}">${icon(ic)}${cat ? `<i class="cat-dot" style="background:${safeColor(cat.color)}"></i>` : ''}</div>
      <div class="row-main"><div class="row-title">${esc(t.desc)}</div><div class="row-sub">${sub}</div></div>
      <div class="row-amt ${cls}">${sign} ${money(t.amount)}</div>
    </div>`;
}

const payBlock = (title, items, ic, tone) => !items.length ? '' : `
  <section class="block ${tone}">
    <h2>${icon(ic)}${title}<span class="count">${items.length}</span><span class="sum">${money(sumOf(items))}</span></h2>
    <div class="list">${items.map(payRow).join('')}</div>
  </section>`;

// ================= Telas =================
const VIEWS = { inicio: viewInicio, pagar: viewPagar, lanc: viewLanc, contas: viewContas, config: viewConfig };

function viewInicio() {
  const d = S.D(), today = todayStr();
  const balance = d.accounts.reduce((s, a) => s + S.accountBalance(a), 0);
  const sum = S.monthSummary(ui.month);
  const all = S.payables();
  const pend = all.filter((p) => !p.paid);
  const overdue = pend.filter((p) => p.due < today);
  const dueToday = pend.filter((p) => p.due === today);
  const soon = pend.filter((p) => p.due > today && diffDays(p.due, today) <= 7);
  const inMonth = all.filter((p) => monthKey(p.due) === ui.month);
  const hasData = d.bills.length + d.txs.length > 0;
  const backupDue = hasData && (!d.settings.lastBackup || diffDays(today, d.settings.lastBackup) > 30);

  return `
    ${header('Visão geral', greeting())}
    ${monthNav()}
    <section class="hero">
      <p class="hero-label">Saldo atual nas contas</p>
      <p class="hero-value">${money(balance)}</p>
      <div class="hero-row">
        <div><span class="pill in">${icon('up')}</span><div><small>Receitas</small><b>${money(sum.receitas)}</b></div></div>
        <div><span class="pill out">${icon('down')}</span><div><small>Despesas</small><b>${money(sum.despesas)}</b></div></div>
      </div>
    </section>
    ${onboardingCard()}
    ${backupDue ? `<button class="banner" data-act="goto" data-tab="config">${icon('download')}<span>Faz tempo que você não faz backup. Toque para exportar.</span></button>` : ''}
    <div class="stats">
      <div class="stat"><small>A pagar em ${monthShort(ui.month)}</small><b class="t-warn">${money(sumOf(inMonth.filter((p) => !p.paid)))}</b></div>
      <div class="stat"><small>Pago em ${monthShort(ui.month)}</small><b class="t-in">${money(sumOf(inMonth.filter((p) => p.paid)))}</b></div>
    </div>
    ${payBlock('Vencidas', overdue, 'alert', 'danger')}
    ${payBlock('Vencem hoje', dueToday, 'clock', 'warn')}
    ${payBlock('Próximos 7 dias', soon, 'clock', '')}
    ${!overdue.length && !dueToday.length && !soon.length && hasData ? emptyState('party', 'Nenhuma conta pendente nos próximos 7 dias.') : ''}`;
}

function onboardingCard() {
  const d = S.D();
  const steps = [
    { done: d.accounts.length > 0, act: 'new-account', ic: 'bank', t: 'Cadastre uma conta', s: 'Banco ou carteira, com o saldo atual' },
    { done: d.cards.length > 0, act: 'new-card', ic: 'card', t: 'Adicione um cartão', s: 'Opcional · com fechamento e vencimento' },
    { done: d.categories.length > 0, act: 'goto', tab: 'config', ic: 'tag', t: 'Crie suas categorias', s: 'Ou crie na hora de lançar' },
    { done: d.bills.length + d.txs.length > 0, act: 'fab', ic: 'plus', t: 'Lance a primeira conta', s: 'Pelo botão + a qualquer momento' },
  ];
  if (d.settings.onboarded || steps.every((s) => s.done)) return '';
  return `
    <section class="onb">
      <div class="onb-head"><h2>Vamos começar</h2><button class="link-btn" data-act="dismiss-onb">Dispensar</button></div>
      ${steps.map((s) => `
        <button class="onb-step ${s.done ? 'done' : ''}" data-act="${s.act}" ${s.tab ? `data-tab="${s.tab}"` : ''}>
          <span class="onb-ic">${icon(s.done ? 'check' : s.ic)}</span>
          <span class="onb-txt"><b>${s.t}</b><small>${s.s}</small></span>${icon('chevR')}
        </button>`).join('')}
    </section>`;
}

function viewPagar() {
  const today = todayStr(), cur = monthKey(today);
  const all = S.payables();
  const inMonth = all.filter((p) => monthKey(p.due) === ui.month);
  const late = ui.month === cur ? all.filter((p) => !p.paid && p.due < `${cur}-01`) : [];
  const f = ui.pagarFilter;
  const list = inMonth.filter((p) => f === 'todas' || (f === 'pagas' ? p.paid : !p.paid));
  return `
    ${header('Contas a pagar', `${inMonth.length} conta${inMonth.length === 1 ? '' : 's'} no mês`)}
    ${monthNav()}
    <div class="stats">
      <div class="stat"><small>Pendente</small><b class="t-warn">${money(sumOf(inMonth.filter((p) => !p.paid)))}</b></div>
      <div class="stat"><small>Pago</small><b class="t-in">${money(sumOf(inMonth.filter((p) => p.paid)))}</b></div>
    </div>
    ${seg('pagarFilter', [['pendentes', 'Pendentes'], ['pagas', 'Pagas'], ['todas', 'Todas']])}
    ${f !== 'pagas' ? payBlock('Atrasadas de meses anteriores', late, 'alert', 'danger') : ''}
    ${list.length
      ? `${late.length && f !== 'pagas' ? `<h3 class="day-h">${monthLabel(ui.month)}</h3>` : ''}<div class="list">${list.map(payRow).join('')}</div>`
      : emptyState(f === 'pagas' ? 'bill' : 'party', f === 'pagas' ? 'Nenhuma conta paga neste mês.' : f === 'pendentes' ? 'Nenhuma conta pendente neste mês.' : 'Nenhuma conta neste mês. Toque no + para adicionar.')}`;
}

function viewLanc() {
  const d = S.D(), f = ui.lancFilter;
  const txs = d.txs
    .filter((t) => monthKey(t.date) === ui.month && (f === 'todos' || t.type === f))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const sum = S.monthSummary(ui.month);
  const today = todayStr(), yesterday = addDays(today, -1);
  const groups = [];
  for (const t of txs) {
    if (groups.at(-1)?.date !== t.date) groups.push({ date: t.date, items: [] });
    groups.at(-1).items.push(t);
  }
  const dayTitle = (s) => (s === today ? 'Hoje' : s === yesterday ? 'Ontem' : fmtDayLong(s));
  return `
    ${header('Lançamentos', 'Receitas e despesas')}
    ${monthNav()}
    <div class="stats three">
      <div class="stat"><small>Receitas</small><b class="t-in">${money(sum.receitas)}</b></div>
      <div class="stat"><small>Despesas</small><b class="t-out">${money(sum.despesas)}</b></div>
      <div class="stat"><small>Resultado</small><b class="${sum.saldo < 0 ? 't-out' : ''}">${money(sum.saldo)}</b></div>
    </div>
    ${seg('lancFilter', [['todos', 'Todos'], ['receita', 'Receitas'], ['despesa', 'Despesas']])}
    ${groups.length
      ? groups.map((g) => `<h3 class="day-h">${dayTitle(g.date)}</h3><div class="list">${g.items.map(txRow).join('')}</div>`).join('')
      : emptyState('swap', 'Nenhum lançamento neste mês.')}`;
}

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function viewContas() {
  const d = S.D(), today = todayStr();
  const total = d.accounts.reduce((s, a) => s + S.accountBalance(a), 0);
  const accRows = d.accounts.map((a) => {
    const bal = S.accountBalance(a);
    return `
      <div class="row" role="button" tabindex="0" data-act="open-account" data-id="${a.id}">
        <div class="row-ic">${icon(a.kind === 'carteira' ? 'wallet' : 'bank')}</div>
        <div class="row-main"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${ACCOUNT_KINDS[a.kind] || 'Conta'}</div></div>
        <div class="row-amt ${bal < 0 ? 't-out' : ''}">${money(bal)}</div>
      </div>`;
  }).join('');
  const cardTiles = d.cards.map((c) => {
    const inv = S.invoice(c, S.invoiceKeyFor(c, today));
    const used = S.cardUsed(c);
    const pct = c.limit ? Math.min(100, Math.round((used / c.limit) * 100)) : 0;
    return `
      <button class="cc" data-act="open-card" data-id="${c.id}">
        <div class="cc-top"><span>${esc(c.name)}</span>${icon('card')}</div>
        <small>Fatura atual (aberta)</small>
        <b class="cc-amt">${money(inv.remaining)}</b>
        <div class="cc-foot"><span>Fecha ${fmtShort(inv.close)}</span><span>Vence ${fmtShort(inv.due)}</span></div>
        ${c.limit ? `<div class="bar"><i style="width:${pct}%"></i></div><small>Disponível ${money(c.limit - used)} de ${money(c.limit)}</small>` : ''}
      </button>`;
  }).join('');
  return `
    ${header('Contas e cartões', `Saldo total ${money(total)}`)}
    <div class="sec-h"><h2>Contas</h2><button class="link-btn" data-act="new-account">+ Nova conta</button></div>
    ${accRows ? `<div class="list">${accRows}</div>` : emptyState('bank', 'Cadastre suas contas bancárias e a carteira para acompanhar o saldo.')}
    <div class="sec-h"><h2>Cartões de crédito</h2><button class="link-btn" data-act="new-card">+ Novo cartão</button></div>
    ${cardTiles ? `<div class="cc-list">${cardTiles}</div>` : emptyState('card', 'Cadastre um cartão para as compras caírem na fatura certa.')}`;
}

function viewConfig() {
  const d = S.D();
  const chips = (type) => d.categories.filter((c) => c.type === type)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `<button class="chip" data-act="open-cat" data-id="${c.id}"><i style="background:${safeColor(c.color)}"></i>${esc(c.name)}</button>`).join('');
  return `
    <header class="top">
      <a class="icon-btn" href="#inicio" aria-label="Voltar">${icon('chevL')}</a>
      <h1 class="grow">Configurações</h1>
      ${themeBtn()}
    </header>
    <section class="card-sec">
      <h2>${icon('tag')}Categorias</h2>
      <h3>Despesas</h3>
      <div class="chips">${chips('despesa')}<button class="chip add" data-act="new-cat" data-type="despesa">+ Nova</button></div>
      <h3>Receitas</h3>
      <div class="chips">${chips('receita')}<button class="chip add" data-act="new-cat" data-type="receita">+ Nova</button></div>
    </section>
    <section class="card-sec">
      <h2>${icon('lock')}Segurança</h2>
      <p>${d.settings.pin ? 'O app pede o PIN ao abrir e ao voltar depois de 1 minuto fora.' : 'Sem PIN: o app abre direto.'}</p>
      <div class="btn-row">
        <button class="btn ghost" data-act="set-pin">${d.settings.pin ? 'Alterar PIN' : 'Definir PIN'}</button>
        ${d.settings.pin ? '<button class="btn ghost" data-act="remove-pin">Remover PIN</button>' : ''}
      </div>
    </section>
    <section class="card-sec">
      <h2>${icon('download')}Backup</h2>
      <p>Seus dados ficam só neste celular. Exporte um backup de vez em quando e guarde no Google Drive.<br>
      Último backup: <b>${d.settings.lastBackup ? fmtDate(d.settings.lastBackup) : 'nunca'}</b></p>
      <div class="btn-col">
        ${navigator.share ? `<button class="btn primary" data-act="export" data-share="1">${icon('share')}Compartilhar backup (Drive, e-mail…)</button>` : ''}
        <button class="btn ghost" data-act="export">${icon('download')}Baixar arquivo de backup</button>
        <button class="btn ghost" data-act="import">${icon('upload')}Restaurar backup</button>
      </div>
      <input type="file" id="import-file" accept=".json,.txt,application/json,text/plain" hidden>
    </section>
    <section class="card-sec">
      <h2>${icon('chat')}Entre em contato</h2>
      ${contactCard()}
    </section>
    <section class="card-sec danger-sec">
      <h2>${icon('alert')}Zona de perigo</h2>
      <button class="btn danger" data-act="wipe">${icon('trash')}Apagar todos os dados</button>
    </section>
    <p class="ver">Finanças v1.0 · dados salvos apenas neste aparelho</p>`;
}

// ================= Bottom sheets (janelas que sobem de baixo) =================
// O botão "voltar" do Android fecha a janela do topo.
const sheets = [];
let ignorePop = false;

function openSheet(html) {
  const w = document.createElement('div');
  w.className = 'sheet-wrap';
  w.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  $('#sheets').appendChild(w);
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
  if (!sheets.length && !ignorePop) history.pushState({ modal: 1 }, '');
  sheets.push(w);
  document.body.classList.add('no-scroll');
  return w;
}
function removeTop() {
  const w = sheets.pop();
  if (!w) return;
  w.classList.remove('open');
  setTimeout(() => w.remove(), 260);
  w._onClose?.();
  if (!sheets.length) document.body.classList.remove('no-scroll');
}
function closeSheet(n = 1) {
  for (let i = 0; i < n && sheets.length; i++) removeTop();
  if (!sheets.length && history.state?.modal && !ignorePop) {
    ignorePop = true;
    history.back();
  }
}
window.addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop = false;
    if (sheets.length) history.pushState({ modal: 1 }, '');
    return;
  }
  if (sheets.length) {
    removeTop();
    if (sheets.length) history.pushState({ modal: 1 }, '');
  }
});

const sheetHead = (title) => `
  <div class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn" data-act="close-sheet" aria-label="Fechar">${icon('x')}</button></div>`;

function choose(title, msg, opts) {
  return new Promise((resolve) => {
    let done = false;
    const w = openSheet(`
      <div class="dialog">
        <h2>${title}</h2>${msg ? `<p class="muted">${msg}</p>` : ''}
        <div class="btn-col">
          ${opts.map(([v, l, cls]) => `<button class="btn ${cls || 'ghost'}" data-v="${v}">${l}</button>`).join('')}
          <button class="btn text" data-v="">Cancelar</button>
        </div>
      </div>`);
    w._onClose = () => { if (!done) { done = true; resolve(null); } };
    w.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      done = true;
      closeSheet();
      resolve(b.dataset.v || null);
    }));
  });
}
const confirmBox = async (title, msg, ok = 'Confirmar', cls = 'danger') => (await choose(title, msg, [['ok', ok, cls]])) === 'ok';

function promptBox(title, placeholder = '') {
  return new Promise((resolve) => {
    let done = false;
    const w = openSheet(`
      ${sheetHead(title)}
      <form class="form" novalidate>
        <label class="field"><span>Nome</span><input name="v" maxlength="40" placeholder="${esc(placeholder)}" enterkeyhint="done"></label>
        <button type="submit" class="btn primary">Criar</button>
      </form>`);
    const form = $('form', w);
    w._onClose = () => { if (!done) { done = true; resolve(null); } };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = form.elements.v.value.trim();
      if (!v) return invalid(form.elements.v, 'Digite um nome');
      done = true;
      closeSheet();
      resolve(v);
    });
    setTimeout(() => form.elements.v.focus(), 250);
  });
}

// ================= Toast =================
let toastTimer;
function toast(msg, { action, onAction, duration = 2400 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) $('button', el).onclick = () => { el.classList.remove('show'); onAction?.(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}
function invalid(input, msg) {
  const field = input.closest('.field');
  field?.classList.add('invalid');
  input.addEventListener('input', () => field?.classList.remove('invalid'), { once: true });
  const more = input.closest('details');
  if (more) more.open = true;
  input.focus();
  toast(msg);
}

// ================= Campo de dinheiro (digita da direita, estilo banco) =================
function initMoney(input) {
  input.placeholder = money(0);
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
    setMoney(input, +(digits || 0));
  });
}
function setMoney(input, cents) {
  input.dataset.cents = String(cents || 0);
  input.value = cents ? money(cents) : '';
}
const getMoney = (input) => +(input.dataset.cents || 0);

// ================= Seletores =================
function catOptions(type) {
  const cats = S.D().categories.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name));
  return `<option value="">Sem categoria</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="__new">+ Nova categoria…</option>`;
}
function sourceOptions(withCards, none = 'Não informar') {
  const d = S.D();
  let html = `<option value="">${none}</option>`;
  if (d.accounts.length) html += `<optgroup label="Contas">${d.accounts.map((a) => `<option value="a:${a.id}">${esc(a.name)}</option>`).join('')}</optgroup>`;
  if (withCards && d.cards.length) html += `<optgroup label="Cartões de crédito">${d.cards.map((c) => `<option value="c:${c.id}">${esc(c.name)} (crédito)</option>`).join('')}</optgroup>`;
  return html;
}
async function newCategoryInline(select, type) {
  const name = await promptBox('Nova categoria', type === 'receita' ? 'Ex.: Salário' : 'Ex.: Mercado');
  if (name) {
    const c = S.addCategory({ name, type });
    await commit();
    select.innerHTML = catOptions(type);
    select.value = c.id;
  } else {
    select.value = '';
  }
}

// ================= Formulário de lançamento (botão +) =================
function openEntryForm({ type = 'bill', edit = null } = {}) {
  const st = { type, edit };
  const w = openSheet('<div class="sheet-body"></div>');
  const body = $('.sheet-body', w);
  const draw = (keep) => {
    body.innerHTML = entryHtml(st);
    const form = $('form', body);
    fillEntry(form, st, keep);
    wireEntry(form, st, draw);
  };
  draw();
  if (!edit) setTimeout(() => $('input[name=desc]', body)?.focus(), 280);
}

function entryHtml({ type, edit }) {
  const d = S.D();
  const isBill = type === 'bill';
  const title = !edit ? 'Novo lançamento' : isBill ? 'Editar conta a pagar' : type === 'receita' ? 'Editar receita' : 'Editar despesa';
  const pool = isBill ? d.bills : d.txs.filter((t) => t.type === type);
  const descs = [...new Set(pool.map((x) => x.desc))].slice(-300);
  const ph = isBill ? 'Ex.: Conta de luz' : type === 'receita' ? 'Ex.: Salário' : 'Ex.: Mercado';
  return `
    ${sheetHead(title)}
    <form class="form" novalidate autocomplete="off">
      ${edit ? '' : `<div class="seg seg-type">${[['bill', 'Conta a pagar'], ['despesa', 'Despesa'], ['receita', 'Receita']]
        .map(([v, l]) => `<button type="button" class="${type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('')}</div>`}
      <label class="field"><span>Descrição</span><input name="desc" list="dl-desc" maxlength="80" placeholder="${ph}" enterkeyhint="next"></label>
      <datalist id="dl-desc">${descs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span class="amount-label">Valor</span><input name="amount" class="money" inputmode="numeric" enterkeyhint="done"></label>
        <label class="field"><span>${isBill ? 'Vencimento' : 'Data'}</span><input name="date" type="date"></label>
      </div>
      <p class="hint hidden" data-hint></p>
      <details class="more"${edit ? ' open' : ''}>
        <summary>Mais opções</summary>
        <label class="field"><span>Categoria</span><select name="categoryId">${catOptions(type === 'receita' ? 'receita' : 'despesa')}</select></label>
        ${isBill ? `<label class="field"><span>Pagar com (sugestão ao pagar)</span><select name="source">${sourceOptions(true)}</select></label>` : ''}
        ${type === 'despesa' ? `
          <label class="field"><span>Pago com</span><select name="source">${sourceOptions(true)}</select></label>
          <label class="field parcels-field hidden"><span>Parcelas no cartão</span><select name="parcels">${range(1, 24).map((n) => `<option value="${n}">${n === 1 ? 'À vista' : `${n}x`}</option>`).join('')}</select><small>Informe o valor total da compra; ele é dividido entre as faturas.</small></label>` : ''}
        ${type === 'receita' ? `<label class="field"><span>Recebido em</span><select name="source">${sourceOptions(false)}</select></label>` : ''}
        ${isBill && !edit ? `
          <label class="field"><span>Repetição</span><select name="mode"><option value="none">Não repete</option><option value="mensal">Todo mês</option><option value="parcelada">Parcelada</option></select></label>
          <label class="field bill-parcels hidden"><span>Quantidade de parcelas</span><input name="billParcels" type="number" inputmode="numeric" min="2" max="120" value="2"><small>O valor informado é o de cada parcela.</small></label>` : ''}
        ${isBill && edit?.seriesId ? `<label class="check"><input type="checkbox" name="applyFuture" checked><span>Aplicar também às próximas ${edit.recur === 'mensal' ? 'ocorrências' : 'parcelas'} não pagas</span></label>` : ''}
        <label class="field"><span>Observação</span><input name="notes" maxlength="200"></label>
      </details>
      <div class="btn-col">
        <button type="submit" class="btn primary" value="save">${icon('check')}Salvar</button>
        ${edit
          ? `<button type="button" class="btn danger" data-del>${icon('trash')}Excluir</button>`
          : '<button type="submit" class="btn ghost" value="again">Salvar e adicionar outra</button>'}
      </div>
    </form>`;
}

function fillEntry(form, st, keep) {
  const el = form.elements, d = S.D(), x = st.edit;
  initMoney(el.amount);
  if (x && !keep) {
    el.desc.value = x.desc;
    el.categoryId.value = x.categoryId || '';
    el.notes.value = x.notes || '';
    if (st.type === 'bill') {
      setMoney(el.amount, x.amount);
      el.date.value = x.due;
      el.source.value = x.payWith || '';
    } else {
      setMoney(el.amount, x.groupId ? x.totalAmount : x.amount);
      el.date.value = x.groupId ? x.purchaseDate : x.date;
      el.source.value = x.cardId ? `c:${x.cardId}` : x.accountId ? `a:${x.accountId}` : '';
      if (x.groupId) el.parcels.value = String(x.installment.total);
    }
    return;
  }
  el.date.value = keep?.date || todayStr();
  if (keep) { el.desc.value = keep.desc || ''; setMoney(el.amount, keep.amount); }
  if (st.type !== 'bill' && el.source) el.source.value = d.settings.lastAccount || '';
}

function wireEntry(form, st, draw) {
  const el = form.elements;
  form.querySelectorAll('.seg-type button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.type === st.type) return;
    const keep = { desc: el.desc.value, amount: getMoney(el.amount), date: el.date.value };
    st.type = b.dataset.type;
    draw(keep);
  }));
  const parcelsField = $('.parcels-field', form);
  const amountLabel = $('.amount-label', form);
  const syncParcels = () => {
    const onCard = (el.source?.value || '').startsWith('c:');
    parcelsField?.classList.toggle('hidden', !onCard);
    if (parcelsField) amountLabel.textContent = onCard && +el.parcels.value > 1 ? 'Valor total' : 'Valor';
  };
  el.source?.addEventListener('change', syncParcels);
  el.parcels?.addEventListener('change', syncParcels);
  syncParcels();
  el.mode?.addEventListener('change', () => $('.bill-parcels', form).classList.toggle('hidden', el.mode.value !== 'parcelada'));
  el.categoryId.addEventListener('change', () => {
    if (el.categoryId.value === '__new') newCategoryInline(el.categoryId, st.type === 'receita' ? 'receita' : 'despesa');
  });
  el.desc.addEventListener('input', () => suggest(form, st, syncParcels));
  el.desc.addEventListener('change', () => suggest(form, st, syncParcels));
  el.desc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.amount.focus(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitEntry(form, st, e.submitter?.value === 'again', draw);
  });
  $('[data-del]', form)?.addEventListener('click', () => deleteEntry(st));
}

// Ao digitar uma descrição já usada, sugere valor, categoria e conta do último lançamento igual.
function suggest(form, st, after) {
  if (st.edit) return;
  const el = form.elements, d = S.D();
  const v = el.desc.value.trim().toLowerCase();
  if (!v) return;
  const pool = st.type === 'bill' ? d.bills : d.txs.filter((t) => t.type === st.type);
  const last = pool.filter((x) => x.desc.toLowerCase() === v)
    .sort((a, b) => (b.due || b.date).localeCompare(a.due || a.date))[0];
  if (!last) return;
  const filled = [];
  if (!getMoney(el.amount)) { setMoney(el.amount, last.groupId ? last.totalAmount : last.amount); filled.push('valor'); }
  if (!el.categoryId.value && last.categoryId && S.byId('categories', last.categoryId)) { el.categoryId.value = last.categoryId; filled.push('categoria'); }
  if (st.type === 'bill' && !el.source.value && last.payWith) el.source.value = last.payWith;
  if (st.type !== 'bill' && el.source) {
    const src = last.cardId ? `c:${last.cardId}` : last.accountId ? `a:${last.accountId}` : '';
    if (src) el.source.value = src;
  }
  after?.();
  if (filled.length) {
    const hint = $('[data-hint]', form);
    hint.textContent = `Preenchi ${filled.join(' e ')} com base no último lançamento “${last.desc}”.`;
    hint.classList.remove('hidden');
  }
}

async function submitEntry(form, st, again, draw) {
  const el = form.elements, d = S.D();
  const cat = el.categoryId.value;
  const f = {
    desc: el.desc.value.trim(),
    amount: getMoney(el.amount),
    date: el.date.value,
    categoryId: cat && cat !== '__new' ? cat : null,
    notes: el.notes.value.trim(),
    source: el.source?.value || null,
  };
  if (!f.desc) return invalid(el.desc, 'Informe a descrição');
  if (!f.amount) return invalid(el.amount, 'Informe o valor');
  if (!f.date) return invalid(el.date, 'Informe a data');

  if (st.type === 'bill') {
    const bf = { desc: f.desc, amount: f.amount, due: f.date, categoryId: f.categoryId, payWith: f.source, notes: f.notes };
    if (st.edit) {
      S.updateBill(st.edit, bf, !!el.applyFuture?.checked);
    } else {
      const parcels = Math.max(2, Math.min(120, parseInt(el.billParcels.value, 10) || 2));
      S.addBill({ ...bf, mode: el.mode.value, parcels });
    }
  } else {
    const tf = { ...f, type: st.type, parcels: st.type === 'despesa' && f.source?.startsWith('c:') ? +el.parcels.value : 1 };
    if (st.edit) S.updateTx(st.edit, tf);
    else S.addTx(tf);
    if (f.source?.startsWith('a:')) d.settings.lastAccount = f.source;
  }
  await commit();
  if (again) {
    draw({ date: el.date.value });
    setTimeout(() => $('input[name=desc]', sheets.at(-1))?.focus(), 50);
    toast('Salvo! Pode lançar a próxima.');
  } else {
    closeSheet();
    toast(st.edit ? 'Alterações salvas' : 'Salvo!');
  }
}

async function deleteEntry(st) {
  const x = st.edit;
  if (st.type === 'bill') {
    if (x.seriesId) {
      const choice = await choose('Excluir conta', x.recur === 'mensal'
        ? 'Esta conta se repete todo mês. Excluir as próximas encerra a repetição.'
        : 'Esta conta é parcelada.', [['one', 'Só esta', 'ghost'], ['future', 'Esta e as próximas não pagas', 'danger']]);
      if (!choice) return;
      S.deleteBill(x, choice);
    } else {
      if (!await confirmBox('Excluir esta conta?', x.paid ? 'A despesa do pagamento continua registrada em Lançamentos.' : '', 'Excluir')) return;
      S.deleteBill(x, 'one');
    }
  } else {
    const msg = x.groupId ? `As ${x.installment.total} parcelas desta compra serão excluídas.` : x.billId ? 'A conta a pagar vinculada volta a ficar pendente.' : '';
    if (!await confirmBox('Excluir lançamento?', msg, 'Excluir')) return;
    S.deleteTx(x);
  }
  closeSheet();
  await commit();
  toast('Excluído');
}

// ================= Pagamento =================
function findPayable(id) { return S.payables().find((p) => p.id === id); }

function openPaySheet(p) {
  const d = S.D(), isFat = p.kind === 'fatura';
  const w = openSheet(`
    ${sheetHead(isFat ? 'Pagar fatura' : 'Pagar conta')}
    <p class="pay-desc"><b>${esc(p.desc)}</b> · vence ${fmtDate(p.due)}</p>
    <form class="form" novalidate>
      <div class="grid2">
        <label class="field"><span>Valor pago</span><input name="amount" class="money" inputmode="numeric"></label>
        <label class="field"><span>Data do pagamento</span><input name="date" type="date"></label>
      </div>
      <label class="field"><span>${isFat ? 'Debitar da conta' : 'Pagar com'}</span><select name="source">${sourceOptions(!isFat)}</select></label>
      <button type="submit" class="btn primary">${icon('check')}Confirmar pagamento</button>
    </form>`);
  const form = $('form', w), el = form.elements;
  initMoney(el.amount);
  setMoney(el.amount, p.amount);
  el.date.value = todayStr();
  el.source.value = (isFat ? p.inv.card.payAccount : p.bill.payWith) || d.settings.lastAccount || '';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = getMoney(el.amount);
    if (!amount) return invalid(el.amount, 'Informe o valor pago');
    if (!el.date.value) return invalid(el.date, 'Informe a data');
    const args = { date: el.date.value, amount, source: el.source.value || null };
    if (isFat) S.payInvoice(p.inv, args);
    else S.payBill(p.bill, args);
    if (args.source?.startsWith('a:')) d.settings.lastAccount = args.source;
    closeSheet();
    await commit();
    toast('Pagamento registrado ✓');
  });
}

function openPayable(id) {
  const first = findPayable(id);
  if (!first) return;
  if (first.kind === 'fatura') return openInvoice(first.inv.card.id, first.inv.key);
  const w = openSheet('<div class="sheet-body"></div>');
  const body = $('.sheet-body', w);
  const draw = () => {
    const p = findPayable(id);
    if (!p) return;
    const b = p.bill, cls = dueClass(p);
    const cat = S.byId('categories', b.categoryId);
    const tx = S.byId('txs', b.txId);
    const paidWith = tx ? (tx.cardId ? S.byId('cards', tx.cardId)?.name : S.byId('accounts', tx.accountId)?.name) : null;
    const plannedWith = b.payWith ? S.byId(b.payWith[0] === 'c' ? 'cards' : 'accounts', b.payWith.slice(2))?.name : null;
    const kv = [
      ['Vencimento', fmtDate(b.due)],
      ['Categoria', cat ? esc(cat.name) : 'Sem categoria'],
      b.recur === 'mensal' && ['Repetição', 'Todo mês'],
      b.installment && ['Parcela', `${b.installment.n} de ${b.installment.total}`],
      b.paid && ['Pago em', fmtDate(b.paidDate)],
      b.paid && paidWith && ['Pago com', esc(paidWith)],
      !b.paid && plannedWith && ['Pagar com', esc(plannedWith)],
      b.notes && ['Observação', esc(b.notes)],
    ].filter(Boolean);
    body.innerHTML = `
      ${sheetHead(esc(b.desc))}
      <div class="detail-amt">${money(p.amount)}</div>
      <span class="tag ${cls}">${b.paid ? 'Paga' : dueText(p)}</span>
      <dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="btn-col">
        ${b.paid ? `<button class="btn ghost" data-x="unpay">Desfazer pagamento</button>` : `<button class="btn primary" data-x="pay">${icon('check')}Pagar</button>`}
        <button class="btn ghost" data-x="edit">${icon('edit')}Editar</button>
      </div>`;
    $('[data-x=pay]', body)?.addEventListener('click', () => openPaySheet(p));
    $('[data-x=unpay]', body)?.addEventListener('click', async () => {
      if (!await confirmBox('Desfazer pagamento?', 'A despesa registrada no pagamento será removida e a conta volta a ficar pendente.', 'Desfazer')) return;
      S.unpayBill(b);
      await commit();
      toast('Pagamento desfeito');
    });
    $('[data-x=edit]', body).addEventListener('click', () => {
      closeSheet();
      openEntryForm({ type: 'bill', edit: b });
    });
  };
  w._refresh = draw;
  draw();
}

// ================= Fatura do cartão =================
function openInvoice(cardId, key) {
  const card = S.byId('cards', cardId);
  if (!card) return;
  let k = key || S.invoiceKeyFor(card, todayStr());
  const w = openSheet('<div class="sheet-body"></div>');
  const body = $('.sheet-body', w);
  const draw = () => {
    const c = S.byId('cards', cardId);
    if (!c) return closeSheet();
    const inv = S.invoice(c, k), today = todayStr();
    const status = inv.total === 0 ? 'Sem compras'
      : inv.isPaid ? 'Paga'
      : today < inv.close ? 'Aberta'
      : today > inv.due ? 'Vencida' : 'Fechada';
    body.innerHTML = `
      ${sheetHead(`Fatura · ${esc(c.name)}`)}
      <div class="month-nav">
        <button class="icon-btn" data-nav="-1" aria-label="Fatura anterior">${icon('chevL')}</button>
        <span class="month-label">${monthLabel(k)}</span>
        <button class="icon-btn" data-nav="1" aria-label="Próxima fatura">${icon('chevR')}</button>
      </div>
      <div class="inv-total">
        <small class="tag ${status === 'Vencida' ? 'overdue' : status === 'Paga' ? 'paid' : ''}">${status}</small>
        <b>${money(inv.total)}</b>
        <span>Fecha ${fmtDate(inv.close)} · Vence ${fmtDate(inv.due)}</span>
        ${inv.paid ? `<span>Pago ${money(inv.paid)}${inv.remaining ? ` · falta ${money(inv.remaining)}` : ''}</span>` : ''}
      </div>
      ${inv.items.length ? `<div class="list">${inv.items.map(txRow).join('')}</div>` : emptyState('card', 'Nenhuma compra nesta fatura.')}
      <div class="btn-col mt">
        ${inv.remaining > 0 ? `<button class="btn primary" data-x="pay">${icon('check')}Pagar fatura (${money(inv.remaining)})</button>` : ''}
        ${inv.payments.length ? '<button class="btn ghost" data-x="unpay">Desfazer pagamento</button>' : ''}
        <button class="btn ghost" data-x="edit">${icon('edit')}Editar cartão</button>
      </div>`;
    body.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { k = addMonthsKey(k, +b.dataset.nav); draw(); }));
    $('[data-x=pay]', body)?.addEventListener('click', () => openPaySheet({
      kind: 'fatura', inv, desc: `Fatura ${c.name}`, due: inv.due, amount: inv.remaining,
    }));
    $('[data-x=unpay]', body)?.addEventListener('click', async () => {
      if (!await confirmBox('Desfazer pagamento da fatura?', 'O pagamento registrado será removido.', 'Desfazer')) return;
      S.unpayInvoice(inv);
      await commit();
    });
    $('[data-x=edit]', body).addEventListener('click', () => cardForm(c));
  };
  w._refresh = draw;
  draw();
}

function openTx(id) {
  const t = S.byId('txs', id);
  if (!t) return;
  if (t.type !== 'fatura') return openEntryForm({ type: t.type, edit: t });
  const acc = S.byId('accounts', t.accountId);
  const card = S.byId('cards', t.payCard);
  openSheet(`
    ${sheetHead('Pagamento de fatura')}
    <div class="detail-amt">${money(t.amount)}</div>
    <dl class="kv">
      <div><dt>Cartão</dt><dd>${card ? esc(card.name) : 'Cartão excluído'}</dd></div>
      <div><dt>Fatura</dt><dd>${t.payInvoice ? monthLabel(t.payInvoice) : '-'}</dd></div>
      <div><dt>Data</dt><dd>${fmtDate(t.date)}</dd></div>
      <div><dt>Conta</dt><dd>${acc ? esc(acc.name) : 'Não informada'}</dd></div>
    </dl>
    <div class="btn-col">
      ${card ? `<button class="btn ghost" data-x="open">${icon('card')}Ver fatura</button>` : ''}
      <button class="btn danger" data-x="del">${icon('trash')}Excluir pagamento</button>
    </div>`);
  const w = sheets.at(-1);
  $('[data-x=open]', w)?.addEventListener('click', () => { closeSheet(); openInvoice(card.id, t.payInvoice); });
  $('[data-x=del]', w).addEventListener('click', async () => {
    if (!await confirmBox('Excluir pagamento?', 'A fatura volta a ficar pendente.', 'Excluir')) return;
    S.deleteTx(t);
    closeSheet();
    await commit();
    toast('Pagamento excluído');
  });
}

// ================= Contas, cartões e categorias =================
function accountForm(acc) {
  const w = openSheet(`
    ${sheetHead(acc ? 'Editar conta' : 'Nova conta')}
    <form class="form" novalidate>
      <label class="field"><span>Nome</span><input name="name" maxlength="40" placeholder="Ex.: Nubank, Itaú, Carteira"></label>
      <label class="field"><span>Tipo</span><select name="kind">${Object.entries(ACCOUNT_KINDS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="field"><span>Saldo inicial</span><input name="initial" class="money" inputmode="numeric"><small>O saldo da conta no dia em que você começou a usar o app.</small></label>
      <label class="check"><input type="checkbox" name="negative"><span>Saldo inicial negativo</span></label>
      <div class="btn-col">
        <button type="submit" class="btn primary">${icon('check')}Salvar</button>
        ${acc ? `<button type="button" class="btn danger" data-del>${icon('trash')}Excluir conta</button>` : ''}
      </div>
    </form>`);
  const form = $('form', w), el = form.elements;
  initMoney(el.initial);
  if (acc) {
    el.name.value = acc.name;
    el.kind.value = acc.kind || 'corrente';
    setMoney(el.initial, Math.abs(acc.initial || 0));
    el.negative.checked = (acc.initial || 0) < 0;
  } else {
    setTimeout(() => el.name.focus(), 280);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) return invalid(el.name, 'Informe o nome da conta');
    const initial = getMoney(el.initial) * (el.negative.checked ? -1 : 1);
    const saved = S.saveAccount(acc, { name, kind: el.kind.value, initial });
    if (!S.D().settings.lastAccount) S.D().settings.lastAccount = `a:${saved.id}`;
    closeSheet();
    await commit();
    toast('Conta salva');
  });
  $('[data-del]', form)?.addEventListener('click', async () => {
    const used = S.D().txs.filter((t) => t.accountId === acc.id).length;
    if (!await confirmBox('Excluir conta?', used ? `${used} lançamento(s) continuarão registrados, mas sem conta vinculada.` : '', 'Excluir')) return;
    S.deleteAccount(acc);
    closeSheet();
    await commit();
    toast('Conta excluída');
  });
}

function cardForm(card) {
  const w = openSheet(`
    ${sheetHead(card ? 'Editar cartão' : 'Novo cartão')}
    <form class="form" novalidate>
      <label class="field"><span>Nome</span><input name="name" maxlength="40" placeholder="Ex.: Nubank, Inter"></label>
      <div class="grid2">
        <label class="field"><span>Dia de fechamento</span><input name="closeDay" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex.: 3"></label>
        <label class="field"><span>Dia de vencimento</span><input name="dueDay" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex.: 10"></label>
      </div>
      <p class="hint">Compras feitas no dia do fechamento ou depois entram na fatura seguinte.</p>
      <label class="field"><span>Limite (opcional)</span><input name="limit" class="money" inputmode="numeric"></label>
      <label class="field"><span>Conta que paga a fatura (opcional)</span><select name="payAccount">${sourceOptions(false, 'Não informar')}</select></label>
      <div class="btn-col">
        <button type="submit" class="btn primary">${icon('check')}Salvar</button>
        ${card ? `<button type="button" class="btn danger" data-del>${icon('trash')}Excluir cartão</button>` : ''}
      </div>
    </form>`);
  const form = $('form', w), el = form.elements;
  initMoney(el.limit);
  if (card) {
    el.name.value = card.name;
    el.closeDay.value = card.closeDay;
    el.dueDay.value = card.dueDay;
    setMoney(el.limit, card.limit || 0);
    el.payAccount.value = card.payAccount || '';
  } else {
    setTimeout(() => el.name.focus(), 280);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    const closeDay = parseInt(el.closeDay.value, 10), dueDay = parseInt(el.dueDay.value, 10);
    if (!name) return invalid(el.name, 'Informe o nome do cartão');
    if (!(closeDay >= 1 && closeDay <= 31)) return invalid(el.closeDay, 'Dia de fechamento entre 1 e 31');
    if (!(dueDay >= 1 && dueDay <= 31)) return invalid(el.dueDay, 'Dia de vencimento entre 1 e 31');
    S.saveCard(card, { name, closeDay, dueDay, limit: getMoney(el.limit) || null, payAccount: el.payAccount.value || null });
    closeSheet();
    await commit();
    toast('Cartão salvo');
  });
  $('[data-del]', form)?.addEventListener('click', async () => {
    const n = S.D().txs.filter((t) => t.cardId === card.id).length;
    if (!await confirmBox('Excluir cartão?', n ? `As ${n} compra(s) lançadas neste cartão também serão excluídas.` : '', 'Excluir')) return;
    S.deleteCard(card);
    closeSheet(sheets.length);
    await commit();
    toast('Cartão excluído');
  });
}

function categoryForm(cat, type) {
  const w = openSheet(`
    ${sheetHead(cat ? 'Editar categoria' : `Nova categoria de ${type === 'receita' ? 'receita' : 'despesa'}`)}
    <form class="form" novalidate>
      <label class="field"><span>Nome</span><input name="name" maxlength="40" placeholder="${type === 'receita' ? 'Ex.: Salário' : 'Ex.: Mercado'}"></label>
      <div class="field"><span>Cor</span>
        <div class="swatches">${S.COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${(cat ? cat.color === c : i === S.D().categories.length % S.COLORS.length) ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
      </div>
      <div class="btn-col">
        <button type="submit" class="btn primary">${icon('check')}Salvar</button>
        ${cat ? `<button type="button" class="btn danger" data-del>${icon('trash')}Excluir categoria</button>` : ''}
      </div>
    </form>`);
  const form = $('form', w), el = form.elements;
  if (cat) el.name.value = cat.name;
  else setTimeout(() => el.name.focus(), 280);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) return invalid(el.name, 'Informe o nome');
    if (cat) Object.assign(cat, { name, color: el.color.value });
    else S.addCategory({ name, type, color: el.color.value });
    closeSheet();
    await commit();
  });
  $('[data-del]', form)?.addEventListener('click', async () => {
    if (!await confirmBox('Excluir categoria?', 'Os lançamentos desta categoria ficarão "Sem categoria".', 'Excluir')) return;
    S.deleteCategory(cat);
    closeSheet();
    await commit();
  });
}

// ================= PIN =================
let locking = null, hiddenAt = 0;

function lockApp() {
  if (locking) return locking;
  const el = $('#lock');
  locking = new Promise((resolve) => {
    let pin = '', mode = 'pin';
    const draw = (err) => {
      el.innerHTML = mode === 'forgot' ? `
        <div class="lock-box">
          <div class="lock-logo">${icon('alert')}</div>
          <h2>Esqueceu o PIN?</h2>
          <p class="muted">Por segurança, a única forma de redefinir é apagar todos os dados deste aparelho. Se você tem um backup, poderá restaurá-lo depois.</p>
          <div class="btn-col">
            <button class="btn danger" data-k="wipe">Apagar dados e redefinir</button>
            <button class="btn text" data-k="back">Voltar</button>
          </div>
        </div>` : `
        <div class="lock-box">
          <div class="lock-brand">${logo()}</div>
          <h2>${icon('lock')}Digite seu PIN</h2>
          <div class="dots ${err ? 'shake' : ''}">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
          <div class="keys">
            ${range(1, 9).map((n) => `<button data-k="${n}">${n}</button>`).join('')}
            <button data-k="forgot" class="k-text">Esqueci</button>
            <button data-k="0">0</button>
            <button data-k="del" class="k-text" aria-label="Apagar">${icon('backspace')}</button>
          </div>
        </div>`;
    };
    const unlock = () => {
      el.classList.add('hidden');
      el.innerHTML = '';
      el.onclick = null;
      document.removeEventListener('keydown', onKey);
      locking = null;
      resolve();
    };
    const press = async (k) => {
      if (k === 'del') { pin = pin.slice(0, -1); return draw(); }
      if (k === 'forgot') { mode = 'forgot'; return draw(); }
      if (k === 'back') { mode = 'pin'; pin = ''; return draw(); }
      if (k === 'wipe') { S.wipe(); await commit(); return unlock(); }
      if (!/^\d$/.test(k) || pin.length >= 4) return;
      pin += k;
      draw();
      if (pin.length === 4) {
        if (await S.checkPin(pin)) return unlock();
        pin = '';
        navigator.vibrate?.(120);
        draw(true);
      }
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
    document.addEventListener('keydown', onKey);
    el.classList.remove('hidden');
    draw();
  });
  return locking;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.D()?.settings.pin && hiddenAt && Date.now() - hiddenAt > 60000) lockApp();
});

function pinForm() {
  const has = !!S.D().settings.pin;
  const w = openSheet(`
    ${sheetHead(has ? 'Alterar PIN' : 'Definir PIN')}
    <form class="form" novalidate>
      ${has ? '<label class="field"><span>PIN atual</span><input name="current" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' : ''}
      <label class="field"><span>Novo PIN (4 dígitos)</span><input name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
      <label class="field"><span>Repita o novo PIN</span><input name="pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
      <p class="hint">Se esquecer o PIN, só é possível entrar apagando os dados. Mantenha um backup.</p>
      <button type="submit" class="btn primary">${icon('check')}Salvar PIN</button>
    </form>`);
  const form = $('form', w), el = form.elements;
  setTimeout(() => (el.current || el.pin).focus(), 280);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (has && !await S.checkPin(el.current.value)) return invalid(el.current, 'PIN atual incorreto');
    if (!/^\d{4}$/.test(el.pin.value)) return invalid(el.pin, 'O PIN deve ter 4 números');
    if (el.pin.value !== el.pin2.value) return invalid(el.pin2, 'Os PINs não conferem');
    await S.setPin(el.pin.value);
    closeSheet();
    await commit();
    toast('PIN salvo');
  });
}

function removePinForm() {
  const w = openSheet(`
    ${sheetHead('Remover PIN')}
    <form class="form" novalidate>
      <label class="field"><span>PIN atual</span><input name="current" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
      <button type="submit" class="btn danger">Remover PIN</button>
    </form>`);
  const form = $('form', w), el = form.elements;
  setTimeout(() => el.current.focus(), 280);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!await S.checkPin(el.current.value)) return invalid(el.current, 'PIN incorreto');
    await S.setPin(null);
    closeSheet();
    await commit();
    toast('PIN removido');
  });
}

// ================= Backup =================
async function exportBackup(share) {
  const json = JSON.stringify(S.exportData());
  const name = `financas-backup-${todayStr()}`;
  if (share) {
    const candidates = [new File([json], `${name}.json`, { type: 'application/json' }), new File([json], `${name}.txt`, { type: 'text/plain' })];
    const file = candidates.find((f) => navigator.canShare?.({ files: [f] }));
    if (!file) return toast('Este navegador não permite compartilhar arquivos. Use "Baixar".');
    try {
      await navigator.share({ files: [file], title: 'Backup Finanças' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      return toast('Não foi possível compartilhar');
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  S.D().settings.lastBackup = todayStr();
  await commit();
  toast('Backup gerado ✓');
}

async function importBackup(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido'); }
  if (!S.isValidBackup(obj)) return toast('Este arquivo não é um backup do Finanças');
  const when = obj.exportedAt ? ` de ${fmtDate(obj.exportedAt.slice(0, 10))}` : '';
  if (!await confirmBox('Restaurar backup?', `Todos os dados atuais serão substituídos pelos do backup${when}.`, 'Restaurar')) return;
  S.replaceAll(obj);
  await commit();
  toast('Backup restaurado ✓');
}

// ================= Ações (cliques) =================
const ACTIONS = {
  goto: (ds) => { location.hash = ds.tab; },
  theme: () => { setTheme(isLight() ? 'dark' : 'light'); render(); },
  contact: () => openContact(),
  fab: () => openEntryForm({ type: 'bill' }),
  month: (ds) => { ui.month = addMonthsKey(ui.month, +ds.d); render(); },
  'month-today': () => { ui.month = monthKey(todayStr()); render(); },
  filter: (ds) => { ui[ds.key] = ds.val; render(); },
  'close-sheet': () => closeSheet(),
  'open-pay': (ds) => openPayable(ds.id),
  'quick-pay': (ds) => { const p = findPayable(ds.id); if (p) openPaySheet(p); },
  'open-tx': (ds) => openTx(ds.id),
  'new-account': () => accountForm(null),
  'open-account': (ds) => accountForm(S.byId('accounts', ds.id)),
  'new-card': () => cardForm(null),
  'open-card': (ds) => openInvoice(ds.id),
  'new-cat': (ds) => categoryForm(null, ds.type),
  'open-cat': (ds) => { const c = S.byId('categories', ds.id); if (c) categoryForm(c, c.type); },
  'dismiss-onb': async () => { S.D().settings.onboarded = true; await commit(); },
  'set-pin': () => pinForm(),
  'remove-pin': () => removePinForm(),
  export: (ds) => exportBackup(!!ds.share),
  import: () => $('#import-file').click(),
  wipe: async () => {
    if (!await confirmBox('Apagar todos os dados?', 'Contas, cartões, lançamentos e categorias serão apagados deste aparelho. Esta ação não pode ser desfeita.', 'Continuar')) return;
    if (!await confirmBox('Tem certeza absoluta?', 'Recomendamos exportar um backup antes.', 'Apagar tudo')) return;
    S.wipe();
    await commit();
    location.hash = 'inicio';
    toast('Dados apagados');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el.dataset, el);
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.row[role=button]')) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    importBackup(e.target.files[0]);
    e.target.value = '';
  }
});

boot();
