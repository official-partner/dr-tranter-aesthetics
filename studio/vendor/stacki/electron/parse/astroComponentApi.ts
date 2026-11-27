
import type { RenderTag } from './astroParserTypes';
import { VOID_ELEMENTS, required } from './astroAttrs';
import { skipStringOrComment } from './astroScan';
import { frontmatterOf } from './astroFence';

function slotApiUses(source: string): { slot: string; varName: string | undefined }[] {
  const text = withoutComments(source);
  const uses = [];
  const re = /Astro\s*\.\s*slots\b(\s*\.\s*(?:render|has)\s*\()?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let depth = 1;
    let name = undefined;
    for (let i = match.index + match[0].length; i < text.length; i++) {
      const character = text.charAt(i);
      if (character === '"' || character === "'" || character === '`') {
        const close = text.indexOf(character, i + 1);
        const quoted = text.slice(i + 1, close === -1 ? text.length : close);
        if (name === undefined && /^[\w-]*$/.test(quoted)) {
          name = quoted;
        }
        if (close === -1) {
          break;
        }
        i = close;
        continue;
      }
      if (character === '(' || character === '[' || character === '{') {
        depth++;
      } else if (character === ')' || character === ']' || character === '}') {
        depth--;
        if (depth === 0) {
          break;
        }
      } else if (depth === 1 && character === ';') {
        break;
      }
    }
    const decl = text.slice(0, match.index).match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[^;\n]*$/);
    uses.push({
      slot: name || 'default',
      varName: decl ? required(decl[1], 'Slot variable capture') : undefined,
    });
  }
  return uses;
}

function withoutComments(source: string): string {
  const fm = frontmatterOf(source);
  const chars = [...source];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] !== '\n') {
        chars[i] = ' ';
      }
    }
  };
  const end = fm ? fm.length : 0;
  for (let i = 0; i < end; i++) {
    const skipped = skipStringOrComment(source, i);
    if (skipped === i) {
      continue;
    }
    if (source[i] === '/') {
      blank(i, skipped);
    }
    i = skipped - 1;
  }
  for (const comment of source.matchAll(/<!--[\s\S]*?-->/g)) {
    blank(comment.index, comment.index + comment[0].length);
  }
  return chars.join('');
}

export function parseSlots(source: string): string[] {
  const fm = frontmatterOf(source);
  const body = fm ? source.slice(fm.length) : source;
  const found = new Set<string>();
  const re = /<slot\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*?)\/?>/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const nameMatch = required(match[1], 'Slot attributes capture').match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    found.add(nameMatch ? required(nameMatch[1] ?? nameMatch[2], 'Slot name capture') : 'default');
  }
  for (const use of slotApiUses(source)) {
    found.add(use.slot);
  }
  const named = [...found].filter((slot) => slot !== 'default');
  return found.has('default') ? ['default', ...named] : named;
}

const TEXT_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'button',
  'caption',
  'cite',
  'code',
  'dd',
  'dt',
  'em',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'label',
  'legend',
  'li',
  'option',
  'p',
  'q',
  'small',
  'span',
  'strong',
  'summary',
  'td',
  'th',
  'title',
]);

function dynamicTagLiterals(frontmatter: string, name: string): string[] {
  const alias = destructuredTag(frontmatter, name);
  if (alias) {
    return [alias.tag];
  }
  const decl = frontmatter.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`));
  if (!decl) {
    return [];
  }
  const literals = [...required(decl[1], 'Dynamic tag expression capture').matchAll(/["'`]([A-Za-z][\w-]*)["'`]/g)].map((match) =>
    required(match[1], 'Tag literal capture'),
  );
  if (literals.length) {
    return literals;
  }
  const ident = required(decl[1], 'Dynamic tag expression capture')
    .trim()
    .match(/^([A-Za-z_$][\w$]*)$/);
  if (!ident) {
    return [];
  }
  const viaDefault = frontmatter.match(new RegExp(`\\b${ident[1]}\\s*=\\s*["'\`]([A-Za-z][\\w-]*)["'\`]`));
  return viaDefault ? [required(viaDefault[1], 'Dynamic tag default capture')] : [];
}

function destructuredTag(frontmatter: string, name: string): { prop: string; tag: string } | undefined {
  const declarations = frontmatter.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*Astro\.props\b/g);
  for (const declaration of declarations) {
    const match = declaration[1]?.match(new RegExp(`(?:^|,)\\s*([A-Za-z_$][\\w$]*)\\s*:\\s*${name}\\s*=\\s*["']([A-Za-z][\\w-]*)["']`));
    if (match?.[1] && match[2]) {
      return { prop: match[1], tag: match[2].toLowerCase() };
    }
  }
  return undefined;
}

export function rendersHtml(source: string): boolean {
  const fm = frontmatterOf(source);
  const body = withoutComments(source).slice(fm ? fm.length : 0);
  return /\sset:html\s*=\s*\{/.test(body);
}

export function htmlPropsOf(source: string): string[] {
  const fm = frontmatterOf(source);
  const body = withoutComments(source).slice(fm ? fm.length : 0);
  const destructured = /const\s*\{([^}]*)\}\s*=\s*Astro\.props/.exec(fm ? fm.code : '')?.[1] ?? '';
  const names = new Set<string>();
  for (const match of body.matchAll(/\sset:html\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const name = match[1] ?? '';
    const entry = destructured.split(',').find((part) => new RegExp(`(?:^|:)\\s*${name}\\s*(?:=|$)`).test(part.trim()));
    const prop = entry?.split(':')[0]?.split('=')[0]?.trim();
    if (prop) {
      names.add(prop);
    }
    if (names.size >= 8) {
      break;
    }
  }
  return [...names];
}

export function forwardsRest(source: string): boolean {
  return /\.\.\.\s*\w+\s*\}\s*(?::[^=]+)?=\s*Astro\.props/.test(source);
}

