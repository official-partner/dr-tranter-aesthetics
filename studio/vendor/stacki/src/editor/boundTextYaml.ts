
import * as YAML from 'yaml';
import { assert } from '../../shared/core/assert';

export const YAML_QUOTES = ['yaml-plain', 'yaml-single', 'yaml-double'] as const;
export type YamlQuote = (typeof YAML_QUOTES)[number];

export const isYamlQuote = (quote: string): quote is YamlQuote => YAML_QUOTES.some((entry) => entry === quote);

export type YamlStep = { readonly kind: 'key'; readonly name: string } | { readonly kind: 'index'; readonly at: number };

export type YamlBlockReason = 'computed' | 'missing' | 'multiline' | 'not-text' | 'unreadable';

export type YamlFound =
  | { readonly kind: 'site'; readonly start: number; readonly end: number; readonly quote: YamlQuote; readonly value: string; readonly raw: string }
  | { readonly kind: 'list'; readonly count: number }
  | { readonly kind: 'block'; readonly reason: YamlBlockReason; readonly detail: string; readonly line: number };

export const YAML_TEXT_CHARS_MAX = 2_000_000;

const PARSE_OPTIONS = { keepSourceTokens: false, uniqueKeys: true, version: '1.2', prettyErrors: false } as const;

export function findYamlValue(text: string, steps: readonly YamlStep[], want: 'string' | 'list'): YamlFound {
  if (text.length > YAML_TEXT_CHARS_MAX) {
    return yamlBlock('unreadable', 'The YAML file is larger than the editor reads.', text, 0);
  }
  const document = YAML.parseDocument(text, PARSE_OPTIONS);
  const firstError = document.errors[0];
  if (firstError !== undefined) {
    return yamlBlock('unreadable', `The YAML file does not parse: ${firstError.message}`, text, firstError.pos[0]);
  }
  let node: unknown = document.contents;
  for (const step of steps) {
    const walked = yamlChild(node, step, text);
    if (walked.kind === 'block') {
      return walked;
    }
    node = walked.node;
  }
  return yamlLeaf(node, want, text);
}

type Walked = { readonly kind: 'node'; readonly node: unknown } | Extract<YamlFound, { readonly kind: 'block' }>;

function yamlChild(node: unknown, step: YamlStep, text: string): Walked {
  if (YAML.isAlias(node)) {
    return yamlBlock('computed', `An alias (*${node.source}) supplies this value.`, text, node.range?.[0] ?? 0);
  }
  if (YAML.isMap(node)) {
    if (step.kind === 'key') {
      const matches = node.items.filter((pair) => YAML.isScalar(pair.key) && String(pair.key.value) === step.name);
      if (matches.length === 1) {
        return { kind: 'node', node: matches[0]?.value };
      }
      const merged = node.items.some((pair) => YAML.isScalar(pair.key) && pair.key.value === '<<');
      return merged
        ? yamlBlock('computed', `A merge key (<<) may supply ${step.name}.`, text, node.range?.[0] ?? 0)
        : yamlBlock('missing', `${step.name} is not written in this mapping.`, text, node.range?.[0] ?? 0);
    }
    return yamlBlock('missing', 'A mapping has values by name, not by number.', text, node.range?.[0] ?? 0);
  }
  if (YAML.isSeq(node)) {
    const item = step.kind === 'index' ? node.items[step.at] : undefined;
    if (item === undefined) {
      const detail = step.kind === 'index' ? `The list has no item ${step.at}.` : 'A list has items by number, not by name.';
      return yamlBlock('missing', detail, text, node.range?.[0] ?? 0);
    }
    return { kind: 'node', node: item };
  }
  return yamlBlock('missing', 'The path goes past a value that has no fields.', text, 0);
}

