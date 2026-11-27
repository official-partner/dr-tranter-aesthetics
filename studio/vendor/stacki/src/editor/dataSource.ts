
export const DATA_SUGGEST_LIMITS = {
  completionDepthMax: 2,
} as const;

export function skipString(code: string, start: number): number {
  const quote = code.charAt(start);
  let index = start + 1;
  while (index < code.length && code.charAt(index) !== quote) {
    if (code.charAt(index) === '\\') {
      index++;
    }
    index++;
  }
  return index;
}

export function scanValue(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(code, i);
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
      if (depth < 0) {
        return i;
      }
    } else if (depth === 0 && ch === ';') {
      return i;
    } else if (depth === 0 && ch === '\n') {
      if (!/^\s*(\.|\)|\]|\}|,|\|\||&&|\?|:)/.test(code.slice(i))) {
        return i;
      }
    }
  }
  return code.length;
}

function staticPathsBody(code: string): readonly [number, number] | undefined {
  const head = /export\s+(?:async\s+)?function\s+getStaticPaths\s*\([^)]*\)[^{]*\{/.exec(code);
  if (head === null) {
    return undefined;
  }
  const start = head.index + head[0].length;
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(code, i);
    } else if (code.startsWith('//', i)) {
      const lineEnd = code.indexOf('\n', i);
      i = lineEnd === -1 ? code.length : lineEnd;
    } else if (code.startsWith('/*', i)) {
      const commentEnd = code.indexOf('*/', i);
      i = commentEnd === -1 ? code.length : commentEnd + 1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return [start, i];
      }
    }
  }
  return undefined;
}

export function parseDeclarations(code: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*/g;
  const paths = staticPathsBody(code);
  let match;
  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }
    if (paths !== undefined && match.index >= paths[0] - 1 && match.index < paths[1]) {
      re.lastIndex = paths[1];
      continue;
    }
    const start = match.index + match[0].length;
    const end = scanValue(code, start);
    out.set(name, code.slice(start, end).trim());
    re.lastIndex = end;
  }
  return out;
}

export interface DeclarationSpan {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly statement: string;
  readonly value: string;
}

export function findDeclaration(code: unknown, name: unknown): DeclarationSpan | undefined {
  const source = String(code || '');
  const ident = String(name || '');
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
    return undefined;
  }
  const re = new RegExp(`(?:^|\\n)([ \\t]*)((?:export\\s+)?(?:const|let|var)\\s+` + `${ident.replace(/\$/g, '\\$')}\\s*=\\s*)`, 'g');
  const match = re.exec(source);
  const lead = match?.[1];
  const head = match?.[2];
  if (!match || lead === undefined || head === undefined) {
    return undefined;
  }
  const valueStart = match.index + match[0].length;
  const start = valueStart - head.length;
  const valueEnd = scanValue(source, valueStart);
  const end = source.charAt(valueEnd) === ';' ? valueEnd + 1 : valueEnd;
  return {
    name: ident,
    start,
    end,
    statement: source.slice(start, end),
    value: source.slice(valueStart, valueEnd).trim(),
  };
}

export function findImportOf(code: unknown, name: unknown): { name: string; spec: string; named?: boolean; imported?: string } | undefined {
  const ident = String(name || '');
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
    return undefined;
  }
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(String(code || ''))) !== null) {
    const clause = match[1];
    const spec = match[2];
    if (clause === undefined || spec === undefined) {
      continue;
    }
    const braced = clause.match(/\{([\s\S]*)\}/);
    const names: string[] = [];
    const exported = new Map<string, string>();
    const outside = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+/, '');
    for (const part of outside.split(',')) {
      const entry = part.trim();
      if (entry) {
        names.push(entry);
      }
    }
    const bracedBody = braced?.[1];
    if (bracedBody !== undefined) {
      for (const part of bracedBody.split(',')) {
        const entry = part.trim();
        if (!entry) {
          continue;
        }
        const as = entry.split(/\s+as\s+/);
        const local = (as[1] || as[0] || '').trim();
        names.push(local);
        exported.set(local, (as[0] || '').trim());
      }
    }
    if (names.includes(ident)) {
      const imported = exported.get(ident);
      return imported === undefined ? { name: ident, spec } : { name: ident, spec, named: true, imported };
    }
  }
  return undefined;
}

export function firstObjectIn(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }
  if (!trimmed.startsWith('[')) {
    return undefined;
  }
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(trimmed, i);
      continue;
    }
    if (ch === '{' && depth === 1) {
      let nesting = 0;
      for (let j = i; j < trimmed.length; j++) {
        const character = trimmed.charAt(j);
        if (character === '"' || character === "'" || character === '`') {
          j = skipString(trimmed, j);
          continue;
        }
        if (character === '{') {
          nesting++;
        } else if (character === '}') {
          nesting--;
          if (nesting === 0) {
            return trimmed.slice(i, j + 1);
          }
        }
      }
      return undefined;
    }
    if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
    }
  }
  return undefined;
}

export interface ObjectEntry {
  readonly key: string;
  readonly value: string;
}

export function objectEntries(text: string | undefined): ObjectEntry[] {
  if (!text) {
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return [];
  }
  const pairs: ObjectEntry[] = [];
  let depth = 0;
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(trimmed, i) + 1;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      i++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && /[,{\s]/.test(trimmed.charAt(i - 1) || '{')) {
      const match = trimmed.slice(i).match(/^([\w$]+)\s*(:)?/);
      const key = match?.[1];
      if (match && key !== undefined && (match[2] || /^[\w$]+\s*[,}]/.test(trimmed.slice(i)))) {
        if (!match[2]) {
          pairs.push({ key, value: '' });
          i += key.length;
          continue;
        }
        const vs = i + match[0].length;
        let nesting = depth;
        let j = vs;
        while (j < trimmed.length) {
          const character = trimmed.charAt(j);
          if (character === '"' || character === "'" || character === '`') {
            j = skipString(trimmed, j) + 1;
            continue;
          }
          if ('([{'.includes(character)) {
            nesting++;
          } else if (')]}'.includes(character)) {
            nesting--;
            if (nesting === 0) {
              break;
            }
          } else if (character === ',' && nesting === 1) {
            break;
          }
          j++;
        }
        pairs.push({ key, value: trimmed.slice(vs, j).trim() });
        i = j;
        continue;
      }
    }
    i++;
  }
  return pairs;
}

