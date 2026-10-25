// Pulls ARC Raiders reference data from MetaForge and the ARC Raiders Wiki and caches it in the
// app's data folder. MetaForge asks consumers to cache rather than hit the API live.
// Sources: https://metaforge.app/arc-raiders and https://arcraiders.wiki
export const DATA_VERSION = 4; // bump when the cached shape changes so old caches get rebuilt
const MAPS = [['dam', 'Dam Battlegrounds'], ['spaceport', 'The Spaceport'], ['buried-city', 'Buried City'], ['blue-gate', 'Blue Gate'], ['stella-montis', 'Stella Montis'], ['riven-tides', 'Riven Tides']];

const BASE = 'https://metaforge.app/api/arc-raiders';
const WIKI = 'https://arcraiders.wiki/w/api.php';
const SKIP_TYPES = new Set(['Outfits', 'Cosmetic', 'Stencil', 'Design', 'Furniture']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function buildData(host, log = () => {}) {
  const getJson = async url => JSON.parse(await host('httpGet', { url }));
  const get = p => getJson(`${BASE}/${p}`);
  async function getAll(p) {
    const rows = [];
    const sep = p.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const d = await get(`${p}${sep}limit=100&page=${page}`);
      rows.push(...d.data);
      log(`Downloading ${p.split('?')[0]} ${rows.length}/${d.pagination.total}`);
      if (!d.pagination.hasNextPage) return rows;
      await sleep(500); // the docs say large requests get throttled
    }
  }
  async function cargo(table, fields) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const qs = new URLSearchParams({ action: 'cargoquery', format: 'json', tables: table, fields, limit: 500, offset });
      const batch = ((await getJson(`${WIKI}?${qs}`)).cargoquery || []).map(r => r.title);
      rows.push(...batch);
      log(`Reading wiki ${table} ${rows.length}`);
      if (batch.length < 500) return rows;
      await sleep(500);
    }
  }
  const norm = s => (s || '').toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const pairs = (list, key) => (list || []).map(e => [e[key].id, e.quantity]);

  const rawItems = await getAll('items?includeComponents=true');
  const rawQuests = await getAll('quests');
  log('Downloading hideout and traders');
  const hideout = await get('hideout');
  const traders = (await get('traders')).data;

  // How many units a recipe yields lives on the consumer side (used_in.output_quantity).
  const yields = {};
  for (const it of rawItems) for (const u of it.used_in || []) if (u.output_quantity) yields[u.item.id] = u.output_quantity;

  const items = {};
  for (const it of rawItems) {
    if (SKIP_TYPES.has(it.item_type)) continue;
    const sb = it.stat_block || {};
    items[it.id] = {
      n: it.name, t: it.item_type, r: it.rarity, v: it.value || 0, s: sb.stackSize || 1, i: it.icon,
      d: it.description || '', am: it.ammo_type || null, sub: it.subcategory || null,
      wb: (it.workbench || '').trim() || null,
      c: pairs(it.components, 'component'), y: yields[it.id] || 1,
      rc: pairs(it.recycle_components, 'component'), la: it.loot_area,
      db: (it.dropped_by || []).map(d => d.arc.name),
      sb: (it.sold_by || []).map(s => [s.trader_name, s.price]),
      gu: it.guide_url || null,
    };
  }

  const quests = rawQuests.map(q => ({
    id: q.id, n: q.name, tr: q.trader_name,
    req: (q.required_items || []).map(r => [r.item_id, r.quantity]),
    rew: (q.rewards || []).map(r => [r.item_id, r.quantity]),
  }));

  const stations = hideout.map(s => ({
    id: s.id, n: s.name, max: s.maxLevel,
    levels: Object.entries(s.levels).sort((a, b) => +a[0] - +b[0]).map(([l, d]) => ({
      l: +l, req: (d.requiredItems || []).map(r => [r.id, r.quantity]), crafts: d.crafts || [],
    })),
  }));

  const shop = Object.fromEntries(Object.entries(traders).map(([n, offers]) => [n, offers.map(o => [o.id, o.trader_price])]));

  // ---- ARC Raiders Wiki: sell prices, blueprint requirements, expedition/event projects ----
  const byName = Object.fromEntries(Object.entries(items).map(([k, v]) => [norm(v.n), k]));
  const wikiItems = await cargo('items', 'name,sellprice,stacksize');
  const wikiCraft = await cargo('crafting', 'resultItem,requireBlueprint');
  const wikiProjects = await cargo('projects', 'name,type,start,end');
  const wikiParts = await cargo('projectItems', 'projectName,projectPart,stage,context,itemName,qty');

  for (const w of wikiItems) {
    const id = byName[norm(w.name)];
    if (id && +w.sellprice > 0) items[id].wv = +w.sellprice; // the wiki leaves 0 on many quest items
  }
  for (const w of wikiCraft) {
    const id = byName[norm(w.resultItem)];
    if (id && w.requireBlueprint) items[id].bp = w.requireBlueprint;
  }

  // Requirement rows name the project ("Expedition 3", "Outpost"); the projects table only has
  // some of them ("Expedition"), so group by the rows and borrow dates where they match.
  const meta = Object.fromEntries(wikiProjects.map(p => [p.name, p]));
  const grouped = {};
  for (const r of wikiParts) {
    const stages = (grouped[r.projectName] ||= {});
    const key = `${+r.projectPart || 0}:${+r.stage || 0}`;
    const st = (stages[key] ||= { part: +r.projectPart || 0, stage: +r.stage || 0, req: [], rew: [] });
    st[r.context === 'require' ? 'req' : 'rew'].push([byName[norm(r.itemName)] || r.itemName, +r.qty || 0]);
  }
  const projects = Object.entries(grouped).map(([name, stages]) => {
    const p = meta[name] || meta[name.replace(/\s+\d+$/, '')] || {};
    return {
      n: name, type: p.type || 'Permanent', start: p.start || null, end: p.end || null,
      stages: Object.values(stages).sort((a, b) => a.part - b.part || a.stage - b.stage),
    };
  });

  // ---- price history: one snapshot per day ----
  let history = [];
  try { history = JSON.parse(await host('readFile', { name: 'price-history.json' }) || '[]'); } catch {}
  const buy = {};
  for (const [trader, offers] of Object.entries(shop)) {
    for (const [id, price] of offers) if (trader !== 'Celeste' && (!(id in buy) || price < buy[id])) buy[id] = price; // Celeste trades in seeds
  }
  const now = new Date();
  const snap = {
    d: now.toISOString().slice(0, 10),
    sell: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.wv || v.v]).filter(([, v]) => v)),
    buy,
  };
  history = history.filter(h => h.d !== snap.d).concat(snap);

  const guide = await buildGuide(getJson, cargo, wikiItems, byName, norm, log);

  const payload = { ver: DATA_VERSION, fetched: now.toISOString(), items, quests, stations, projects, traders: shop, history, guide };
  // Saving the cache is best-effort: if the data folder can't be written (read-only, disk full), the
  // app still opens with what it just downloaded and simply downloads again next time.
  for (const [name, value] of [['price-history.json', history], ['arc-data.json', payload]]) {
    try { await host('writeFile', { name, text: JSON.stringify(value) }); } catch (e) { log(`Couldn't save ${name}: ${e.message}`); }
  }
  log(`Loaded ${Object.keys(items).length} items`);
  return payload;
}

