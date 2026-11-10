# Between 1024 and the reference width the design scales as one piece: every element's left edge must be
# its 1728 position times width / 1728. Anything else has left its rail. usage: rail_check.py <url> <widths>
import sys
from playwright.sync_api import sync_playwright
url, widths = sys.argv[1], [int(w) for w in sys.argv[2].split(',')]
JS = r"""() => { const o = {}; document.querySelectorAll('[data-figma]').forEach((el, i) => { if (getComputedStyle(el).visibility === 'hidden') return;
  const r = el.getBoundingClientRect(); const pad = el.classList.contains('inset-optical') ? parseFloat(getComputedStyle(el).paddingLeft) : 0;
  o[el.dataset.figma + '#' + i] = { x: r.left + pad, right: r.right, txt: (el.textContent || '').trim().slice(0, 30) }; }); return { o, vw: document.documentElement.clientWidth }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg = b.new_page(viewport={'width': 1728, 'height': 900}); pg.goto(url); pg.wait_for_timeout(400); pg.evaluate('document.fonts.ready')
    ref = pg.evaluate(JS); pg.close()
    for w in widths:
        pg = b.new_page(viewport={'width': w, 'height': 900}); pg.goto(url); pg.wait_for_timeout(400); pg.evaluate('document.fonts.ready')
        cur = pg.evaluate(JS); pg.close()
        k = cur['vw'] / ref['vw']; off = []
        for key, e in ref['o'].items():
            c = cur['o'].get(key)
            if not c: continue
            dl = c['x'] - e['x'] * k; dr = c['right'] - e['right'] * k
            if abs(dl) > 1 and abs(dr) > 1:
                off.append(f"{key.split('#')[0]:>6} {e['txt'][:26]:<26} gauche {c['x']:7.1f} attendu {e['x']*k:7.1f} ({dl:+.1f})")
        print(f"{w:5d}px  éléments {len(ref['o'])}  hors proportion {len(off)}" + ''.join('\n        ' + x for x in off[:20]))
    b.close()
