
import { assert } from '../../shared/core/assert';
import { NON_DATA_EXT, TOOL_MODULE, scanValue, skipString, type ImportLike } from './dataSource';

export const IMPORTED_VALUE_LIMITS = {
  modulesMax: 16,
  exportListNamesMax: 256,
} as const;

export type ImportedValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'data'; readonly value: unknown }
  | { readonly kind: 'function' };

export interface ImportedModuleRequest {
  readonly spec: string;
  readonly bindings: readonly { readonly local: string; readonly exported: string }[];
}

export interface ImportedModuleSource {
  readonly file: string;
  readonly text: string;
}

export function importedModuleRequests(imports: readonly ImportLike[]): ImportedModuleRequest[] {
  const bySpec = new Map<string, { local: string; exported: string }[]>();
  for (const imp of imports) {
    const spec = imp.path ?? '';
    const local = imp.name ?? '';
    if (spec === '' || local === '' || imp.typeOnly === true) {
      continue;
    }
    if (NON_DATA_EXT.test(spec) || TOOL_MODULE.test(spec)) {
      continue;
    }
    const exported = imp.named === true ? (imp.imported ?? local) : 'default';
    const bindings = bySpec.get(spec);
    if (bindings !== undefined) {
      bindings.push({ local, exported });
    } else if (bySpec.size < IMPORTED_VALUE_LIMITS.modulesMax) {
      bySpec.set(spec, [{ local, exported }]);
    }
  }
  const requests = [...bySpec].map(([spec, bindings]) => ({ spec, bindings }));
  assert(requests.length <= IMPORTED_VALUE_LIMITS.modulesMax, 'importedModuleRequests: module limit holds');
  return requests;
}

export function importedValuesFrom(request: ImportedModuleRequest, source: ImportedModuleSource): Record<string, ImportedValue> {
  const out: Record<string, ImportedValue> = {};
  const json = /\.json$/i.test(source.file);
  const parsed = json ? parseJSON(source.text) : undefined;
  for (const binding of request.bindings) {
    const value = json ? jsonExport(parsed, binding.exported) : scriptExport(source.text, binding.exported);
    if (value !== undefined) {
      out[binding.local] = value;
    }
  }
  assert(Object.keys(out).length <= request.bindings.length, 'importedValuesFrom: one value per binding at most');
  return out;
}

export async function readImportedValues(
  imports: readonly ImportLike[],
  readModule: (spec: string) => Promise<ImportedModuleSource | undefined>,
): Promise<Record<string, ImportedValue>> {
  const requests = importedModuleRequests(imports);
  const answers = await Promise.all(
    requests.map(async (request) => {
      const source = await readModule(request.spec).catch(() => undefined);
      return source === undefined ? {} : importedValuesFrom(request, source);
    }),
  );
  const values: Record<string, ImportedValue> = {};
  for (const answer of answers) {
    for (const [local, value] of Object.entries(answer)) {
      values[local] = value;
    }
  }
  assert(answers.length === requests.length, 'readImportedValues: one answer per module');
  return values;
}

export function scriptExport(code: string, name: string): ImportedValue | undefined {
  assert(/^[A-Za-z_$][\w$]*$/.test(name), 'scriptExport: an export name is an identifier');
  if (name === 'default') {
    const head = /(?:^|\n)[ \t]*export\s+default\s+/.exec(code);
    if (head === null) {
      return undefined;
    }
    const start = head.index + head[0].length;
    const text = code.slice(start, scanValue(code, start)).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
      return localExport(code, text);
    }
    return FUNCTION_VALUE.test(text) ? FUNCTION : literalOf(text);
  }
  if (declaresFunction(code, name, { exported: true })) {
    return FUNCTION;
  }
  const direct = declarationValue(code, name, { exported: true });
  if (direct !== undefined) {
    return FUNCTION_VALUE.test(direct) ? FUNCTION : literalOf(direct);
  }
  const local = exportListLocal(code, name);
  return local === undefined ? undefined : localExport(code, local);
}

