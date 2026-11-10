# Every page grid must sit exactly on the site grid at every width: left = margin, width = viewport - 2 margins (capped).
# usage: grid_check.py <url> <widths comma separated>
import sys
from playwright.sync_api import sync_playwright
url, widths = sys.argv[1], [int(w) for w in sys.argv[2].split(',')]
JS = r"""() => {
  const probe = (v) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;visibility:hidden;width:' + v; document.body.appendChild(d); const w = d.getBoundingClientRect().width; d.remove(); return w; };
  const m = probe('var(--site-margin)'), maxw = probe('var(--max-width-main)'), vw = document.documentElement.clientWidth;
  const w = Math.min(vw - 2 * m, maxw), left = (vw - w) / 2;
  const bad = [];
  document.querySelectorAll('.site-grid:not(.review-grid)').forEach(g => {
    if (g.parentElement.closest('.site-grid')) return;
    const r = g.getBoundingClientRect();
    if (Math.abs(r.left - left) > 0.5 || Math.abs(r.width - w) > 0.5) bad.push((g.className.split(' ')[0]) + ' left ' + r.left.toFixed(1) + ' (attendu ' + left.toFixed(1) + ') largeur ' + r.width.toFixed(1) + ' (attendu ' + w.toFixed(1) + ')');
  });
  return { n: document.querySelectorAll('.site-grid:not(.review-grid)').length, bad };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for w in widths:
        pg = b.new_page(viewport={'width': w, 'height': 900}); pg.goto(url); pg.wait_for_timeout(300)
        r = pg.evaluate(JS)
        print(f"{w:5d}px  grilles {r['n']}  hors grille {len(r['bad'])}" + ''.join('\n        ' + x for x in r['bad']))
        pg.close()
    b.close()
