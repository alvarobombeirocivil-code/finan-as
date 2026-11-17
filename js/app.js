// Interface: telas, formulários e navegação.
import * as S from './store.js';
import {
  todayStr, monthKey, addMonthsKey, monthLabel, monthShort, money, fmtDate, fmtShort, fmtDayLong,
  diffDays, esc, safeColor, range, dateInMonth, MONTHS,
} from './util.js';
import { icon } from './icons.js';
import * as Drive from './drive.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ui = { tab: 'inicio', month: monthKey(todayStr()), pagarFilter: 'pendentes', lancFilter: 'todos' };
const TABS = [
  { id: 'inicio', label: 'Início', icon: 'home' },
  { id: 'pagar', label: 'Pagar', icon: 'bill' },
  { id: 'lanc', label: 'Lançamentos', icon: 'swap' },
  { id: 'rel', label: 'Relatórios', icon: 'chart' },
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
  if (S.D().settings.drive) Drive.loadGoogle();
  route();
  if (S.D().settings.pin) await lockApp();
  handleShortcut();
  registerSW();
  syncDrive();
  window.addEventListener('online', () => syncDrive());
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
  ui.tab = ['inicio', 'pagar', 'lanc', 'rel', 'contas', 'config'].includes(tab) ? tab : 'inicio';
  render();
}

function render() {
  $('#view').innerHTML = VIEWS[ui.tab]() + footer();
  if (ui.tab === 'config') Drive.loadGoogle();
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === ui.tab));
  $('#fab').classList.toggle('hidden', ui.tab === 'config');
  if (lastTab !== ui.tab) { window.scrollTo(0, 0); lastTab = ui.tab; }
}

async function commit() {
  S.touch();
  try {
    await S.persist();
  } catch (err) {
    toast('Erro ao salvar: ' + err.message);
  }
  render();
  sheets.forEach((w) => w._refresh?.());
  scheduleBackup();
}

// ================= Backup automático no Google Drive =================
// meta.updatedAt marca a versão dos dados deste aparelho; drive.lastSync guarda a última
// versão que este aparelho e o Drive tinham em comum. Comparando as duas com a versão do Drive,
// o app sabe se deve enviar, baixar ou perguntar qual manter.
const driveState = { status: 'idle', busy: false, lastCheck: 0 };
let backupTimer;

