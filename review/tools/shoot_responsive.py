# Full-page captures at desktop, tablet and phone, and a side-by-side sheet per page, cut in readable chunks.
# usage: shoot_responsive.py <out dir> [widths]
import sys, os
from playwright.sync_api import sync_playwright
from PIL import Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
widths = [int(w) for w in (sys.argv[2] if len(sys.argv) > 2 else '1728,820,390').split(',')]
pages = (('home', '/'), ('melasma', '/concerns/melasma/'))
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for name, url in pages:
        for w in widths:
            pg = br.new_page(viewport={'width': w, 'height': 900})
            pg.goto('http://127.0.0.1:4802' + url); pg.wait_for_timeout(400); pg.evaluate('document.fonts.ready')
            pg.evaluate("document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager')")
            pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(500); pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200)
            pg.screenshot(path=f'{out}/{name}-{w}.png', full_page=True); pg.close()
    br.close()
for name, _ in pages:
    ims = [Image.open(f'{out}/{name}-{w}.png') for w in widths]
    tw = {1728: 600, 820: 410, 390: 260}
    sc = [im.resize((tw.get(im.width, 400), int(im.height * tw.get(im.width, 400) / im.width))) for im in ims]
    H = max(s.height for s in sc); W = sum(s.width for s in sc) + 20 * (len(sc) - 1)
    sheet = Image.new('RGB', (W, H), 'white'); x = 0
    for s in sc: sheet.paste(s, (x, 0)); x += s.width + 20
    for i in range((H + 1599) // 1600):
        sheet.crop((0, i * 1600, W, min(H, (i + 1) * 1600))).save(f'{out}/sheet-{name}-{i}.png')
    print(name, H)
