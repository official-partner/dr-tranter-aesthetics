# Every image must start and end on a line of the site grid (column start or column end), at every width.
# usage: media_rail.py <url> <widths>
import sys
from playwright.sync_api import sync_playwright
url, widths = sys.argv[1], [int(w) for w in sys.argv[2].split(',')]
JS = """() => { const g = document.querySelector('.site-grid'); const gs = getComputedStyle(g); const gr = g.getBoundingClientRect();
  const cols = gs.gridTemplateColumns.split(' ').filter(s => s.endsWith('px')).map(parseFloat); const gap = parseFloat(gs.columnGap);
  const starts = [], ends = []; let x = gr.left; cols.forEach(c => { starts.push(x); ends.push(x + c); x += c + gap; });
  return [...document.querySelectorAll('.media')].filter(m => m.getBoundingClientRect().width > 0 && getComputedStyle(m).visibility === 'visible')
    .map(m => { const r = m.getBoundingClientRect(); const s = starts.findIndex(v => Math.abs(v - r.left) < 1); const e = ends.findIndex(v => Math.abs(v - r.right) < 1);
      return [(m.dataset.figma || m.querySelector('img')?.getAttribute('src').split('/').pop()), s + 1, e + 1, cols.length]; }); }"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for w in widths:
        pg = br.new_page(viewport={'width': w, 'height': 900}); pg.goto(url); pg.wait_for_timeout(300)
        res = pg.evaluate(JS); off = [r for r in res if r[1] == 0 or r[2] == 0]
        print(f"{w:>5}px  images {len(res):>2}  hors grille {len(off)}  colonnes " + ' '.join(f"{r[1]}-{r[2]}" for r in res if r[1] and r[2]))
        for r in off: print('        hors grille', r)
        pg.close()
    br.close()