function setDriveStatus(status) {
  if (driveState.status === status) return;
  driveState.status = status;
  if (ui.tab === 'inicio' || ui.tab === 'config') render();
}
function scheduleBackup() {
  if (!S.D().settings.drive) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => syncDrive(), 4000);
}
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return `${fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function syncDrive({ interactive = false } = {}) {
  const st = S.D().settings.drive;
  if (!st || driveState.busy || locking) return;
  if (!navigator.onLine) return setDriveStatus('offline');
  if (!Drive.hasToken()) {
    if (!interactive) return setDriveStatus('auth');
    try {
      await Drive.connect(st.email);
    } catch (e) {
      setDriveStatus('auth');
      if (e.message !== 'cancelado') toast(e.message);
      return;
    }
  }
  driveState.busy = true;
  driveState.lastCheck = Date.now();
  setDriveStatus('syncing');
  try {
    const remote = await Drive.remoteInfo(st);
    const local = S.D().meta.updatedAt || null;
    const base = st.lastSync || null;
    const localChanged = local !== base;
    const remoteChanged = !!remote && (remote.updatedAt || null) !== base;
    let action = 'none';
    if (!remote) action = local || S.hasData() ? 'upload' : 'none';
    else if (remote.updatedAt && remote.updatedAt === local) action = 'same';
    else if (remoteChanged && !localChanged) action = 'download';
    else if (localChanged && !remoteChanged) action = 'upload';
    else if (!S.hasData()) action = 'download';
    else {
      const when = fmtDateTime(remote.updatedAt || remote.modifiedTime);
      action = await choose('Quais dados manter?',
        `Este celular e o Google Drive têm alterações diferentes. A última cópia do Drive é de ${when}.`,
        [['download', 'Usar os dados do Google Drive', 'primary'], ['upload', 'Manter os dados deste celular', 'ghost']]);
      if (!action) { driveState.busy = false; return setDriveStatus('conflict'); }
    }

    if (action === 'download') {
      const obj = await Drive.download(remote.id);
      if (!S.isValidBackup(obj)) throw new Error('O backup do Drive não pôde ser lido');
      S.replaceAll(obj);
      S.D().meta.updatedAt = remote.updatedAt || S.D().meta.updatedAt;
      st.lastSync = S.D().meta.updatedAt;
      toast('Dados atualizados do Google Drive ✓');
    } else if (action === 'upload') {
      const stamp = local || new Date().toISOString();
      S.D().meta.updatedAt = stamp;
      S.D().settings.lastBackup = todayStr();
      await Drive.upload(st, JSON.stringify(S.exportData()), stamp);
      st.lastSync = stamp;
    } else if (action === 'same') {
      st.lastSync = local;
    }
    if (action !== 'none') st.lastSyncAt = new Date().toISOString();
    await S.persist();
    driveState.status = 'ok';
    render();
    sheets.forEach((w) => w._refresh?.());
    if (interactive && action !== 'download') toast(action === 'upload' ? 'Backup salvo no Google Drive ✓' : 'Tudo em dia com o Google Drive ✓');
  } catch (e) {
    if (Drive.isAuthError(e)) setDriveStatus('auth');
    else {
      setDriveStatus(navigator.onLine ? 'error' : 'offline');
      if (interactive) toast(e.message);
    }
  } finally {
    driveState.busy = false;
  }
}

async function connectDrive() {
  try {
    await Drive.connect();
    const user = await Drive.whoAmI();
    S.D().settings.drive = { email: user.emailAddress, name: user.displayName || '', fileId: null, folderId: null, lastSync: null, lastSyncAt: null };
    await S.persist();
    toast('Conectado ao Google Drive');
    await syncDrive({ interactive: true });
  } catch (e) {
    if (e.message !== 'cancelado') toast(e.message);
  }
}

async function disconnectDrive() {
  if (!await confirmBox('Desconectar do Google Drive?', 'O backup automático para. A cópia que já está no seu Drive continua lá e pode ser usada depois.', 'Desconectar', 'ghost')) return;
  Drive.disconnect();
  S.D().settings.drive = null;
  driveState.status = 'idle';
  await S.persist();
  render();
  toast('Backup automático desativado');
}

// Faixa na tela inicial: avisa quando o Google pede para reconectar ou sugere ativar o backup.
function driveBanner(backupDue) {
  const d = S.D(), ds = d.settings.drive;
  if (ds && driveState.status === 'auth') {
    const dirty = (d.meta.updatedAt || null) !== (ds.lastSync || null);
    return `<button class="banner" data-act="drive-sync">${icon('cloud')}<span>${dirty ? 'Há alterações sem backup. Toque para salvar no Google Drive.' : 'Toque para sincronizar com o Google Drive.'}</span></button>`;
  }
  if (ds && driveState.status === 'conflict') return `<button class="banner" data-act="drive-sync">${icon('cloud')}<span>Escolha quais dados manter: deste celular ou do Google Drive. Toque aqui.</span></button>`;
  if (!ds && backupDue) {
    return Drive.configured()
      ? `<button class="banner" data-act="goto" data-tab="config">${icon('cloud')}<span>Ative o backup automático no Google Drive. Toque para configurar.</span></button>`
      : `<button class="banner" data-act="goto" data-tab="config">${icon('download')}<span>Faz tempo que você não faz backup. Toque para exportar.</span></button>`;
  }
  return '';
}

function driveSection() {
  if (!Drive.configured()) return '';
  const ds = S.D().settings.drive;
  if (!ds) {
    return `
    <section class="card-sec">
      <h2>${icon('cloud')}Backup automático no Google Drive</h2>
      <p>O app salva seus dados no seu Google Drive sozinho, a cada alteração. Em outro celular, é só conectar a mesma conta Google para trazer tudo de volta. <a href="privacidade.html">Política de privacidade</a></p>
      <button class="btn primary w100" data-act="drive-connect">${icon('cloud')}Conectar ao Google Drive</button>
    </section>`;
  }
  const STATUS = {
    syncing: 'Sincronizando…',
    ok: 'Tudo salvo no Google Drive.',
    auth: 'O Google pediu para confirmar a conta. Toque em “Sincronizar agora”.',
    offline: 'Sem internet. O backup será feito quando a conexão voltar.',
    error: 'Não foi possível sincronizar agora. Tente de novo em instantes.',
    conflict: 'Escolha quais dados manter. Toque em “Sincronizar agora”.',
  };
  return `
    <section class="card-sec">
      <h2>${icon('cloud')}Backup automático no Google Drive</h2>
      <p>Conectado como <b>${esc(ds.email)}</b><br>
      Último backup: <b>${ds.lastSyncAt ? fmtDateTime(ds.lastSyncAt) : 'ainda não feito'}</b>${STATUS[driveState.status] ? `<br>${STATUS[driveState.status]}` : ''}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="drive-sync">Sincronizar agora</button>
        <button class="btn ghost" data-act="drive-off">Desconectar</button>
      </div>
      <p class="hint-muted">O arquivo fica na pasta “AVR Finanças” do seu Drive. O app só acessa os arquivos que ele mesmo criou. <a href="privacidade.html">Política de privacidade</a></p>
    </section>`;
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
    <a class="link-btn privacy-link" href="privacidade.html">Política de privacidade</a>
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
  const linked = p.kind === 'bill' && p.bill.payWith?.startsWith('c:') ? S.byId('cards', p.bill.payWith.slice(2)) : null;
  const sub = [
    dueText(p),
    p.installment && `${p.installment.n}/${p.installment.total}`,
    p.recur === 'mensal' && 'Mensal',
    p.kind === 'fatura' && p.open && 'Fatura aberta',
    linked && esc(linked.name),
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
    : [t.date > todayStr() && 'Previsto', cat ? esc(cat.name) : 'Sem categoria', src && esc(src),
      t.installment && `${t.installment.n}/${t.installment.total}`, t.seriesId && 'Mensal'].filter(Boolean).join(' · ');
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
const VIEWS = { inicio: viewInicio, pagar: viewPagar, lanc: viewLanc, rel: viewRel, contas: viewContas, config: viewConfig };
const monthYear = (key) => `${monthShort(key)}/${key.slice(2, 4)}`;
const monthName = (key) => MONTHS[+key.slice(5, 7) - 1].toLowerCase();
const endOfMonth = (key) => dateInMonth(key, 31);

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
  const fc = hasData && ui.month >= monthKey(today) ? S.forecast(endOfMonth(ui.month)) : null;
  const forecastHtml = !fc ? '' : `
    <div class="forecast">
      <div>
        <small>Previsto para o fim de ${monthName(ui.month)}</small>
        <span>${fc.pagar ? `− ${money(fc.pagar)} a pagar` : 'Nada pendente'}${fc.receber ? ` · + ${money(fc.receber)} a receber` : ''}</span>
      </div>
      <b class="${fc.saldo < 0 ? 'neg' : ''}">${money(fc.saldo)}</b>
    </div>`;

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
      ${forecastHtml}
    </section>
    ${limitAlerts(ui.month)}
    ${onboardingCard()}
    ${driveBanner(backupDue)}
    <div class="stats">
      <div class="stat"><small>A pagar em ${monthShort(ui.month)}</small><b class="t-warn">${money(sumOf(inMonth.filter((p) => !p.paid)))}</b></div>
      <div class="stat"><small>Pago em ${monthShort(ui.month)}</small><b class="t-in">${money(sumOf(inMonth.filter((p) => p.paid)))}</b></div>
    </div>
    ${payBlock('Vencidas', overdue, 'alert', 'danger')}
    ${payBlock('Vencem hoje', dueToday, 'clock', 'warn')}
    ${payBlock('Próximos 7 dias', soon, 'clock', '')}
    ${!overdue.length && !dueToday.length && !soon.length && hasData ? emptyState('party', 'Nenhuma conta pendente nos próximos 7 dias.') : ''}`;
}

