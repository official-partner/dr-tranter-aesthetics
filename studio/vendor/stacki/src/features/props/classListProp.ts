
import { parser } from '@lezer/javascript';
import type { SyntaxNode } from '@lezer/common';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { err, ok, type Result } from '../../../shared/core/result';
import type { Attr } from '../../../shared/page/pageNode';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';
import type { NewPropHost, NewPropSeed } from './newPropModel';

export const CLASS_ATTRIBUTE = 'class';
export const CLASS_LIST_ATTRIBUTE = 'class:list';
export const CLASS_LIST_LOCAL = 'className';

export type ClassListRefusal = 'component' | 'spread' | 'taken' | 'shape';

export const CLASS_LIST_REFUSAL_KEYS: Readonly<Record<ClassListRefusal, MessageKey>> = {
  component: 'props.classListProp.refusal.component',
  spread: 'props.classListProp.refusal.spread',
  taken: 'props.classListProp.refusal.taken',
  shape: 'props.classListProp.refusal.shape',
};

export interface ClassListElement {
  readonly kind: string;
  readonly name: string;
  readonly props?: Readonly<Record<string, Attr | undefined>> | undefined;
}

export interface ClassListOffer {
  readonly refusal: ClassListRefusal | undefined;
  readonly onCreated: (local: string) => void;
}

export const CLASS_LIST_SEED: NewPropSeed = { fit: 'classList', label: CLASS_ATTRIBUTE, value: '' };

const HTML_TAG = /^[a-z][a-z0-9-]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ts = parser.configure({ dialect: 'ts' });

export function classListLocal(seed: Pick<NewPropSeed, 'fit'>, key: string): string | undefined {
  if (seed.fit !== 'classList') {
    return undefined;
  }
  return key === CLASS_ATTRIBUTE ? CLASS_LIST_LOCAL : undefined;
}

export function classListRefusal(element: ClassListElement, host: Pick<NewPropHost, 'propKeys' | 'restLocal'>): ClassListRefusal | undefined {
  if (element.kind !== 'element') {
    return 'component';
  }
  if (!HTML_TAG.test(element.name)) {
    return 'component';
  }
  if (host.propKeys.includes(CLASS_ATTRIBUTE)) {
    return 'taken';
  }
  const rewritten = withClassListProp(element.props ?? {}, CLASS_LIST_LOCAL, host.restLocal);
  return rewritten.ok ? undefined : rewritten.error;
}

export function classListOfferOf(
  element: ClassListElement,
  host: Pick<NewPropHost, 'propKeys' | 'restLocal'> | undefined,
  replace: ((props: Readonly<Record<string, Attr>>) => void) | undefined,
): ClassListOffer | undefined {
  if (host === undefined || replace === undefined) {
    return undefined;
  }
  const refusal = classListRefusal(element, host);
  const onCreated = (local: string): void => {
    assert(refusal === undefined, 'classListOfferOf: a refused row makes no prop');
    const rewritten = withClassListProp(element.props ?? {}, local, host.restLocal);
    assert(rewritten.ok, 'classListOfferOf: a prop is made only for an element the rewrite takes');
    replace(rewritten.value);
  };
  return { refusal, onCreated };
}

export function withClassListProp(
  props: Readonly<Record<string, Attr | undefined>>,
  local: string,
  restLocal: string | undefined,
): Result<Readonly<Record<string, Attr>>, ClassListRefusal> {
  assert(IDENTIFIER.test(local), 'withClassListProp: the prop is read by an identifier');
  const entries = Object.entries(props);
  assert(entries.length <= LIMITS.attrsPerNodeMax, 'withClassListProp: attribute limit exceeded');
  for (const [, value] of entries) {
    if (value?.type === 'spread' && value.value !== restLocal) {
      return err('spread');
    }
  }
  const list = props[CLASS_LIST_ATTRIBUTE];
  const target = list === undefined ? CLASS_ATTRIBUTE : CLASS_LIST_ATTRIBUTE;
  const value = list === undefined ? classListOfClass(props[CLASS_ATTRIBUTE], local) : classListAppended(list, local);
  if (value === undefined) {
    return err('shape');
  }
  const out: Record<string, Attr> = {};
  let placed = false;
  for (const [name, attribute] of entries) {
    if (attribute === undefined) {
      continue;
    }
    if (name === target) {
      define(out, CLASS_LIST_ATTRIBUTE, value);
      placed = true;
    } else {
      define(out, name, attribute);
    }
  }
  if (!placed) {
    define(out, CLASS_LIST_ATTRIBUTE, value);
  }
  assert(out[CLASS_LIST_ATTRIBUTE]?.type === 'expr', 'withClassListProp: the element has a class list');
  assert(list !== undefined || !Object.hasOwn(out, CLASS_ATTRIBUTE), 'withClassListProp: a class moved into the list is gone');
  return ok(out);
}

