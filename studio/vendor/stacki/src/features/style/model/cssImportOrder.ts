
import { assert } from '../../../../shared/core/assert';

export type ImportSource = {
  readonly path: string;
  readonly code: string;
};

export type ImportStatement = {
  readonly target: string;
  readonly layer: string | undefined;
};

export const IMPORTS_PER_FILE_MAX = 512;

const IMPORT_PATTERN = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*(?:layer(?:\(\s*([^)]*?)\s*\))?(?![\w-]))?/gi;

export function importsOf(code: string): ImportStatement[] {
  const text = code.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: ImportStatement[] = [];
  for (const match of text.matchAll(IMPORT_PATTERN)) {
    if (found.length >= IMPORTS_PER_FILE_MAX) {
      break;
    }
    const target = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim();
    if (target.length === 0) {
      continue;
    }
    const wholeMatch = match[0];
    const layered = /\blayer\b/i.test(wholeMatch.slice(wholeMatch.search(/["')]\s*layer/i) + 1));
    found.push({ target, layer: layered ? (match[6] ?? '').trim() : undefined });
  }
  assert(found.length <= IMPORTS_PER_FILE_MAX, 'importsOf: the imports are bounded');
  return found;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  return `/${parts.join('/')}`;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

function resolveImport(importer: string, target: string, known: ReadonlySet<string>): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
    return undefined;
  }
  const withoutQuery = target.replace(/[?#].*$/, '');
  const base = withoutQuery.startsWith('/') ? withoutQuery : `${directoryOf(importer)}/${withoutQuery}`;
  const direct = normalizePath(base);
  if (known.has(direct)) {
    return direct;
  }
  return undefined;
}

export type ImportPlacement = {
  readonly path: string;
  readonly rank: number;
  readonly layer: readonly string[] | undefined;
};

export function orderByImports(sources: readonly ImportSource[]): ImportPlacement[] {
  const byPath = new Map(sources.map((source) => [normalizePath(source.path), source]));
  const known = new Set(byPath.keys());
  const imported = new Set<string>();
  const importsByPath = new Map<string, Array<{ readonly path: string; readonly layer: string | undefined }>>();
  for (const [path, source] of byPath) {
    const resolved: Array<{ readonly path: string; readonly layer: string | undefined }> = [];
    for (const statement of importsOf(source.code)) {
      const target = resolveImport(path, statement.target, known);
      if (target !== undefined && target !== path) {
        resolved.push({ path: target, layer: statement.layer });
        imported.add(target);
      }
    }
    importsByPath.set(path, resolved);
  }

  const placements: ImportPlacement[] = [];
  const visited = new Set<string>();
  const visit = (root: string, rootLayer: readonly string[] | undefined): void => {
    const stack: Array<{ readonly path: string; readonly layer: readonly string[] | undefined; expanded: boolean }> = [
      { path: root, layer: rootLayer, expanded: false },
    ];
    const budget = byPath.size * 2 + 2;
    for (let step = 0; step < budget && stack.length > 0; step += 1) {
      const top = stack[stack.length - 1];
      assert(top !== undefined, 'orderByImports: the stack is non-empty inside the loop');
      if (top.expanded) {
        stack.pop();
        const source = byPath.get(top.path);
        assert(source !== undefined, 'orderByImports: a visited path is a source');
        placements.push({ path: source.path, rank: placements.length, layer: top.layer });
        continue;
      }
      top.expanded = true;
      visited.add(top.path);
      const children = importsByPath.get(top.path) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined && !visited.has(child.path)) {
          const layer =
            child.layer === undefined ? top.layer : [...(top.layer ?? []), ...(child.layer === '' ? [`\u0000import-${child.path}`] : child.layer.split('.'))];
          stack.push({ path: child.path, layer, expanded: false });
        }
      }
    }
  };

  for (const source of sources) {
    const path = normalizePath(source.path);
    if (!imported.has(path) && !visited.has(path)) {
      visit(path, undefined);
    }
  }
  for (const source of sources) {
    const path = normalizePath(source.path);
    if (!visited.has(path)) {
      visit(path, undefined);
    }
  }
  assert(placements.length === byPath.size, 'orderByImports: every source is placed exactly once');
  return placements;
}