// Avisos de limite de gasto por categoria (passou do limite / acima de 80%).
function limitAlerts(key) {
  const spent = S.spendingByCategory(key);
  const withLimit = S.D().categories.filter((c) => c.type === 'despesa' && c.limit > 0);
  const over = withLimit.filter((c) => (spent.get(c.id) || 0) > c.limit);
  const near = withLimit.filter((c) => { const v = spent.get(c.id) || 0; return v <= c.limit && v >= c.limit * 0.8; });
  return [
    ...over.map((c) => `<button class="alert-limit" data-act="goto" data-tab="rel">${icon('alert')}<span><b>${esc(c.name)}</b> passou do limite: ${money(spent.get(c.id))} de ${money(c.limit)}</span></button>`),
    near.length ? `<button class="alert-limit warn" data-act="goto" data-tab="rel">${icon('clock')}<span>Perto do limite: ${near.map((c) => `<b>${esc(c.name)}</b> (${Math.round((spent.get(c.id) / c.limit) * 100)}%)`).join(', ')}</span></button>` : '',
  ].join('');
}

// ================= Relatórios =================
function viewRel() {
  const d = S.D(), key = ui.month, prevKey = addMonthsKey(key, -1);
  const spent = S.spendingByCategory(key), prev = S.spendingByCategory(prevKey);
  const total = [...spent.values()].reduce((s, v) => s + v, 0);
  const rows = [...spent.entries()].map(([id, v]) => ({ id, cat: S.byId('categories', id), v, prev: prev.get(id) || 0 }));
  for (const c of d.categories) if (c.type === 'despesa' && c.limit > 0 && !spent.has(c.id)) rows.push({ id: c.id, cat: c, v: 0, prev: prev.get(c.id) || 0 });
  rows.sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.v, r.cat?.limit || 0)));
  const catBars = rows.map((r) => {
    const limit = r.cat?.limit || 0, over = limit && r.v > limit;
    const delta = r.prev ? Math.round(((r.v - r.prev) / r.prev) * 100) : null;
    const note = [
      limit ? `Limite ${money(limit)} · ${over ? `passou ${money(r.v - limit)}` : `resta ${money(limit - r.v)}`}` : 'Sem limite',
      delta !== null ? `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs ${monthShort(prevKey)}` : r.v ? `sem gastos em ${monthShort(prevKey)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="hbar ${over ? 'over' : ''}" ${r.cat ? `role="button" tabindex="0" data-act="open-cat" data-id="${r.cat.id}"` : ''}>
        <span class="lbl"><i style="background:${safeColor(r.cat?.color)}"></i>${r.cat ? esc(r.cat.name) : 'Sem categoria'}</span>
        <span class="val">${money(r.v)}<small>${total ? Math.round((r.v / total) * 100) : 0}%</small></span>
        <span class="track"><span class="fill" style="width:${(r.v / max) * 100}%"></span>${limit ? `<span class="limit" style="left:calc(${(limit / max) * 100}% - 1px)"></span>` : ''}</span>
        <span class="note">${over ? `${icon('alert')} ` : ''}${note}</span>
      </div>`;
  }).join('');
  const months = range(0, 5).map((i) => addMonthsKey(key, i - 5));
  const sums = months.map((k) => ({ k, ...S.monthSummary(k) }));
  const top = Math.max(1, ...sums.map((s) => Math.max(s.receitas, s.despesas)));
  const cols = sums.map((s) => `
    <button class="m ${s.k === key ? 'cur' : ''}" data-act="bar-tip" data-tip="${monthLabel(s.k)}: receitas ${money(s.receitas)} · despesas ${money(s.despesas)}" aria-label="${monthLabel(s.k)}: receitas ${money(s.receitas)}, despesas ${money(s.despesas)}">
      <span class="b in" style="height:${(s.receitas / top) * 100}%"></span><span class="b out" style="height:${(s.despesas / top) * 100}%"></span>
    </button>`).join('');
  return `
    ${header('Relatórios', 'Para onde foi o dinheiro')}
    ${monthNav()}
    <div class="chart-card">
      <h3>Despesas por categoria</h3>
      <p class="sub">${monthLabel(key)} · ${money(total)} no total · toque numa categoria para definir o limite</p>
      ${catBars || emptyState('chart', 'Nenhuma despesa neste mês.')}
    </div>
    <div class="chart-card">
      <h3>Receitas x despesas</h3>
      <p class="sub">Últimos 6 meses · toque num mês para ver os valores</p>
      <div class="cols">${cols}</div>
      <div class="cols-l">${months.map((k) => `<span>${monthShort(k)}</span>`).join('')}</div>
      <div class="legend"><span><i class="in"></i>Receitas</span><span><i class="out"></i>Despesas</span></div>
      <details class="table-view">
        <summary>Ver tabela</summary>
        <table>
          <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead>
          <tbody>${sums.map((s) => `<tr><td>${monthYear(s.k)}</td><td>${money(s.receitas)}</td><td>${money(s.despesas)}</td><td class="${s.saldo < 0 ? 't-out' : ''}">${money(s.saldo)}</td></tr>`).join('')}</tbody>
        </table>
      </details>
    </div>`;
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
    const key = S.invoiceKeyFor(c, today);
    const st = S.cardStatement(c, key);
    const future = S.cardFuture(c, key);
    const late = S.payables().filter((p) => !p.paid && p.due < today
      && ((p.kind === 'fatura' && p.inv.card.id === c.id) || (p.kind === 'bill' && p.bill.payWith === `c:${c.id}`)));
    const used = S.cardUsed(c);
    const pct = c.limit ? Math.min(100, Math.round((used / c.limit) * 100)) : 0;
    return `
      <button class="cc" data-act="open-card" data-id="${c.id}">
        <div class="cc-top"><span>${esc(c.name)}</span>${icon('card')}</div>
        <small>Fatura de ${monthName(key)} · ${st.count} lançamento${st.count === 1 ? '' : 's'}</small>
        <b class="cc-amt">${money(st.grandPending)}</b>
        <div class="cc-foot"><span>Fecha ${fmtShort(st.close)}</span><span>Vence ${fmtShort(st.due)}</span></div>
        ${late.length ? `<small class="cc-late">${icon('alert')}Em atraso: ${money(sumOf(late))}</small>` : ''}
        ${future ? `<small class="cc-future">Próximas faturas: ${money(future)}</small>` : ''}
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
      ${d.settings.pin ? `
        <div class="bio-row">
          <p>${d.settings.bio ? 'Digital ativada: o app pede a digital ao abrir, com o PIN como alternativa.' : 'Use a digital do celular para desbloquear mais rápido.'}</p>
          <button class="btn ${d.settings.bio ? 'ghost' : 'primary'}" data-act="${d.settings.bio ? 'bio-off' : 'bio-on'}">${icon('finger')}${d.settings.bio ? 'Desativar digital' : 'Ativar digital'}</button>
        </div>` : '<p class="hint-muted">Defina um PIN para poder ativar o desbloqueio por digital.</p>'}
    </section>
    <section class="card-sec">
      <h2>${icon('download')}Exportar planilha</h2>
      <p>Arquivo CSV que abre no Excel e no Google Planilhas.</p>
      <div class="grid2 mb">
        <label class="field"><span>De</span><input type="month" id="exp-from" value="${monthKey(todayStr())}"></label>
        <label class="field"><span>Até</span><input type="month" id="exp-to" value="${monthKey(todayStr())}"></label>
      </div>
      <div class="btn-col">
        <button class="btn primary" data-act="export-csv" data-kind="lanc">${icon('swap')}Lançamentos (Excel)</button>
        <button class="btn ghost" data-act="export-csv" data-kind="pagar">${icon('bill')}Contas a pagar (Excel)</button>
      </div>
    </section>
    <section class="card-sec">
      <h2>${icon('calendar')}Lembretes de vencimento</h2>
      <p>Gera um arquivo de agenda com as contas e faturas pendentes dos próximos 3 meses, com aviso 1 dia antes. No Android, abra o arquivo com o app de agenda. No Google Agenda, importe pelo computador em calendar.google.com → Configurações → Importar.<br>Dica: em cada conta também há o botão <b>Lembrar no Google Agenda</b>.</p>
      <button class="btn ghost w100" data-act="export-ics">${icon('calendar')}Gerar arquivo de lembretes</button>
    </section>
    ${driveSection()}
    <section class="card-sec">
      <h2>${icon('download')}Backup em arquivo</h2>
      <p>${S.D().settings.drive ? 'Além do backup automático, você pode salvar uma cópia em arquivo.' : 'Seus dados ficam só neste celular. Exporte um backup de vez em quando e guarde no Google Drive.'}<br>
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
    <p class="ver">AVR Finanças v1.7 · dados salvos apenas neste aparelho</p>`;
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
        <label class="field"><span>${isBill ? 'Vencimento' : type === 'despesa' ? 'Data da compra' : 'Data'}</span><input name="date" type="date"></label>
      </div>
      ${!isBill ? `
        <label class="field"><span>${type === 'receita' ? 'Recebido em' : 'Pago com'}</span><select name="source">${sourceOptions(type === 'despesa')}</select></label>
        ${type === 'despesa' ? `
          <label class="field parcels-field hidden"><span>Parcelas</span><select name="parcels">${range(1, 24).map((n) => `<option value="${n}">${n === 1 ? 'À vista' : `${n}x`}</option>`).join('')}</select></label>
          <div class="parc-prev hidden" data-parc></div>` : ''}
        ${!edit ? `
          <label class="toggle-row repeat-row"><span>${icon('repeat')}Repetir todo mês</span><input type="checkbox" name="repeat" class="sw" role="switch"></label>
          <label class="field repeat-end hidden"><span>Até (opcional)</span><input type="month" name="repeatEnd"><small>Deixe em branco para repetir sem data de término.</small></label>` : ''}
        ${edit?.seriesId ? `
          <label class="check"><input type="checkbox" name="applyFuture" checked><span>Aplicar também aos próximos meses</span></label>
          <label class="field"><span>Repete até (opcional)</span><input type="month" name="repeatEnd"></label>` : ''}` : ''}
      <p class="hint hidden" data-hint></p>
      <details class="more"${edit ? ' open' : ''}>
        <summary>Mais opções</summary>
        <label class="field"><span>Categoria</span><select name="categoryId">${catOptions(type === 'receita' ? 'receita' : 'despesa')}</select></label>
        ${isBill ? `<label class="field"><span>Pagar com (sugestão ao pagar)</span><select name="source">${sourceOptions(true)}</select></label>` : ''}
        ${isBill && !edit ? `
          <label class="field"><span>Repetição</span><select name="mode"><option value="none">Não repete</option><option value="mensal">Todo mês</option><option value="parcelada">Parcelada</option></select></label>
          <label class="field bill-parcels hidden"><span>Quantidade de parcelas</span><input name="billParcels" type="number" inputmode="numeric" min="2" max="120" value="2"><small>O valor informado é o de cada parcela.</small></label>
          <label class="field bill-end hidden"><span>Até (opcional)</span><input type="month" name="billEnd"><small>Deixe em branco para repetir sem data de término.</small></label>` : ''}
        ${isBill && edit?.seriesId ? `<label class="check"><input type="checkbox" name="applyFuture" checked><span>Aplicar também às próximas ${edit.recur === 'mensal' ? 'ocorrências' : 'parcelas'} não pagas</span></label>` : ''}
        ${isBill && edit?.recur === 'mensal' ? '<label class="field"><span>Repete até (opcional)</span><input type="month" name="billEnd"></label>' : ''}
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
      if (el.billEnd) el.billEnd.value = d.series[x.seriesId]?.end || '';
    } else {
      setMoney(el.amount, x.groupId ? x.totalAmount : x.amount);
      el.date.value = x.groupId ? x.purchaseDate : x.date;
      el.source.value = x.cardId ? `c:${x.cardId}` : x.accountId ? `a:${x.accountId}` : '';
      if (x.groupId) el.parcels.value = String(x.installment.total);
      if (x.seriesId && el.repeatEnd) el.repeatEnd.value = d.txSeries[x.seriesId]?.end || '';
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
  const preview = $('[data-parc]', form);
  const repeatRow = $('.repeat-row', form);
  // Mostra parcelas só para cartão; resume em quais faturas a compra cai.
  const syncParcels = () => {
    const src = el.source?.value || '';
    const onCard = st.type === 'despesa' && src.startsWith('c:');
    const repeating = !!el.repeat?.checked || !!st.edit?.seriesId;
    parcelsField?.classList.toggle('hidden', !onCard || repeating);
    const n = onCard && !repeating ? +(el.parcels?.value || 1) : 1;
    repeatRow?.classList.toggle('hidden', n > 1);
    $('.repeat-end', form)?.classList.toggle('hidden', !el.repeat?.checked || n > 1);
    if (parcelsField) amountLabel.textContent = n > 1 ? 'Valor total' : 'Valor';
    if (!preview) return;
    const card = onCard ? S.byId('cards', src.slice(2)) : null;
    if (!card || !el.date.value) { preview.classList.add('hidden'); return; }
    const first = S.invoiceKeyFor(card, el.date.value);
    const total = getMoney(el.amount);
    preview.innerHTML = n > 1
      ? `<b>${n}x de ${money(Math.floor(total / n))}</b><br>1ª parcela na fatura de <b>${monthYear(first)}</b> · última em <b>${monthYear(addMonthsKey(first, n - 1))}</b>`
      : `Entra na fatura de <b>${monthYear(first)}</b> · vence ${fmtShort(S.invoiceDue(card, first))}`;
    preview.classList.remove('hidden');
  };
  el.source?.addEventListener('change', syncParcels);
  el.parcels?.addEventListener('change', syncParcels);
  el.repeat?.addEventListener('change', syncParcels);
  el.amount.addEventListener('input', syncParcels);
  el.date.addEventListener('change', syncParcels);
  syncParcels();
  el.mode?.addEventListener('change', () => {
    $('.bill-parcels', form).classList.toggle('hidden', el.mode.value !== 'parcelada');
    $('.bill-end', form).classList.toggle('hidden', el.mode.value !== 'mensal');
  });
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

  const endInput = el.billEnd || el.repeatEnd;
  const end = endInput?.value || null;
  if (end && end < monthKey(f.date)) return invalid(endInput, 'O término deve ser depois da primeira data');

  if (st.type === 'bill') {
    const bf = { desc: f.desc, amount: f.amount, due: f.date, categoryId: f.categoryId, payWith: f.source, notes: f.notes, end };
    if (st.edit) {
      S.updateBill(st.edit, bf, !!el.applyFuture?.checked);
    } else {
      const parcels = Math.max(2, Math.min(120, parseInt(el.billParcels.value, 10) || 2));
      S.addBill({ ...bf, mode: el.mode.value, parcels });
    }
  } else {
    const repeat = !!el.repeat?.checked;
    const onCard = st.type === 'despesa' && f.source?.startsWith('c:');
    const tf = { ...f, type: st.type, repeat, repeatEnd: end, parcels: onCard && !repeat && !st.edit?.seriesId ? +el.parcels.value : 1 };
    if (st.edit) S.updateTx(st.edit, tf, !!el.applyFuture?.checked);
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
  } else if (x.seriesId) {
    const choice = await choose('Excluir lançamento', 'Este lançamento se repete todo mês. Excluir os próximos encerra a repetição.',
      [['one', 'Só este', 'ghost'], ['future', 'Este e os próximos', 'danger']]);
    if (!choice) return;
    S.deleteTx(x, choice);
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
  // Conta ligada a um cartão já faz parte da fatura dele: o pagamento sai de uma conta, não do cartão.
  const linkedCard = !isFat && p.bill.payWith?.startsWith('c:') ? S.byId('cards', p.bill.payWith.slice(2)) : null;
  const fromAccount = isFat || !!linkedCard;
  const w = openSheet(`
    ${sheetHead(isFat ? 'Pagar fatura' : 'Pagar conta')}
    <p class="pay-desc"><b>${esc(p.desc)}</b> · vence ${fmtDate(p.due)}</p>
    ${linkedCard ? `<p class="hint">Esta conta faz parte da fatura do cartão ${esc(linkedCard.name)}.</p>` : ''}
    <form class="form" novalidate>
      <div class="grid2">
        <label class="field"><span>Valor pago</span><input name="amount" class="money" inputmode="numeric"></label>
        <label class="field"><span>Data do pagamento</span><input name="date" type="date"></label>
      </div>
      <label class="field"><span>${fromAccount ? 'Debitar da conta' : 'Pagar com'}</span><select name="source">${sourceOptions(!fromAccount)}</select></label>
      <button type="submit" class="btn primary">${icon('check')}Confirmar pagamento</button>
    </form>`);
  const form = $('form', w), el = form.elements;
  initMoney(el.amount);
  setMoney(el.amount, p.amount);
  el.date.value = todayStr();
  el.source.value = (isFat ? p.inv.card.payAccount : linkedCard ? (linkedCard.payAccount || d.settings.lastAccount) : p.bill.payWith) || d.settings.lastAccount || '';
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
        ${b.paid ? '' : `<button class="btn ghost" data-x="gcal">${icon('calendar')}Lembrar no Google Agenda</button>`}
        <button class="btn ghost" data-x="edit">${icon('edit')}Editar</button>
      </div>`;
    $('[data-x=pay]', body)?.addEventListener('click', () => openPaySheet(p));
    $('[data-x=gcal]', body)?.addEventListener('click', () => openGcal({
      title: `Vence: ${b.desc} (${money(b.amount)})`, date: b.due,
      details: 'Lembrete criado pelo AVR Finanças.',
      monthly: b.recur === 'mensal', until: S.D().series[b.seriesId]?.end,
    }));
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
    const st = S.cardStatement(c, k), inv = st, today = todayStr();
    const status = st.count === 0 ? 'Sem lançamentos'
      : st.grandPending === 0 ? 'Paga'
      : today < st.close ? 'Aberta'
      : today > st.due ? 'Vencida' : 'Fechada';
    const pays = S.payables();
    const billRows = st.bills.map((b) => pays.find((p) => p.id === b.id)).filter(Boolean).map(payRow).join('');
    body.innerHTML = `
      ${sheetHead(`Fatura · ${esc(c.name)}`)}
      <div class="month-nav">
        <button class="icon-btn" data-nav="-1" aria-label="Fatura anterior">${icon('chevL')}</button>
        <span class="month-label">${monthLabel(k)}</span>
        <button class="icon-btn" data-nav="1" aria-label="Próxima fatura">${icon('chevR')}</button>
      </div>
      <div class="inv-total">
        <small class="tag ${status === 'Vencida' ? 'overdue' : status === 'Paga' ? 'paid' : ''}">${status}</small>
        <span>A pagar</span>
        <b>${money(st.grandPending)}</b>
        <span>Total da fatura ${money(st.grandTotal)}${st.grandPaid ? ` · pago ${money(st.grandPaid)}` : ''}</span>
        <span>Fecha ${fmtDate(st.close)} · Vence ${fmtDate(st.due)}</span>
      </div>
      ${st.bills.length ? `<h3 class="day-h">Contas deste cartão (${st.bills.length})</h3><div class="list">${billRows}</div>` : ''}
      ${st.items.length ? `<h3 class="day-h">Compras lançadas no cartão (${st.items.length})</h3><div class="list">${st.items.map(txRow).join('')}</div>` : ''}
      ${!st.count ? emptyState('card', 'Nenhum lançamento nesta fatura.') : ''}
      <div class="btn-col mt">
        ${inv.remaining > 0 ? `<button class="btn primary" data-x="pay">${icon('check')}${st.bills.length ? 'Pagar compras lançadas no cartão' : 'Pagar fatura'} (${money(inv.remaining)})</button>` : ''}
        ${inv.payments.length ? '<button class="btn ghost" data-x="unpay">Desfazer pagamento</button>' : ''}
        ${st.bills.some((b) => !b.paid) ? '<p class="hint-muted">As contas deste cartão são pagas uma a uma pelo ✓, como na aba Pagar.</p>' : ''}
        <button class="btn ghost" data-x="gcal">${icon('calendar')}Lembrar vencimento no Google Agenda</button>
        <button class="btn ghost" data-x="edit">${icon('edit')}Editar cartão</button>
      </div>`;
    $('[data-x=gcal]', body).addEventListener('click', () => openGcal({
      title: `Vence: fatura ${c.name}`, date: inv.due,
      details: 'Lembrete mensal criado pelo AVR Finanças.', monthly: true,
    }));
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
      ${type === 'despesa' ? '<label class="field"><span>Limite mensal (opcional)</span><input name="limit" class="money" inputmode="numeric"><small>O app avisa quando os gastos do mês chegam perto ou passam deste valor.</small></label>' : ''}
      <div class="btn-col">
        <button type="submit" class="btn primary">${icon('check')}Salvar</button>
        ${cat ? `<button type="button" class="btn danger" data-del>${icon('trash')}Excluir categoria</button>` : ''}
      </div>
    </form>`);
  const form = $('form', w), el = form.elements;
  if (el.limit) { initMoney(el.limit); setMoney(el.limit, cat?.limit || 0); }
  if (cat) el.name.value = cat.name;
  else setTimeout(() => el.name.focus(), 280);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) return invalid(el.name, 'Informe o nome');
    const limit = el.limit ? getMoney(el.limit) || null : null;
    if (cat) Object.assign(cat, { name, color: el.color.value, limit });
    else S.addCategory({ name, type, color: el.color.value }).limit = limit;
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
          ${S.D().settings.bio ? `<button class="btn ghost bio-btn" data-k="bio">${icon('finger')}Usar digital</button>` : ''}
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
      if (k === 'bio') { if (await verifyBio()) return unlock(); return toast('Digital não confirmada. Use o PIN.'); }
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
    // Com a digital ativada, já pede a biometria ao abrir (o PIN continua disponível).
    if (S.D().settings.bio) setTimeout(() => press('bio'), 300);
  });
  return locking;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
    if (S.D()?.settings.pin && hiddenAt && Date.now() - hiddenAt > 60000) lockApp();
    // Ao voltar para o app, busca alterações feitas em outro aparelho.
    if (S.D()?.settings.drive && Date.now() - driveState.lastCheck > 30000) syncDrive();
  }
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
    S.D().settings.bio = null;
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

