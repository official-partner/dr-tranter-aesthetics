# Compare every text element's computed type with its Figma style: family (SERF axis), weight, size, line height,
# letter spacing, case and OpenType features. Team decisions (data/type-decisions.json) replace the Figma value and
# are counted apart. usage: type_check.py <url> <figma.json>
import json, re, sys
from playwright.sync_api import sync_playwright
url, fj = sys.argv[1], sys.argv[2]
d = json.load(open(fj)); keys = d['keys']
AX = {'Sans': 0, 'Mix': 50, 'Serif': 100}; WT = {'Regular': None, 'Medium': 550, 'SemiBold': 670}
def expect(k):
    fam, size, lh, ls, *rest = keys[k].split('|') + ['']
    f, w = fam.split(' ', 1)
    weight = {'Sans Regular': 400, 'Sans Medium': 550, 'Mix Regular': 420, 'Mix SemiBold': 670, 'Serif Regular': 470}.get(fam)
    S = float(size); L = float(lh[:-2]) if lh.endswith('px') else float(lh[:-1]) / 100 * S
    LS = float(ls[:-2]) if ls.endswith('px') else float(ls[:-1]) / 100 * S if ls.endswith('%') else 0
    x = dict(axis=AX.get(f), weight=weight, size=S, lh=L, ls=LS, upper='UPPER' in keys[k], why=None)
    for dec in DEC:
        if keys[k].startswith(dec['figma']): x.update(dec['set']); x['why'] = dec['why']
    return x
import os
DEC = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'type-decisions.json')))['decisions']
fig = {}
for r in d['T']:
    m = re.findall(r'(\d+)-(\d+):(k\d+)', r[7])
    k = m[0][2] if m else (re.search(r'k\d+', r[7]).group(0) if re.search(r'k\d+', r[7]) else None)
    if k and k in keys and not keys[k].startswith('Mix Regular|27') and 'Sans Regular|14.69' not in keys[k]:
        fig[r[0]] = (expect(k), (r[8] or '')[:28].replace('\n', ' '))
JS = r"""() => [...document.querySelectorAll('[data-figma]')].map(el => { const t = el.querySelector('.button_text') || el; const cs = getComputedStyle(t);
  return { id: el.dataset.figma, fvs: cs.fontVariationSettings, w: cs.fontWeight, fs: parseFloat(cs.fontSize), lh: cs.lineHeight, ls: cs.letterSpacing, tt: cs.textTransform, ff: cs.fontFeatureSettings, fam: cs.fontFamily.split(',')[0] }; })"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome'); pg = b.new_page(viewport={'width': 1728, 'height': 900})
    pg.goto(url); pg.wait_for_timeout(500); pg.evaluate('document.fonts.ready'); res = pg.evaluate(JS); b.close()
bad = 0; n = 0; decided = {}
for e in res:
    if e['id'] not in fig: continue
    x, label = fig[e['id']]; n += 1
    if x['why']: decided[x['why']] = decided.get(x['why'], 0) + 1
    axis = re.search(r'"SERF" ([\d.]+)', e['fvs']); axis = float(axis.group(1)) if axis else None
    lh = float(e['lh'][:-2]) if e['lh'].endswith('px') else None
    ls = float(e['ls'][:-2]) if e['ls'].endswith('px') else 0.0
    issues = []
    if axis != x['axis']: issues.append(f"axe {axis} au lieu de {x['axis']}")
    if x['weight'] and abs(float(e['w']) - x['weight']) > 1: issues.append(f"graisse {e['w']} au lieu de {x['weight']}")
    if abs(e['fs'] - x['size']) > 0.5: issues.append(f"taille {e['fs']} au lieu de {x['size']:g}")
    if lh and abs(lh - x['lh']) > 0.5: issues.append(f"interligne {lh:.2f} au lieu de {x['lh']:.2f}")
    if abs(ls - x['ls']) > 0.1: issues.append(f"approche {ls:.2f} au lieu de {x['ls']:.2f}")
    if (e['tt'] == 'uppercase') != x['upper']: issues.append(f"casse {e['tt']}")
    if e['ff'] != 'normal': issues.append(f"options {e['ff']} (absentes du Figma)")
    if issues:
        bad += 1; print(f"{e['id']:>6} {label:<28} " + ' ; '.join(issues))
print(f'\n{n} textes comparés, {bad} avec au moins un écart')
for why, c in decided.items(): print(f'  décision appliquée à {c} textes : {why}')
