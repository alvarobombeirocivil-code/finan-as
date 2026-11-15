// Backup no Google Drive da própria pessoa.
// Permissão "drive.file": o app só enxerga os arquivos que ele mesmo criou.
// O acesso dura cerca de 1 hora; depois disso o Google pede uma nova confirmação (um toque).
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'AVR Finanças';
const FILE_NAME = 'avr-financas-backup.json';
const API = 'https://www.googleapis.com';
const TOKEN_KEY = 'avr-drive-token';

let token = null, tokenExp = 0;
try {
  const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
  if (t && t.exp > Date.now()) { token = t.token; tokenExp = t.exp; }
} catch {}

// Em testes locais o ID pode vir do localStorage; publicado, vale só o config.js.
const clientId = () => GOOGLE_CLIENT_ID || (location.hostname === 'localhost' ? (localStorage.getItem('avr-test-client-id') || '') : '');
export const configured = () => !!clientId();
const gisReady = () => !!window.google?.accounts?.oauth2;
export const hasToken = () => !!token && Date.now() < tokenExp - 60000;

function saveToken(access, expiresIn) {
  token = access;
  tokenExp = Date.now() + expiresIn * 1000;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); } catch {}
}
function dropToken() {
  token = null; tokenExp = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

// Abre a janela do Google. Precisa ser chamado a partir de um toque da pessoa.
export function connect(hint) {
  return new Promise((resolve, reject) => {
    if (!gisReady()) return reject(new Error('Não foi possível falar com o Google. Verifique a internet.'));
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('Permissão do Drive não concedida'));
        saveToken(r.access_token, Number(r.expires_in) || 3600);
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'cancelado' : 'Conexão não concluída')),
    });
    client.requestAccessToken({ prompt: '', ...(hint ? { hint } : {}) });
  });
}

export function disconnect() {
  if (token && gisReady()) { try { window.google.accounts.oauth2.revoke(token, () => {}); } catch {} }
  dropToken();
}

class AuthError extends Error {}
export const isAuthError = (e) => e instanceof AuthError;

async function api(url, opts = {}) {
  if (!hasToken()) throw new AuthError('Conexão com o Google expirou');
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (r.status === 401) { dropToken(); throw new AuthError('Conexão com o Google expirou'); }
  if (!r.ok) { const e = new Error(`Google Drive respondeu ${r.status}`); e.status = r.status; throw e; }
  return r;
}

export async function whoAmI() {
  const r = await api('/drive/v3/about?fields=user(emailAddress,displayName)');
  return (await r.json()).user;
}

async function findOne(q) {
  const params = new URLSearchParams({ q, spaces: 'drive', fields: 'files(id,modifiedTime,appProperties)', orderBy: 'modifiedTime desc', pageSize: '1' });
  const r = await api(`/drive/v3/files?${params}`);
  return (await r.json()).files?.[0] || null;
}

async function ensureFolder(st) {
  if (st.folderId) return st.folderId;
  const found = await findOne(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  if (found) return (st.folderId = found.id);
  const r = await api('/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (st.folderId = (await r.json()).id);
}

// Informações do backup no Drive: { id, modifiedTime, updatedAt } ou null se ainda não existe.
// `st` é o estado da conexão salvo no aparelho (fileId, folderId…), atualizado aqui.
export async function remoteInfo(st) {
  let f = null;
  if (st.fileId) {
    try {
      const r = await api(`/drive/v3/files/${st.fileId}?fields=id,modifiedTime,appProperties,trashed`);
      f = await r.json();
      if (f.trashed) f = null;
    } catch (e) {
      if (isAuthError(e)) throw e;
      f = null;
    }
  }
  if (!f) f = await findOne(`name='${FILE_NAME}' and trashed=false`);
  st.fileId = f?.id || null;
  return f && { id: f.id, modifiedTime: f.modifiedTime, updatedAt: f.appProperties?.updatedAt || null };
}

export async function download(id) {
  const r = await api(`/drive/v3/files/${id}?alt=media`);
  return r.json();
}

// Envia os dados (cria o arquivo na pasta "AVR Finanças" na primeira vez).
export async function upload(st, json, updatedAt) {
  const boundary = 'avr' + Math.random().toString(36).slice(2);
  const send = (method, url, meta) => api(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`,
  });
  const props = { appProperties: { updatedAt: updatedAt || '' } };
  if (st.fileId) {
    try {
      const r = await send('PATCH', `${API}/upload/drive/v3/files/${st.fileId}?uploadType=multipart&fields=id,modifiedTime`, props);
      return r.json();
    } catch (e) {
      if (e.status !== 404) throw e;
      st.fileId = null;
    }
  }
  const parent = await ensureFolder(st);
  const r = await send('POST', `${API}/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`,
    { name: FILE_NAME, mimeType: 'application/json', parents: [parent], ...props });
  const f = await r.json();
  st.fileId = f.id;
  return f;
}

// Carrega a biblioteca de login do Google só quando o backup no Drive está configurado.
export function loadGoogle() {
  if (!configured() || document.querySelector('script[data-gis]')) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.dataset.gis = '1';
  document.head.appendChild(s);
}