export function classListAppended(list: Attr, path: string): Attr | undefined {
  assert(path.trim() !== '', 'classListAppended: something is added');
  switch (list.type) {
    case 'expr':
      return expressionAppended(list.value, path);
    case 'string':
      return classListOfClass(list, path);
    case 'bare':
      return { type: 'expr', value: `[${path}]` };
    case 'spread':
      return undefined;
    default: {
      const exhaustive: never = list;
      return exhaustive;
    }
  }
}

function classListOfClass(value: Attr | undefined, local: string): Attr | undefined {
  if (value === undefined || value.type === 'bare') {
    return { type: 'expr', value: `[${local}]` };
  }
  switch (value.type) {
    case 'string': {
      const words = value.value.split(/\s+/).filter((word) => word !== '');
      return { type: 'expr', value: `[${[...words.map((word) => JSON.stringify(word)), local].join(', ')}]` };
    }
    case 'expr': {
      const entry = singleExpression(value.value);
      return entry === undefined ? undefined : { type: 'expr', value: `[${entry}, ${local}]` };
    }
    case 'spread':
      return undefined;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function expressionAppended(code: string, local: string): Attr | undefined {
  const array = arrayLiteral(code);
  if (array === undefined) {
    const entry = singleExpression(code);
    return entry === undefined ? undefined : { type: 'expr', value: `[${entry}, ${local}]` };
  }
  const last = array.lastEntryEnd;
  if (last === undefined) {
    const out = `${code.slice(0, array.open + 1)}${local}${code.slice(array.close)}`;
    return { type: 'expr', value: out };
  }
  const lineStart = code.lastIndexOf('\n', last - 1) + 1;
  const indent = /^[ \t]*/.exec(code.slice(lineStart))?.[0] ?? '';
  const multiline = code.slice(array.open, array.close).includes('\n');
  const separator = multiline ? `,\n${indent}` : ', ';
  const out = `${code.slice(0, last)}${separator}${local}${code.slice(last)}`;
  assert(out.length > code.length, 'expressionAppended: the prop is added');
  return { type: 'expr', value: out };
}

interface ArrayLiteral {
  readonly open: number;
  readonly close: number;
  readonly lastEntryEnd: number | undefined;
}

const PUNCTUATION = new Set(['[', ']', ',', 'LineComment', 'BlockComment']);

function arrayLiteral(code: string): ArrayLiteral | undefined {
  const expression = parsedExpression(code);
  if (expression === undefined || expression.node.name !== 'ArrayExpression') {
    return undefined;
  }
  const { node, offset } = expression;
  if (node.from - offset !== leadingSpace(code) || node.to - offset !== code.trimEnd().length) {
    return undefined;
  }
  let lastEntryEnd: number | undefined;
  let child = node.firstChild ?? undefined;
  for (let count = 0; child !== undefined; count++) {
    assert(count <= LIMITS.attrCharsMax, 'arrayLiteral: an array has fewer entries than characters');
    if (!PUNCTUATION.has(child.name)) {
      lastEntryEnd = child.to - offset;
    }
    child = child.nextSibling ?? undefined;
  }
  const out = { open: node.from - offset, close: node.to - offset - 1, lastEntryEnd };
  assert(code.charAt(out.open) === '[', 'arrayLiteral: the array opens with a bracket');
  assert(code.charAt(out.close) === ']', 'arrayLiteral: the array closes with a bracket');
  return out;
}

function singleExpression(code: string): string | undefined {
  const expression = parsedExpression(code);
  if (expression === undefined || expression.node.name === 'SequenceExpression') {
    return undefined;
  }
  return code.trim();
}

function parsedExpression(code: string): { readonly node: SyntaxNode; readonly offset: number } | undefined {
  if (code.trim() === '' || code.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  const source = `(${code});`;
  const tree = ts.parse(source);
  let broken = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) {
        broken = true;
      }
      return !broken;
    },
  });
  const statement = tree.topNode.firstChild ?? undefined;
  if (broken || statement === undefined || statement.name !== 'ExpressionStatement' || statement.nextSibling !== null) {
    return undefined;
  }
  const parenthesized = statement.firstChild ?? undefined;
  if (parenthesized === undefined || parenthesized.name !== 'ParenthesizedExpression' || parenthesized.to !== source.length - 1) {
    return undefined;
  }
  const inner = parenthesized.firstChild?.nextSibling ?? undefined;
  if (inner === undefined || inner.nextSibling?.name !== ')') {
    return undefined;
  }
  return { node: inner, offset: 1 };
}

function leadingSpace(code: string): number {
  return code.length - code.trimStart().length;
}

function define(target: Record<string, Attr>, name: string, value: Attr): void {
  Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}
