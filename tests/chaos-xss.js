// XSS check, run by tests\chaos.ps1 against a cache poisoned by tests\poison.py: every screen,
// hover card, Find page and the sync window must render the payloads as text, never as markup.
(async () => {
  window.__selftestPending = true;
  const A = window.__arcDebug, wait = ms => new Promise(r => setTimeout(r, ms));
  const fail = [], pass = [];
  const check = where => { const pwn = document.querySelector('[data-pwn]'); (pwn || window.__xss ? fail : pass).push(where + (pwn ? ': ' + pwn.outerHTML.slice(0, 80) : '')); };
  try {
    while (A.SY.busy) await wait(200);
    const ids = Object.keys(A.D.items);
    A.S = A.sanitizeState({ inv: Object.fromEntries(ids.slice(0, 120).map(id => [id, 3])), tracked: ids.slice(0, 30) });
    for (const t of ['tracked', 'find', 'craft', 'prices', 'projects', 'insights', 'traders']) {
      A.S.tab = t; A.render(); await wait(50); check('tab ' + t);
      document.querySelectorAll('details').forEach(d => { d.open = true; });
      await wait(50); check('tab ' + t + ' (all sections open)');
    }
    for (const id of ids.slice(0, 40)) {
      A.S.tab = 'find'; A.S.findId = id; A.render(); await wait(10);
      check('find ' + id.slice(0, 20));
    }
    for (const el of [...document.querySelectorAll('[data-tip]')].slice(0, 40)) {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await wait(120);
      check('hover ' + el.dataset.tip.slice(0, 20));
    }
    A.openSync(); await wait(200); check('sync window');
    A.importMetaForge({ resources: { inventory: { data: { inventory: { view: { stashSlots: [{ item: { itemId: 'nope', title: '<i data-pwn="1">x</i>' } }] } } } } } });
    A.openSync(); await wait(200); check('sync window with hostile unknown item');
  } catch (e) { fail.push('harness crashed: ' + e.message); }
  window.__selftestReport = { passed: pass.length, failed: fail.length, failures: fail.slice(0, 20) };
})();
