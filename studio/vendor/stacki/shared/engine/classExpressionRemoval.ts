
import { parser } from '@lezer/javascript';
import type { SyntaxNode } from '@lezer/common';
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';

export const CLASS_EXPRESSION_LIMITS = {
  codeCharsMax: LIMITS.attrCharsMax,
  depthMax: 32,
  snippetsMax: 16,
} as const satisfies Record<string, number>;

export type ClassExpressionContext = 'list' | 'string';

export interface ClassExpressionSnippet {
  readonly code: string;
  readonly from: number;
  readonly to: number;
}

export type ClassExpressionRemoval =
  | { readonly tag: 'edited'; readonly code: string | undefined; readonly occurrences: number }
  | { readonly tag: 'absent' }
  | { readonly tag: 'computed'; readonly snippets: readonly ClassExpressionSnippet[] }
  | { readonly tag: 'unreadable'; readonly reason: ClassExpressionUnreadable };

export type ClassExpressionUnreadable = 'syntax' | 'limit' | 'verify';

export function removeClassFromExpression(code: string, name: string, context: ClassExpressionContext): ClassExpressionRemoval {
  assert(name.length > 0, 'removeClassFromExpression: a class has a name');
  assert(!/\s/.test(name), 'removeClassFromExpression: one class, no whitespace');
  if (code.length > CLASS_EXPRESSION_LIMITS.codeCharsMax) {
    return { tag: 'unreadable', reason: 'limit' };
  }
  const parsed = parseExpression(code);
  if (parsed === undefined) {
    return { tag: 'unreadable', reason: 'syntax' };
  }
  const plan = newPlan(parsed.text, name, quoteOf(parsed));
  const fate = visitValue(plan, parsed.root, context, 0);
  if (plan.limited) {
    return { tag: 'unreadable', reason: 'limit' };
  }
  if (plan.occurrences === 0) {
    assert(plan.edits.length === 0, 'removeClassFromExpression: nothing found, nothing edited');
    return plan.snippets.length === 0 ? { tag: 'absent' } : { tag: 'computed', snippets: snippetsOf(plan) };
  }
  if (fate === 'emptied') {
    return { tag: 'edited', code: undefined, occurrences: plan.occurrences };
  }
  const edited = applyReplacements(parsed.text, plan.edits);
  assert(edited.startsWith(WRAP_OPEN), 'removeClassFromExpression: the wrapper opens the edited text');
  assert(edited.endsWith(WRAP_CLOSE), 'removeClassFromExpression: the wrapper closes the edited text');
  const next = edited.slice(WRAP_OPEN.length, edited.length - WRAP_CLOSE.length);
  if (classExpressionOccurrences(next, name, context) !== 0) {
    return { tag: 'unreadable', reason: 'verify' };
  }
  return { tag: 'edited', code: next, occurrences: plan.occurrences };
}

export function classExpressionOccurrences(code: string, name: string, context: ClassExpressionContext): number | undefined {
  assert(name.length > 0, 'classExpressionOccurrences: a class has a name');
  if (code.length > CLASS_EXPRESSION_LIMITS.codeCharsMax) {
    return undefined;
  }
  const parsed = parseExpression(code);
  if (parsed === undefined) {
    return undefined;
  }
  const plan = newPlan(parsed.text, name, quoteOf(parsed));
  visitValue(plan, parsed.root, context, 0);
  if (plan.limited) {
    return undefined;
  }
  assert(plan.occurrences >= 0, 'classExpressionOccurrences: a count is never negative');
  return plan.occurrences;
}


const WRAP_OPEN = '(';
const WRAP_CLOSE = '\n)';
const expressionParser = parser.configure({ dialect: 'ts' });
const COMMENTS: ReadonlySet<string> = new Set(['LineComment', 'BlockComment']);

interface ParsedExpression {
  readonly text: string;
  readonly root: SyntaxNode;
}

