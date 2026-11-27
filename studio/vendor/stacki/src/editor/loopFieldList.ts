
import { assert } from '../../shared/core/assert';
import type { LoopSource } from './loopQuery';
import { parseExpression, parseFrontmatter, type Js } from './loopSyntax';

export interface FieldList {
  readonly source: LoopSource;
  readonly path: readonly string[];
  readonly follow: 'values' | 'references';
}

export interface FieldListReaders {
  readonly astro: string | undefined;
  readonly sanity: string | undefined;
}

const PATH_DEPTH_MAX = 8;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const GROQ_FIELD = /^[A-Za-z_][\w-]*$/;

export function fieldListCode(list: FieldList, reader: string): string {
  assert(list.path.length > 0, 'A field list names a field');
  assert(list.path.length <= PATH_DEPTH_MAX, 'A field list path is bounded');
  const code = list.source.kind === 'astro' ? astroCode(list, reader) : sanityCode(list, reader);
  const readers = list.source.kind === 'astro' ? { astro: reader, sanity: undefined } : { astro: undefined, sanity: reader };
  assert(fieldListOfExpression(code, readers)?.source.collection === list.source.collection, 'A field list reads back as written');
  return code;
}

export function isGroqPath(path: readonly string[]): boolean {
  return path.length > 0 && path.length <= PATH_DEPTH_MAX && path.every((key) => GROQ_FIELD.test(key));
}

export function fieldListOf(frontmatter: string, data: string, readers: FieldListReaders): FieldList | undefined {
  if (!IDENTIFIER.test(data.trim())) {
    return undefined;
  }
  const declaration = parseFrontmatter(frontmatter).declarations.get(data.trim());
  return declaration?.init === undefined ? undefined : fieldListOfJs(declaration.init, readers);
}

function astroCode(list: FieldList, reader: string): string {
  const access = list.path.map((key) => (IDENTIFIER.test(key) ? `?.${key}` : `?.[${JSON.stringify(key)}]`)).join('');
  return `(await ${reader}(${JSON.stringify(list.source.collection)})).flatMap((entry) => entry.data${access} ?? [])`;
}

function sanityCode(list: FieldList, client: string): string {
  assert(isGroqPath(list.path), 'A Sanity field list names fields GROQ can');
  assert(GROQ_FIELD.test(list.source.collection), 'A Sanity type is a plain name');
  const groq = `*[_type == "${list.source.collection}"].${list.path.join('.')}[]${list.follow === 'references' ? '->' : ''}`;
  return `await ${client}.fetch(${JSON.stringify(groq)})`;
}

function fieldListOfExpression(code: string, readers: FieldListReaders): FieldList | undefined {
  const parsed = parseExpression(code);
  return parsed === undefined ? undefined : fieldListOfJs(parsed.expression, readers);
}

function fieldListOfJs(init: Js, readers: FieldListReaders): FieldList | undefined {
  if (init.kind === 'await') {
    return readers.sanity === undefined ? undefined : sanityListOf(init.value, readers.sanity);
  }
  return readers.astro === undefined ? undefined : astroListOf(init, readers.astro);
}

function sanityListOf(call: Js, client: string): FieldList | undefined {
  if (call.kind !== 'call' || call.callee.kind !== 'member' || call.callee.property !== 'fetch' || call.args.length !== 1) {
    return undefined;
  }
  const object = call.callee.object;
  const groq = call.args[0];
  if (object.kind !== 'name' || object.name !== client || groq?.kind !== 'string') {
    return undefined;
  }
  const match = /^\*\[_type == "([A-Za-z_][\w-]*)"\]\.([A-Za-z_][\w.-]*)\[\](->)?$/.exec(groq.value);
  const path = match?.[2]?.split('.') ?? [];
  if (match?.[1] === undefined || !isGroqPath(path)) {
    return undefined;
  }
  return { source: { kind: 'sanity', collection: match[1] }, path, follow: match[3] === undefined ? 'values' : 'references' };
}

function astroListOf(init: Js, reader: string): FieldList | undefined {
  if (init.kind !== 'call' || init.callee.kind !== 'member' || init.callee.property !== 'flatMap' || init.args.length !== 1) {
    return undefined;
  }
  const source = init.callee.object.kind === 'await' ? init.callee.object.value : undefined;
  const first = source?.kind === 'call' && source.callee.kind === 'name' && source.callee.name === reader ? source.args[0] : undefined;
  const callback = init.args[0];
  if (first?.kind !== 'string' || callback?.kind !== 'function') {
    return undefined;
  }
  const parameter = callback.parameters[0];
  const body = callback.body;
  if (parameter?.kind !== 'name' || body?.kind !== 'binary' || body.operator !== '??' || body.right.kind !== 'array') {
    return undefined;
  }
  const path = memberPath(body.left, parameter.name);
  return path === undefined || path.length === 0 ? undefined : { source: { kind: 'astro', collection: first.value }, path, follow: 'values' };
}

function memberPath(node: Js, parameter: string): readonly string[] | undefined {
  const keys: string[] = [];
  let current: Js = node;
  for (let depth = 0; depth <= PATH_DEPTH_MAX + 1; depth++) {
    if (current.kind === 'member') {
      keys.unshift(current.property);
      current = current.object;
    } else if (current.kind === 'index' && current.index.kind === 'string') {
      keys.unshift(current.index.value);
      current = current.object;
    } else if (current.kind === 'name' && current.name === parameter) {
      return keys[0] === 'data' ? keys.slice(1) : undefined;
    } else {
      return undefined;
    }
  }
  return undefined;
}