function yamlLeaf(node: unknown, want: 'string' | 'list', text: string): YamlFound {
  if (YAML.isSeq(node)) {
    return want === 'list' ? { kind: 'list', count: node.items.length } : yamlBlock('not-text', 'This value is a list, not text.', text, node.range?.[0] ?? 0);
  }
  if (YAML.isAlias(node)) {
    return yamlBlock('computed', `An alias (*${node.source}) supplies this value.`, text, node.range?.[0] ?? 0);
  }
  if (!YAML.isScalar(node) || typeof node.value !== 'string' || want !== 'string') {
    return yamlBlock('not-text', 'This value is not one string.', text, rangeStart(node));
  }
  const range = node.range;
  if (range === undefined || range === null) {
    return yamlBlock('missing', 'This value has no place in the file.', text, 0);
  }
  if (node.tag !== undefined) {
    return yamlBlock('computed', `A tag (${node.tag}) converts this value.`, text, range[0]);
  }
  const quote = yamlQuoteOf(node.type);
  if (quote === undefined) {
    return yamlBlock('multiline', 'A block scalar (| or >) holds this text over several lines.', text, range[0]);
  }
  const raw = text.slice(range[0], range[1]);
  if (raw.includes('\n') || raw.includes('\r')) {
    return yamlBlock('multiline', 'This text is folded over several lines.', text, range[0]);
  }
  assert(raw.length > 0, 'A YAML scalar with a value spans some characters');
  assert(range[1] <= text.length, 'A YAML scalar ends inside its file');
  return { kind: 'site', start: range[0], end: range[1], quote, value: node.value, raw };
}

const YAML_QUOTE_OF_TYPE: Readonly<Record<string, YamlQuote>> = { PLAIN: 'yaml-plain', QUOTE_SINGLE: 'yaml-single', QUOTE_DOUBLE: 'yaml-double' };

function yamlQuoteOf(type: string | undefined): YamlQuote | undefined {
  return type === undefined ? undefined : YAML_QUOTE_OF_TYPE[type];
}

function rangeStart(node: unknown): number {
  if (YAML.isNode(node)) {
    return node.range?.[0] ?? 0;
  }
  return 0;
}

function yamlBlock(reason: YamlBlockReason, detail: string, text: string, offset: number): Extract<YamlFound, { readonly kind: 'block' }> {
  return { kind: 'block', reason, detail, line: lineAt(text, offset) };
}

export function lineAt(text: string, offset: number): number {
  assert(offset >= 0, 'A line is asked for an offset inside the text');
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let index = 0; index < end; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
    }
  }
  return line;
}

export function encodeYamlScalar(value: string, quote: YamlQuote): string {
  const encoded = encodeYamlScalarStyle(value, quote);
  assert(!encoded.includes('\n'), 'An encoded YAML scalar stays on one line');
  assert(YAML.parse(encoded, PARSE_OPTIONS) === value, 'An encoded YAML scalar reads back as its value');
  return encoded;
}

function encodeYamlScalarStyle(value: string, quote: YamlQuote): string {
  switch (quote) {
    case 'yaml-plain':
      return plainSpells(value) ? value : doubleQuoted(value);
    case 'yaml-single':
      return singleSpells(value) ? `'${value.replaceAll("'", "''")}'` : doubleQuoted(value);
    case 'yaml-double':
      return doubleQuoted(value);
    default: {
      const exhaustive: never = quote;
      return exhaustive;
    }
  }
}

const doubleQuoted = (value: string): string => JSON.stringify(value);

const SINGLE_UNSPELLABLE = /[\u0000-\u0008\u000a-\u001f\u007f]/;

function singleSpells(value: string): boolean {
  return !SINGLE_UNSPELLABLE.test(value);
}

const PLAIN_FIRST_UNSAFE = /^[-?:,[\]{}#&*!|>'"%@`\s]/;
const PLAIN_ANYWHERE_UNSAFE = /[\u0000-\u001f\u007f,[\]{}]|: |:$| #|\s$/;

function plainSpells(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (PLAIN_FIRST_UNSAFE.test(value)) {
    return false;
  }
  if (PLAIN_ANYWHERE_UNSAFE.test(value)) {
    return false;
  }
  return YAML.parse(value, PARSE_OPTIONS) === value;
}