function parseExpression(code: string): ParsedExpression | undefined {
  const text = `${WRAP_OPEN}${code}${WRAP_CLOSE}`;
  const tree = expressionParser.parse(text);
  let broken = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) {
        broken = true;
      }
      return !broken;
    },
  });
  if (broken) {
    return undefined;
  }
  const statements = childrenOf(tree.topNode);
  const statement = statements[0];
  if (statements.length !== 1 || statement === undefined || statement.name !== 'ExpressionStatement') {
    return undefined;
  }
  const parenthesized = childrenOf(statement)[0];
  if (parenthesized === undefined || parenthesized.name !== 'ParenthesizedExpression') {
    return undefined;
  }
  if (parenthesized.from !== 0 || parenthesized.to !== text.length) {
    return undefined;
  }
  const inner = childrenOf(parenthesized).filter((child) => child.name !== '(' && child.name !== ')');
  const root = inner[0];
  if (inner.length !== 1 || root === undefined) {
    return undefined;
  }
  assert(root.from >= WRAP_OPEN.length, 'parseExpression: the expression starts inside the wrapper');
  assert(root.to <= text.length - WRAP_CLOSE.length + 1, 'parseExpression: the expression ends inside the wrapper');
  return { text, root };
}

function childrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const childrenMax = node.to - node.from + 1;
  let child = node.firstChild;
  for (let index = 0; child !== null; index += 1) {
    assert(index < childrenMax, 'childrenOf: a node has fewer children than characters');
    if (!COMMENTS.has(child.name)) {
      out.push(child);
    }
    child = child.nextSibling;
  }
  return out;
}

function quoteOf(parsed: ParsedExpression): string {
  let quote: string | undefined = undefined;
  parsed.root.toTree().iterate({
    enter: (node) => {
      if (quote === undefined && node.name === 'String') {
        quote = parsed.text.charAt(parsed.root.from + node.from);
      }
      return quote === undefined;
    },
  });
  return quote ?? "'";
}


type Fate = 'kept' | 'emptied';

interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

class Plan {
  readonly edits: Replacement[] = [];
  readonly snippets: Range[] = [];
  private found = 0;
  private overLimit = false;

  constructor(
    readonly text: string,
    readonly name: string,
    readonly quote: string,
  ) {}

  get occurrences(): number {
    return this.found;
  }

  get limited(): boolean {
    return this.overLimit;
  }

  count(removed: number): void {
    assert(removed > 0, 'Plan.count: something was found');
    this.found += removed;
  }

  markLimited(): void {
    this.overLimit = true;
  }
}

function newPlan(text: string, name: string, quote: string): Plan {
  return new Plan(text, name, quote);
}

function visitValue(plan: Plan, node: SyntaxNode, context: ClassExpressionContext, depth: number): Fate {
  if (depth > CLASS_EXPRESSION_LIMITS.depthMax) {
    plan.markLimited();
    return 'kept';
  }
  switch (node.name) {
    case 'String':
      return visitString(plan, node);
    case 'TemplateString':
      return visitTemplate(plan, node, depth);
    case 'ArrayExpression':
      return context === 'list' ? visitArray(plan, node, depth) : computed(plan, node);
    case 'ObjectExpression':
      return context === 'list' ? visitObject(plan, node) : computed(plan, node);
    case 'ConditionalExpression':
      return visitConditional(plan, node, context, depth);
    case 'BinaryExpression':
      return visitBinary(plan, node, context, depth);
    case 'ParenthesizedExpression': {
      const inner = childrenOf(node).filter((child) => child.name !== '(' && child.name !== ')');
      const only = inner[0];
      if (inner.length !== 1 || only === undefined) {
        return computed(plan, node);
      }
      return visitValue(plan, only, context, depth + 1);
    }
    case 'BooleanLiteral':
    case 'null':
    case 'Number':
      return 'kept';
    case 'VariableName':
      return textOf(plan, node) === 'undefined' ? 'kept' : computed(plan, node);
    default:
      return computed(plan, node);
  }
}

function computed(plan: Plan, range: Range): Fate {
  if (plan.snippets.length < CLASS_EXPRESSION_LIMITS.snippetsMax) {
    plan.snippets.push({ from: range.from, to: range.to });
  }
  return 'kept';
}

function visitString(plan: Plan, node: SyntaxNode): Fate {
  assert(node.to - node.from >= 2, 'visitString: a string has its quotes');
  const raw = plan.text.slice(node.from + 1, node.to - 1);
  const words = withoutWord(raw, plan.name, NOT_GLUED);
  if (words.removed === 0) {
    return 'kept';
  }
  plan.count(words.removed);
  if (words.keptCount === 0) {
    return 'emptied';
  }
  plan.edits.push({ from: node.from + 1, to: node.to - 1, text: words.text });
  return 'kept';
}

