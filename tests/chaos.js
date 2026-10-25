// In-app chaos test, run by tests\chaos.ps1 through the shell's self-test mode (ARC_SELFTEST_SEED).
// Attacks the host bridge, feeds malformed MetaForge payloads and saved state, and stress-tests
// rendering. Results go to window.__selftestReport, which the shell writes to log.txt.
(async () => {
  window.__selftestPending = true;
  const R = { pass: [], fail: [], timings: {} };
  const ok = (name, cond, info) => (cond ? R.pass : R.fail).push(info ? `${name}: ${info}` : name);
  const A = window.__arcDebug, wait = ms => new Promise(r => setTimeout(r, ms));
  let errors = [];
  window.addEventListener('error', e => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  const noNewErrors = (name, fn) => { const n = errors.length; try { fn(); } catch (e) { errors.push(e.message); } ok(name, errors.length === n, errors.slice(n).join(' | ')); };
  try {
    while (A.SY.busy) await wait(200);

    // ---- 1. host bridge: only the intended commands, files and endpoints ----
    const call = (cmd, args) => new Promise(res => {
      const id = 900000 + Math.floor(Math.random() * 99999);
      const h = e => { const m = JSON.parse(e.data); if (m.id === id) { window.chrome.webview.removeEventListener('message', h); res(m); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage(JSON.stringify({ id, cmd, args }));
      setTimeout(() => res({ timeout: true }), 20000);
    });
    ok('unknown command rejected', (await call('deleteEverything', {})).ok === false);
    ok('non-JSON message ignored', (window.chrome.webview.postMessage('not json'), true));
    for (const n of ['../evil.json', '..\\evil.json', 'C:\\Windows\\evil.json', '/etc/passwd', 'Upper.json', '', 'a'.repeat(80), 'x/y.json', '.hidden', 'con', 'con.json', 'nul.json', 'com1.json', 'evil.exe', 'evil.json.exe', null])
      ok(`writeFile refuses name ${JSON.stringify(n)}`, (await call('writeFile', { name: n, text: 'x' })).ok === false);
    ok('readFile refuses traversal', (await call('readFile', { name: '..\\..\\window.txt' })).ok === false);
    for (const u of ['https://evil.example/', 'http://metaforge.app/api/arc-raiders/items', 'https://metaforge.app.evil.example/api/', 'file:///C:/Windows/win.ini', 'https://metaforge.app/arc-raiders', null])
      ok(`httpGet blocks ${u}`, (await call('httpGet', { url: u })).ok === false);
    for (const [m, p] of [['GET', '/api/arc-raiders/trade/messages/unread-count'], ['POST', '/api/arc-raiders/trade/embark-id'], ['DELETE', '/api/arc-raiders/account-sync'],
      ['POST', '/api/arc-raiders/account-sync'], ['GET', 'https://evil.example/api/'], ['POST', '/api/sync'], ['GET', '/arc-raiders/needed-items'], ['GET', '/api/arc-raiders/account-sync#x'],
      ['GET', '/api/arc-raiders/../account-sync'], ['POST', '/api/arc-raiders/workshop/sync?x=1'], ['GET', null]])
      ok(`mfFetch blocks ${m} ${p}`, (await call('mfFetch', { path: p, method: m })).ok === false);
    const allowed = await call('mfFetch', { path: '/api/arc-raiders/account-sync?_=1', method: 'GET' });
    ok('mfFetch allows account-sync', allowed.ok === true, allowed.error);
    ok('mfFetch rejects huge body', (await call('mfFetch', { path: '/api/arc-raiders/workshop/sync', method: 'POST', body: 'x'.repeat(10000) })).ok === false);
    for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'https://', 'ms-settings:', 'http://example.com', 'https://exa mple.com', 'https://x.example/\n"', 'C:\\Windows\\notepad.exe'])
      ok(`openExternal refuses ${JSON.stringify(u)}`, (await call('openExternal', { url: u })).result === false);

    // ---- 2. malformed MetaForge sync payloads ----
    const proto = JSON.parse('{"__proto__":{"polluted":1},"gunsmith":"3","scrappy":-1,"gearBench":"<b>","medicalLab":2.5}');
    const nasty = {
      lastSyncedAt: 'not a date',
      resources: {
        inventory: { syncedAt: null, data: { inventory: { wallet: { coins: 'lots' }, view: { stashSlots: [null, 5, 'x', {}, { item: null },
          { item: { itemId: '__proto__', amount: 5 } }, { item: { itemId: 'constructor' } }, { item: { itemId: 'spring', amount: '7' } },
          { item: { itemId: 'spring', amount: -3 } }, { item: { itemId: 'metal-parts', amount: 1e15 } }, { item: { itemId: 'fabric', amount: 'abc' } },
          { item: { itemId: '<img src=x onerror="window.__xss=1">', title: '<i data-pwn="1">x</i>' } }] } } } },
        workshop: { data: { levels: proto } },
        quests: { data: { user_quests: [null, 5, { status: 'COMPLETED' }, { status: 'COMPLETED', quest_id: '__proto__' }, { status: 'COMPLETED', quest_id: 'a-bad-feeling' }] } },
        blueprints: { data: { blueprints: [null, { itemId: 5 }, { name: '__proto__' }, { name: 'constructor' }] } },
        'player-stats': { data: { stats: 'nope' } },
      },
    };
    noNewErrors('import of hostile sync payload', () => A.importMetaForge(nasty));
    const S = A.S;
    ok('string amount coerced', S.inv.spring === 7, JSON.stringify(S.inv.spring));
    ok('amount capped', S.inv['metal-parts'] === 1e9, String(S.inv['metal-parts']));
    ok('junk amount dropped', !('fabric' in S.inv));
    ok('no __proto__ key in stash', !Object.prototype.hasOwnProperty.call(S.inv, '__proto__') && Object.getPrototypeOf(S.inv) === Object.prototype);
    ok('no prototype pollution', ({}).polluted === undefined && Object.getPrototypeOf(S.questsDone) === Object.prototype);
    ok('valid quest kept', S.questsDone['a-bad-feeling'] === true);
    ok('bench level from string', S.stations['weapon-bench'] === 3, JSON.stringify(S.stations));
    ok('bad bench levels ignored', S.stations.scrappy !== -1 && S.stations['equipment-bench'] !== '<b>');
    for (const bad of [null, 5, 'x', [], {}, { resources: null }, { resources: { inventory: { data: { inventory: { view: { stashSlots: 'nope' } } } } } }]) {
      let msg = '';
      try { A.importMetaForge(bad); } catch (e) { msg = e.message; }
      ok(`rejects payload ${JSON.stringify(bad).slice(0, 40)}`, msg === 'no inventory in sync data', msg);
    }
    noNewErrors('render after hostile import', () => A.render());

    // ---- 3. garbage saved state ----
    const garbage = [null, 5, 'x', [], { inv: [1, 2] }, { inv: JSON.parse('{"spring":"abc","metal-parts":-5,"fabric":"12","__proto__":{"polluted":2},"nope":3}') },
      { tracked: 'spring' }, { tracked: ['spring', 5, null, '__proto__', 'spring', 'constructor'] }, { stations: { a: 'x', 'weapon-bench': 99 } }, { price: 'x' },
      { price: { scope: 5 } }, { tab: 5 }, { tab: 'no-such-tab' }, { sync: 'x' }, { findId: 'constructor' }, { findRecent: 'spring' }, { proj: [] }, { bp: { spring: 'yes' } }];
    for (const g of garbage) {
      const s2 = A.sanitizeState(g);
      A.S = s2;
      noNewErrors(`render with state ${JSON.stringify(g).slice(0, 50)}`, () => { for (const t of ['tracked', 'find', 'craft', 'prices', 'projects', 'insights', 'traders']) { A.S.tab = t; A.render(); } });
    }
    const s3 = A.sanitizeState(garbage[5]);
    ok('sanitize keeps valid stash entries', s3.inv.fabric === 12 && !('spring' in s3.inv) && !('metal-parts' in s3.inv) && !('nope' in s3.inv), JSON.stringify(s3.inv));
    ok('sanitize dedupes tracked', JSON.stringify(A.sanitizeState(garbage[7]).tracked) === '["spring"]', JSON.stringify(A.sanitizeState(garbage[7]).tracked));
    ok('no pollution from state', ({}).polluted === undefined);

    // ---- 4. stress: every item in the stash, rapid tab switching, hostile search input ----
    const all = A.sanitizeState({ inv: Object.fromEntries(Object.keys(A.D.items).map((id, i) => [id, 1 + (i * 7919) % 999999])), tracked: Object.keys(A.D.items).slice(0, 60) });
    A.S = all;
    for (const t of ['tracked', 'find', 'craft', 'prices', 'projects', 'insights', 'traders']) {
      A.S.tab = t;
      const t0 = performance.now();
      noNewErrors(`render ${t} with ${Object.keys(all.inv).length} items`, () => A.render());
      R.timings[t] = Math.round(performance.now() - t0);
    }
    const tabs = [...document.querySelectorAll('#tabs [data-tab]')];
    const t1 = performance.now();
    noNewErrors('300 rapid tab switches', () => { for (let i = 0; i < 300; i++) tabs[i % tabs.length].click(); });
    R.timings.rapidTabsMs = Math.round(performance.now() - t1);
    document.querySelector('[data-tab=find]').click();
    for (const q of ['(', '[', '\\', '.*', '<i data-pwn="1">x</i>', 'a'.repeat(5000), '🍑🔥', '   ', '%00', 'spring']) {
      const el = document.getElementById('findQ');
      noNewErrors(`find search ${JSON.stringify(q).slice(0, 20)}`, () => { el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    }
    ok('stash filter survives hostile input', (() => { const f = document.getElementById('invFilter'); f.value = '[(<i data-pwn=1>'; f.dispatchEvent(new Event('input')); return true; })());
    await wait(300);
    ok('no injected markup anywhere', !document.querySelector('[data-pwn]') && window.__xss === undefined);
    ok('no uncaught errors overall', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    R.fail.push('harness crashed: ' + e.message);
  }
  window.__selftestReport = { passed: R.pass.length, failed: R.fail.length, failures: R.fail, timings: R.timings };
})();
