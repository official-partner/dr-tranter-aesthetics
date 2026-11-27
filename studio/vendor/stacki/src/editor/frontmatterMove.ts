import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { treeBudget, type TreeView } from './treeView';
interface FrontmatterPage {
  readonly nodes: readonly TreeView[];
  readonly extraFrontmatter?: string;
}
interface Statement {
  readonly name: string;
  readonly statement: string;
}
interface NeededImport {
  readonly name: string;
  readonly path: string;
  readonly imported?: string | undefined;
  readonly named?: boolean | undefined;
  readonly typeOnly?: boolean | undefined;
}
interface FrontmatterRequest {
  readonly names?: Iterable<string> | undefined;
  readonly frontmatter?: string;
  readonly imports?: readonly NeededImport[];
  readonly has?: (name: string) => boolean;
}
interface NeededFrontmatter {
  readonly imports: readonly NeededImport[];
  readonly statements: readonly Statement[];
}


import { findDeclaration, findImportOf, parseDeclarations } from './dataSuggest';

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'new',
  'typeof',
  'instanceof',
  'in',
  'of',
  'await',
  'async',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'const',
  'let',
  'var',
  'class',
  'extends',
  'import',
  'from',
  'export',
  'default',
  'this',
  'void',
  'delete',
  'yield',
  'try',
  'catch',
  'finally',
  'throw',
  'switch',
  'case',
  'break',
  'continue',
  'Astro',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Promise',
  'Map',
  'Set',
  'console',
  'globalThis',
]);

