// ---------- boot ----------
async function loadData() {
  if (!window.api) throw new Error('Run this page inside the ARC Stash Tracker app.');
  window.api.onProgress(m => { const el = document.getElementById('loadMsg'); if (el) el.textContent = m; });
  try {
    return await window.api.getData();
  } catch (e) {
    document.getElementById('loadMsg').textContent = `Couldn't load item data (${e.message || e}). Check your internet connection and restart the app.`;
    throw e;
  }
}

const D = await loadData();
const ITEMS = D.items;
// Item ids are slugs; drop anything else so ids are always safe in attributes and as object keys.
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,100}$/;
for (const k of Object.keys(ITEMS)) if (!SAFE_ID.test(k)) delete ITEMS[k];
D.quests = (D.quests || []).filter(q => q && SAFE_ID.test(q.id));
D.stations = (D.stations || []).filter(st => st && SAFE_ID.test(st.id));
// Own-property check: ids come from MetaForge payloads and saved files, and "__proto__" or
// "constructor" must never be treated as items or written as keys.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasItem = id => typeof id === 'string' && !UNSAFE_KEYS.has(id) && Object.prototype.hasOwnProperty.call(ITEMS, id);
const STORE_KEY = 'arc-stash-tracker-v1';
// Written by shell/build.ps1; shown in the sync window so you can tell which build is installed.
const APP_VERSION = await fetch('version.txt').then(r => r.ok ? r.text() : '').catch(() => '');
document.getElementById('loading').remove();

// ---------- derived indexes ----------
const usedIn = {};          // componentId -> [[productId, qty]]
const recycledFrom = {};    // materialId  -> [[sourceId, qty]]
for (const [id, it] of Object.entries(ITEMS)) {
  it.mv = it.v;             // MetaForge value; the wiki's sell price wins when it has one
  if (it.wv) it.v = it.wv;
  for (const [c, q] of it.c) (usedIn[c] ||= []).push([id, q]);
  for (const [c, q] of it.rc) (recycledFrom[c] ||= []).push([id, q]);
}
// Trader offers in coins. Celeste trades in Assorted Seeds, so she is listed but never "cheapest".
const offersFor = {};       // itemId -> [[trader, price]]
function indexOffers() {
  for (const k of Object.keys(offersFor)) delete offersFor[k];
  for (const [t, list] of Object.entries(D.traders)) for (const [id, p] of list) (offersFor[id] ||= []).push([t, p]);
}
indexOffers();
// Refresh trader stock when a price-showing tab opens, at most every 30 minutes.
const PRICE_TABS = new Set(['traders', 'prices', 'find', 'craft', 'insights']);
let tradersBusy = false;
async function maybeRefreshTraders() {
  const at = D.tradersAt || D.fetched;
  if (tradersBusy || !PRICE_TABS.has(S.tab) || Date.now() - new Date(at) < 30 * 60e3) return;
  tradersBusy = true;
  try { const r = await window.api.refreshTraders(); D.traders = r.traders; D.tradersAt = r.at; indexOffers(); render(); } catch { /* keep the cached stock */ }
  tradersBusy = false;
}
const cheapest = id => (offersFor[id] || []).filter(o => o[0] !== 'Celeste').sort((a, b) => a[1] - b[1])[0] || null;
const projectNeeds = {};    // itemId -> [{p, si, n}] from wiki expedition/event projects
for (const p of D.projects || []) p.stages.forEach((st, si) => { for (const [id, n] of st.req) (projectNeeds[id] ||= []).push({ p, si, n }); });
const TODAY = new Date().toISOString().slice(0, 10);
const projectStatus = p => p.type === 'PAUSED' ? 'paused' : p.end && p.end < TODAY ? 'ended' : p.start && p.start > TODAY ? 'upcoming' : 'active';
const questNeeds = {};      // itemId -> [{quest, qty}]
for (const q of D.quests) for (const [id, n] of q.req) (questNeeds[id] ||= []).push({ q, n });
const stationNeeds = {};    // itemId -> [{station, level, qty}]
for (const s of D.stations) for (const L of s.levels) for (const [id, n] of L.req) (stationNeeds[id] ||= []).push({ s, l: L.l, n });

// Blueprint requirements come from the wiki's crafting table (it.bp); fall back to
// matching "<thing> Blueprint" item names for recipes the wiki doesn't cover.
const byName = {};
for (const [id, it] of Object.entries(ITEMS)) byName[it.n.toLowerCase()] = id;
const blueprintFor = {};    // craftableId -> blueprint name
for (const [id, it] of Object.entries(ITEMS)) {
  if (it.bp) blueprintFor[id] = it.bp;
  if (it.t !== 'Blueprint') continue;
  const base = it.n.replace(/ Blueprint$/i, '').toLowerCase();
  const target = byName[base] || byName[base + ' i'];
  if (target && ITEMS[target].c.length && !(target in blueprintFor) && !ITEMS[target].bp) blueprintFor[target] = it.n;
}