const FUNCTION: ImportedValue = { kind: 'function' };
const FUNCTION_VALUE = /^(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/;

function localExport(code: string, local: string): ImportedValue | undefined {
  if (declaresFunction(code, local, { exported: false })) {
    return FUNCTION;
  }
  const text = declarationValue(code, local, { exported: false });
  return text !== undefined && FUNCTION_VALUE.test(text) ? FUNCTION : literalOf(text);
}

function declaresFunction(code: string, name: string, options: { readonly exported: boolean }): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  const lead = options.exported ? 'export\\s+(?:default\\s+)?' : '(?:export\\s+)?';
  return new RegExp(`(?:^|\\n)[ \\t]*${lead}(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*[<(]`).test(code);
}

function declarationValue(code: string, name: string, options: { readonly exported: boolean }): string | undefined {
  const escaped = name.replace(/\$/g, '\\$');
  const lead = options.exported ? 'export\\s+' : '(?:export\\s+)?';
  const head = new RegExp(`(?:^|\\n)[ \\t]*${lead}(?:const|let|var)\\s+${escaped}\\s*(?::[^=\\n]*)?=(?!=)\\s*`).exec(code);
  if (head === null) {
    return undefined;
  }
  const start = head.index + head[0].length;
  const end = scanValue(code, start);
  assert(end >= start, 'declarationValue: a value ends after it starts');
  return code.slice(start, end).trim();
}

function exportListLocal(code: string, name: string): string | undefined {
  const lists = /(?:^|\n)[ \t]*export\s*\{([^}]*)\}(?!\s*from\b)/g;
  for (let match = lists.exec(code); match !== null; match = lists.exec(code)) {
    const entries = (match[1] ?? '').split(',').slice(0, IMPORTED_VALUE_LIMITS.exportListNamesMax);
    for (const entry of entries) {
      const parts = entry.trim().split(/\s+as\s+/);
      const local = parts[0]?.trim();
      const exported = (parts[1] ?? parts[0])?.trim();
      if (exported === name && local !== undefined && local !== '') {
        return local;
      }
    }
  }
  return undefined;
}

function literalOf(text: string | undefined): ImportedValue | undefined {
  if (text === undefined || text === '') {
    return undefined;
  }
  const literal = withoutTypeSuffix(text);
  if (/^[{[]/.test(literal)) {
    return { kind: 'literal', text: literal };
  }
  if (/^(['"`])/.test(literal) && skipString(literal, 0) === literal.length - 1) {
    return /^`/.test(literal) && literal.includes('${') ? undefined : { kind: 'literal', text: literal };
  }
  if (/^-?\d[\d_]*(\.\d+)?(e[+-]?\d+)?$/i.test(literal) || /^(true|false)$/.test(literal)) {
    return { kind: 'literal', text: literal };
  }
  return undefined;
}

function withoutTypeSuffix(text: string): string {
  const trimmed = text.trim();
  const close = literalEnd(trimmed);
  const body = close === undefined ? trimmed : trimmed.slice(0, close + 1);
  const rest = close === undefined ? '' : trimmed.slice(close + 1).trim();
  if (rest !== '' && !/^(as\s+const|satisfies\s[\s\S]*)$/.test(rest)) {
    return trimmed;
  }
  return close === undefined ? trimmed.replace(/\s+as\s+const$/, '') : body;
}

function literalEnd(text: string): number | undefined {
  const first = text.charAt(0);
  if (first === '"' || first === "'" || first === '`') {
    return skipString(text, 0);
  }
  if (first !== '{' && first !== '[') {
    return undefined;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (character === '"' || character === "'" || character === '`') {
      index = skipString(text, index);
      continue;
    }
    if ('([{'.includes(character)) {
      depth++;
    } else if (')]}'.includes(character)) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function parseJSON(text: string): { readonly ok: true; readonly value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return undefined;
  }
}

function jsonExport(parsed: { readonly value: unknown } | undefined, name: string): ImportedValue | undefined {
  if (parsed === undefined) {
    return undefined;
  }
  if (name === 'default') {
    return { kind: 'data', value: parsed.value };
  }
  const document = parsed.value;
  if (typeof document !== 'object' || document === null || Array.isArray(document) || !Object.prototype.hasOwnProperty.call(document, name)) {
    return undefined;
  }
  const value: unknown = Reflect.get(document, name);
  return { kind: 'data', value };
}