function blankStrings(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < code.length && code[i] !== quote) {
        i += code[i] === '\\' ? 2 : 1;
      }
      out += ' ';
      continue;
    }
    if (ch === '`') {
      i++;
      let depth = 0;
      while (i < code.length) {
        const character = code[i];
        if (character === '\\') {
          i += 2;
          continue;
        }
        if (depth === 0 && character === '`') {
          break;
        }
        if (character === '$' && code[i + 1] === '{') {
          depth++;
          out += ' ';
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (character === '}') {
            depth--;
            out += ' ';
            i++;
            continue;
          }
          out += character;
          i++;
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

export function identifiersIn(code: unknown): Set<string> {
  const text = blankStrings(
    String(code || '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '),
  );
  const out = new Set<string>();
  const re = /(\.?)\b([A-Za-z_$][\w$]*)\b(\s*:)?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const [, dot, name, colon] = match;
    if (dot) {
      continue;
    }
    if (colon && !/\?\s*$/.test(text.slice(0, match.index))) {
      const before = text.slice(0, match.index);
      if (/[{,]\s*$/.test(before)) {
        continue;
      }
    }
    if (name === undefined || KEYWORDS.has(name)) {
      continue;
    }
    out.add(name);
  }
  return out;
}

export function namesUsedIn(nodes: readonly TreeView[] | undefined): Set<string> {
  const out = new Set<string>();
  const visit = treeBudget();
  const walk = (list: readonly TreeView[] | undefined, depth: number): void => {
    for (const node of list || []) {
      visit(depth);
      assert(depth <= LIMITS.treeDepthMax, 'namesUsedIn: depth limit');
      if (node.kind === 'component' && node.name) {
        out.add(node.name);
      }
      if (node.kind === 'expr' || node.kind === 'raw-line') {
        for (const name of identifiersIn(node.value)) {
          out.add(name);
        }
      }
      if (node.kind === 'map') {
        for (const name of identifiersIn(node.head)) {
          out.add(name);
        }
      }
      if (node.kind === 'cond') {
        for (const name of identifiersIn(node.test)) {
          out.add(name);
        }
      }
      if (node.body !== undefined) {
        for (const line of node.body) {
          for (const name of identifiersIn(line)) {
            out.add(name);
          }
        }
      }
      for (const value of Object.values(node.props || {})) {
        if (value && (value.type === 'expr' || value.type === 'spread')) {
          for (const name of identifiersIn(value.value)) {
            out.add(name);
          }
        }
      }
      if (node.children !== undefined) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

function namesUsedByPage(model: FrontmatterPage): Set<string> {
  const out = namesUsedIn(model.nodes);
  for (const name of identifiersIn(model.extraFrontmatter || '')) {
    out.add(name);
  }
  return out;
}

const EXPORTED_RE = (name: string): RegExp => new RegExp(`(^|\\n)[ \\t]*export\\s+(const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\b`);

export function unusedDeclarations(model: FrontmatterPage): readonly Statement[] {
  const code = String(model.extraFrontmatter || '');
  const declared = parseDeclarations(code);
  if (!declared.size) {
    return [];
  }
  const fromMarkup = namesUsedIn(model.nodes);
  const out = [];
  let rest = code;
  let changed = true;
  const gone = new Set<string>();
  let passes = 0;
  while (changed) {
    assert(++passes <= declared.size + 1, 'Declaration removal must make progress');
    changed = false;
    for (const [name] of parseDeclarations(rest)) {
      if (gone.has(name)) {
        continue;
      }
      if (EXPORTED_RE(name).test(rest)) {
        continue;
      }
      if (fromMarkup.has(name)) {
        continue;
      }
      const found = findDeclaration(rest, name);
      if (!found) {
        continue;
      }
      const without = rest.slice(0, found.start) + rest.slice(found.end);
      if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(without)) {
        continue;
      }
      out.push({ name, statement: found.statement });
      gone.add(name);
      rest = without;
      changed = true;
    }
  }
  return out;
}

export function withoutDeclarations(code: unknown, names: readonly string[]): string {
  let out = String(code || '');
  for (const name of names) {
    const found = findDeclaration(out, name);
    if (!found) {
      continue;
    }
    const before = out.slice(0, found.start);
    const after = out.slice(found.end).replace(/^[ \t]*\/\/[^\n]*/, '');
    out = before.replace(/[ \t]*$/, '') + after.replace(/^[ \t]*\r?\n/, '');
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

export function neededFrontmatter({ names, frontmatter, imports, has }: FrontmatterRequest): NeededFrontmatter {
  const known = has || (() => false);
  const code = String(frontmatter || '');
  const declared = parseDeclarations(code);
  const wantedImports: NeededImport[] = [];
  const statements: Statement[] = [];
  const seen = new Set<string>();
  const queue = [...(names || [])];
  while (queue.length) {
    assert(seen.size <= LIMITS.scanEntriesMax, 'Frontmatter dependencies exceed limit');
    assert(queue.length <= LIMITS.scanEntriesMax, 'Frontmatter queue exceeds limit');
    const name = queue.shift();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    if (known(name)) {
      continue;
    }
    const imported = (imports || []).find((i) => i.name === name) || findImportOf(code, name);
    if (imported) {
      const path = 'path' in imported ? imported.path : imported.spec;
      wantedImports.push({
        name,
        path,
        ...(imported.imported === undefined ? {} : { imported: imported.imported }),
        ...(imported.named === undefined ? {} : { named: imported.named }),
        ...('typeOnly' in imported && imported.typeOnly !== undefined ? { typeOnly: imported.typeOnly } : {}),
      });
      continue;
    }
    if (!declared.has(name)) {
      continue;
    }
    const found = findDeclaration(code, name);
    if (!found) {
      continue;
    }
    statements.push({ name, statement: found.statement });
    for (const read of identifiersIn(found.value)) {
      queue.push(read);
    }
  }
  statements.sort((left, right) => code.indexOf(left.statement) - code.indexOf(right.statement));
  return { imports: wantedImports, statements };
}

export function withStatements(code: unknown, statements: readonly Statement[] | undefined): string {
  const lines = (statements || []).map((entry) => entry.statement).filter(Boolean);
  if (!lines.length) {
    return String(code || '');
  }
  const base = String(code || '').replace(/\s*$/, '');
  return base ? `${base}\n${lines.join('\n')}` : lines.join('\n');
}

export { namesUsedByPage };
