# Measure the build against the Figma, element by element, section-relative, at 1728.
# usage: measure_build.py <url> <figma.json> [--hover "selector"] [--only band] [--shot out.png]
import json, re, sys
from playwright.sync_api import sync_playwright
url, fj = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
hover, only, shot, width = opt('--hover'), opt('--only'), opt('--shot'), int(opt('--width', 1728))
# the window's height: the home's opening fills the screen (100svh), so measure it in a window as tall as the Figma's band (928)
height = int(opt('--height', 1000))
target = json.load(open(opt('--target'))) if opt('--target') else {}
d = json.load(open(fj)); keys = d['keys']
def style(k):
    s = keys[k].split('|'); S = float(s[1]); lh = s[2]
    return s[0], S, (float(lh[:-2]) if lh.endswith('px') else float(lh[:-1]) / 100 * S)
fig = {}
for r in d['T']:
    m = re.search(r'k\d+', r[7])
    if not m: continue
    fam, S, L = style(m.group(0))
    fig[r[0]] = dict(kind='T', x=r[1], top=r[2] + L / 2 - 0.3605 * S, size=S, w=r[3], label=(r[8] or '')[:28].replace('\n', ' '))
for r in d['S']:
    fig[r[0]] = dict(kind='S', x=r[3], top=r[4], w=r[5], h=r[6], label=r[2][:28])
JS = """() => {
  const out = [];
  document.querySelectorAll('[data-figma]').forEach(el => {
    const band = el.closest('[data-figma-band]');
    const r = el.getBoundingClientRect(); const b = band ? band.getBoundingClientRect() : {top: 0};
    const cs = getComputedStyle(el);
    const txt = el.querySelector('.button_text');
    const capOff = parseFloat(el.dataset.capOffset || '0') * parseFloat(cs.fontSize);
    const padL = parseFloat(cs.paddingLeft) || 0;
    out.push({id: el.dataset.figma, band: band ? band.dataset.figmaBand : '?', btop: band ? parseFloat(band.dataset.bandTop || '0') : 0,
      x: r.left + (el.classList.contains('inset-optical') ? padL : 0), top: r.top - b.top + capOff, w: r.width, h: r.height, fs: parseFloat(getComputedStyle(txt || el).fontSize), bottom: r.bottom - b.top, vis: cs.visibility,
      bandH: band ? band.getBoundingClientRect().height : 0});
  });
  return out;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg = br.new_page(viewport={'width': width, 'height': height})
    pg.goto(url); pg.wait_for_timeout(600); pg.evaluate('document.fonts.ready')
    pg.evaluate("document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager')")
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(500); pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(300)
    if hover:
        pg.hover(hover); pg.wait_for_timeout(100)
    if shot:
        pg.screenshot(path=shot, full_page=True)
    res = pg.evaluate(JS)
    bands = pg.evaluate("""() => [...document.querySelectorAll('[data-figma-band]')].map(b => [b.dataset.figmaBand, b.getBoundingClientRect().top + scrollY, b.getBoundingClientRect().height])""")
    br.close()
# local check: for each element, the vertical gap from the nearest element above it that overlaps it horizontally
fx = {}
for e in res:
    f = fig.get(e['id'])
    if not f or e['vis'] != 'visible': continue
    fx.setdefault(e['band'], []).append((e, f))
local = {}
for band, items in fx.items():
    for e, f in items:
        best = None
        for e2, f2 in items:
            if e2 is e: continue
            fw = f.get('w', 50); fw2 = f2.get('w', 50)
            if f2['x'] > f['x'] + fw - 4 or f2['x'] + fw2 < f['x'] + 4: continue
            if f2['top'] >= f['top'] - 1: continue
            if best is None or f2['top'] > best[1]['top']: best = (e2, f2)
        if best:
            e2, f2 = best
            local[(band, e['id'])] = (e['top'] - e2['top']) - (f['top'] - f2['top']), e2['id']
print('bands (build top, height):', [(b[0], round(b[1], 1), round(b[2], 1)) for b in bands])
STATS = []
cur = None
for e in res:
    if only and e['band'] != only: continue
    f = fig.get(e['id'])
    if not f: continue
    if e['band'] != cur:
        cur = e['band']; print(f"\n== {cur}  (build band h {e['bandH']:.1f})")
    ftop = f['top'] - e['btop']
    dx = e['x'] - f['x']; dy = e['top'] - ftop
    t = target.get(e['id'], {})
    ex, ey = t.get('d', [0, 0])
    if 'abs' in t: ex, ey = t['abs'][0] - f['x'], t['abs'][1] - ftop
    if 'abs_x' in t: ex = t['abs_x'] - f['x']
    rx, ry = dx - ex, dy - ey
    flag = '  ' if abs(rx) <= 2 and abs(ry) <= 2 else '!!'
    if target: STATS.append((e['id'], rx, ry, abs(dx) <= 2 and abs(dy) <= 2, e['vis'] == 'visible'))
    extra = ''
    if f['kind'] == 'S':
        extra = f" w {e['w']:.1f}/{f['w']:.1f} h {e['h']:.1f}/{f['h']:.1f}"
    else:
        extra = f" fs {e['fs']:.2f}/{f['size']:g}"
    hid = '' if e['vis'] == 'visible' else ' (hidden)'
    lc = local.get((e['band'], e['id']))
    if lc: extra += f"  local {lc[0]:+5.1f} vs {lc[1]}" 
    print(f"{flag} {e['id']:>6} {f['label'][:26]:<26} x {e['x']:7.1f}/{f['x']:7.1f} ({dx:+6.1f})  top {e['top']:7.1f}/{ftop:7.1f} ({dy:+6.1f}){extra}{hid}")

if target:
    vis = [s_ for s_ in STATS if s_[4]]
    raw_ok = sum(1 for s_ in vis if s_[3]); tgt_ok = sum(1 for s_ in vis if abs(s_[1]) <= 2 and abs(s_[2]) <= 2)
    print(f"\nSUMMARY visible elements {len(vis)} | within 2 px of raw Figma {raw_ok} | within 2 px of target {tgt_ok}")
    for s_ in vis:
        if not (abs(s_[1]) <= 2 and abs(s_[2]) <= 2): print('  off target:', s_[0], round(s_[1], 1), round(s_[2], 1))
