"""Make a copy of a real arc-data.json where every text field the UI shows carries an HTML/script
payload, for tests\\chaos-xss.js. Usage: python -I tests\\poison.py <in arc-data.json> <out arc-data.json>"""
import json
import sys

PWN = '"\'><i data-pwn="1">x</i><img src=x onerror="window.__xss=1">'
d = json.load(open(sys.argv[1], encoding='utf-8'))
items = d['items']
for i, (k, v) in enumerate(items.items()):
    if i % 3 == 0:
        v['n'] = v['n'] + PWN
        v['d'] = PWN
        v['r'] = PWN          # rarity ends up in style="" attributes
        v['wb'] = PWN
        v['la'] = PWN
        v['db'] = [PWN] + v.get('db', [])
        v['sb'] = [[PWN, 5]] + v.get('sb', [])
        v['bp'] = PWN
# a hostile id, referenced from a recipe and the traders
items['x"><i data-pwn="1">'] = dict(next(iter(items.values())), n='hostile id')
next(iter(items.values()))['c'].append(['x"><i data-pwn="1">', 1])
d['traders'][PWN] = [[k, 99] for k in list(items)[:5]]
for q in d['quests'][:20]:
    q['n'] += PWN
    q['tr'] = PWN
for s in d['stations']:
    s['n'] += PWN
for p in d['projects']:
    p['n'] += PWN
g = d.get('guide', {})
for m in g.get('maps', []):
    m['name'] += PWN
    m['containers'][PWN] = 5
    m['nature'][PWN] = 5
for src in g.get('sources', {}).values():
    for line in src['lines']:
        line['t'] += PWN
    for look in src['look']:
        look.update(title=look['title'] + PWN, text=PWN, caption=PWN, file=look['file'] + PWN)
for c in g.get('containers', []):
    c.update(n=c['n'] + PWN, loot=PWN, img=PWN)
# Fresh timestamps, so the app doesn't refresh (and reload) clean data in the middle of the test.
from datetime import datetime, timezone
d['fetched'] = d['tradersAt'] = datetime.now(timezone.utc).isoformat()
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'))
print('poisoned', sys.argv[2])
