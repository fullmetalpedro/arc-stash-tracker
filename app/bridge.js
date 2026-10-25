// window.api for the tracker page, backed by the native WebView2 shell (ArcStash.exe).
// The shell only exposes primitives (HTTP GET to the data sources, files in the data folder,
// signed-in MetaForge requests, links, notifications); the logic lives here.
import { buildData, DATA_VERSION } from './databuild.js';

const webview = window.chrome?.webview;
let seq = 0;
const pending = new Map();
webview?.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
});
const host = (cmd, args = {}) => new Promise((resolve, reject) => {
  if (!webview) return reject(new Error('Run this page inside the ARC Stash Tracker app.'));
  const id = ++seq;
  pending.set(id, { resolve, reject });
  webview.postMessage(JSON.stringify({ id, cmd, args }));
});

const listeners = { progress: [], updated: [] };
const emit = (k, v) => listeners[k].forEach(cb => cb(v));
const STALE_MS = 20 * 3600 * 1000; // refresh reference data (and take a price snapshot) at most ~daily

let building = null;
const refresh = () => (building ||= buildData(host, m => emit('progress', m)).finally(() => { building = null; }));

async function getData() {
  let cached = null;
  try { cached = JSON.parse(await host('readFile', { name: 'arc-data.json' }) || 'null'); } catch {}
  if (!cached || cached.ver !== DATA_VERSION) {
    // An app update changed the data format: rebuild, but if you're offline, open with the old cache
    // (newer fields are just missing) rather than refusing to start.
    try { return await refresh(); } catch (e) { if (cached?.items) return cached; throw e; }
  }
  if (Date.now() - new Date(cached.fetched) > STALE_MS) refresh().then(d => emit('updated', d)).catch(() => {});
  return cached;
}

// ---------- MetaForge ----------
// Always bypass caches: a cached account-sync response is how "up to date" can be wrong.
async function mfFetch(path, init = {}) {
  const method = init.method || 'GET';
  const p = method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}` : path;
  const r = JSON.parse(await host('mfFetch', { path: p, method, body: init.body ?? null, contentType: init.contentType ?? null }));
  if (r.status === 0) throw new Error(`Couldn't reach MetaForge (${r.text})`);
  let body = null;
  try { body = JSON.parse(r.text); } catch {}
  return { status: r.status, ok: r.status >= 200 && r.status < 300, body };
}
async function mfJson(path) {
  const r = await mfFetch(path);
  if (r.status === 401 || r.status === 403) return { signedOut: true };
  if (!r.ok) throw new Error(`MetaForge ${r.status}`);
  return r.body;
}

// Read what MetaForge has stored for your account (cheap; no calls to Embark).
async function pull() {
  const [status, sync] = await Promise.all([mfJson('/api/arc-raiders/embark/oauth/status'), mfJson('/api/arc-raiders/account-sync')]);
  if (sync.signedOut || !sync.resources) return { signedIn: false, status };
  return { signedIn: true, status, sync };
}

// "Sync all": the same per-resource refreshes MetaForge's own Sync all button runs. Each one asks
// Embark for fresh data, so it only works while the Embark authorization is valid.
const REFRESH_STEPS = [
  ['inventory', '/api/arc-raiders/inventory/live?persist=1'],
  ['workshop', '/api/arc-raiders/workshop/sync'],
  ['projects', '/api/arc-raiders/projects/sync'],
  ['quests', '/api/arc-raiders/quests/sync'],
  ['player-stats', '/api/arc-raiders/player-stats/sync'],
];
const REFRESH_COOLDOWN_MS = 60 * 1000;
let lastRefresh = 0;
async function syncAll() {
  const wait = lastRefresh + REFRESH_COOLDOWN_MS - Date.now();
  if (wait > 0) return { cooldown: Math.ceil(wait / 1000), ...(await pull()) };
  lastRefresh = Date.now();
  const steps = {};
  for (const [name, url] of REFRESH_STEPS) {
    try {
      const r = await mfFetch(url, { method: 'POST' });
      const b = r.body || {};
      steps[name] = { ok: r.ok, status: r.status, authRequired: b.authRequired === true, retryAfter: b.retryAfter, data: r.ok ? b : undefined, error: r.ok ? undefined : (b.message || b.error) };
      if (r.status === 401 && !b.authRequired) break; // signed out of MetaForge: no point continuing
      if (steps[name].authRequired) break;            // Embark authorization expired: the rest fail too
    } catch (e) { steps[name] = { ok: false, error: e.message }; }
  }
  return { steps, ...(await pull()) };
}

// Re-authorize Embark the way MetaForge's own button does: start an app-auth, hand the returned
// link to the MetaForge Bridge app (you sign in to Embark/Steam there), then poll until MetaForge
// reports it succeeded. Falls back to the website if Bridge can't be used.
async function reauthorize(platform = 'steam') {
  try {
    const r = await mfFetch('/api/arc-raiders/embark/app-auth/start', {
      method: 'POST', contentType: 'application/json',
      body: JSON.stringify({ platform, returnTo: 'https://metaforge.app/arc-raiders/needed-items' }),
    });
    const s = r.body;
    if (!r.ok || !s?.protocolUrl || !s.pollUrl) throw new Error(s?.message || s?.error || `MetaForge ${r.status}`);
    await host('openExternal', { url: s.protocolUrl });
    const poll = new URL(s.pollUrl, 'https://metaforge.app');
    const deadline = s.expiresAt ? new Date(s.expiresAt).getTime() : Date.now() + 10 * 60e3;
    while (Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 2500));
      const p = (await mfFetch(poll.pathname + poll.search).catch(() => null))?.body;
      if (p?.status === 'succeeded') return { ok: true, finishedAt: Date.now() };
      if (p?.status === 'failed' || p?.status === 'expired') return { ok: false, error: `Authorization ${p.status}` };
    }
    return { ok: false, error: 'Authorization timed out' };
  } catch (e) {
    await host('openExternal', { url: 'https://metaforge.app/arc-raiders/needed-items' });
    return { ok: false, fallback: true, error: e.message };
  }
}

window.api = {
  getData,
  refreshData: refresh,
  // Trader stock rotates on resets; refresh just that (one request) and keep the cache in step.
  refreshTraders: async () => {
    const t = JSON.parse(await host('httpGet', { url: 'https://metaforge.app/api/arc-raiders/traders' })).data;
    const traders = Object.fromEntries(Object.entries(t).map(([n, offers]) => [n, offers.map(o => [o.id, o.trader_price])]));
    const at = new Date().toISOString();
    try {
      const cached = JSON.parse(await host('readFile', { name: 'arc-data.json' }) || 'null');
      if (cached?.ver === DATA_VERSION) { cached.traders = traders; cached.tradersAt = at; await host('writeFile', { name: 'arc-data.json', text: JSON.stringify(cached) }); }
    } catch {}
    return { traders, at };
  },
  onProgress: cb => listeners.progress.push(cb),
  onDataUpdated: cb => listeners.updated.push(cb),
  mfPull: pull,
  mfRefresh: syncAll,
  mfLogin: () => host('mfLogin'),
  mfLogout: () => host('mfLogout'),
  mfReauthorize: reauthorize,
  openExternal: url => host('openExternal', { url }),
  notify: (title, body) => host('notify', { title, body }),
  // State saved by the previous Electron version, extracted once when upgrading.
  oldState: async () => JSON.parse(await host('readFile', { name: 'electron-state.json' }) || 'null'),
};