function visitTemplate(plan: Plan, node: SyntaxNode, depth: number): Fate {
  const holes = childrenOf(node).filter((child) => child.name === 'Interpolation');
  const segments: Range[] = [];
  let start = node.from + 1;
  for (const hole of holes) {
    segments.push({ from: start, to: hole.from });
    start = hole.to;
  }
  segments.push({ from: start, to: node.to - 1 });
  assert(segments.length === holes.length + 1, 'visitTemplate: text sits around every hole');
  let keptWords = 0;
  for (const [index, segment] of segments.entries()) {
    const raw = plan.text.slice(segment.from, segment.to);
    const glue = { start: index > 0, end: index < holes.length };
    const words = withoutWord(raw, plan.name, glue);
    keptWords += words.keptCount;
    if (words.removed === 0) {
      continue;
    }
    plan.count(words.removed);
    const text = words.keptCount > 0 ? words.text : glue.start && glue.end ? ' ' : '';
    plan.edits.push({ from: segment.from, to: segment.to, text });
  }
  let keptHoles = 0;
  for (const hole of holes) {
    const inner = childrenOf(hole).filter((child) => child.name !== 'InterpolationStart' && child.name !== 'InterpolationEnd');
    const value = inner[0];
    const before = plan.text.charAt(hole.from - 1);
    const after = plan.text.charAt(hole.to);
    const alone = (hole.from - 1 === node.from || /\s/.test(before)) && (hole.to + 1 === node.to || /\s/.test(after));
    if (inner.length !== 1 || value === undefined || !alone) {
      computed(plan, hole);
      keptHoles += 1;
      continue;
    }
    if (visitValue(plan, value, 'string', depth + 1) === 'emptied') {
      plan.edits.push({ from: hole.from, to: hole.to, text: '' });
    } else {
      keptHoles += 1;
    }
  }
  if (keptWords === 0 && keptHoles === 0 && plan.occurrences > 0) {
    dropEditsWithin(plan, node);
    return 'emptied';
  }
  return 'kept';
}

function visitArray(plan: Plan, node: SyntaxNode, depth: number): Fate {
  const elements = listItems(childrenOf(node), '[', ']');
  const emptied = new Set<number>();
  for (const [index, element] of elements.entries()) {
    const first = element.nodes[0];
    assert(first !== undefined, 'visitArray: an element has a node');
    if (first.name === 'Spread' || element.nodes.length !== 1) {
      computed(plan, element);
      continue;
    }
    if (visitValue(plan, first, 'list', depth + 1) === 'emptied') {
      emptied.add(index);
    }
  }
  return removeItems(plan, node, elements, emptied);
}

function visitObject(plan: Plan, node: SyntaxNode): Fate {
  const properties = listItems(childrenOf(node), '{', '}');
  const emptied = new Set<number>();
  for (const [index, property] of properties.entries()) {
    const only = property.nodes[0];
    if (property.nodes.length !== 1 || only === undefined || only.name !== 'Property') {
      computed(plan, property);
      continue;
    }
    if (visitProperty(plan, only) === 'emptied') {
      emptied.add(index);
    }
  }
  return removeItems(plan, node, properties, emptied);
}

function visitProperty(plan: Plan, property: SyntaxNode): Fate {
  const parts = childrenOf(property);
  const key = parts[0];
  if (key === undefined || parts.some((part) => part.name === 'ParamList')) {
    return computed(plan, property);
  }
  if (key.name === 'PropertyDefinition') {
    if (textOf(plan, key) !== plan.name) {
      return 'kept';
    }
    plan.count(1);
    return 'emptied';
  }
  if (key.name !== 'String') {
    return computed(plan, property);
  }
  const raw = plan.text.slice(key.from + 1, key.to - 1);
  const words = withoutWord(raw, plan.name, NOT_GLUED);
  if (words.removed === 0) {
    return 'kept';
  }
  plan.count(words.removed);
  if (words.keptCount === 0) {
    return 'emptied';
  }
  plan.edits.push({ from: key.from + 1, to: key.to - 1, text: words.text });
  return 'kept';
}

function visitConditional(plan: Plan, node: SyntaxNode, context: ClassExpressionContext, depth: number): Fate {
  const operands = childrenOf(node).filter((child) => child.name !== 'LogicOp');
  const consequent = operands[1];
  const alternate = operands[2];
  if (operands.length !== 3 || consequent === undefined || alternate === undefined) {
    return computed(plan, node);
  }
  const consequentFate = visitValue(plan, consequent, context, depth + 1);
  const alternateFate = visitValue(plan, alternate, context, depth + 1);
  return emptiedOperands(plan, [
    { node: consequent, fate: consequentFate },
    { node: alternate, fate: alternateFate },
  ]);
}

