
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

const WS = /\s/;

export interface ScalarNode {
  readonly type: 'scalar';
  readonly start: number;
  readonly end: number;
}

export interface Member {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly start: number;
  readonly end: number;
  readonly value: JsonNode;
}

export interface ObjectNode {
  readonly type: 'object';
  readonly start: number;
  readonly end: number;
  readonly members: Member[];
}

export interface ArrayNode {
  readonly type: 'array';
  readonly start: number;
  readonly end: number;
  readonly items: JsonNode[];
}

export type JsonNode = ScalarNode | ObjectNode | ArrayNode;

function parse(text: string): JsonNode {
  const parser = new SpanParser(text);
  const root = parser.value(0);
  parser.skip();
  return root;
}

class SpanParser {
  readonly #text: string;
  #position = 0;

  constructor(text: string) {
    this.#text = text;
  }

  fail(message: string): never {
    const line = this.#text.slice(0, this.#position).split('\n').length;
    throw new Error(`${message} (line ${line})`);
  }

  skip(): void {
    while (this.#position < this.#text.length && WS.test(this.#text.charAt(this.#position))) {
      this.#position++;
    }
  }

  value(depth: number): JsonNode {
    if (depth > LIMITS.ipcDepthMax) {
      return this.fail('Nested too deeply');
    }
    this.skip();
    const start = this.#position;
    const first = this.#text.charAt(start);
    if (first === '{') {
      return this.object(start, depth);
    }
    if (first === '[') {
      return this.array(start, depth);
    }
    if (first === '"') {
      const span = this.string();
      return { type: 'scalar', start: span.start, end: span.end };
    }
    const text = this.#text;
    while (this.#position < text.length && !WS.test(text.charAt(this.#position)) && !',}]'.includes(text.charAt(this.#position))) {
      this.#position++;
    }
    if (this.#position === start) {
      return this.fail('Expected a value');
    }
    return { type: 'scalar', start, end: this.#position };
  }

  private string(): { start: number; end: number } {
    const text = this.#text;
    const start = this.#position;
    this.#position++;
    while (this.#position < text.length) {
      if (text.charAt(this.#position) === '\\') {
        this.#position += 2;
      } else if (text.charAt(this.#position) === '"') {
        this.#position++;
        return { start, end: this.#position };
      } else {
        this.#position++;
      }
    }
    return this.fail('Unterminated string');
  }

  private object(start: number, depth: number): ObjectNode {
    const text = this.#text;
    assert(text.charAt(start) === '{', 'An object starts at its brace');
    this.#position = start + 1;
    const members: Member[] = [];
    this.skip();
    if (text.charAt(this.#position) === '}') {
      this.#position++;
      return { type: 'object', start, end: this.#position, members };
    }
    for (let pass = 0; pass <= text.length; pass++) {
      this.skip();
      if (text.charAt(this.#position) !== '"') {
        return this.fail('Expected a key');
      }
      const keySpan = this.string();
      const parsedKey: unknown = JSON.parse(text.slice(keySpan.start, keySpan.end));
      if (typeof parsedKey !== 'string') {
        return this.fail('Expected a key');
      }
      this.skip();
      if (text.charAt(this.#position) !== ':') {
        return this.fail('Expected ":"');
      }
      this.#position++;
      const child = this.value(depth + 1);
      members.push({
        key: parsedKey,
        keyStart: keySpan.start,
        keyEnd: keySpan.end,
        start: keySpan.start,
        end: child.end,
        value: child,
      });
      this.skip();
      if (text.charAt(this.#position) === ',') {
        this.#position++;
        continue;
      }
      if (text.charAt(this.#position) === '}') {
        this.#position++;
        return { type: 'object', start, end: this.#position, members };
      }
      return this.fail('Expected "," or "}"');
    }
    assert(false, 'An object ends within its text');
  }

  private array(start: number, depth: number): ArrayNode {
    const text = this.#text;
    assert(text.charAt(start) === '[', 'An array starts at its bracket');
    this.#position = start + 1;
    const items: JsonNode[] = [];
    this.skip();
    if (text.charAt(this.#position) === ']') {
      this.#position++;
      return { type: 'array', start, end: this.#position, items };
    }
    for (let pass = 0; pass <= text.length; pass++) {
      items.push(this.value(depth + 1));
      this.skip();
      if (text.charAt(this.#position) === ',') {
        this.#position++;
        continue;
      }
      if (text.charAt(this.#position) === ']') {
        this.#position++;
        return { type: 'array', start, end: this.#position, items };
      }
      return this.fail('Expected "," or "]"');
    }
    assert(false, 'An array ends within its text');
  }
}

const parseData = (text: string): unknown => {
  const data: unknown = JSON.parse(text);
  return data;
};

function indentAt(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  const match = text.slice(lineStart, position).match(/^[ \t]*/);
  return match ? match[0] : '';
}

function indentUnit(text: string): string {
  const match = text.match(/\n([ \t]+)\S/);
  const unit = match?.[1];
  if (unit === undefined) {
    return '  ';
  }
  return unit.charAt(0) === '\t' ? '\t' : unit;
}

function print(value: unknown, baseIndent: string, unit: string): string {
  const body = JSON.stringify(value, null, unit);
  if (body === undefined) {
    return 'null';
  }
  return body.split('\n').join(`\n${baseIndent}`);
}

type Child =
  | Member
  | { readonly key: number; readonly start: number; readonly end: number; readonly value: JsonNode }
  | { readonly start: number; readonly end: number; readonly value: JsonNode };

function childAt(node: JsonNode | undefined, key: string | number | undefined): Child | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === 'object') {
    return node.members.find((member) => member.key === String(key));
  }
  if (node.type === 'array') {
    const item = node.items[Number(key)];
    return item ? { key: Number(key), start: item.start, end: item.end, value: item } : undefined;
  }
  return undefined;
}

interface Located {
  readonly parent: JsonNode | undefined;
  readonly key: string | number | undefined;
  readonly member: Child | undefined;
}

function locate(root: JsonNode, path: readonly (string | number)[]): Located | undefined {
  let node: JsonNode = root;
  for (let level = 0; level < path.length; level++) {
    const member = childAt(node, path[level]);
    if (!member) {
      return level === path.length - 1 ? { parent: node, key: path[level], member: undefined } : undefined;
    }
    if (level === path.length - 1) {
      return { parent: node, key: path[level], member };
    }
    node = member.value;
  }
  return {
    parent: undefined,
    key: undefined,
    member: { start: node.start, end: node.end, value: node },
  };
}

function insertion(text: string, container: JsonNode, unit: string): { at: number; before: string; after: string; inner: string } {
  const parts: readonly { start: number; end: number }[] = container.type === 'object' ? container.members : container.type === 'array' ? container.items : [];
  const openIndent = indentAt(text, container.start);
  const inner = openIndent + unit;
  if (!parts.length) {
    return { at: container.start + 1, before: `\n${inner}`, after: `\n${openIndent}`, inner };
  }
  const last = parts[parts.length - 1];
  const lastIndent = indentAt(text, last?.start ?? container.start);
  return {
    at: last?.end ?? container.end - 1,
    before: `,\n${lastIndent}`,
    after: '',
    inner: lastIndent,
  };
}

const DELETE = Symbol('delete');

export interface Edit {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly rename?: string;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  const unit = indentUnit(text);
  let out = text;

  for (const edit of edits) {
    const root = parse(out);
    const path = edit.path;

    if (edit.rename !== undefined) {
      const found = locate(root, path);
      const member = found?.member;
      if (member && 'keyEnd' in member) {
        out = out.slice(0, member.keyStart) + JSON.stringify(String(edit.rename)) + out.slice(member.keyEnd);
      }
      continue;
    }
    if (!path.length) {
      out = print(edit.value, '', unit) + (out.endsWith('\n') ? '\n' : '');
      continue;
    }

    let node: JsonNode = root;
    let depth = 0;
    while (depth < path.length - 1) {
      const member = childAt(node, path[depth]);
      if (!member) {
        break;
      }
      node = member.value;
      depth++;
    }

    const remaining = path.slice(depth);
    const target = childAt(node, remaining[0]);

    if (edit.value === DELETE) {
      if (remaining.length > 1 || !target) {
        continue;
      }
      out = removeMember(out, node, target);
      continue;
    }

    let value = edit.value;
    for (let level = path.length - 1; level > depth; level--) {
      const key = path[level];
      if (key === undefined) {
        continue;
      }
      value = typeof key === 'number' ? [value] : { [key]: value };
    }

    if (remaining.length === 1 && target) {
      const baseIndent = indentAt(out, target.value.start);
      out = out.slice(0, target.value.start) + print(value, baseIndent, unit) + out.slice(target.value.end);
      continue;
    }

    const spot = insertion(out, node, unit);
    const written = node.type === 'object' ? `${JSON.stringify(String(remaining[0]))}: ${print(value, spot.inner, unit)}` : print(value, spot.inner, unit);
    out = out.slice(0, spot.at) + spot.before + written + spot.after + out.slice(spot.at);
  }

  return out;
}

function removeMember(text: string, container: JsonNode, member: Child): string {
  const parts: readonly Child[] | readonly { start: number; end: number }[] =
    container.type === 'object' ? container.members : container.type === 'array' ? container.items : [];
  const index = parts.findIndex((part) => part.start === member.start);
  const only = parts.length === 1;
  let from = member.start;
  let to = member.end;

  if (only) {
    from = container.start + 1;
    to = container.end - 1;
    return text.slice(0, from) + text.slice(to);
  }
  if (index === parts.length - 1) {
    from = parts[index - 1]?.end ?? from;
  } else {
    to = parts[index + 1]?.start ?? to;
  }
  return text.slice(0, from) + text.slice(to);
}

export { parse, parseData, applyEdits, indentUnit, DELETE };