export function kindOf(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    return 'list';
  }
  if (trimmed.startsWith('{')) {
    return 'object';
  }
  if (/^['"`]/.test(trimmed)) {
    return 'text';
  }
  if (/^-?\d/.test(trimmed)) {
    return 'number';
  }
  if (/^(true|false)$/.test(trimmed)) {
    return 'boolean';
  }
  return '';
}

export const NON_DATA_EXT = new RegExp('\\.(astro|md|mdx|css|s[ac]ss|less|svg|png|jpe?g|gif|webp|avif|ico|bmp|' + 'mp4|webm|mov|woff2?|ttf|otf)(\\?.*)?$', 'i');

export const TOOL_MODULE = /^(astro(:|$)|node:)/;

export interface ImportLike {
  readonly name?: string;
  readonly path?: string;
  readonly named?: boolean;
  readonly imported?: string;
  readonly typeOnly?: boolean;
}

export function mayHoldData(imp: ImportLike | undefined): boolean {
  const path = String(imp?.path || '');
  if (NON_DATA_EXT.test(path) || TOOL_MODULE.test(path)) {
    return false;
  }
  return !/^[A-Z]/.test(String(imp?.name || ''));
}

export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text.charAt(i);
    if (character === '"' || character === "'" || character === '`') {
      i = skipString(text, i);
      continue;
    }
    if ('([{'.includes(character)) {
      depth++;
    } else if (')]}'.includes(character)) {
      depth--;
    } else if (character === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

export function topIndexOf(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text.charAt(i);
    if (character === '"' || character === "'" || character === '`') {
      i = skipString(text, i);
      continue;
    }
    if ('([{'.includes(character)) {
      depth++;
    } else if (')]}'.includes(character)) {
      depth--;
    } else if (character === ch && depth === 0) {
      return i;
    }
  }
  return -1;
}

export interface Destructure {
  readonly name: string;
  readonly prop: string;
  readonly from: string;
  readonly kind: string;
  readonly defaultText?: string;
}

export function parseDestructures(code: unknown): Destructure[] {
  const source = String(code || '');
  const out: Destructure[] = [];
  const re = /(?:^|[\n;])\s*(?:export\s+)?(?:const|let|var)\s*\{/g;
  while (re.exec(source) !== null) {
    const open = re.lastIndex - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i++) {
      const character = source.charAt(i);
      if (character === '"' || character === "'" || character === '`') {
        i = skipString(source, i);
        continue;
      }
      if ('([{'.includes(character)) {
        depth++;
      } else if (')]}'.includes(character)) {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) {
      break;
    }
    re.lastIndex = close + 1;
    const eq = source.slice(close + 1).match(/^\s*=\s*/);
    if (!eq) {
      continue;
    }
    const valueStart = close + 1 + eq[0].length;
    const from = source.slice(valueStart, scanValue(source, valueStart)).trim();
    for (const part of splitTopLevel(source.slice(open + 1, close))) {
      const entry = part.trim();
      if (!entry) {
        continue;
      }
      if (entry.startsWith('...')) {
        const rest = entry.slice(3).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(rest)) {
          out.push({ name: rest, prop: rest, from, kind: 'rest' });
        }
        continue;
      }
      const colon = topIndexOf(entry, ':');
      let local = colon === -1 ? entry : entry.slice(colon + 1);
      const eqAt = topIndexOf(local, '=');
      const defaultText = eqAt === -1 ? '' : local.slice(eqAt + 1).trim();
      local = (eqAt === -1 ? local : local.slice(0, eqAt)).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(local)) {
        continue;
      }
      const key = colon === -1 ? local : entry.slice(0, colon).trim();
      const prop = /^[A-Za-z_$][\w$]*$/.test(key) ? key : local;
      out.push({ name: local, prop, from, kind: kindOf(defaultText), ...(defaultText === '' ? {} : { defaultText }) });
    }
  }
  return out;
}

export function looksCallable(value: unknown): boolean {
  const raw = String(value || '').trim();
  const test = (candidate: string): boolean =>
    /^(async\s+)?function\b/.test(candidate) || /^(async\s*)?\([^()]*\)\s*(:[^=]*)?=>/.test(candidate) || /^(async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(candidate);
  return test(raw) || test(raw.replace(/^\(\s*/, ''));
}

export const COLLECTION_CALL = /\b(getCollection|getEntry|getEntries)\s*\(\s*['"]([\w-]+)['"]/;

export function collectionCallIn(text: unknown): { fn: string; name: string } | undefined {
  const match = String(text || '').match(COLLECTION_CALL);
  const callee = match?.[1];
  const name = match?.[2];
  return callee !== undefined && name !== undefined ? { fn: callee, name } : undefined;
}

export const REF_CALL = /\b(getEntry|getEntries)\s*\(\s*([\w$]+(?:\.[\w$]+)*(?:\[\d+\])?)\s*\)/;

export function referenceCallIn(text: unknown): { fn: string; path: string } | undefined {
  const match = String(text || '').match(REF_CALL);
  const callee = match?.[1];
  const path = match?.[2];
  return callee !== undefined && path !== undefined ? { fn: callee, path } : undefined;
}