function visitBinary(plan: Plan, node: SyntaxNode, context: ClassExpressionContext, depth: number): Fate {
  const parts = childrenOf(node);
  const left = parts[0];
  const operator = parts[1];
  const right = parts[2];
  if (parts.length !== 3 || left === undefined || operator === undefined || right === undefined || operator.name !== 'LogicOp') {
    return computed(plan, node);
  }
  const symbol = textOf(plan, operator);
  if (symbol === '&&') {
    return visitValue(plan, right, context, depth + 1);
  }
  if (symbol === '||' || symbol === '??') {
    const leftFate = visitValue(plan, left, context, depth + 1);
    const rightFate = visitValue(plan, right, context, depth + 1);
    return emptiedOperands(plan, [
      { node: left, fate: leftFate },
      { node: right, fate: rightFate },
    ]);
  }
  return computed(plan, node);
}

function emptiedOperands(plan: Plan, operands: readonly { readonly node: SyntaxNode; readonly fate: Fate }[]): Fate {
  assert(operands.length === 2, 'emptiedOperands: two operands');
  const gone = operands.filter((operand) => operand.fate === 'emptied');
  if (gone.length === 0) {
    return 'kept';
  }
  const nothingLeft = operands.every((operand) => operand.fate === 'emptied' || isNoClass(plan, operand.node));
  if (nothingLeft) {
    for (const operand of operands) {
      dropEditsWithin(plan, operand.node);
    }
    return 'emptied';
  }
  for (const operand of gone) {
    plan.edits.push({ from: operand.node.from, to: operand.node.to, text: `${plan.quote}${plan.quote}` });
  }
  return 'kept';
}

function isNoClass(plan: Plan, node: SyntaxNode): boolean {
  if (node.name === 'String') {
    return plan.text.slice(node.from + 1, node.to - 1).trim() === '';
  }
  if (node.name === 'null') {
    return true;
  }
  if (node.name === 'BooleanLiteral') {
    return textOf(plan, node) === 'false';
  }
  if (node.name === 'VariableName') {
    return textOf(plan, node) === 'undefined';
  }
  return false;
}


interface ListItem extends Range {
  readonly nodes: readonly SyntaxNode[];
}

function listItems(children: readonly SyntaxNode[], open: string, close: string): readonly ListItem[] {
  const items: ListItem[] = [];
  let current: SyntaxNode[] = [];
  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (first !== undefined && last !== undefined) {
      items.push({ from: first.from, to: last.to, nodes: current });
    }
    current = [];
  };
  for (const child of children) {
    if (child.name === open) {
      continue;
    }
    if (child.name === ',' || child.name === close) {
      flush();
      continue;
    }
    current.push(child);
  }
  flush();
  assert(items.length <= children.length, 'listItems: no more items than nodes');
  return items;
}

function removeItems(plan: Plan, container: SyntaxNode, items: readonly ListItem[], emptied: ReadonlySet<number>): Fate {
  if (emptied.size === 0) {
    return 'kept';
  }
  if (emptied.size === items.length) {
    dropEditsWithin(plan, container);
    return 'emptied';
  }
  const kept = items.map((_, index) => index).filter((index) => !emptied.has(index));
  const lastKept = kept.at(-1);
  assert(lastKept !== undefined, 'removeItems: an item is kept');
  const containerText = plan.text.slice(container.from, container.to);
  const lines = containerText.includes('\n') ? items.map((item) => ownLine(plan.text, item)) : [];
  const lineMode = lines.length === items.length && lines.every((line) => line !== undefined);
  if (lineMode) {
    for (const index of emptied) {
      const line = lines[index];
      assert(line !== undefined, 'removeItems: a line-mode item has its line');
      plan.edits.push({ from: line.from, to: line.to, text: '' });
    }
    const last = items.at(-1);
    const keptItem = items[lastKept];
    assert(last !== undefined, 'removeItems: a list has a last item');
    assert(keptItem !== undefined, 'removeItems: the last kept item exists');
    if (emptied.has(items.length - 1) && !/^[ \t]*,/.test(plan.text.slice(last.to))) {
      const comma = /^[ \t]*,/.exec(plan.text.slice(keptItem.to));
      if (comma !== null) {
        plan.edits.push({ from: keptItem.to, to: keptItem.to + comma[0].length, text: '' });
      }
    }
    return 'kept';
  }
  const firstKept = kept[0];
  assert(firstKept !== undefined, 'removeItems: a first item is kept');
  const firstKeptItem = items[firstKept];
  const firstItem = items[0];
  assert(firstKeptItem !== undefined, 'removeItems: the first kept item exists');
  assert(firstItem !== undefined, 'removeItems: the list has a first item');
  if (firstKept > 0) {
    plan.edits.push({ from: firstItem.from, to: firstKeptItem.from, text: '' });
  }
  for (const index of emptied) {
    if (index < firstKept) {
      continue;
    }
    const previous = items[index - 1];
    const item = items[index];
    assert(previous !== undefined, 'removeItems: a later item has one before it');
    assert(item !== undefined, 'removeItems: the item exists');
    plan.edits.push({ from: previous.to, to: item.to, text: '' });
  }
  return 'kept';
}