// ---------- "where to find it" guide data ----------
// Per map: how many of each plant, ARC enemy and container type MetaForge's community map has.
// From the wiki: each item's "Sources" section and pictures of what to look for, and every
// container with its picture, loot category and loot pool.
async function buildGuide(getJson, cargo, wikiItems, byName, norm, log) {
  const pretty = s => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  const maps = [];
  for (const [id, name] of MAPS) {
    log(`Reading ${name} map`);
    try {
      const markers = (await getJson(`${BASE}/maps/locations?map=${id}`)).markers || [];
      const agg = { id, name, nature: {}, arc: {}, containers: {} };
      for (const m of markers) {
        const bucket = m.category === 'nature' ? agg.nature : m.category === 'arc' ? agg.arc : m.category === 'containers' ? agg.containers : null;
        if (!bucket) continue;
        const key = m.category === 'containers' ? (m.name || pretty(m.subcategory)) : norm(m.subcategory);
        bucket[key] = (bucket[key] || 0) + 1;
      }
      maps.push(agg);
    } catch { /* a map that fails to load just won't show counts */ }
    await sleep(300);
  }

  // Wiki pages, 50 per request.
  const WIKI_API = 'https://arcraiders.wiki/w/api.php';
  async function pages(titles) {
    const out = {};
    for (let i = 0; i < titles.length; i += 50) {
      const qs = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: 2, redirects: 1, titles: titles.slice(i, i + 50).join('|') });
      for (const p of (await getJson(`${WIKI_API}?${qs}`)).query?.pages || []) if (p.revisions) out[p.title] = p.revisions[0].slots.main.content;
      log(`Reading wiki pages ${Math.min(i + 50, titles.length)}/${titles.length}`);
      await sleep(300);
    }
    return out;
  }
  // Wiki markup -> plain text: [[A|B]] -> B, {{Price|6|Assorted Seeds}} -> 6 Assorted Seeds, drop other templates.
  const plain = s => s.replace(/\[\[(?:File|Category):[^\]]*\]\]/gi, '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\{\{Price\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, '$1 $2').replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '').replace(/<[^>]+>/g, '').trim();
  const section = (txt, name) => { const m = txt.match(new RegExp(String.raw`==\s*${name}\s*==([\s\S]*?)(?=\n==[^=]|$)`, 'i')); return m ? m[1] : ''; };

  const itemTitles = wikiItems.map(w => w.name).filter(n => byName[norm(n)]);
  const itemPages = await pages(itemTitles);
  const sources = {};
  for (const [title, txt] of Object.entries(itemPages)) {
    const id = byName[norm(title)];
    if (!id) continue;
    const lines = section(txt, 'Sources').split('\n').filter(l => /^\*/.test(l))
      .map(l => ({ d: (l.match(/^\*+/)[0].length), t: plain(l.replace(/^\*+/, '')) })).filter(l => l.t && !/sourced from quests/i.test(l.t));
    // Drop headings like "Quests:" whose content was a template we can't expand (nothing nested under them).
    const kept = lines.filter((l, i) => !(/:\s*$/.test(l.t) && !(lines[i + 1]?.d > l.d)));
    // Pictures that show where/what to look for (not the infobox icon), with their section text.
    const look = [];
    for (const m of txt.matchAll(/==+\s*([^=\n]+?)\s*==+\n([\s\S]*?)(?=\n==|$)/g)) {
      const f = m[2].match(/\[\[File:([^|\]]+)(?:\|[^\]]*?)?(?:\|([^\]|]*))?\]\]/i);
      if (!f) continue;
      look.push({ title: m[1].trim(), file: f[1].trim(), caption: plain(f[2] || ''), text: plain(m[2]).split('\n').filter(Boolean)[0] || '' });
    }
    if (kept.length || look.length) sources[id] = { lines: kept.slice(0, 14), look: look.slice(0, 3) };
  }

  const containerTitles = [];
  for (let cont = ''; ;) {
    const qs = new URLSearchParams({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Containers', cmlimit: 500, format: 'json', ...(cont ? { cmcontinue: cont } : {}) });
    const d = await getJson(`${WIKI_API}?${qs}`);
    containerTitles.push(...d.query.categorymembers.filter(p => p.ns === 0 && p.title !== 'Containers').map(p => p.title));
    if (!d.continue) break;
    cont = d.continue.cmcontinue;
  }
  const containers = [];
  for (const [title, txt] of Object.entries(await pages(containerTitles))) {
    const field = k => (txt.match(new RegExp(String.raw`\|\s*${k}\s*=\s*([^\n|]*)`, 'i')) || [])[1]?.trim() || '';
    const loot = new Set();
    for (const m of section(txt, 'Loot').concat(txt.match(/\{\|[\s\S]*?Loot Pool[\s\S]*?\|\}/i)?.[0] || '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|name\d+\s*=\s*([^\n|]+)/g)) {
      const id = byName[norm(m[1] || m[2])];
      if (id) loot.add(id);
    }
    containers.push({ n: title, img: field('image'), loot: field('loot'), breach: /yes/i.test(field('breach')), items: [...loot] });
  }
  return { maps, sources, containers };
}