// ================= Planilha (CSV para Excel) =================
function downloadFile(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvNum = (cents) => (cents / 100).toFixed(2).replace('.', ',');
// Separador ";" e vírgula decimal: o Excel em português abre direto, com acentos (BOM UTF-8).
const toCsv = (rows) => '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

function exportCsv(kind) {
  const from = $('#exp-from')?.value, to = $('#exp-to')?.value;
  if (!from || !to) return toast('Escolha o período');
  if (to < from) return toast('O mês final deve ser depois do inicial');
  const d = S.D(), today = todayStr();
  const inRange = (date) => { const k = monthKey(date); return k >= from && k <= to; };
  const catName = (id) => S.byId('categories', id)?.name || 'Sem categoria';
  let rows, name;
  if (kind === 'lanc') {
    const TYPES = { receita: 'Receita', despesa: 'Despesa', fatura: 'Pagamento de fatura' };
    rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta/Cartão', 'Parcela', 'Valor (R$)', 'Situação', 'Observação']];
    d.txs.filter((t) => inRange(t.date)).sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
      const src = t.cardId ? S.byId('cards', t.cardId)?.name : t.accountId ? S.byId('accounts', t.accountId)?.name : t.payCard ? S.byId('cards', t.payCard)?.name : '';
      rows.push([fmtDate(t.date), TYPES[t.type], t.desc, t.type === 'fatura' ? '' : catName(t.categoryId), src || '',
        t.installment ? `${t.installment.n}/${t.installment.total}` : '', csvNum(t.type === 'receita' ? t.amount : -t.amount),
        t.date > today ? 'Previsto' : 'Realizado', t.notes || '']);
    });
    name = `avr-lancamentos-${from}_${to}.csv`;
  } else {
    rows = [['Vencimento', 'Descrição', 'Tipo', 'Categoria', 'Parcela', 'Valor (R$)', 'Situação', 'Pago em']];
    S.payables().filter((p) => inRange(p.due)).forEach((p) => {
      const status = p.paid ? 'Paga' : p.due < today ? 'Vencida' : 'Pendente';
      rows.push([fmtDate(p.due), p.desc, p.kind === 'fatura' ? 'Fatura de cartão' : p.recur === 'mensal' ? 'Mensal' : 'Conta',
        p.kind === 'fatura' ? '' : catName(p.categoryId), p.installment ? `${p.installment.n}/${p.installment.total}` : '',
        csvNum(p.amount), status, p.paidDate ? fmtDate(p.paidDate) : '']);
    });
    name = `avr-contas-a-pagar-${from}_${to}.csv`;
  }
  if (rows.length === 1) return toast('Nada encontrado nesse período');
  downloadFile(name, toCsv(rows), 'text/csv;charset=utf-8');
  toast(`Planilha gerada: ${rows.length - 1} linha(s)`);
}

