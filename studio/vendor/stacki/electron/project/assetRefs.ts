
const DEFAULT_IMPORT = new RegExp(
  /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s*/.source + /(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?/.source + /\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*$/.source,
  'gm',
);

interface DefaultImport {
  readonly name: string;
  readonly spec: string;
  readonly start: number;
  readonly end: number;
}

function defaultImports(source: string): DefaultImport[] {
  const out: DefaultImport[] = [];
  const re = new RegExp(DEFAULT_IMPORT.source, 'gm');
  let match;
  while ((match = re.exec(String(source || ''))) !== null) {
    const name = match[1];
    const spec = match[3];
    if (name === undefined || spec === undefined) {
      continue;
    }
    out.push({ name, spec, start: match.index, end: match.index + match[0].length });
  }
  return out;
}

function importedAs(source: string, name: string): DefaultImport | undefined {
  return defaultImports(source).find((i) => i.name === name);
}

function importInsertAt(source: string): number {
  const all = defaultImports(source);
  const anyImport = /^[ \t]*import\b[^\n]*$/gm;
  let end: number | undefined = undefined;
  let match;
  while ((match = anyImport.exec(String(source || ''))) !== null) {
    end = match.index + match[0].length;
  }
  if (all.length) {
    const last = all[all.length - 1];
    if (last !== undefined) {
      end = Math.max(end ?? 0, last.end);
    }
  }
  return end ?? 0;
}

function addImport(source: string, name: string, spec: string): string {
  const text = String(source || '');
  const line = `import ${name} from '${spec}';`;
  const at = importInsertAt(text);
  if (at === 0) {
    return `${line}\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  }
  return `${text.slice(0, at)}\n${line}${text.slice(at)}`;
}

function importName(fileRel: string, taken: readonly string[] = []): string {
  const base =
    String(fileRel || '')
      .split('/')
      .pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '');
  const camel = stem
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : (part[0] ?? '').toUpperCase() + part.slice(1)))
    .join('');
  let candidate = /^[A-Za-z_$]/.test(camel) ? camel : `_${camel}`;
  if (!candidate) {
    candidate = 'asset';
  }
  const used = new Set(taken);
  if (!used.has(candidate)) {
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}${suffix}`;
}

interface ImportSpecContext {
  readonly imports?: readonly DefaultImport[];
  readonly srcRelative?: string;
  readonly relative: string;
}

function importSpecFor({ imports = [], srcRelative: pathInSourceFolder, relative }: ImportSpecContext): string {
  if (pathInSourceFolder) {
    for (const imp of imports) {
      if (imp.spec.startsWith('.')) {
        continue;
      }
      for (const marker of ['/components/', '/layouts/', '/assets/']) {
        const markerIndex = imp.spec.indexOf(marker);
        if (markerIndex > 0) {
          return imp.spec.slice(0, markerIndex + 1) + pathInSourceFolder;
        }
      }
    }
  }
  return relative;
}

import { LIMITS } from '../../shared/core/limits';
import { toRecord } from '../../shared/core/record';

function withAssets(value: unknown, resolve: (name: string) => string | undefined): unknown {
  return withAssetsAtDepth(value, 0, resolve);
}

function withAssetsAtDepth(value: unknown, depth: number, resolve: (name: string) => string | undefined): unknown {
  if (depth > LIMITS.ipcDepthMax) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withAssetsAtDepth(item, depth + 1, resolve));
  }
  const record = toRecord(value);
  if (record === undefined) {
    return value;
  }
  const expr = record['__expr'];
  if (typeof expr === 'string') {
    const rel = resolve(expr);
    return rel ? { ...record, __asset: rel } : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    out[key] = withAssetsAtDepth(entry, depth + 1, resolve);
  }
  return out;
}

export { defaultImports, importedAs, importInsertAt, addImport, importName, importSpecFor, withAssets };
export type { DefaultImport, ImportSpecContext };
