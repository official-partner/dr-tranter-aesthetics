# Every image and the text of its own card (title, caption, date) must be separated by the same gap, at every width.
# A card is any container that is not the page grid (.site-grid): figure, li, item. Image and text side by side
# (no vertical stacking) are skipped; stacks straight in the page grid are listed apart as section gaps.
# usage: media_gap.py <url> <widths comma separated>
import sys
from playwright.sync_api import sync_playwright
url, widths = sys.argv[1], [int(w) for w in sys.argv[2].split(',')]
JS = """() => {
  const out = [];
  const isText = (el) => el && !el.classList.contains('media') && el.textContent.trim().length > 0;
  document.querySelectorAll('.media').forEach((m) => {
    const r = m.getBoundingClientRect();
    if (r.width === 0) return;
    const name = (m.dataset.figma || '') + ' ' + (m.querySelector('img')?.getAttribute('src') || '').split('/').pop();
    let n = m.nextElementSibling, p = m.previousElementSibling;
    // inside a card the text can be the next sibling; for a caption-first figure it is the previous one
    const card = !m.parentElement.classList.contains('site-grid');
    const over = (b) => b.left < r.right - 1 && b.right > r.left + 1;
    if (isText(n)) {
      const tr = n.getBoundingClientRect();
      if (over(tr) && tr.top >= r.bottom - 1) out.push({img: name, card, side: 'below', gap: tr.top - r.bottom, text: n.textContent.trim().slice(0, 24)});
    } else if (isText(p)) {
      const tr = p.getBoundingClientRect();
      if (over(tr) && tr.bottom <= r.top + 1) out.push({img: name, card, side: 'above', gap: r.top - tr.bottom, text: p.textContent.trim().slice(0, 24)});
    }
  });
  return out;
}"""
with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    for w in widths:
        pg = br.new_page(viewport={'width': w, 'height': 900})
        pg.goto(url); pg.wait_for_timeout(500); pg.evaluate('document.fonts.ready')
        res = pg.evaluate(JS)
        cards = [e for e in res if e['card']]; sec = [e for e in res if not e['card']]
        gaps = sorted({round(e['gap'], 1) for e in cards})
        print(f"{w:>5}px  cartes {len(cards):>2}  écarts image-texte {gaps}  |  empilements de section {sorted({round(e['gap'], 1) for e in sec})}")
        if len(gaps) > 1 or '-v' in sys.argv:
            for e in cards: print(f"        {e['gap']:6.1f} {e['side']:<5} {e['img'][:30]:<30} {e['text']}")
        pg.close()
    br.close()