// ================= Google Agenda =================
const ymd = (s) => s.replace(/-/g, '');
function openGcal({ title, date, details, monthly, until }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${ymd(date)}/${ymd(addDays(date, 1))}`, details });
  if (monthly) p.set('recur', `RRULE:FREQ=MONTHLY${until ? `;UNTIL=${ymd(endOfMonth(until))}T235959Z` : ''}`);
  window.open(`https://calendar.google.com/calendar/render?${p}`, '_blank', 'noopener');
}

// Arquivo .ics com as contas e faturas pendentes dos próximos 3 meses (aviso às 9h do dia anterior).
function exportIcs() {
  const today = todayStr(), end = endOfMonth(addMonthsKey(monthKey(today), 3));
  const items = S.payables().filter((p) => !p.paid && p.due >= today && p.due <= end);
  if (!items.length) return toast('Nenhuma conta pendente nos próximos 3 meses');
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AVR Financas//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Vencimentos AVR Finanças'];
  for (const p of items) {
    const title = icsText(`Vence: ${p.desc} (${money(p.amount)})`);
    lines.push('BEGIN:VEVENT', `UID:${p.id}-${ymd(p.due)}@avr-financas`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(p.due)}`, `DTEND;VALUE=DATE:${ymd(addDays(p.due, 1))}`, `SUMMARY:${title}`,
      'DESCRIPTION:Lembrete criado pelo AVR Finanças', 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  downloadFile('vencimentos-avr.ics', lines.join('\r\n'), 'text/calendar;charset=utf-8');
  toast(`${items.length} vencimento(s) no arquivo`);
}

// ================= Digital (biometria do aparelho via WebAuthn) =================
// A digital fica guardada no próprio Android; o app só pede que o aparelho confirme o dono.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function bioAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}
async function enableBio() {
  if (!await bioAvailable()) return toast('Este aparelho ou navegador não oferece desbloqueio por digital');
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'AVR Finanças' },
      user: { id: randomBytes(16), name: 'avr-financas', displayName: 'AVR Finanças' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none', timeout: 60000,
    } });
    S.D().settings.bio = { id: b64u(cred.rawId) };
    await commit();
    toast('Digital ativada ✓');
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Ativação cancelada' : 'Não foi possível ativar a digital');
  }
}
async function verifyBio() {
  const bio = S.D().settings.bio;
  if (!bio) return false;
  try {
    await navigator.credentials.get({ publicKey: {
      challenge: randomBytes(32), allowCredentials: [{ type: 'public-key', id: fromB64u(bio.id) }],
      userVerification: 'required', timeout: 60000,
    } });
    return true;
  } catch { return false; }
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
  'drive-connect': () => connectDrive(),
  'drive-sync': () => syncDrive({ interactive: true }),
  'drive-off': () => disconnectDrive(),
  'set-pin': () => pinForm(),
  'remove-pin': () => removePinForm(),
  'bio-on': () => enableBio(),
  'bio-off': async () => { S.D().settings.bio = null; await commit(); toast('Digital desativada'); },
  'export-csv': (ds) => exportCsv(ds.kind),
  'export-ics': () => exportIcs(),
  'bar-tip': (ds) => toast(ds.tip, { duration: 3500 }),
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