function ownLine(text: string, item: Range): Range | undefined {
  const lineStart = text.lastIndexOf('\n', item.from - 1) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, item.from))) {
    return undefined;
  }
  const tail = /^[ \t]*,?[ \t]*(?:\/\/[^\n]*)?\n/.exec(text.slice(item.to));
  if (tail === null) {
    return undefined;
  }
  return { from: lineStart, to: item.to + tail[0].length };
}


interface Glue {
  readonly start: boolean;
  readonly end: boolean;
}

const NOT_GLUED: Glue = { start: false, end: false };

interface Words {
  readonly text: string;
  readonly removed: number;
  readonly keptCount: number;
}

function withoutWord(raw: string, name: string, glue: Glue): Words {
  const matches = [...raw.matchAll(/\S+/g)];
  assert(matches.length <= raw.length, 'withoutWord: fewer words than characters');
  const kept: string[] = [];
  let removed = 0;
  let previousEnd = 0;
  for (const [index, match] of matches.entries()) {
    const word = match[0];
    const at = match.index;
    const before = raw.slice(previousEnd, at);
    previousEnd = at + word.length;
    const gluedStart = index === 0 && glue.start && at === 0;
    const gluedEnd = index === matches.length - 1 && glue.end && previousEnd === raw.length;
    if (word === name && !gluedStart && !gluedEnd) {
      removed += 1;
      continue;
    }
    kept.push(kept.length === 0 ? word : `${before}${word}`);
  }
  if (removed === 0) {
    return { text: raw, removed, keptCount: kept.length };
  }
  const leading = /^\s*/.exec(raw)?.[0] ?? '';
  const trailing = /\s*$/.exec(raw)?.[0] ?? '';
  const text = kept.length === 0 ? '' : `${leading}${kept.join('')}${trailing}`;
  assert(kept.length + removed === matches.length, 'withoutWord: every word is kept or removed');
  return { text, removed, keptCount: kept.length };
}

function textOf(plan: Plan, range: Range): string {
  return plan.text.slice(range.from, range.to);
}

function dropEditsWithin(plan: Plan, range: Range): void {
  const outside = plan.edits.filter((edit) => edit.to <= range.from || edit.from >= range.to);
  plan.edits.splice(0, plan.edits.length, ...outside);
}

function applyReplacements(text: string, edits: readonly Replacement[]): string {
  const sorted = [...edits].sort((first, second) => first.from - second.from);
  let out = '';
  let cursor = 0;
  for (const edit of sorted) {
    assert(edit.from >= cursor, 'applyReplacements: edits do not overlap');
    assert(edit.to >= edit.from, 'applyReplacements: an edit has a forward range');
    out += text.slice(cursor, edit.from) + edit.text;
    cursor = edit.to;
  }
  out += text.slice(cursor);
  assert(out.length <= text.length + edits.length * 2, 'applyReplacements: removal never grows the text past its quotes');
  return out;
}

function snippetsOf(plan: Plan): readonly ClassExpressionSnippet[] {
  return plan.snippets.map((range) => {
    const from = range.from - WRAP_OPEN.length;
    const to = range.to - WRAP_OPEN.length;
    assert(from >= 0, 'snippetsOf: a snippet starts inside the code');
    return { code: plan.text.slice(range.from, range.to), from, to };
  });
}