export function rootTag(source: string): RenderTag | undefined {
  const root = rootElement(source);
  if (root === undefined) {
    return undefined;
  }
  const { name, frontmatter } = root;
  const lower = name.toLowerCase();
  if (!/^[A-Z]/.test(name)) {
    return { tag: lower };
  }
  const alias = destructuredTag(frontmatter, name);
  if (alias) {
    return alias;
  }
  const decl = frontmatter.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`));
  if (!decl) {
    return undefined;
  }
  const expr = required(decl[1], 'Dynamic tag expression capture').trim();
  const ident = expr.match(/^([A-Za-z_$][\w$]*)$/);
  if (ident) {
    const prop = required(ident[1], 'Dynamic tag prop capture');
    const dflt = frontmatter.match(new RegExp(`\\b${prop}\\s*=\\s*["'\`]([A-Za-z][\\w-]*)["'\`]`));
    return dflt ? { prop, tag: required(dflt[1], 'Root tag default capture').toLowerCase() } : { prop };
  }
  const lits = [...expr.matchAll(/["'`]([A-Za-z][\w-]*)["'`]/g)].map((x) => required(x[1], 'Root tag literal capture').toLowerCase());
  if (lits.length === 1) {
    return { tag: required(lits[0], 'Root has exactly one literal tag') };
  }
  if (lits.length > 1) {
    return { options: lits };
  }
  return undefined;
}

export function rootComponent(source: string): string | undefined {
  const root = rootElement(source);
  if (root === undefined) {
    return undefined;
  }
  const { name, frontmatter } = root;
  if (!/^[A-Z]/.test(name)) {
    return undefined;
  }
  if (destructuredTag(frontmatter, name)) {
    return undefined;
  }
  if (frontmatter.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`))) {
    return undefined;
  }
  return name;
}

function rootElement(source: string): { readonly name: string; readonly frontmatter: string } | undefined {
  const fm = frontmatterOf(source);
  const frontmatter = fm ? source.slice(0, fm.length) : '';
  const body = fm ? source.slice(fm.length) : source;
  const re = /<(\/?)([A-Za-z][\w.-]*)\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*?)(\/?)>/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const closing = match[1];
    const name = required(match[2], 'Root tag name capture');
    if (closing) {
      continue;
    }
    const lower = name.toLowerCase();
    if (lower === 'fragment' || lower === 'slot' || lower === 'style' || lower === 'script') {
      continue;
    }
    return { name, frontmatter };
  }
  return undefined;
}

export function defaultSlotInline(source: string): boolean {
  const fm = frontmatterOf(source);
  const frontmatter = fm ? source.slice(0, fm.length) : '';
  const body = fm ? source.slice(fm.length) : source;
  const heldBy = new Set(
    slotApiUses(source)
      .filter((use) => use.slot === 'default' && use.varName)
      .map((use) => use.varName),
  );
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w.-]*)\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*?)(\/?)>/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const closing = match[1];
    const tag = required(match[2], 'Slot parent tag capture');
    const attrs = required(match[3], 'Slot parent attributes capture');
    const selfClosing = match[4];
    const html = !closing && attrs.match(/\bset:html\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/);
    const isSlot = tag.toLowerCase() === 'slot' && !closing && !/\bname\s*=/.test(attrs);
    const placeholder = isSlot || (html && heldBy.has(required(html[1], 'Slot content variable capture')));
    if (placeholder) {
      const parent = isSlot || tag === 'Fragment' ? stack[stack.length - 1] : tag;
      if (!parent) {
        return false;
      }
      if (TEXT_TAGS.has(parent.toLowerCase())) {
        return true;
      }
      if (!/^[A-Z]/.test(parent)) {
        return false;
      }
      const options = dynamicTagLiterals(frontmatter, parent);
      return options.length > 0 && options.every((tag) => TEXT_TAGS.has(tag.toLowerCase()));
    }
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at !== -1) {
        stack.length = at;
      }
    } else if (!selfClosing && !VOID_ELEMENTS.has(tag.toLowerCase())) {
      stack.push(tag);
    }
  }
  return false;
}

export function parseExtendsTag(source: string): string | undefined {
  const frontmatter = frontmatterOf(source)?.code ?? '';
  const tagOf = (typing: string): string | undefined => {
    const match = /\b(?:astroHTML\.JSX\.)?HTMLAttributes\s*<\s*['"]([a-z][a-z0-9]*)['"]\s*>/.exec(typing);
    return match ? required(match[1], 'Extended HTML tag capture') : undefined;
  };
  const extended = /\binterface\s+Props\s+extends\s+([^{]*)\{/.exec(frontmatter);
  if (extended) {
    return tagOf(required(extended[1], 'Extends list capture'));
  }
  const aliased = /\btype\s+Props\s*=/.exec(frontmatter);
  return aliased ? tagOf(topLevelText(frontmatter.slice(aliased.index + aliased[0].length))) : undefined;
}

function topLevelText(text: string): string {
  let depth = 0;
  let out = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? '';
    if ('{(['.includes(character)) {
      depth++;
    } else if ('})]'.includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (character === ';' || (character === '\n' && /^\n[A-Za-z]/.test(text.slice(index, index + 2))))) {
      return out;
    } else if (depth === 0) {
      out += character;
    }
  }
  return out;
}
