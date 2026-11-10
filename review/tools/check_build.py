# Automatic check of an op-astro project (the rules of the Tranter method). usage: check_build.py <project root>
import re, sys, os, glob, collections
root = sys.argv[1]
fails, notes = [], []
def css_blocks(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    out, stack, buf = [], [], ''
    for ch in text:
        if ch == '{':
            sel = buf.strip()
            if ';' in sel:
                parts = sel.split(';'); sel = parts[-1].strip()
                if stack: stack[-1][1].extend(p.strip() for p in parts[:-1] if p.strip())
            stack.append([sel, []]); buf = ''
        elif ch == '}':
            rest = [p.strip() for p in buf.split(';') if p.strip()]
            if stack:
                sel, decls = stack.pop(); decls.extend(rest)
                path = ' > '.join([s[0] for s in stack] + [sel])
                out.append((path, [d for d in decls if ':' in d]))
            buf = ''
        else:
            buf += ch
    return out
def styles_of(path):
    t = open(path, encoding='utf-8').read()
    return t if path.endswith('.css') else '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', t, re.S))
# 1 pages carry no CSS
for p in glob.glob(os.path.join(root, 'src/pages/**/*.astro'), recursive=True):
    t = open(p, encoding='utf-8').read()
    if re.search(r'<style', t) or re.search(r'\sstyle=', t):
        fails.append(f'page with CSS: {os.path.relpath(p, root)}')
# component and project files written for this site (the starter library is checked by its own rules)
own = [os.path.join(root, f) for f in ['src/styles/project.css']] + glob.glob(os.path.join(root, 'src/components/section/*.astro')) + glob.glob(os.path.join(root, 'src/components/content/*.astro')) + [os.path.join(root, 'src/components/global/Nav.astro'), os.path.join(root, 'src/components/global/Footer.astro'), os.path.join(root, 'src/components/Button.astro')]
own = [f for f in own if os.path.exists(f) and not f.endswith('CardTeam.astro')]
TYPO = {'font-size', 'line-height', 'letter-spacing', 'font-family', 'font-variation-settings', 'text-transform'}
blocks = []
for f in own:
    for path, decls in css_blocks(styles_of(f)):
        rel = os.path.relpath(f, root)
        props = {d.split(':', 1)[0].strip() for d in decls}
        # 2 no text style outside the text-style rules
        if len(props & TYPO) >= 2:
            fails.append(f'text style redefined: {rel} | {path} | {sorted(props & TYPO)}')
        for d in decls:
            k, v = [x.strip() for x in d.split(':', 1)]
            # 3 no column number outside the rails (spans are widths, allowed)
            if k in ('grid-column', 'grid-column-start', 'grid-column-end'):
                if re.search(r'(?<!span )(?<![\w-])-?\d+(?![\w.-]*\))', v) and 'span' not in v.split('/')[0]:
                    fails.append(f'column number: {rel} | {path} | {d}')
            # 6 no raw px or hex
            if re.search(r'#[0-9a-fA-F]{3,8}\b', v) or re.search(r'\d(\.\d+)?px\b', v):
                fails.append(f'raw value: {rel} | {path} | {d}')
        if decls:
            blocks.append((rel, path, frozenset(d.replace(' ', '') for d in decls)))
# 4 identical blocks and near copies (80 % or more of declarations shared, 3 declarations or more)
for i in range(len(blocks)):
    for j in range(i + 1, len(blocks)):
        a, b = blocks[i][2], blocks[j][2]
        if len(a) < 3 or len(b) < 3: continue
        if a == b:
            fails.append(f'identical blocks: {blocks[i][0]} {blocks[i][1]}  =  {blocks[j][0]} {blocks[j][1]}')
        else:
            share = len(a & b) / max(len(a), len(b))
            if share >= 0.8:
                fails.append(f'near copy ({share:.0%}): {blocks[i][0]} {blocks[i][1]}  ~  {blocks[j][0]} {blocks[j][1]}')
# 5 each project global class used three times or more in the markup
proj = open(os.path.join(root, 'src/styles/project.css'), encoding='utf-8').read()
globals_ = sorted(set(re.findall(r'^\.([a-z][\w-]*)\s*\{', proj, re.M)))
markup = ''
for f in glob.glob(os.path.join(root, 'src/**/*.astro'), recursive=True):
    markup += open(f, encoding='utf-8').read()
for g in globals_:
    n = len(re.findall(r'class(?::list)?=\{?["\'\[][^>]*?\b' + re.escape(g) + r'\b', markup))
    notes.append(f'global class {g}: {n} uses')
    if n < 3:
        fails.append(f'global class used fewer than 3 times: {g} ({n})')
print('\n'.join(notes))
print(f'\nCHECK: {len(fails)} failure(s)')
print('\n'.join('  ' + x for x in fails))