// ---------- icons: inline SVG line icons in the game's flat style ----------
const svg = body => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const STAR = 'M8 1.6l1.95 4.06 4.45.55-3.28 3.06.84 4.43L8 11.56l-3.96 2.14.84-4.43L1.6 6.21l4.45-.55z';
const IC = {
  star: svg(`<path d="${STAR}" fill="currentColor"/>`),
  starO: svg(`<path d="${STAR}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`),
  close: svg('<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  check: svg('<path d="M3 8.4l3.1 3.1L13 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  up: svg('<path d="M8 4l4.5 7h-9z" fill="currentColor"/>'),
  down: svg('<path d="M8 12L3.5 5h9z" fill="currentColor"/>'),
  ext: svg('<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v4h-9.5v-9.5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  coin: svg('<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 3.8v8.4" stroke="currentColor" stroke-width="1.7"/>'),
  bench: svg('<path d="M2 13.5h12M3.5 13.5V8h9v5.5M5 8V5.5h6V8M7 5.5V3h2v2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'),
  flag: svg('<path d="M3.5 14.5v-12M3.5 3h8.5l-1.8 3 1.8 3H3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  quest: svg('<path d="M4 2.5h6.5L13 5v8.5H4zM10.5 2.5V5H13M6 8h5M6 10.5h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  sync: svg('<path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11M3.2 2.5v2.8H6M12.8 13.5v-2.8H10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
};
const goalIcon = kind => IC[kind === 'station' ? 'bench' : kind === 'project' ? 'flag' : 'quest'];

// ---------- goals: what your remaining workshop upgrades, projects and quests still need ----------
// Recomputed once per render. "next" = goals you can work on now (next station level, the current
// stage of an active project, open quests). Paused projects are tracked separately as "later".
let G = null;
function computeGoals() {
  const list = [];
  for (const s of D.stations) {
    const cur = stationLevel(s.id);
    for (const L of s.levels) if (L.l > cur && L.req.length) list.push({ kind: 'station', label: `${s.n} Lv ${L.l}`, next: L.l === cur + 1, req: L.req });
  }
  for (const p of D.projects || []) {
    const st = projectStatus(p);
    if (st === 'ended' || st === 'upcoming') continue;
    const done = S.proj[p.n] || 0;
    p.stages.forEach((s, si) => {
      const req = s.req.filter(([id]) => ITEMS[id]);
      if (si >= done && req.length) list.push({ kind: 'project', label: `${p.n} stage ${si + 1}`, next: si === done && st === 'active', paused: st === 'paused', req });
    });
  }
  for (const q of D.quests) if (!S.questsDone[q.id] && q.req.length) list.push({ kind: 'quest', label: q.n, next: true, req: q.req });
  const next = {}, all = {}, later = {};
  for (const g of list) for (const [id, n] of g.req) {
    if (g.paused) { later[id] = (later[id] || 0) + n; continue; }
    all[id] = (all[id] || 0) + n;
    if (g.next) next[id] = (next[id] || 0) + n;
  }
  return { list, next, all, later };
}
const goals = () => (G ||= computeGoals());
const neededBy = id => goals().list.filter(g => g.req.some(([r]) => r === id));

const MATERIAL_TYPES = new Set(['Basic Material', 'Topside Material', 'Refined Material', 'Material', 'Nature']);
// Ammo item ids that the weapons in your stash fire.
function ammoInUse() {
  const s = new Set();
  for (const id of Object.keys(S.inv)) if (it(id).t === 'Weapon' && it(id).am) s.add(`${it(id).am.toLowerCase()}-ammo`);
  return s;
}
// Sensible spares by item type, on top of what your goals need. These follow the common
// community advice: keep what you'll deploy, one stack of materials you craft with, sell the rest.
function baselineKeep(id) {
  const x = it(id);
  switch (x.t) {
    // Core materials (metal, rubber, plastic, chemicals...) feed most recipes, so keep a few stacks.
    case 'Basic Material': return (usedIn[id] || []).length ? 3 * x.s : 0;
    case 'Topside Material': case 'Refined Material': case 'Material': case 'Nature':
      return (usedIn[id] || []).length ? x.s : 0;
    case 'Ammunition': return ammoInUse().has(id) ? 3 * x.s : 0;
    case 'Weapon': return 2;
    // Consumables you burn every raid: several stacks of heals and shield charges, fewer throwables.
    case 'Quick Use':
      return /bandage|shot|spray|recharger|defib|medkit/i.test(x.n) ? 3 * x.s : /grenade|'nade|mine|trap|flare/i.test(x.n) ? 2 * x.s : x.s;
    case 'Shield': return 2;
    case 'Augment': return 1;
    case 'Modification': return 1;
    case 'Key': case 'Quest Item': return Infinity;
    default: return 0; // trinkets, recyclables, blueprints (learn them), research items
  }
}
const keepOf = id => (goals().all[id] || 0) + baselineKeep(id);
const surplusOf = id => Math.max(0, have(id) - keepOf(id));
const spareOf = id => { const n = surplusOf(id); return n === Infinity ? 0 : n; };

// ---------- state ----------
const defaults = () => ({ inv: {}, tracked: [], stations: {}, proj: {}, bp: {}, questsDone: {}, tab: 'tracked',
  price: { q: '', scope: 'stash', sort: 'name' }, costQ: '', findQ: '', findId: null });
// Saved state, old-version state and imported files are all untrusted shapes: keep only fields of the
// right type, and only ids the item catalog knows (never "__proto__" and friends).
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanMap = (m, ok) => Object.fromEntries(Object.entries(isObj(m) ? m : {}).filter(([k, v]) => !UNSAFE_KEYS.has(k) && ok(k, v)));
function sanitizeState(raw) {
  const d = defaults(), s = Object.assign(d, isObj(raw) ? raw : {});
  s.inv = Object.fromEntries(Object.entries(cleanMap(s.inv, (k, v) => hasItem(k) && Number.isFinite(+v) && +v > 0)).map(([k, v]) => [k, Math.min(1e9, Math.floor(+v))]));
  s.tracked = (Array.isArray(s.tracked) ? s.tracked : []).filter(hasItem).filter((x, i, a) => a.indexOf(x) === i);
  s.findRecent = (Array.isArray(s.findRecent) ? s.findRecent : []).filter(hasItem).slice(0, 10);
  s.stations = cleanMap(s.stations, (k, v) => Number.isInteger(+v) && +v >= 0 && +v <= 20);
  s.proj = cleanMap(s.proj, (k, v) => Number.isInteger(+v) && +v >= 0 && +v <= 50);
  s.bp = cleanMap(s.bp, (k, v) => hasItem(k) && v === true);
  s.questsDone = cleanMap(s.questsDone, (k, v) => v === true);
  s.price = Object.assign(defaults().price, isObj(s.price) ? s.price : {});
  for (const k of ['q', 'scope', 'sort']) if (typeof s.price[k] !== 'string') s.price[k] = defaults().price[k];
  for (const k of ['costQ', 'findQ']) if (typeof s[k] !== 'string') s[k] = '';
  if (!hasItem(s.findId)) s.findId = null;
  if (typeof s.tab !== 'string') s.tab = 'tracked';
  if (!isObj(s.sync)) delete s.sync;
  if (!isObj(s.notified)) s.notified = {};
  if (!Array.isArray(s.authLog)) s.authLog = [];
  delete s.cap; delete s.targets; delete s.selected;
  return s;
}
let S = defaults();
try { S = sanitizeState(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch {}
// First launch of this build: pick up what the previous (Electron) version saved.
if (!localStorage.getItem(STORE_KEY)) {
  const old = await window.api.oldState().catch(() => null);
  if (old) S = sanitizeState(old);
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

const have = id => S.inv[id] || 0;
// Unknown ids (e.g. bench unlocks MetaForge doesn't list) get a readable name instead of a raw slug.
const prettyId = id => String(id).replace(/-/g, ' ').replace(/\b(i{1,3}|iv|vi{0,3})\b/gi, m => m.toUpperCase()).replace(/\b[a-z]/g, c => c.toUpperCase());
const it = id => (hasItem(id) ? ITEMS[id] : null) || { n: prettyId(id), t: '?', r: null, v: 0, mv: 0, s: 1, i: '', c: [], rc: [], y: 1, db: [], sb: [] };
const slotsOf = (id, qty = have(id)) => qty > 0 ? Math.ceil(qty / (it(id).s || 1)) : 0;
const totalSlots = () => Object.keys(S.inv).reduce((a, id) => a + slotsOf(id), 0);
const fmt = n => n.toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only known rarities become CSS: the value lands inside style="…" attributes.
const RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const rarityColor = r => { const k = String(r || '').toLowerCase(); return `var(--${RARITIES.has(k) ? k : 'common'})`; };
const icon = (id, cls = '') => `<img class="icon ${cls}" data-tip="${esc(id)}" loading="lazy" decoding="async" src="${esc(it(id).i)}" alt="" style="border-bottom-color:${rarityColor(it(id).r)}">`;
const chip = (id, need) => {
  const h = have(id), cls = need == null ? '' : h >= need ? 'have' : 'short';
  const qty = need == null ? '' : ` <b>${h}/${need}</b>`;
  return `<span class="chip ${cls}" data-tip="${esc(id)}">${icon(id, 'sm')}${esc(it(id).n)}${qty}</span>`;
};
const stationLevel = sid => S.stations[sid] || 0;

function toggleTrack(id) {
  S.tracked = S.tracked.includes(id) ? S.tracked.filter(x => x !== id) : [...S.tracked, id];
  save(); render();
}

// ---------- crafting math ----------
function maxCraft(id) {
  const c = it(id).c;
  if (!c.length) return 0;
  return Math.min(...c.map(([cid, q]) => Math.floor(have(cid) / q)));
}
// Real stash-slot change from crafting n of id with the current inventory.
function slotDelta(id, n) {
  if (n <= 0) return 0;
  let before = 0, after = 0;
  const touched = new Set([id, ...it(id).c.map(x => x[0])]);
  for (const t of touched) {
    before += slotsOf(t);
    let q = have(t);
    const comp = it(id).c.find(x => x[0] === t);
    if (comp) q -= comp[1] * n;
    if (t === id) q += it(id).y * n;
    after += slotsOf(t, q);
  }
  return after - before;
}
function recycleValue(id) { return it(id).rc.reduce((a, [c, q]) => a + it(c).v * q, 0); }
// Cost of one craft: ingredients at sell value (what you give up) and at trader price (what it costs to buy them).
function craftCost(id) {
  let sell = 0, buy = 0;
  const unbuyable = [];
  for (const [c, q] of it(id).c) {
    sell += it(c).v * q;
    const o = cheapest(c);
    if (o) buy += o[1] * q; else unbuyable.push(c);
  }
  const y = it(id).y || 1, product = cheapest(id);
  // Traders sell multi-unit items (ammo) in packs of unknown size, so only compare single-unit crafts.
  const comparable = product && y === 1;
  return { sell, buy, unbuyable, y, productBuy: comparable ? product[1] : null, productTrader: comparable ? product[0] : null, productSell: it(id).v * y };
}
const money = n => n == null ? '<span class="muted">—</span>' : fmt(Math.round(n));
// Price history: one snapshot per fetch day.
const HIST = D.history || [];
function series(id, kind) { return HIST.map(h => h[kind][id] ?? null); }
function delta(id, kind) {
  const s = series(id, kind).filter(v => v != null);
  return s.length > 1 ? s[s.length - 1] - s[s.length - 2] : 0;
}
function spark(id) {
  if (HIST.length < 2) return '<span class="muted" style="font-size:11px">1 snapshot</span>';
  const lines = [['sell', 'var(--good)'], ['buy', 'var(--cream)']].map(([k, col]) => {
    const s = series(id, k), vals = s.filter(v => v != null);
    if (vals.length < 2) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = s.map((v, i) => v == null ? null : `${(i / (s.length - 1) * 78 + 1).toFixed(1)},${(19 - (v - lo) / span * 18).toFixed(1)}`).filter(Boolean);
    return `<polyline fill="none" stroke="${col}" stroke-width="1.5" points="${pts.join(' ')}"/>`;
  }).join('');
  return `<svg width="80" height="20" viewBox="0 0 80 20">${lines}</svg>`;
}
const deltaTag = d => d ? `<span class="${d > 0 ? 'good' : 'bad'}" style="font-size:11px">${d > 0 ? IC.up : IC.down}${fmt(Math.abs(d))}</span>` : '';
const bpState = id => !blueprintFor[id] ? 'none' : S.bp[id] ? 'learned' : 'missing';

// ---------- inventory panel ----------
const $ = s => document.querySelector(s);
let filterTimer;
$('#invFilter').oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderInv, 120); };
$('#invSort').onchange = renderInv;

const RARITY_ORDER = { Legendary: 0, Epic: 1, Rare: 2, Uncommon: 3, Common: 4 };
const stashUsed = () => S.sync?.used ?? totalSlots();
const stashSize = () => S.sync?.size || null;
const stashValue = () => Object.keys(S.inv).reduce((a, id) => a + it(id).v * have(id), 0);

function renderInv() {
  const f = $('#invFilter').value.trim().toLowerCase(), sort = $('#invSort').value;
  let ids = Object.keys(S.inv).filter(id => !f || it(id).n.toLowerCase().includes(f) || it(id).t.toLowerCase().includes(f));
  const by = {
    name: (a, b) => it(a).n.localeCompare(it(b).n),
    slots: (a, b) => slotsOf(b) - slotsOf(a),
    type: (a, b) => it(a).t.localeCompare(it(b).t) || it(a).n.localeCompare(it(b).n),
    rarity: (a, b) => (RARITY_ORDER[it(a).r] ?? 5) - (RARITY_ORDER[it(b).r] ?? 5) || it(a).n.localeCompare(it(b).n),
    value: (a, b) => it(b).v * have(b) - it(a).v * have(a),
    needed: (a, b) => (goals().all[b] ? 1 : 0) - (goals().all[a] ? 1 : 0) || it(a).n.localeCompare(it(b).n),
    spare: (a, b) => it(b).v * spareOf(b) - it(a).v * spareOf(a) || it(a).n.localeCompare(it(b).n),
  };
  ids.sort(by[sort] || by.name);
  $('#invCount').textContent = `${Object.keys(S.inv).length} items`;
  $('#inv').innerHTML = ids.length ? `<div class="tiles">${ids.map(id => `
    <div class="tile ${S.tracked.includes(id) ? 'tracked' : ''}" data-id="${esc(id)}" data-tip="${esc(id)}" style="--rc:${rarityColor(it(id).r)}">
      <img src="${esc(it(id).i)}" alt="" loading="lazy" decoding="async">
      ${goals().all[id] ? `<span class="mark need" title="Needed by your goals">${IC.flag}</span>` : spareOf(id) ? `<span class="mark spare" title="Spare: safe to sell">${IC.coin}</span>` : ''}
      <span class="star">${IC.star}</span>
      <span class="q">×${fmt(have(id))}</span>
    </div>`).join('')}</div>` : `<div class="empty">${Object.keys(S.inv).length ? 'No match' : 'Sync from MetaForge (top right) to load your stash.'}</div>`;
}
$('#inv').addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const id = t.dataset.id;
  toggleTrack(id);
  toast(`${S.tracked.includes(id) ? 'Tracking' : 'Stopped tracking'} <b>${esc(it(id).n)}</b>`, 1600);
});

// ---------- hover card: item details on hover, like the in-game inspector ----------
const tipEl = document.getElementById('tip');
let tipFor = null, tipTimer;
function tipHtml(id, isTile) {
  const x = it(id), o = cheapest(id), keep = keepOf(id), sur = surplusOf(id);
  // Next goals first, then later levels/stages, paused projects last (they don't count toward Keep).
  const rank = u => u.paused ? 2 : u.next ? 0 : 1;
  const uses = neededBy(id).sort((a, b) => rank(a) - rank(b));
  return `<div class="tags"><span>${esc(x.t)}</span>${x.r ? `<span style="background:${rarityColor(x.r)}">${esc(x.r)}</span>` : ''}</div>
    <h4>${esc(x.n)}</h4>
    ${x.d ? `<p>${esc(x.d)}</p>` : ''}
    <div class="facts">
      ${have(id) ? `<span>In stash</span><b>${fmt(have(id))} · ${slotsOf(id)} slot${slotsOf(id) === 1 ? '' : 's'}</b>` : ''}
      <span>Sells for</span><b>${IC.coin}${fmt(x.v)}${have(id) > 1 ? ` <i>${fmt(x.v * have(id))} total</i>` : ''}</b>
      ${o ? `<span>Buy</span><b>${IC.coin}${fmt(o[1])} <i>${esc(o[0])}</i></b>` : ''}
      <span>Stack size</span><b>${x.s}</b>
      ${keep && keep !== Infinity ? `<span>Keep</span><b>${fmt(keep)}${sur ? ` <i class="warn">${fmt(sur)} spare</i>` : ''}</b>` : ''}
      ${x.rc.length ? `<span>Recycles into</span><b>${x.rc.map(([c, q]) => `${q}× ${esc(it(c).n)}`).join(', ')}</b>` : ''}
    </div>
    ${uses.length ? `<div class="uses">${uses.slice(0, 5).map(u => `<div class="${u.paused ? 'm' : ''}">${goalIcon(u.kind)}<span>${esc(u.label)}${u.next ? ' <i class="tag">next</i>' : u.paused ? ' <i class="tag">paused</i>' : ''}</span><b>${u.req.find(([r]) => r === id)[1]}</b></div>`).join('')}${uses.length > 5 ? `<div class="m">+${uses.length - 5} more</div>` : ''}</div>` : ''}
    <div class="hint">${isTile ? (S.tracked.includes(id) ? 'Tracked · click to untrack' : 'Click to track') : 'Click for where to get it'}</div>`;
}
function placeTip(el) {
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = r.right + 10, y = r.top;
  if (x + w > innerWidth - 8) x = r.left - w - 10;
  if (x < 8) x = 8;
  if (y + h > innerHeight - 8) y = innerHeight - h - 8;
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(52, y))}px)`;
}
function hideTip() { tipFor = null; clearTimeout(tipTimer); tipEl.classList.remove('show'); }
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el || el === tipFor || !ITEMS[el.dataset.tip]) return;
  tipFor = el; clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    tipEl.innerHTML = tipHtml(el.dataset.tip, el.classList.contains('tile'));
    tipEl.classList.add('show'); placeTip(el);
  }, 80);
});
document.addEventListener('mouseout', e => {
  const el = e.target.closest('[data-tip]');
  if (el && !el.contains(e.relatedTarget)) hideTip();
});
window.addEventListener('scroll', hideTip, true);

// ---------- views ----------
function viewTracked() {
  if (!S.tracked.length) {
    // Nothing tracked yet: suggest what your next goals are short on instead of an empty page.
    const short = Object.entries(goals().next).filter(([id, n]) => have(id) < n).map(([id]) => id);
    return `<div class="empty">Click an item in your stash (or ${IC.star} one in a recipe or project) to see what it's for and where to get it.</div>
      ${short.length ? `<h2 style="margin-top:22px">Your next goals are short on <span class="cnt">${short.length}</span></h2>
        <div>${short.slice(0, 24).map(id => chip(id, goals().next[id])).join('')}</div>
        <button class="primary" style="margin-top:12px" data-trackall="${esc(short.join(','))}">${IC.star} Track all ${short.length}</button>` : ''}`;
  }
  return `<div class="grid">${S.tracked.map(trackedCard).join('')}</div>`;
}
function trackedCard(id) {
  const x = it(id);
  const stations = (stationNeeds[id] || []).filter(n => n.l > stationLevel(n.s.id));
  const quests = (questNeeds[id] || []).filter(n => !S.questsDone[n.q.id]);
  const projs = (projectNeeds[id] || []).filter(n => n.si >= (S.proj[n.p.n] || 0) && projectStatus(n.p) !== 'ended');
  const recipes = (usedIn[id] || []).sort((a, b) => it(a[0]).n.localeCompare(it(b[0]).n));
  const projectNeed = [...stations, ...quests, ...projs.filter(n => projectStatus(n.p) !== 'paused')].reduce((a, n) => a + n.n, 0);
  const buyNow = cheapest(id);
  const sources = (recycledFrom[id] || []).sort((a, b) => have(b[0]) - have(a[0]) || b[1] - a[1]);
  return `<div class="card">
    <div class="card-hd">${icon(id)}<div style="flex:1"><h3>${esc(x.n)}</h3>
      <div class="meta">${esc(x.r || '')} ${esc(x.t)} · have <b>${have(id)}</b> · sells ${fmt(x.v)} ${deltaTag(delta(id, 'sell'))}${buyNow ? ` · buy ${fmt(buyNow[1])} (${esc(buyNow[0])})` : ''} · stack ${x.s}${x.wb ? ' · crafted at ' + esc(x.wb) : ''}</div></div>
      <button class="iconbtn on" data-track="${esc(id)}" title="Untrack">${IC.star}</button></div>
    ${projectNeed ? `<div class="${have(id) >= projectNeed ? 'good' : 'warn'}">Your current goals need <b>${projectNeed}</b> (you have ${have(id)})</div>` : ''}
    ${keepOf(id) && keepOf(id) !== Infinity ? `<div class="muted small">Keep ${fmt(keepOf(id))} for your goals and spares${surplusOf(id) ? ` · <span class="warn">${fmt(surplusOf(id))} spare</span>` : ''}</div>` : ''}
    <h2>Projects</h2>
    ${stations.length || quests.length || projs.length ? `<ul class="list">
      ${stations.map(n => `<li>${IC.bench} <b>${esc(n.s.n)}</b> → Lv ${n.l} needs <b>${n.n}</b>${n.l === stationLevel(n.s.id) + 1 ? ' <span class="badge">next</span>' : ''}</li>`).join('')}
      ${projs.map(n => `<li>${IC.flag} <b>${esc(n.p.n)}</b> stage ${n.si + 1} needs <b>${n.n}</b>${n.si === (S.proj[n.p.n] || 0) ? ' <span class="badge">next</span>' : ''}${projectStatus(n.p) === 'paused' ? ' <span class="badge">paused</span>' : ''}</li>`).join('')}
      ${quests.map(n => `<li>${IC.quest} Quest <b>${esc(n.q.n)}</b> (${esc(n.q.tr)}) needs <b>${n.n}</b></li>`).join('')}
    </ul>` : '<div class="muted">Not needed by any hideout upgrade or quest you have left.</div>'}
    <h2>Used in ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}</h2>
    ${recipes.length ? `<div>${recipes.slice(0, 24).map(([pid, q]) => `<span class="chip plain" title="${esc(it(pid).t)}">${esc(it(pid).n)} ×${q}${maxCraft(pid) ? ` <span class="good">${IC.check}</span>` : ''}</span>`).join('')}${recipes.length > 24 ? `<span class="muted"> +${recipes.length - 24} more</span>` : ''}</div>` : '<div class="muted">Not a crafting ingredient.</div>'}
    <h2>How to get more</h2>
    ${x.c.length ? `<div>Craft: ${x.c.map(([c, q]) => chip(c, q)).join('')} ${x.y > 1 ? `→ ×${x.y}` : ''} ${maxCraft(id) ? `<span class="good">(can make ${maxCraft(id)} now)</span>` : ''}</div>` : ''}
    ${sources.length ? `<div>Recycle: ${sources.slice(0, 12).map(([s, q]) => `<span class="chip ${have(s) ? 'have' : ''}" title="${esc(it(s).t)}">${icon(s, 'sm')}${esc(it(s).n)} → ${q}${have(s) ? ` <b>(own ${have(s)})</b>` : ''}</span>`).join('')}${sources.length > 12 ? `<span class="muted"> +${sources.length - 12} more</span>` : ''}</div>` : ''}
    ${x.db.length ? `<div>Dropped by: ${x.db.map(esc).join(', ')}</div>` : ''}
    ${x.sb.length ? `<div>Sold by: ${x.sb.map(([t, p]) => `${esc(t)} (${fmt(p)})`).join(', ')}</div>` : ''}
    ${x.la ? `<div class="muted">Loot area: ${esc(x.la)}</div>` : ''}
  </div>`;
}

function viewCraft() {
  const craftable = Object.keys(ITEMS).filter(id => ITEMS[id].c.length && ITEMS[id].t !== 'Blueprint');
  // Recipes behind a blueprint you haven't learned aren't actually craftable: list them separately.
  const canMake = id => maxCraft(id) > 0;
  const ready = craftable.filter(id => canMake(id) && bpState(id) !== 'missing')
    .sort((a, b) => slotDelta(a, maxCraft(a)) - slotDelta(b, maxCraft(b)) || it(a).n.localeCompare(it(b).n));
  // "Almost": exactly one ingredient short.
  const almost = craftable.filter(id => !maxCraft(id) && it(id).c.some(([c]) => have(c)) &&
      it(id).c.filter(([c, q]) => have(c) < q).length === 1 && bpState(id) !== 'missing')
    .sort((a, b) => it(a).n.localeCompare(it(b).n));
  const lockedBp = craftable.filter(id => canMake(id) && bpState(id) === 'missing').sort((a, b) => it(a).n.localeCompare(it(b).n));
  const bpBadge = id => bpState(id) === 'none' ? '' : `<span class="badge bp ${bpState(id) === 'learned' ? 'learned' : ''}" data-bp="${esc(id)}" title="${esc(blueprintFor[id])}: click to toggle learned">${bpState(id) === 'learned' ? `BP ${IC.check}` : 'Needs BP'}</span>`;
  const partsBuyOf = id => { const k = craftCost(id); return k.unbuyable.length === it(id).c.length ? null : k.buy; };
  // Only show the trader columns when at least one row has a value; they're usually empty and push the table wider than the window.
  const colsFor = ids => ({ buy: ids.some(id => craftCost(id).productBuy), parts: ids.some(id => partsBuyOf(id) != null) });
  const priceCells = (id, cols) => {
    const k = craftCost(id);
    const partsBuy = partsBuyOf(id);
    let verdict;
    if (k.productBuy && !k.unbuyable.length) {
      const save = k.productBuy - k.buy;
      verdict = save > 0 ? `<span class="good">Craft, saves ${fmt(save)}</span>` : `<span class="warn">Buying is ${fmt(-save)} cheaper</span>`;
    } else if (k.productBuy) {
      verdict = `<span class="muted">Buy ${fmt(k.productBuy)} vs give up ${fmt(k.sell)} of parts</span>`;
    } else {
      const add = k.productSell - k.sell;
      verdict = `<span class="${add >= 0 ? 'good' : 'muted'}">${add >= 0 ? '+' : ''}${fmt(add)} sell value</span>`;
    }
    return `
      ${cols.buy ? `<td class="num">${k.productBuy ? `${money(k.productBuy)}<div class="muted" style="font-size:11px">${esc(k.productTrader)}</div>` : '<span class="muted" title="No trader sells it right now">—</span>'}</td>` : ''}
      ${cols.parts ? `<td class="num">${money(partsBuy)}${k.unbuyable.length && partsBuy != null ? `<div class="warn" style="font-size:11px" title="Not sold by traders: ${esc(k.unbuyable.map(c => it(c).n).join(', '))}">+${k.unbuyable.length} not sold</div>` : ''}</td>` : ''}
      <td class="num">${money(k.sell)}</td>
      <td style="font-size:12px">${verdict}</td>`;
  };
  const head = (withMax, cols) => `<thead><tr><th>Item</th><th>Ingredients</th>${withMax ? '<th class="num">Max</th><th class="num">Slots Δ</th>' : ''}
    ${cols.buy ? '<th class="num" title="Cheapest trader price for the item (per craft)">Buy price</th>' : ''}${cols.parts ? '<th class="num" title="Ingredients bought from traders">Parts to buy</th>' : ''}
    <th class="num" title="Ingredients at sell value: what you give up">Parts value</th><th>Verdict</th></tr></thead>`;
  const row = (id, n, withMax, cols) => {
    const d = slotDelta(id, n);
    return `<tr>
      <td><div class="namecell">${icon(id)}<div>${esc(it(id).n)} <button class="iconbtn ${S.tracked.includes(id) ? 'on' : ''}" data-track="${esc(id)}" title="Track">${IC.star}</button> ${bpBadge(id)}<div class="muted" style="font-size:12px">${esc(it(id).wb || '')}</div></div></div></td>
      <td>${it(id).c.map(([c, q]) => chip(c, q)).join('')}${it(id).y > 1 ? ` <span class="muted">→ ×${it(id).y}</span>` : ''}</td>
      ${withMax ? `<td class="num">${n ? `<b>${n}</b>` : '—'}</td>
      <td class="num">${n ? `<span class="${d < 0 ? 'good' : d > 0 ? 'bad' : 'muted'}">${d > 0 ? '+' : ''}${d}</span>` : ''}</td>` : ''}
      ${priceCells(id, cols)}
    </tr>`;
  };
  const table = (ids, withMax, nOf) => { const cols = colsFor(ids); return `<table>${head(withMax, cols)}<tbody>${ids.map(id => row(id, nOf(id), withMax, cols)).join('')}</tbody></table>`; };
  const cq = S.costQ.trim().toLowerCase();
  const all = craftable.filter(id => !cq || it(id).n.toLowerCase().includes(cq) || it(id).c.some(([c]) => it(c).n.toLowerCase().includes(cq)))
    .sort((a, b) => it(a).n.localeCompare(it(b).n));
  return `
    <div class="row" style="justify-content:space-between"><div class="tip"><b>Craft to compress.</b> Sorted by stash-slot change if you craft the max now: green = crafting frees space (e.g. power cells → shield rechargers, loose parts → refined components).</div>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:6px"><b>Buy price</b> = cheapest trader offer for the finished item. <b>Parts to buy</b> = what the ingredients cost at traders. <b>Parts value</b> = what the ingredients would sell for (what you give up by crafting).</div>
    <h2>Ready to craft (${ready.length})</h2>
    ${ready.length ? `<div style="overflow-x:auto">${table(ready, true, maxCraft)}</div>` : '<div class="empty">Nothing yet. Add more materials to your inventory.</div>'}
    ${lockedBp.length ? `<details style="margin-top:14px"><summary>You have the parts but not the blueprint (${lockedBp.length}). Click a "Needs BP" badge once you learn one.</summary><div style="overflow-x:auto;margin-top:8px">${table(lockedBp, true, maxCraft)}</div></details>` : ''}
    <h2>One ingredient short (${almost.length})</h2>
    ${almost.length ? `<div style="overflow-x:auto">${table(almost.slice(0, 60), true, () => 0)}</div>` : '<div class="muted">None.</div>'}
    <h2>All recipe costs (${all.length})</h2>
    <input id="costQ" placeholder="Search a recipe or ingredient…" value="${esc(S.costQ)}" style="width:100%;max-width:360px;margin-bottom:8px">
    <div style="overflow-x:auto">${table(all.slice(0, 80), false, () => 0)}</div>
    ${all.length > 80 ? `<div class="muted">Showing 80 of ${all.length}. Narrow the search.</div>` : ''}`;
}

function viewPrices() {
  const P = S.price, q = P.q.trim().toLowerCase();
  let ids = P.scope === 'stash' ? Object.keys(S.inv) : P.scope === 'tracked' ? [...S.tracked] : Object.keys(ITEMS);
  ids = ids.filter(id => (it(id).v || cheapest(id)) && (!q || it(id).n.toLowerCase().includes(q) || it(id).t.toLowerCase().includes(q)));
  const key = {
    name: id => it(id).n, sell: id => -it(id).v, buy: id => -(cheapest(id)?.[1] || 0),
    slot: id => -(it(id).v * it(id).s), change: id => -Math.abs(delta(id, 'sell')) - Math.abs(delta(id, 'buy')),
  }[P.sort];
  ids.sort((a, b) => { const x = key(a), y = key(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; });
  const stashValue = Object.keys(S.inv).reduce((a, id) => a + it(id).v * have(id), 0);
  const prevValue = HIST.length > 1 ? Object.keys(S.inv).reduce((a, id) => a + (HIST[HIST.length - 2].sell[id] ?? it(id).v) * have(id), 0) : stashValue;
  return `
    <div class="tip"><b>Price tracker.</b> Sell prices come from the ARC Raiders Wiki (MetaForge if the wiki has none). Buy prices are the cheapest current trader offer. The app refreshes this data about once a day when you open it and saves a snapshot each time, so history and price changes build up over time (${HIST.length} snapshot${HIST.length === 1 ? '' : 's'} so far${HIST.length ? ', latest ' + HIST[HIST.length - 1].d : ''}).</div>
    <div class="row" style="margin-bottom:10px">
      <span class="chip plain">Stash sell value <b>${fmt(stashValue)}</b> ${deltaTag(stashValue - prevValue)}</span>
      <input id="priceQ" placeholder="Search…" value="${esc(P.q)}" style="flex:1;min-width:160px">
      <select data-price="scope">${[['stash', 'My stash'], ['tracked', 'Tracked'], ['all', 'All items']].map(([v, l]) => `<option value="${v}" ${P.scope === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-price="sort">${[['name', 'Name'], ['sell', 'Sell price'], ['buy', 'Buy price'], ['slot', 'Value / slot'], ['change', 'Biggest change']].map(([v, l]) => `<option value="${v}" ${P.sort === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
    </div>
    ${ids.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Item</th><th class="num">Sell</th><th class="num">Buy</th><th class="num" title="Buy price ÷ sell price">Markup</th><th class="num">Value / slot</th>${P.scope === 'stash' ? '<th class="num">Your total</th>' : ''}${HIST.length > 1 ? '<th>History</th>' : ''}<th></th></tr></thead><tbody>
    ${ids.slice(0, 150).map(id => {
      const x = it(id), o = cheapest(id), seeds = (offersFor[id] || []).find(o => o[0] === 'Celeste');
      return `<tr>
        <td><div class="namecell">${icon(id, 'sm')}<div>${esc(x.n)}<div class="muted" style="font-size:11px">${esc(x.t)}</div></div></div></td>
        <td class="num">${x.v ? fmt(x.v) : '—'} ${deltaTag(delta(id, 'sell'))}${x.wv && x.mv && x.wv !== x.mv ? `<div class="muted" style="font-size:11px" title="MetaForge lists a different value">MF ${fmt(x.mv)}</div>` : ''}</td>
        <td class="num">${o ? `${fmt(o[1])} ${deltaTag(delta(id, 'buy'))}<div class="muted" style="font-size:11px">${esc(o[0])}</div>` : seeds ? `<span class="muted">${seeds[1]} seeds</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${o && x.v ? `${(o[1] / x.v).toFixed(1)}×` : ''}</td>
        <td class="num">${x.v ? fmt(x.v * x.s) : ''}</td>
        ${P.scope === 'stash' ? `<td class="num">${fmt(x.v * have(id))}</td>` : ''}
        ${HIST.length > 1 ? `<td>${spark(id)}</td>` : ''}
        <td><button class="iconbtn ${S.tracked.includes(id) ? 'on' : ''}" data-track="${esc(id)}" title="Track">${IC.star}</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>${ids.length > 150 ? `<div class="muted">Showing 150 of ${ids.length}. Narrow the search.</div>` : ''}`
    : `<div class="empty">${P.scope === 'stash' ? 'Add items to your inventory, or switch to All items.' : P.scope === 'tracked' ? 'Star items to watch their prices here.' : 'No match.'}</div>`}`;
}

function viewProjects() {
  const stations = D.stations.filter(s => s.levels.some(l => l.req.length));
  const quests = D.quests.filter(q => q.req.length);
  const reqRows = req => req.map(([id, n]) => chip(id, n)).join('');
  const pct = req => req.length ? Math.round(100 * req.reduce((a, [id, n]) => a + Math.min(have(id), n) / n, 0) / req.length) : 100;
  return `
    <div class="tip">${S.sync ? `Bench levels come from your MetaForge sync (${ago(S.sync.at)}); change one only if it's wrong.` : `Set each station's <b>current</b> level, or sync from MetaForge to fill them in.`} The next level's shopping list is shown against your stash; the star button tracks every missing item.</div>
    <div class="grid">${stations.map(s => {
      const cur = stationLevel(s.id), next = s.levels.find(l => l.l === cur + 1);
      const missing = next ? next.req.filter(([id, n]) => have(id) < n).map(x => x[0]) : [];
      return `<div class="card">
        <div class="card-hd"><div style="flex:1"><h3>${esc(s.n)}</h3><div class="meta">max level ${s.max}</div></div>
          <label class="muted">Current lv <select data-station="${esc(s.id)}">${Array.from({ length: s.max + 1 }, (_, i) => `<option ${i === cur ? 'selected' : ''}>${i}</option>`).join('')}</select></label></div>
        ${next ? `<div>Next → <b>Lv ${next.l}</b> · ${pct(next.req)}% gathered</div>
          <div class="prog"><i style="width:${pct(next.req)}%"></i></div>
          <div style="margin-top:6px">${next.req.length ? reqRows(next.req) : '<span class="muted">No item cost.</span>'}</div>
          ${next.crafts.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Unlocks: ${next.crafts.map(c => esc(it(c).n)).join(', ')}</div>` : ''}
          ${missing.length ? `<button style="margin-top:8px" data-trackall="${esc(missing.join(','))}">${IC.star} Track ${missing.length} missing</button>` : next.req.length ? '<div class="good" style="margin-top:6px">Ready to upgrade!</div>' : ''}
          ${s.levels.filter(l => l.l > cur + 1 && l.req.length).map(l => `<details style="margin-top:6px"><summary class="muted">Lv ${l.l}</summary>${reqRows(l.req)}</details>`).join('')}`
        : '<div class="good">Maxed out.</div>'}
      </div>`;
    }).join('')}</div>
    <h2>Expedition &amp; event projects <span class="muted" style="text-transform:none;letter-spacing:0">(ARC Raiders Wiki)</span></h2>
    <div class="tip">Set how many stages you've finished. The next stage's items are checked against your stash, with what the missing ones would cost from traders.</div>
    ${(() => {
      const ps = (D.projects || []).filter(p => !stations.some(s => s.n === p.n));  // e.g. Outpost is already a station above
      const by = st => ps.filter(p => projectStatus(p) === st);
      const live = ps.filter(p => !['ended', 'paused'].includes(projectStatus(p))), paused = by('paused'), past = by('ended');
      const fold = (label, list) => list.length ? `<details style="margin-top:10px"><summary class="muted">${label} (${list.length})</summary><div class="grid" style="margin-top:8px">${list.map(projectCard).join('')}</div></details>` : '';
      return `${live.length ? `<div class="grid">${live.map(projectCard).join('')}</div>` : '<div class="muted">No project is running right now.</div>'}
        ${fold('Paused projects', paused)}${fold('Ended events', past)}`;
    })()}
    <h2>Quests that need items</h2>
    <table><tbody>${quests.map(q => `<tr><td><label class="row"><input type="checkbox" data-quest="${esc(q.id)}" ${S.questsDone[q.id] ? 'checked' : ''}> <b>${esc(q.n)}</b></label><span class="muted">${esc(q.tr)}</span></td><td>${reqRows(q.req)}</td></tr>`).join('')}</tbody></table>`;
}

function projectCard(p) {
  const done = S.proj[p.n] || 0, st = p.stages[done], status = projectStatus(p);
  const missing = st ? st.req.filter(([id, n]) => have(id) < n) : [];
  const pct = st && st.req.length ? Math.round(100 * st.req.reduce((a, [id, n]) => a + Math.min(have(id), n) / n, 0) / st.req.length) : 100;
  const buyMissing = missing.reduce((a, [id, n]) => a + (cheapest(id)?.[1] || 0) * (n - have(id)), 0);
  const notSold = missing.filter(([id]) => !cheapest(id)).length;
  const badge = { active: '<span class="badge" style="color:var(--good)">active</span>', paused: '<span class="badge">paused</span>', ended: '<span class="badge">ended</span>', upcoming: '<span class="badge acc">upcoming</span>' }[status];
  return `<div class="card">
    <div class="card-hd"><div style="flex:1"><h3>${esc(p.n)} ${badge}</h3><div class="meta">${p.stages.length} stages${p.start ? ` · ${p.start}${p.end ? ' → ' + p.end : ''}` : ''}</div></div>
      <label class="muted">Done <select data-proj="${esc(p.n)}">${Array.from({ length: p.stages.length + 1 }, (_, i) => `<option ${i === done ? 'selected' : ''}>${i}</option>`).join('')}</select></label></div>
    ${st ? `<div>Next → <b>stage ${done + 1}</b>${p.stages.some(s => s.part > 1) ? ` (part ${st.part})` : ''} · ${pct}% gathered</div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div style="margin-top:6px">${st.req.map(([id, n]) => chip(id, n)).join('') || '<span class="muted">No item cost.</span>'}</div>
      ${st.rew.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Rewards: ${st.rew.map(([id, n]) => `${esc(it(id).n)}${n > 1 ? ' ×' + n : ''}`).join(', ')}</div>` : ''}
      ${missing.length ? `<div class="row" style="margin-top:8px"><button data-trackall="${esc(missing.map(x => x[0]).join(','))}">${IC.star} Track ${missing.length} missing</button>
        <span class="muted" style="font-size:12px">${notSold === missing.length ? 'None of the missing items are sold by traders: loot or craft them.' : `Buying the rest: <b>${fmt(buyMissing)}</b>${notSold ? ` (+${notSold} not sold by traders)` : ''}`}</span></div>` : st.req.length ? '<div class="good" style="margin-top:6px">Ready to hand in!</div>' : ''}`
    : '<div class="good">Complete.</div>'}
  </div>`;
}

// ---------- stash insights: computed from your stash, your goals and your real stash size ----------
const ACTION = { handin: ['Hand in', 'var(--green)'], sell: ['Sell', 'var(--gold)'], recycle: ['Recycle', 'var(--cyan)'],
  craft: ['Craft', 'var(--green)'], learn: ['Learn', 'var(--epic)'], buy: ['Buy', 'var(--orange)'] };
const actTag = k => `<span class="act" style="--ac:${ACTION[k][1]}">${ACTION[k][0]}</span>`;
const nameCell = id => `<div class="namecell">${icon(id, 'sm')}<span>${esc(it(id).n)}</span></div>`;
// Slots a stack takes before and after removing n units.
const slotsFreed = (id, n) => slotsOf(id) - slotsOf(id, have(id) - n);

function insightActions() {
  const g = goals(), acts = [];
  // 1. Goals you can complete right now: handing them in is free space and progress.
  for (const goal of g.list) {
    if (!goal.next || !goal.req.every(([id, n]) => have(id) >= n)) continue;
    acts.push({ kind: 'handin', title: goal.label, icon: goalIcon(goal.kind),
      why: `${goal.kind === 'quest' ? 'Once the quest is active, you have' : 'You have'} everything: ${goal.req.map(([id, n]) => `${n}× ${esc(it(id).n)}`).join(', ')}.`,
      slots: goal.req.reduce((a, [id, n]) => a + slotsFreed(id, n), 0), coins: 0 });
  }
  // 2. Everything above what you should keep.
  const ammo = ammoInUse();
  for (const id of Object.keys(S.inv)) {
    const x = it(id), extra = surplusOf(id);
    if (!extra || extra === Infinity) continue;
    const slots = slotsFreed(id, extra), sell = x.v * extra, rec = recycleValue(id) * extra;
    const feeds = x.rc.filter(([c]) => (g.next[c] || 0) > have(c)).map(([c]) => it(c).n);
    if (x.t === 'Blueprint') { acts.push({ kind: 'learn', id, why: 'Learning it unlocks the recipe for good and frees the slot.', slots, coins: 0 }); continue; }
    if (x.t === 'Ammunition' && !ammo.has(id)) { acts.push({ kind: 'sell', id, why: 'None of your weapons use this ammo.', slots, coins: sell }); continue; }
    if (feeds.length) { acts.push({ kind: 'recycle', id, why: `Its parts cover what your next goals are short on: ${[...new Set(feeds)].map(esc).join(', ')}.`, slots, coins: rec }); continue; }
    if (rec > sell * 1.1) { acts.push({ kind: 'recycle', id, why: `Parts are worth ${fmt(rec)} vs ${fmt(sell)} selling it.`, slots, coins: rec }); continue; }
    const why = x.t === 'Trinket' ? 'Trinkets only exist to be sold.'
      : g.all[id] ? `You have ${fmt(extra)} more than your goals and a spare stack need.`
      : MATERIAL_TYPES.has(x.t) ? 'More than a stack and no remaining goal needs it.'
      : x.t === 'Recyclable' || x.t === 'Misc' ? 'No remaining goal needs it.'
      : `More than you'll deploy (keeping ${keepOf(id)}).`;
    if (sell > 0) acts.push({ kind: 'sell', id, why, slots, coins: sell });
  }
  // 3. Crafts that pack the same materials into fewer slots.
  for (const id of Object.keys(ITEMS)) {
    const n = maxCraft(id);
    if (!n || bpState(id) === 'missing' || it(id).t === 'Blueprint') continue;
    const d = slotDelta(id, n);
    const useful = g.all[id] || ['Refined Material', 'Quick Use'].includes(it(id).t) || (it(id).t === 'Ammunition' && ammo.has(id));
    if (d < 0 && useful) acts.push({ kind: 'craft', id, why: `Craft ${n}× from what you have: same materials, ${-d} fewer slot${d === -1 ? '' : 's'}.`, slots: -d, coins: 0 });
  }
  return acts.sort((a, b) => (a.kind === 'handin' ? -1 : 0) - (b.kind === 'handin' ? -1 : 0) || b.slots - a.slots || b.coins - a.coins);
}

function shortfalls() {
  const g = goals();
  return Object.entries(g.next).filter(([id, n]) => have(id) < n).map(([id, n]) => {
    const miss = n - have(id);
    const recycle = (recycledFrom[id] || []).filter(([s]) => surplusOf(s) > 0 && surplusOf(s) !== Infinity)
      .map(([s, q]) => ({ s, units: q * surplusOf(s) })).sort((a, b) => b.units - a.units);
    return { id, n, miss, recycle, buy: cheapest(id), craft: it(id).c.length && bpState(id) !== 'missing' ? maxCraft(id) * it(id).y : 0 };
  }).sort((a, b) => b.miss / b.n - a.miss / a.n || it(a.id).n.localeCompare(it(b.id).n));
}

// For each map: which of your shortfalls you can harvest there, or get from ARC that spawn there
// (counts from MetaForge's community maps). Best three maps first.
function raidPlan(short) {
  const sum = (obj, name) => Object.entries(obj || {}).filter(([k]) => sameName(k, name)).reduce((a, [, v]) => a + v, 0);
  return GUIDE.maps.map(m => {
    const rows = short.map(r => ({ ...r, plants: sum(m.nature, it(r.id).n), arcs: it(r.id).db.map(a => [a, sum(m.arc, a)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]) }))
      .filter(r => r.plants || r.arcs.length);
    return { m, rows, spots: rows.reduce((a, r) => a + r.plants, 0) };
  }).filter(p => p.rows.length).sort((a, b) => b.rows.length - a.rows.length || b.spots - a.spots).slice(0, 3);
}

function viewInsights() {
  const ids = Object.keys(S.inv);
  if (!ids.length) return '<div class="empty">Sync your stash from MetaForge to get insights.</div>';
  const g = goals(), used = stashUsed(), size = stashSize(), pct = size ? used / size : null;
  const acts = insightActions(), short = shortfalls();
  const freeable = acts.reduce((a, x) => a + x.slots, 0), coins = acts.filter(a => a.kind === 'sell').reduce((a, x) => a + x.coins, 0);

  // Stash pressure, with the next expansion cost (64 base slots, +24 per expansion, 5,000 coins more each time).
  let pressure = '';
  if (!size) {
    // Stash size comes from a MetaForge sync; until then still show value and what can be freed.
    pressure = `<div class="card kpi-card"><div class="kpis">
        <div><span>Items</span><b>${fmt(ids.length)}</b></div>
        <div><span>Stash value</span><b>${IC.coin}${fmt(stashValue())}</b></div>
        <div><span>Can free</span><b>${freeable}</b></div>
        <div><span>Spare to sell</span><b>${IC.coin}${fmt(coins)}</b></div>
      </div><div class="muted small" style="margin-top:8px">Sync from MetaForge to see your real stash size and how full it is.</div></div>`;
  } else {
    const done = Math.max(0, Math.round((size - 64) / 24)), cost = 5000 * (done + 1), coinsNow = S.sync?.coins ?? 0;
    const lvl = pct > .95 ? ['bad', 'Your stash is full.', `Free space before your next raid: the actions below free <b>${freeable}</b> slots.`]
      : pct > .8 ? ['warn', 'Your stash is getting tight.', `The actions below free <b>${freeable}</b> slots without touching anything your goals need.`]
      : ['good', 'Plenty of room.', 'No need to sell materials your upcoming goals use. Hold them until those goals are done.'];
    pressure = `<div class="card kpi-card">
      <div class="kpis">
        <div><span>Slots</span><b class="${lvl[0]}">${used}/${size}</b></div>
        <div><span>Stash value</span><b>${IC.coin}${fmt(stashValue())}</b></div>
        <div><span>Can free</span><b>${freeable}</b></div>
        <div><span>Spare to sell</span><b>${IC.coin}${fmt(coins)}</b></div>
      </div>
      <div class="prog"><i style="width:${Math.min(100, pct * 100)}%;background:var(--${lvl[0]})"></i></div>
      <div style="margin-top:8px"><b class="${lvl[0]}">${lvl[1]}</b> ${lvl[2]}
      ${size < 328 && pct > .8 ? ` Next stash expansion (+24 slots) costs about <b>${fmt(cost)}</b> coins${coinsNow >= cost ? ', which you can afford' : ''}.` : ''}</div>
    </div>`;
  }

  // Loadout readiness: what you can bring into the next raid.
  const count = re => ids.filter(id => it(id).t === 'Quick Use' && re.test(it(id).n)).reduce((a, id) => a + have(id), 0);
  const heals = count(/bandage|vita|shot|spray|medkit|defib/i), shieldCh = count(/recharger/i), nades = count(/grenade|'nade|mine|trap/i);
  const weapons = ids.filter(id => it(id).t === 'Weapon');
  const ammoRows = [...ammoInUse()].map(a => ({ a, n: have(a), guns: weapons.filter(w => `${(it(w).am || '').toLowerCase()}-ammo` === a).map(w => it(w).n) }));
  const craftable = re => Object.keys(ITEMS).filter(id => it(id).t === 'Quick Use' && re.test(it(id).n) && maxCraft(id) && bpState(id) !== 'missing');
  const readiness = [];
  if (heals < 3) { const c = craftable(/bandage|vita|shot|spray/i)[0]; readiness.push(`Only <b>${heals}</b> healing items.${c ? ` You can craft ${maxCraft(c)}× ${esc(it(c).n)} now.` : ''}`); }
  if (shieldCh < 2) { const c = craftable(/recharger/i)[0]; readiness.push(`Only <b>${shieldCh}</b> shield rechargers.${c ? ` You can craft ${maxCraft(c)}× ${esc(it(c).n)} now.` : ''}`); }
  for (const r of ammoRows) if (r.n < it(r.a).s) readiness.push(`Low on <b>${esc(it(r.a).n)}</b> (${r.n}) for your ${r.guns.map(esc).join(', ')}.`);
  if (!weapons.length) readiness.push('No weapons in your stash.');

  // Goals closest to done.
  const close = g.list.filter(x => x.next && x.req.length).map(x => ({ x, pct: x.req.reduce((a, [id, n]) => a + Math.min(have(id), n) / n, 0) / x.req.length }))
    .filter(r => r.pct < 1).sort((a, b) => b.pct - a.pct).slice(0, 6);

  const lowVps = ids.filter(id => it(id).v && !g.all[id] && it(id).t !== 'Quest Item').map(id => ({ id, per: it(id).v * it(id).s })).sort((a, b) => a.per - b.per).slice(0, 8);

  return `${pressure}
    <h2>Do this next <span class="cnt">${acts.length}</span></h2>
    ${acts.length ? `<div class="tablewrap"><table><thead><tr><th>Action</th><th>Item</th><th>Why</th><th class="num">Frees</th><th class="num">Coins</th></tr></thead><tbody>
      ${acts.slice(0, 18).map(a => `<tr><td>${actTag(a.kind)}</td><td>${a.id ? nameCell(a.id) : `<div class="namecell">${a.icon}<span>${esc(a.title)}</span></div>`}</td>
        <td class="why">${a.why}</td><td class="num">${a.slots ? `${a.slots} slot${a.slots === 1 ? '' : 's'}` : '—'}</td><td class="num">${a.coins ? fmt(Math.round(a.coins)) : '—'}</td></tr>`).join('')}
    </tbody></table></div>${acts.length > 18 ? `<div class="muted">+${acts.length - 18} smaller actions</div>` : ''}`
    : '<div class="muted">Nothing to clean up: everything in your stash is either needed or a sensible spare.</div>'}

    <h2>Short for your next goals <span class="cnt">${short.length}</span></h2>
    ${short.length ? `<div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Have / need</th><th>Fastest way to get it</th></tr></thead><tbody>
      ${short.slice(0, 14).map(r => `<tr><td>${nameCell(r.id)}</td><td class="num"><span class="bad">${have(r.id)}</span>/${r.n}</td><td class="why">${[
        r.craft ? `${actTag('craft')} ${fmt(r.craft)} from your materials` : '',
        r.recycle.length ? `${actTag('recycle')} ${r.recycle.slice(0, 2).map(x => `spare ${esc(it(x.s).n)} → ${x.units}`).join(', ')}` : '',
        r.buy ? `${actTag('buy')} ${esc(r.buy[0])} ${IC.coin}${fmt(r.buy[1])} each (${fmt(r.buy[1] * r.miss)} for ${r.miss})` : '',
        it(r.id).db.length ? `drops from ${it(r.id).db.slice(0, 3).map(esc).join(', ')}` : it(r.id).la ? `loot in ${esc(it(r.id).la)} areas` : '',
      ].filter(Boolean).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="good">You have everything your next goals need.</div>'}

    ${(() => { const plan = raidPlan(short); return plan.length ? `<h2>Where to raid next <span class="cnt">for what you're short on</span></h2>
      <div class="grid">${plan.map(p => `<div class="card"><h3>${esc(p.m.name)}</h3><div class="muted small">${p.rows.length} of your ${short.length} shortfalls${p.spots ? ` · ${fmt(p.spots)} harvest spots` : ''}</div>
        <div style="margin-top:8px">${p.rows.slice(0, 10).map(r => `<span class="chip" data-tip="${esc(r.id)}">${icon(r.id, 'sm')}${esc(it(r.id).n)} <b>${r.plants ? `${fmt(r.plants)} spots` : r.arcs.slice(0, 2).map(([a, n]) => `${n} ${esc(a)}`).join(', ')}</b></span>`).join('')}${p.rows.length > 10 ? `<span class="muted small"> +${p.rows.length - 10} more</span>` : ''}</div></div>`).join('')}</div>
      <div class="muted small" style="margin-top:6px">From MetaForge's community maps: plant spots, and ARC on the map that drop the item. Containers aren't counted because the maps don't say what they drop.</div>` : ''; })()}
    ${close.length ? `<h2>Closest goals</h2><div class="grid">${close.map(({ x, pct }) => `<div class="card">
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b class="nowrap">${goalIcon(x.kind)} ${esc(x.label)}</b><span class="muted nowrap">${Math.round(pct * 100)}%</span></div>
      <div class="prog"><i style="width:${pct * 100}%"></i></div>
      <div style="margin-top:6px">${x.req.filter(([id, n]) => have(id) < n).map(([id, n]) => chip(id, n)).join('')}</div></div>`).join('')}</div>` : ''}

    <h2>Raid readiness</h2>
    <div class="row">
      <span class="chip plain">Healing <b>${heals}</b></span><span class="chip plain">Shield rechargers <b>${shieldCh}</b></span><span class="chip plain">Grenades &amp; traps <b>${nades}</b></span>
      ${ammoRows.map(r => `<span class="chip ${r.n >= it(r.a).s ? 'have' : 'short'}">${icon(r.a, 'sm')}${esc(it(r.a).n)} <b>${fmt(r.n)}</b></span>`).join('')}
    </div>
    ${readiness.map(t => `<div class="tip">${t}</div>`).join('')}

    ${lowVps.length ? `<h2>Least valuable per slot <span class="cnt">not needed by goals</span></h2>
      <div class="row">${lowVps.map(r => `<span class="chip">${icon(r.id, 'sm')}${esc(it(r.id).n)} <b>${IC.coin}${fmt(r.per)}</b></span>`).join('')}</div>` : ''}`;
}

function viewTraders() {
  const stockAt = D.tradersAt || D.fetched;
  const g = goals(), offers = Object.entries(D.traders).flatMap(([t, list]) => list.map(([id, p]) => ({ t, id, p })));
  const price = o => o.t === 'Celeste' ? `${fmt(o.p)} seeds` : `${IC.coin}${fmt(o.p)}`;
  const shortIds = new Set(Object.entries(g.next).filter(([id, n]) => have(id) < n).map(([id]) => id));
  const forGoals = offers.filter(o => shortIds.has(o.id) && o.t !== 'Celeste').sort((a, b) => a.p - b.p);
  const ammo = ammoInUse(), forGuns = offers.filter(o => ammo.has(o.id));
  // Buying vs crafting for things you'd actually use.
  const cmp = Object.keys(ITEMS).filter(id => it(id).c.length && craftCost(id).productBuy && (g.all[id] || have(id) || shortIds.has(id)))
    .map(id => ({ id, k: craftCost(id) })).filter(r => !r.k.unbuyable.length || maxCraft(r.id))
    .map(r => ({ ...r, save: r.k.productBuy - (r.k.unbuyable.length ? r.k.sell : r.k.buy) })).sort((a, b) => b.save - a.save).slice(0, 10);
  const offerChip = o => `<span class="chip ${shortIds.has(o.id) ? 'short' : have(o.id) ? 'have' : ''}">${icon(o.id, 'sm')}${esc(it(o.id).n)} <b>${price(o)}</b></span>`;
  return `
    <div class="muted small" style="margin-bottom:10px">Trader stock as of ${new Date(stockAt).toLocaleString()} · refreshes every 30 min while you're on a price tab</div>
    <h2>Covers your next goals <span class="cnt">${forGoals.length}</span></h2>
    ${forGoals.length ? `<div class="tablewrap"><table><thead><tr><th>Item</th><th>Trader</th><th class="num">Each</th><th class="num">You're short</th><th class="num">Total</th></tr></thead><tbody>
      ${forGoals.map(o => { const miss = g.next[o.id] - have(o.id); return `<tr><td>${nameCell(o.id)}</td><td>${esc(o.t)}</td><td class="num">${fmt(o.p)}</td><td class="num">${miss}</td><td class="num">${fmt(o.p * miss)}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="muted">No trader sells anything your next goals are short on right now.</div>'}

    <h2>Ammo for your weapons</h2>
    ${forGuns.length ? `<div class="row">${forGuns.map(offerChip).join('')}</div>` : '<div class="muted">No trader stocks your ammo types right now.</div>'}

    ${cmp.length ? `<h2>Craft or buy?</h2><div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Buy</th><th class="num">Craft cost</th><th>Verdict</th></tr></thead><tbody>
      ${cmp.map(r => `<tr><td>${nameCell(r.id)}</td><td class="num">${fmt(r.k.productBuy)}</td><td class="num">${fmt(r.k.unbuyable.length ? r.k.sell : r.k.buy)}${r.k.unbuyable.length ? ' <span class="muted" title="Some parts aren\'t sold; valued at their sell price">*</span>' : ''}</td>
        <td>${r.save > 0 ? `<span class="good nowrap">Craft, saves ${fmt(r.save)}</span>` : `<span class="warn nowrap">Buy, ${fmt(-r.save)} cheaper</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : ''}

    <h2>Today's stock</h2>
    ${Object.entries(D.traders).map(([t, list]) => `<details class="stock"><summary><b>${esc(t)}</b> <span class="muted">${list.length} offers</span></summary>
      <div class="row" style="margin-top:8px">${list.map(([id, p]) => offerChip({ t, id, p })).join('')}</div></details>`).join('')}`;
}

// ---------- Find: how to get any item (buy, craft, recycle, forage, scavenge) ----------
const GUIDE = D.guide || { maps: [], sources: {}, containers: [] };
const normName = s => (s || '').toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameName = (a, b) => { a = normName(a); b = normName(b); return a === b || a.replace(/s$/, '') === b.replace(/s$/, ''); };
const wikiImg = (file, w = 420) => `https://arcraiders.wiki/w/index.php?title=Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}&width=${w}`;
// Per-map counts for a marker name (plant, ARC or container), most first.
function mapCounts(kind, name) {
  return GUIDE.maps.map(m => ({ map: m.name, n: Object.entries(m[kind] || {}).filter(([k]) => sameName(k, name)).reduce((a, [, v]) => a + v, 0) }))
    .filter(r => r.n).sort((a, b) => b.n - a.n);
}
// The wiki names containers more specifically ("Green Locker", "Broken Fridge") than the community
// maps do ("Locker", "Fridge"). Fall back to the broader map type the wiki name ends with.
const CONTAINER_ALIASES = { refrigerator: 'Fridge' };
function containerCounts(name) {
  const exact = mapCounts('containers', name);
  if (exact.length) return { rows: exact, as: null };
  const words = normName(name).split(' ');
  const mapNames = new Set(GUIDE.maps.flatMap(m => Object.keys(m.containers || {})));
  const candidates = [CONTAINER_ALIASES[words[words.length - 1]], words.slice(-2).join(' '), words[words.length - 1]].filter(Boolean);
  for (const c of candidates) {
    const hit = [...mapNames].find(m => sameName(m, c));
    if (hit) return { rows: mapCounts('containers', hit), as: hit };
  }
  return { rows: [], as: null };
}
const countBars = rows => {
  const max = Math.max(...rows.map(r => r.n), 1);
  return `<div class="bars">${rows.map(r => `<div class="barrow"><span>${esc(r.map)}</span><i style="width:${Math.max(4, 100 * r.n / max)}%"></i><b>${fmt(r.n)}</b></div>`).join('')}</div>`;
};

function findResults(q) {
  q = normName(q);
  if (!q) return [];
  return Object.keys(ITEMS).filter(id => normName(it(id).n).includes(q) && it(id).t !== 'Blueprint')
    .sort((a, b) => normName(it(a).n).indexOf(q) - normName(it(b).n).indexOf(q) || it(a).n.length - it(b).n.length).slice(0, 14);
}

function viewFind() {
  const q = S.findQ || '', hits = findResults(q), id = S.findId && ITEMS[S.findId] ? S.findId : null;
  return `<div class="findbar">
      <input id="findQ" placeholder="Search any item: where to buy it, how to craft it, where it spawns… (Ctrl+F)" value="${esc(q)}" autocomplete="off">
    </div>
    ${q && !(id && normName(it(id).n) === normName(q)) ? `<div class="row" style="margin:10px 0 6px">${hits.length ? hits.map(h => `<button class="chipbtn findhit" data-find="${esc(h)}">${icon(h, 'sm')}${esc(it(h).n)}</button>`).join('') : '<span class="muted">No item matches that.</span>'}</div>` : ''}
    ${id ? findCard(id) : !q ? findStart() : ''}`;
}
// Empty search: quick picks from what your goals are short on and what you looked at recently.
function findStart() {
  const short = Object.entries(goals().next).filter(([id, n]) => have(id) < n).map(([id]) => id).slice(0, 16);
  const recent = (S.findRecent || []).filter(id => ITEMS[id]);
  const picks = ids => `<div class="row">${ids.map(h => `<button class="chipbtn findhit" data-find="${esc(h)}">${icon(h, 'sm')}${esc(it(h).n)}</button>`).join('')}</div>`;
  return `${recent.length ? `<h2 style="margin-top:18px">Recently viewed</h2>${picks(recent)}` : ''}
    ${short.length ? `<h2 style="margin-top:18px">Short for your next goals</h2>${picks(short)}` : ''}
    ${!recent.length && !short.length ? '<div class="empty" style="margin-top:12px">Search an item, or click any item chip elsewhere in the app, to see every way to get it.</div>' : ''}`;
}

function findCard(id) {
  const x = it(id), g = goals(), src = GUIDE.sources[id] || { lines: [], look: [] };
  const offers = (offersFor[id] || []).slice().sort((a, b) => (a[0] === 'Celeste') - (b[0] === 'Celeste') || a[1] - b[1]);
  const k = x.c.length ? craftCost(id) : null;
  const fromRecycle = (recycledFrom[id] || []).sort((a, b) => have(b[0]) - have(a[0]) || b[1] - a[1]);
  const plants = mapCounts('nature', x.n);
  const arcs = x.db.map(a => ({ a, rows: mapCounts('arc', a) })).filter(r => r.rows.length);
  const lootCats = (x.la || '').split(',').map(s => s.trim()).filter(Boolean);
  const named = GUIDE.containers.filter(c => c.items.includes(id));
  const byCat = GUIDE.containers.filter(c => !named.includes(c) && lootCats.some(l => sameName(c.loot, l)));
  const rewards = D.quests.filter(q => q.rew.some(([r]) => r === id));
  const need = g.all[id] || 0;
  const container = c => {
    const { rows, as } = containerCounts(c.n);
    return `<div class="cont">${c.img ? `<img src="${wikiImg(c.img, 220)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
      <div><b>${esc(c.n)}</b>${c.breach ? ' <span class="badge">breach</span>' : ''}${c.loot ? ` <span class="badge">${esc(c.loot)}</span>` : ''}
      <div class="muted small">${rows.length ? `Most on ${esc(rows[0].map)} (${rows[0].n})${rows[1] ? `, ${esc(rows[1].map)} (${rows[1].n})` : ''}` : 'Not counted on the community maps'}${as ? ` <span title="The community maps don't split this type out; these are counts for the broader type">· counted as ${esc(as)}</span>` : ''}</div></div></div>`;
  };
  return `<div class="card find">
    <div class="card-hd">${icon(id)}<div style="flex:1;min-width:0"><h3>${esc(x.n)}</h3>
      <div class="meta">${esc(x.r || '')} ${esc(x.t)} · sells ${IC.coin}${fmt(x.v)} · stack ${x.s}${have(id) ? ` · you have <b>${fmt(have(id))}</b>` : ''}${need ? ` · goals need <b>${fmt(need)}</b>` : ''}</div>
      ${x.d ? `<div class="muted small" style="margin-top:4px">${esc(x.d)}</div>` : ''}</div>
      <button class="iconbtn ${S.tracked.includes(id) ? 'on' : ''}" data-track="${esc(id)}" title="Track">${IC.star}</button></div>

    <div class="findgrid">
      <section><h2>Buy</h2>
        ${offers.length ? `<ul class="list">${offers.map(([t, p]) => `<li><b>${esc(t)}</b><span class="spacer"></span>${t === 'Celeste' ? `${fmt(p)} seeds` : `${IC.coin}${fmt(p)}`}</li>`).join('')}</ul>`
          : `<div class="muted">No trader sells it today.${x.sb.length ? ` Usually from ${x.sb.map(s => esc(s[0])).join(', ')}.` : ''}</div>`}
      </section>

      <section><h2>Craft</h2>
        ${k ? `<div>${x.c.map(([c, q]) => chip(c, q)).join('')}${x.y > 1 ? ` <span class="muted">→ ×${x.y}</span>` : ''}</div>
          <div class="muted small" style="margin-top:6px">${x.wb ? `At the ${esc(x.wb)}. ` : ''}${blueprintFor[id] ? (bpState(id) === 'learned' ? 'Blueprint learned. ' : `Needs the <b>${esc(blueprintFor[id])}</b>. `) : ''}${maxCraft(id) ? `<span class="good">You can make ${maxCraft(id) * x.y} now.</span>` : ''}</div>
          <div class="muted small">Parts sell for ${fmt(k.sell)}${k.unbuyable.length ? '' : ` · cost ${fmt(k.buy)} at traders`}${k.productBuy ? ` · buying it costs ${fmt(k.productBuy)}` : ''}</div>`
          : '<div class="muted">Not craftable.</div>'}
        ${fromRecycle.length ? `<h2 style="margin-top:14px">Break down</h2><div>${fromRecycle.slice(0, 8).map(([s, q]) => `<span class="chip ${have(s) ? 'have' : ''}" data-tip="${esc(s)}">${icon(s, 'sm')}${esc(it(s).n)} → ${q}${have(s) ? ` <b>own ${have(s)}</b>` : ''}</span>`).join('')}${fromRecycle.length > 8 ? `<span class="muted small"> +${fromRecycle.length - 8} more</span>` : ''}</div>` : ''}
      </section>
    </div>

    <h2>Find it in a raid</h2>
    ${src.look.length ? `<div class="looks">${src.look.map(l => `<figure><img src="${wikiImg(l.file)}" alt="" loading="lazy"><figcaption><b>${esc(l.title)}</b>${l.text ? `<span>${esc(l.text)}</span>` : ''}</figcaption></figure>`).join('')}</div>` : ''}
    <div class="findgrid">
      ${plants.length ? `<section><h3 class="sub">Harvest spots per map</h3>${countBars(plants)}<div class="muted small">Plants marked on MetaForge's community maps.</div></section>` : ''}
      ${arcs.length ? `<section><h3 class="sub">Dropped by ARC</h3>${arcs.map(r => `<div style="margin-bottom:8px"><b>${esc(r.a)}</b>${countBars(r.rows.slice(0, 4))}</div>`).join('')}</section>` : x.db.length ? `<section><h3 class="sub">Dropped by ARC</h3><div>${x.db.map(esc).join(', ')}</div></section>` : ''}
      ${src.lines.length ? `<section><h3 class="sub">Sources (ARC Raiders Wiki)</h3><ul class="srcs">${src.lines.map(l => `<li style="margin-left:${(l.d - 1) * 16}px">${esc(l.t)}</li>`).join('')}</ul></section>` : ''}
    </div>
    ${named.length || byCat.length ? `<h3 class="sub">${named.length ? 'Containers that drop it' : `Search ${esc(lootCats.join(' / '))} containers`}</h3>
      <div class="conts">${[...named, ...byCat].slice(0, 9).map(container).join('')}</div>` : lootCats.length ? `<div class="muted">Loot area: ${esc(lootCats.join(', '))}</div>` : ''}
    ${rewards.length ? `<h3 class="sub">Quest rewards</h3><div>${rewards.map(q => `<span class="chip plain">${IC.quest} ${esc(q.n)} <span class="muted">(${esc(q.tr)})</span></span>`).join('')}</div>` : ''}
    ${x.gu ? `<div style="margin-top:14px"><a href="https://metaforge.app${esc(x.gu)}" target="_blank" rel="noopener">MetaForge guide for ${esc(x.n)} ${IC.ext}</a></div>` : ''}
  </div>`;
}
function showFind(id) { S.findId = id; S.findQ = it(id).n; S.findRecent = [id, ...(S.findRecent || []).filter(x => x !== id)].slice(0, 10); }
function openFind(id) { S.tab = 'find'; showFind(id); save(); render(); $('section.view').scrollTop = 0; }

const VIEWS = { tracked: viewTracked, find: viewFind, craft: viewCraft, prices: viewPrices, projects: viewProjects, insights: viewInsights, traders: viewTraders };

// ---------- render + events ----------
let lastTab = null;
function render() {
  G = null;
  hideTip();
  const used = stashUsed(), size = stashSize(), pct = size ? Math.min(100, 100 * used / size) : 0;
  $('#slotGroup').hidden = !size;
  $('#slotText').textContent = size ? `${used}/${size}` : '';
  $('#slotBar').style.width = pct + '%';
  $('#slotBar').style.background = pct > 95 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--cream)';
  $('#stashValue').innerHTML = `${IC.coin}${fmt(stashValue())}`;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  // The stash grid only depends on these; skip rebuilding hundreds of tiles on every tab switch.
  const invKey = JSON.stringify([S.inv, S.tracked, S.stations, S.proj, S.questsDone, $('#invFilter').value, $('#invSort').value]);
  if (invKey !== render.invKey) { render.invKey = invKey; renderInv(); }
  // Keep focus and caret in view search boxes, which get rebuilt on every keystroke.
  const a = document.activeElement, focusId = a && a.closest('#view') && a.id, caret = focusId && a.selectionStart;
  const view = $('#view');
  view.innerHTML = (VIEWS[S.tab] || viewTracked)();
  if (lastTab !== S.tab) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); lastTab = S.tab; }
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); el.setSelectionRange?.(caret, caret); } }
}

// Ctrl+F or "/" jumps to Find with the search focused; Esc closes the sync window.
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) {
    e.preventDefault();
    if (S.tab !== 'find') { S.tab = 'find'; save(); render(); }
    const q = document.getElementById('findQ'); q?.focus(); q?.select();
  }
  if (e.key === 'Escape' && $('#syncModal').classList.contains('open')) $('#syncModal').classList.remove('open');
});
$('#tabs').onclick = e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t && t !== S.tab) { S.tab = t; save(); render(); $('section.view').scrollTop = 0; maybeRefreshTraders(); } };
$('#view').addEventListener('click', e => {
  const hit = e.target.closest('[data-find]');
  if (hit) { showFind(hit.dataset.find); save(); render(); return; }
  const ch = e.target.closest('.chip[data-tip], .namecell [data-tip]');
  if (ch && !e.target.closest('[data-track],[data-bp]')) { openFind(ch.dataset.tip); return; }
  const d = e.target.dataset;
  if (d.track) toggleTrack(d.track);
  if (d.trackall) { S.tracked = [...new Set([...S.tracked, ...d.trackall.split(',')])]; save(); render(); }
  if (d.bp) { S.bp[d.bp] = !S.bp[d.bp]; save(); render(); }
});
$('#view').addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.station) S.stations[d.station] = +t.value;
  if (d.proj) S.proj[d.proj] = +t.value;
  if (d.price) S.price[d.price] = t.value;
  if (d.quest) S.questsDone[d.quest] = t.checked;
  save(); render();
});

$('#view').addEventListener('keydown', e => {
  if (e.target.id === 'findQ' && e.key === 'Enter') { const h = findResults(e.target.value)[0]; if (h) { showFind(h); save(); render(); } }
});
$('#view').addEventListener('input', e => {
  if (e.target.id === 'priceQ') { S.price.q = e.target.value; save(); render(); }
  if (e.target.id === 'findQ') { S.findQ = e.target.value; const h = findResults(S.findQ); if (h[0] && normName(it(h[0]).n) === normName(S.findQ)) S.findId = h[0]; save(); render(); }
  if (e.target.id === 'costQ') { S.costQ = e.target.value; save(); render(); }
});

// ---------- MetaForge sync ----------
// MetaForge's /api/arc-raiders/account-sync response (+ fresh data returned by the per-resource
// refreshes) -> tracker state. Replaces stash, bench levels, finished quests and learned blueprints;
// keeps your tracked items and project stages.
const MF_STATIONS = { scrappy: 'scrappy', gunsmith: 'weapon-bench', gearBench: 'equipment-bench', medicalLab: 'med-station',
  explosivesStation: 'explosives-bench', utilityStation: 'utility-bench', refiner: 'refiner', researchStation: 'research-station', outpost: 'outpost' };
function syncParts(j, fresh = {}) {
  const R = (isObj(j) && isObj(j.resources) ? j.resources : null) || {};
  if (!isObj(fresh)) fresh = {};
  return {
    slots: Array.isArray(R.inventory?.data?.inventory?.view?.stashSlots) ? R.inventory.data.inventory.view.stashSlots : null,
    levels: fresh.workshop?.levels || R.workshop?.data?.levels || {},
    quests: [fresh.quests?.user_quests, R.quests?.data?.user_quests].find(Array.isArray) || [],
    stats: fresh['player-stats']?.stats || R['player-stats']?.data?.stats || null,
    coins: R.inventory?.data?.inventory?.wallet?.coins,
    blueprints: Array.isArray(R.blueprints?.data?.blueprints) ? R.blueprints.data.blueprints : [],
  };
}
// Compare content, not timestamps: MetaForge can rewrite data without bumping the time we look at.
function fingerprint(p) {
  const inv = (p.slots || []).filter(s => isObj(s) && isObj(s.item)).map(s => `${s.item.itemId}:${s.item.amount}`).sort().join(',');
  const q = p.quests.filter(x => isObj(x) && x.status === 'COMPLETED').map(x => x.quest_id).sort().join(',');
  return [inv, JSON.stringify(p.levels), q, p.coins, p.stats?.level, p.stats?.currentXp, p.blueprints.length].join('|');
}
function importMetaForge(j, fresh = {}) {
  const p = syncParts(j, fresh);
  if (!p.slots) throw new Error('no inventory in sync data');
  const inv = {}, unknown = new Set();
  for (const s of p.slots) {
    const item = isObj(s) && isObj(s.item) ? s.item : null;
    if (!item) continue;
    if (!hasItem(item.itemId)) { if (item.itemId != null) unknown.add(String(item.title || item.itemId).slice(0, 80)); continue; }
    const amount = item.amount == null ? 1 : Math.floor(+item.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    inv[item.itemId] = Math.min(1e9, (inv[item.itemId] || 0) + amount);
  }
  const changed = new Set([...Object.keys(inv), ...Object.keys(S.inv)].filter(id => (inv[id] || 0) !== (S.inv[id] || 0))).size;
  S.inv = inv;
  for (const [k, lvl] of Object.entries(isObj(p.levels) ? p.levels : {})) {
    if (Object.prototype.hasOwnProperty.call(MF_STATIONS, k) && Number.isInteger(+lvl) && +lvl >= 0 && +lvl <= 20) S.stations[MF_STATIONS[k]] = +lvl;
  }
  for (const q of Array.isArray(p.quests) ? p.quests : []) {
    if (isObj(q) && q.status === 'COMPLETED' && typeof q.quest_id === 'string' && !UNSAFE_KEYS.has(q.quest_id)) S.questsDone[q.quest_id] = true;
  }
  const bpToProduct = Object.fromEntries(Object.entries(blueprintFor).map(([pid, name]) => [name.toLowerCase(), pid]));
  for (const b of p.blueprints) {
    if (!isObj(b)) continue;
    const key = String((hasItem(b.itemId) ? it(b.itemId).n : b.name) || '').toLowerCase();
    const pid = Object.prototype.hasOwnProperty.call(bpToProduct, key) ? bpToProduct[key] : null;
    if (pid) S.bp[pid] = true;
  }
  S.sync = {
    at: j.resources?.inventory?.syncedAt || j.lastSyncedAt, loaded: new Date().toISOString(),
    coins: p.coins, stats: p.stats, unknown: [...unknown],
    size: p.slots.length, used: p.slots.filter(s => isObj(s) && isObj(s.item)).length,
  };
  S.syncFp = fingerprint(p);
  return { items: Object.keys(inv).length, changed, unknown: [...unknown] };
}

// Live sync state (not persisted): what MetaForge said on the last check.
const SY = { busy: false, signedIn: null, status: null, auth: null, lastSyncedAt: null, resources: {}, checkedAt: null, refreshedAt: null, steps: null, authFailed: false, error: null, reauth: null };
const PULL_MS = 5 * 60e3, REFRESH_MS = 15 * 60e3;

function toast(msg, ms = 4500) {
  const t = $('#toast'); t.innerHTML = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
const ago = iso => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const span = ms => {
  const s = Math.floor(Math.abs(ms) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return d ? `${d}d ${h}h ${String(m).padStart(2, '0')}m` : `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
};

// Embark authorization: MetaForge can only ask Embark for fresh data while it's valid.
function authState() {
  const exp = SY.auth?.expiresAt || SY.status?.expiresAt;
  if (!SY.signedIn) return { cls: '', label: SY.signedIn === false ? 'Sign in to sync' : 'Sync', timer: '' };
  if (!exp) return { cls: SY.authFailed ? 'bad' : '', label: SY.authFailed ? 'Authorize' : 'Synced', timer: SY.authFailed ? '' : ago(S.sync?.at) };
  const left = new Date(exp) - Date.now();
  if (left <= 0 || SY.status?.reauthorizationRequired || SY.authFailed) return { cls: 'bad', label: 'Auth expired', timer: left <= 0 ? span(left) + ' ago' : '', left: Math.min(left, 0), exp };
  return { cls: left < 2 * 3600e3 ? 'soon' : 'ok', label: 'Auth', timer: span(left), left, exp };
}
// How long an authorization lasts, measured from your own re-authorizations (falls back to the
// ~22 h observed on a real account between authorizing and MetaForge's expiresAt).
function authLifetime() {
  const log = (S.authLog || []).filter(x => x.exp > x.start);
  if (!log.length) return { h: 22, measured: false };
  return { h: log.reduce((a, x) => a + (x.exp - x.start), 0) / log.length / 3600e3, measured: true };
}
function recordAuth() {
  const exp = SY.auth?.expiresAt || SY.status?.expiresAt;
  if (!S.authPending || !exp) return;
  const e = new Date(exp).getTime();
  if (e > S.authPending) { (S.authLog ||= []).push({ start: S.authPending, exp: e }); S.authLog = S.authLog.slice(-10); delete S.authPending; save(); }
}

async function syncNow({ refresh = true, auto = false } = {}) {
  if (!window.api || SY.busy) return;
  const doRefresh = refresh && SY.signedIn !== false && authState().cls !== 'bad';
  SY.busy = doRefresh ? 'refresh' : 'pull'; SY.error = null; renderHeader(); renderSync();
  try {
    const r = doRefresh ? await window.api.mfRefresh() : await window.api.mfPull();
    SY.signedIn = r.signedIn; SY.status = r.status || null; SY.checkedAt = new Date().toISOString();
    let fresh = {};
    if (r.steps) {
      SY.steps = r.steps; SY.refreshedAt = SY.checkedAt;
      const st = Object.values(r.steps);
      SY.authFailed = st.some(s => s.authRequired) ? true : st.some(s => s.ok) ? false : SY.authFailed;
      fresh = Object.fromEntries(Object.entries(r.steps).filter(([, s]) => s.ok && s.data).map(([k, s]) => [k, s.data]));
    }
    if (r.signedIn) {
      const j = r.sync;
      SY.auth = j.authorization || null; SY.lastSyncedAt = j.lastSyncedAt;
      SY.resources = Object.fromEntries(Object.entries(j.resources || {}).map(([k, v]) => [k, v.syncedAt]));
      recordAuth();
      const fp = fingerprint(syncParts(j, fresh));
      if (fp !== S.syncFp || !auto) {
        const res = importMetaForge(j, fresh);
        save(); render();
        if (fp !== S.syncFpShown || !auto) {
          S.syncFpShown = fp; save();
          toast(res.changed ? `<b>Stash updated</b> · ${res.changed} item${res.changed === 1 ? '' : 's'} changed` : `<b>Already up to date</b> · ${res.items} items`);
        }
      } else if (!auto) toast('<b>Already up to date</b>');
      if (!auto && SY.authFailed) toast(`<b>Embark authorization expired.</b> Showing MetaForge's last copy from ${new Date(S.sync.at).toLocaleString()}. Re-authorize to pull fresh data.`, 7000);
    } else if (!auto) openSync();
  } catch (e) {
    SY.error = e.message;
    if (!auto) toast(`<b>Sync failed:</b> ${esc(e.message)}`);
  } finally {
    SY.busy = false; renderSync(); renderHeader();
  }
}

async function reauthorize() {
  SY.reauth = 'waiting'; renderSync();
  const r = await window.api.mfReauthorize(SY.status?.provider || 'steam');
  SY.reauth = null;
  if (r.ok) {
    S.authPending = r.finishedAt; S.notified = {}; SY.authFailed = false; save();
    toast('<b>Embark authorization renewed.</b> Syncing…');
    await syncNow({ refresh: true });
  } else if (r.fallback) {
    toast('<b>Opened MetaForge in your browser.</b> Click Authorization there; the app picks up the new data automatically.', 8000);
  } else toast(`<b>Authorization didn't finish:</b> ${esc(r.error || 'unknown error')}`, 7000);
  renderSync();
}

function notifyExpiry() {
  const a = authState();
  if (!a.exp || !window.api) return;
  S.notified ||= {};
  const key = a.exp + (a.left <= 0 ? ':expired' : ':soon');
  if (S.notified[key]) return;
  if (a.left <= 0) window.api.notify('MetaForge sync expired', 'Re-authorize Embark so your stash keeps syncing.');
  else if (a.left < 3600e3) window.api.notify('MetaForge sync expires soon', `Your Embark authorization ends in ${Math.ceil(a.left / 60000)} minutes.`);
  else return;
  S.notified[key] = true; save();
}

function renderHeader() {
  const a = authState();
  $('#syncChip').className = 'chipbtn ' + a.cls + (SY.busy ? ' busy' : '');
  $('#syncLabel').textContent = SY.busy === 'refresh' ? 'Syncing' : SY.busy ? 'Checking' : a.label;
  $('#syncTimer').textContent = SY.busy ? '' : a.timer;
  const st = S.sync?.stats, coins = S.sync?.coins ?? st?.credits;
  const html = st ? `
    <span class="hstat" title="Level ${st.level}: ${fmt(st.currentXp)} / ${fmt(st.nextLevelXp)} XP"><span class="ring" style="--p:${Math.round(100 * st.currentXp / (st.nextLevelXp || 1))}%"><span>${st.level}</span></span></span>
    <span class="hstat" title="Coins">${IC.coin}${fmt(coins ?? 0)}</span>` : '';
  if ($('#player').dataset.html !== html) { $('#player').innerHTML = html; $('#player').dataset.html = html; }
}

function renderSync() {
  if (!$('#syncModal').classList.contains('open')) return;
  const a = authState(), linked = SY.status?.profileLinked ?? SY.status?.linked, life = authLifetime();
  const steps = SY.steps ? Object.entries(SY.steps) : [];
  $('#syncBody').innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
      <div><h3>MetaForge sync</h3><div class="muted">Your stash, workshop levels, quests and stats, pulled through your MetaForge account.</div></div>
      <button class="iconbtn" data-sync="close" title="Close">${IC.close}</button>
    </div>
    ${SY.signedIn === false ? `
      <div class="tip" style="margin-top:16px"><b>Sign in to MetaForge.</b> A MetaForge window opens. Sign in with your own account (your Embark link is already on it), then close the window. The app keeps that sign-in.</div>
      <div class="row" style="margin-top:12px"><button class="primary" data-sync="login">Sign in to MetaForge</button><label class="btn">Import sync file<input type="file" accept=".json" data-sync="file" hidden></label></div>` : `
      <div class="authbox ${a.cls}">
        <div><div class="lbl">Embark authorization ${a.cls === 'bad' ? 'expired' : 'expires in'}</div>
          <div class="countdown" id="bigTimer">${a.exp ? (a.left > 0 ? span(a.left) : span(a.left) + ' ago') : a.cls === 'bad' ? 'Expired' : '—'}</div>
          <div class="muted small">${a.exp ? new Date(a.exp).toLocaleString() + ' · ' : ''}lasts about ${Math.round(life.h)} h${life.measured ? ' (measured)' : ''} · renewing it is manual</div></div>
        <button class="${a.cls === 'bad' ? 'primary' : ''}" data-sync="reauth" ${SY.reauth ? 'disabled' : ''}>${SY.reauth ? 'Waiting for Bridge…' : 'Re-authorize'}</button>
      </div>
      ${SY.reauth ? '<div class="tip"><b>MetaForge Bridge is opening.</b> Sign in to Steam/Embark there. This window updates when it\'s done.</div>' : ''}
      ${a.cls === 'bad' && !SY.reauth ? `<div class="tip"><b>Showing MetaForge's last copy</b> from ${S.sync ? new Date(S.sync.at).toLocaleString() : 'the last sync'}. MetaForge can't ask Embark for fresh data until you re-authorize. Re-authorize uses the <b>MetaForge Bridge</b> app${SY.status?.bridgeInstallerUrl ? ` (<a href="#" data-sync="bridge">download it</a> if you don't have it)` : ''}.</div>` : ''}
      <div class="kv">
        <span>MetaForge account</span><b>${SY.signedIn ? 'Signed in' : '…'}${linked ? ' · Embark linked' : ''}${SY.status?.provider ? ` (${esc(SY.status.provider)})` : ''}</b>
        <span>Game data read</span><b>${SY.lastSyncedAt ? `${new Date(SY.lastSyncedAt).toLocaleString()} (${ago(SY.lastSyncedAt)})` : '—'}</b>
        <span>Last full sync</span><b>${SY.refreshedAt ? ago(SY.refreshedAt) : '—'}${steps.length ? ` · ${steps.map(([k, s]) => `<span class="${s.ok ? 'good' : 'bad'}" title="${esc(s.error || s.status || '')}">${s.ok ? IC.check : IC.close}${esc(k)}</span>`).join(' ')}` : ''}</b>
        <span>Last check</span><b>${SY.checkedAt ? ago(SY.checkedAt) : '—'}${S.autoSync !== false ? ` · checks every ${PULL_MS / 60000} min, full sync every ${REFRESH_MS / 60000} min and when you switch back to the app` : ''}</b>
      </div>
      ${S.sync?.unknown?.length ? `<div class="muted small">Not in the item catalog: ${S.sync.unknown.map(esc).join(', ')}</div>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="primary" data-sync="now" ${SY.busy ? 'disabled' : ''}>${SY.busy ? 'Syncing…' : a.cls === 'bad' ? 'Reload from MetaForge' : 'Sync all now'}</button>
        <label class="row muted small"><input type="checkbox" data-sync="auto" ${S.autoSync !== false ? 'checked' : ''}> Automatic</label>
      </div>
      <details style="margin-top:12px"><summary>More</summary>
        <div class="row" style="margin-top:10px">
          <button data-sync="refresh">Refresh item &amp; price data</button>
          <label class="btn">Import file<input type="file" accept=".json" data-sync="file" hidden></label>
          <button data-sync="export">Export tracker</button>
          <button data-sync="logout">Sign out of MetaForge</button>
        </div>
        <div class="muted small" style="margin-top:8px">${APP_VERSION ? `App ${esc(APP_VERSION)} · ` : ''}Item &amp; price data from ${new Date(D.fetched).toLocaleString()}${SY.error ? ` · <span class="bad">${esc(SY.error)}</span>` : ''}</div>
        <div class="muted small" style="margin-top:4px">Data from <a href="https://metaforge.app/arc-raiders" target="_blank" rel="noopener">MetaForge</a> and the <a href="https://arcraiders.wiki" target="_blank" rel="noopener">ARC Raiders Wiki</a> (wiki text and images under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>). Fan project, not affiliated with Embark Studios.</div>
      </details>`}`;
}
function openSync() { hideTip(); $('#syncModal').classList.add('open'); renderSync(); }

$('#syncChip').onclick = () => { openSync(); if (SY.signedIn !== false) syncNow({ refresh: false, auto: true }); };
$('#syncModal').addEventListener('click', async e => {
  if (e.target.id === 'syncModal') { $('#syncModal').classList.remove('open'); return; }
  const act = e.target.closest('[data-sync]')?.dataset.sync;
  if (act === 'close') $('#syncModal').classList.remove('open');
  if (act === 'now') syncNow({ refresh: true });
  if (act === 'login') { await window.api.mfLogin(); await syncNow({ refresh: true }); renderSync(); }
  if (act === 'reauth') reauthorize();
  if (act === 'bridge') { e.preventDefault(); window.api.openExternal(SY.status.bridgeInstallerUrl); }
  if (act === 'logout') { await window.api.mfLogout(); SY.signedIn = false; SY.auth = null; renderSync(); renderHeader(); }
  if (act === 'refresh') {
    e.target.disabled = true; e.target.textContent = 'Refreshing…';
    try { await window.api.refreshData(); location.reload(); } catch (err) { toast(`<b>Refresh failed:</b> ${esc(err.message)}`); e.target.disabled = false; }
  }
  if (act === 'export') {
    const l = document.createElement('a');
    l.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    l.download = 'arc-stash.json'; l.click();
  }
});
$('#syncModal').addEventListener('change', async e => {
  const act = e.target.dataset.sync;
  if (act === 'auto') { S.autoSync = e.target.checked; save(); renderSync(); }
  if (act === 'file') {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.resources) { const r = importMetaForge(j); toast(`<b>Imported:</b> ${r.items} items`); }
      else S = sanitizeState(j);
      save(); render(); renderHeader(); renderSync();
    } catch { toast('<b>That file is not a MetaForge sync file or a tracker export.</b>'); }
  }
});

// Timers: the countdown ticks every second (paused while the window is hidden); a cheap check of
// MetaForge every 5 min; a full Sync all every 15 min and when you come back to the app.
setInterval(() => {
  if (document.hidden) return;
  renderHeader();
  const big = document.getElementById('bigTimer'), a = authState();
  if (big && a.exp) big.textContent = a.left > 0 ? span(a.left) : span(a.left) + ' ago';
  notifyExpiry();
}, 1000);
const sinceMs = iso => iso ? Date.now() - new Date(iso) : Infinity;
setInterval(() => {
  if (S.autoSync === false) return;
  const full = !document.hidden && sinceMs(SY.refreshedAt) >= REFRESH_MS;
  if (full || sinceMs(SY.checkedAt) >= PULL_MS) syncNow({ refresh: full, auto: true });
}, 60e3);
window.addEventListener('focus', () => {
  if (S.autoSync === false || sinceMs(SY.checkedAt) < 60e3) return;
  syncNow({ refresh: sinceMs(SY.refreshedAt) >= 5 * 60e3, auto: true });
});
// Background refresh of item/price data finished: reload unless you're typing somewhere.
window.api?.onDataUpdated(() => {
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) toast('<b>Item &amp; price data updated.</b> It loads next time you open the app.', 8000);
  else location.reload();
});

$('#title').title = 'Item & price data from ' + new Date(D.fetched).toLocaleString();
render();
renderHeader();
if (S.autoSync !== false) syncNow({ refresh: true, auto: true });
setTimeout(maybeRefreshTraders, 3000);

// Hook for the app's self-test mode (main.js ARC_SELFTEST); harmless in normal use.
window.__arcDebug = { importMetaForge, sanitizeState, SY, D, render, renderHeader, openSync, get S() { return S; }, set S(v) { S = v; } };
