import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { foldSearchText, holdsEveryWord, queryWords } from '../../lib/searchText';
import { labelsNode } from '../../../shared/page/leadingNote';
import { hidesChildRows } from '../../editor/treeSelection';
import type { NavigatorNode } from './structureModel';

export const NAVIGATOR_MATCHES_MAX = 500;

export interface NavigatorIndexEntry {
  readonly text: string;
  readonly names: string;
  readonly content: string;
  readonly tag: string;
  readonly classes: readonly string[];
  readonly id: string;
  readonly attributes: ReadonlyMap<string, string | undefined>;
  readonly comment: string | undefined;
}

export type NavigatorSearchIndex = ReadonlyMap<string, NavigatorIndexEntry>;

export const NAVIGATOR_VALUE_CHARS_MAX = 500;

export const NAVIGATOR_URL_CHARS_MAX = 120;

export const NAVIGATOR_TOKEN_CHARS_MAX = 100;

export const NAVIGATOR_CONTENT_CHARS_MAX = 2_000;

export const NAVIGATOR_SNIPPET_CONTEXT_CHARS = 20;

export const NAVIGATOR_QUERY_LENGTH_MAX = 200;

export const NAVIGATOR_TERMS_MAX = 8;

export interface NavigatorSearchResult {
  readonly nodes: readonly NavigatorNode[];
  readonly matchCount: number;
  readonly capped: boolean;
  readonly snippets: ReadonlyMap<string, string>;
}

export function buildNavigatorIndex(nodes: readonly NavigatorNode[], rowLabels?: ReadonlyMap<string, string>): NavigatorSearchIndex {
  const index = new Map<string, NavigatorIndexEntry>();
  const stack: { readonly node: NavigatorNode; readonly depth: number }[] = nodes.map((node) => ({ node, depth: 0 }));
  for (let step = 0; step < LIMITS.treeNodesMax && stack.length > 0; step += 1) {
    const entry = stack.pop();
    assert(entry !== undefined, 'The stack had a node');
    assert(entry.depth <= LIMITS.treeDepthMax, 'The Navigator index walks no deeper than a page tree');
    index.set(entry.node.id, entryOf(entry.node, rowLabels?.get(entry.node.id)));
    for (const child of childrenOf(entry.node)) {
      stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
  assert(stack.length === 0, 'The index walk visited every node');
  return index;
}

export function searchNavigator(nodes: readonly NavigatorNode[], index: NavigatorSearchIndex, query: string): NavigatorSearchResult {
  const terms = parseNavigatorQuery(query);
  const budget = new MatchBudget();
  if (terms.length === 0) {
    return { nodes: [], matchCount: 0, capped: false, snippets: new Map() };
  }
  const walk: Walk = { index, terms, budget, labelled: new Set<string>(), snippets: new Map<string, string>() };
  const kept = keepAll(nodes, walk, 0);
  assert(budget.matches <= NAVIGATOR_MATCHES_MAX, 'Matches stay within the bound');
  return { nodes: kept, matchCount: budget.matches, capped: budget.capped, snippets: walk.snippets };
}

interface Walk {
  readonly index: NavigatorSearchIndex;
  readonly terms: readonly QueryTerm[];
  readonly budget: MatchBudget;
  readonly labelled: Set<string>;
  readonly snippets: Map<string, string>;
}

class MatchBudget {
  matches = 0;
  capped = false;

  take(): boolean {
    if (this.matches >= NAVIGATOR_MATCHES_MAX) {
      this.capped = true;
      return false;
    }
    this.matches += 1;
    return true;
  }
}

function keepAll(nodes: readonly NavigatorNode[], walk: Walk, depth: number): readonly NavigatorNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'The Navigator search walks no deeper than a page tree');
  const kept: NavigatorNode[] = [];
  noteLabelled(nodes, walk);
  for (const node of nodes) {
    const keptNode = keepNode(node, walk, depth);
    if (keptNode !== undefined) {
      kept.push(keptNode);
    }
  }
  return kept;
}

function keepNode(node: NavigatorNode, walk: Walk, depth: number): NavigatorNode | undefined {
  assert(depth <= LIMITS.treeDepthMax, 'The Navigator search walks no deeper than a page tree');
  const own = matchesOwn(node, walk);
  switch (node.kind) {
    case 'component':
    case 'element': {
      if (node.children !== undefined && hidesChildRows(node, node.children)) {
        return own ? node : undefined;
      }
      const children = node.children === undefined ? [] : keepAll(node.children, walk, depth + 1);
      return own || children.length > 0 ? { ...node, children } : undefined;
    }
    case 'map': {
      const children = keepAll(node.children, walk, depth + 1);
      return own || children.length > 0 ? { ...node, children } : undefined;
    }
    case 'chunk-group': {
      const children = keepAll(node.children, walk, depth + 1);
      return own || children.length > 0 ? { ...node, children } : undefined;
    }
    case 'branch': {
      const children = keepAll(node.children, walk, depth + 1);
      return own || children.length > 0 ? { ...node, children } : undefined;
    }
    case 'cond': {
      const children = node.children.flatMap((branch) => {
        const keptBranch = keepNode(branch, walk, depth + 1);
        return keptBranch !== undefined && keptBranch.kind === 'branch' ? [keptBranch] : [];
      });
      return own || children.length > 0 ? { ...node, children } : undefined;
    }
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'raw':
      return own ? node : undefined;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function noteLabelled(nodes: readonly NavigatorNode[], walk: Walk): void {
  for (let position = 0; position + 1 < nodes.length; position += 1) {
    const node = nodes[position];
    const following = nodes[position + 1];
    if (node === undefined || following === undefined || node.kind !== 'comment') {
      continue;
    }
    if (labelsNode(node.kind, following.kind)) {
      const entry = walk.index.get(node.id);
      if (entry !== undefined && termsMatch(entry, walk.terms)) {
        walk.labelled.add(following.id);
      }
    }
  }
}

function matchesOwn(node: NavigatorNode, walk: Walk): boolean {
  const entry = walk.index.get(node.id);
  if (entry === undefined || !(walk.labelled.has(node.id) || termsMatch(entry, walk.terms))) {
    return false;
  }
  if (!walk.budget.take()) {
    return false;
  }
  const snippet = snippetOf(entry, walk.terms);
  if (snippet !== undefined) {
    walk.snippets.set(node.id, snippet);
  }
  return true;
}

function childrenOf(node: NavigatorNode): readonly NavigatorNode[] {
  switch (node.kind) {
    case 'component':
    case 'element':
      return node.children ?? [];
    case 'map':
    case 'chunk-group':
    case 'branch':
    case 'cond':
      return node.children;
    case 'text':
    case 'expr':
    case 'raw':
    case 'comment':
    case 'raw-line':
      return [];
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function entryOf(node: NavigatorNode, label: string | undefined): NavigatorIndexEntry {
  const classes: string[] = [];
  const attributes = new Map<string, string | undefined>();
  let id = '';
  let tag = '';
  let comment: string | undefined;
  if (node.kind === 'component' || node.kind === 'element') {
    tag = foldSearchText(node.name);
    for (const [name, attribute] of Object.entries(node.props ?? {})) {
      const value = attribute.type === 'string' ? foldSearchText(attribute.value) : undefined;
      attributes.set(foldSearchText(name), value);
      if (value !== undefined && (name === 'class' || name === 'className')) {
        classes.push(...value.split(/\s+/u).filter((token) => token.length > 0));
      }
      if (value !== undefined && name === 'id') {
        id = value;
      }
    }
  }
  if (node.kind === 'comment') {
    comment = foldSearchText(node.value);
  }
  const content = contentOf(node);
  const names = foldSearchText(nodeText(node, tag)) + ' ' + classes.join(' ') + ' ' + id + (label === undefined ? '' : ' ' + foldSearchText(label));
  const text = names + (comment === undefined ? '' : ' ' + comment) + ' ' + foldSearchText(content);
  return { text, names, content, tag, classes, id, attributes, comment };
}

const CONTENT_SKIPPED_PROPS: ReadonlySet<string> = new Set(['class', 'classname', 'id', 'style', 'slot', 'class:list']);

function contentOf(node: NavigatorNode): string {
  if (node.kind !== 'component' && node.kind !== 'element') {
    return '';
  }
  const parts: string[] = [];
  let length = 0;
  const add = (candidate: string | undefined): void => {
    const value = candidate === undefined ? undefined : searchableValue(candidate);
    if (value !== undefined && length + value.length + 1 <= NAVIGATOR_CONTENT_CHARS_MAX) {
      parts.push(value);
      length += value.length + 1;
    }
  };
  for (const [name, attribute] of Object.entries(node.props ?? {})) {
    if (!CONTENT_SKIPPED_PROPS.has(name.toLowerCase())) {
      add(attribute.type === 'string' ? attribute.value : attribute.type === 'expr' ? literalOf(attribute.value) : undefined);
    }
  }
  for (const child of node.children ?? []) {
    add(child.kind === 'text' ? child.value : child.kind === 'expr' ? literalOf(child.value) : undefined);
  }
  return parts.join(' ');
}

function literalOf(expression: string): string | undefined {
  const inner = expression
    .trim()
    .replace(/^\{|\}$/gu, '')
    .trim();
  const quote = inner.charAt(0);
  if (inner.length < 2 || inner.charAt(inner.length - 1) !== quote) {
    return undefined;
  }
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return undefined;
  }
  const body = inner.slice(1, inner.length - 1);
  return body.includes(quote) || body.includes('${') || body.includes('\\') ? undefined : body;
}

function searchableValue(raw: string): string | undefined {
  if (raw.length > NAVIGATOR_VALUE_CHARS_MAX * 2) {
    return undefined;
  }
  const value = raw
    .replace(/<[^<>]{0,300}>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (value.length === 0 || value.length > NAVIGATOR_VALUE_CHARS_MAX || !/\p{L}/u.test(value)) {
    return undefined;
  }
  if (value.startsWith('data:')) {
    return undefined;
  }
  if (value.length > NAVIGATOR_URL_CHARS_MAX && /^(?:[a-z]+:\/\/|\/|\.\.?\/)/iu.test(value)) {
    return undefined;
  }
  if (value.split(' ').some((token) => token.length > NAVIGATOR_TOKEN_CHARS_MAX)) {
    return undefined;
  }
  return value;
}

export function snippetOf(entry: NavigatorIndexEntry, terms: readonly QueryTerm[]): string | undefined {
  const words = terms.flatMap((term) => (term.kind === 'word' ? [term.word] : []));
  if (entry.content.length === 0 || words.length === 0 || words.every((word) => entry.names.includes(word))) {
    return undefined;
  }
  const characters = Array.from(entry.content);
  let folded = '';
  const owner: number[] = [];
  for (const [position, character] of characters.entries()) {
    const piece = foldSearchText(character);
    for (let step = 0; step < piece.length; step += 1) {
      owner.push(position);
    }
    folded += piece;
  }
  const hits = words.map((word) => folded.indexOf(word)).filter((at) => at >= 0);
  if (hits.length === 0) {
    return undefined;
  }
  const at = Math.min(...hits);
  const from = Math.max(0, (owner[at] ?? 0) - NAVIGATOR_SNIPPET_CONTEXT_CHARS);
  const longest = Math.max(...words.map((word) => word.length));
  const to = Math.min(characters.length, (owner[Math.min(at + longest, owner.length - 1)] ?? characters.length) + NAVIGATOR_SNIPPET_CONTEXT_CHARS);
  return `${from > 0 ? '…' : ''}${characters.slice(from, to).join('').trim()}${to < characters.length ? '…' : ''}`;
}

function nodeText(node: NavigatorNode, foldedTag: string): string {
  switch (node.kind) {
    case 'component':
    case 'element':
      return foldedTag;
    case 'raw':
    case 'chunk-group':
      return node.name;
    case 'text':
    case 'expr':
    case 'raw-line':
      return node.value;
    case 'map':
      return node.head;
    case 'cond':
      return node.test;
    case 'comment':
    case 'branch':
      return '';
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}


export type AttributeOperator = 'exists' | '=' | '^=' | '$=' | '*=' | '~=';

export type QueryTerm =
  | { readonly kind: 'word'; readonly word: string }
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'id'; readonly name: string }
  | { readonly kind: 'tag'; readonly name: string; readonly whole: 'exact' | 'prefix' }
  | { readonly kind: 'attribute'; readonly name: string; readonly operator: AttributeOperator; readonly value: string }
  | { readonly kind: 'comment'; readonly text: string };

const NAME_BREAK = /[\s.#[\]<>/=]/u;
const ATTRIBUTE_NAME = /^[\w:@.-]+$/u;

export function parseNavigatorQuery(query: string): readonly QueryTerm[] {
  const text = query.slice(0, NAVIGATOR_QUERY_LENGTH_MAX);
  const terms: QueryTerm[] = [];
  let at = 0;
  for (let pass = 0; pass <= text.length && at < text.length && terms.length < NAVIGATOR_TERMS_MAX; pass += 1) {
    const first = text.charAt(at);
    if (/\s/u.test(first)) {
      at += 1;
      continue;
    }
    const read = readTerm(text, at);
    assert(read.next > at, 'Every term consumes text');
    at = read.next;
    terms.push(...read.terms);
  }
  return terms;
}

interface TermRead {
  readonly terms: readonly QueryTerm[];
  readonly next: number;
}

function readTerm(text: string, at: number): TermRead {
  const rest = text.slice(at);
  if (rest.startsWith('/*') || rest.startsWith('<!--') || rest.startsWith('{/*')) {
    return readComment(text, at);
  }
  const first = text.charAt(at);
  if (first === '[') {
    const attribute = readAttribute(text, at);
    if (attribute !== undefined) {
      return attribute;
    }
  }
  if (first === '<') {
    const tag = readTag(text, at);
    if (tag !== undefined) {
      return tag;
    }
  }
  if (first === '.' || first === '#') {
    const end = nameEnd(text, at + 1);
    if (end > at + 1) {
      const name = foldSearchText(text.slice(at + 1, end));
      return { terms: [first === '.' ? { kind: 'class', name } : { kind: 'id', name }], next: end };
    }
  }
  return readWord(text, at);
}

function readComment(text: string, at: number): TermRead {
  let body = text
    .slice(at)
    .replace(/^\{?\/\*|^<!--/u, '')
    .trim();
  for (const closing of ['*/}', '*/', '-->']) {
    if (body.endsWith(closing)) {
      body = body.slice(0, body.length - closing.length).trim();
      break;
    }
  }
  return { terms: [{ kind: 'comment', text: foldSearchText(body) }], next: text.length };
}

function readTag(text: string, at: number): TermRead | undefined {
  const start = text.charAt(at + 1) === '/' ? at + 2 : at + 1;
  let end = start;
  while (end < text.length && !NAME_BREAK.test(text.charAt(end))) {
    end += 1;
  }
  if (end === start) {
    return undefined;
  }
  const closed = text.charAt(end) === '>';
  return { terms: [{ kind: 'tag', name: foldSearchText(text.slice(start, end)), whole: closed ? 'exact' : 'prefix' }], next: closed ? end + 1 : end };
}

function readAttribute(text: string, at: number): TermRead | undefined {
  const close = text.indexOf(']', at);
  if (close < 0) {
    return undefined;
  }
  const inner = text.slice(at + 1, close).trim();
  const operatorAt = inner.search(/[\^$*~=]/u);
  const name = (operatorAt < 0 ? inner : inner.slice(0, operatorAt)).trim();
  if (!ATTRIBUTE_NAME.test(name)) {
    return undefined;
  }
  const folded = foldSearchText(name);
  if (operatorAt < 0) {
    return { terms: [{ kind: 'attribute', name: folded, operator: 'exists', value: '' }], next: close + 1 };
  }
  const operator = inner.slice(operatorAt, inner.indexOf('=', operatorAt) + 1);
  if (operator !== '=' && operator !== '^=' && operator !== '$=' && operator !== '*=' && operator !== '~=') {
    return undefined;
  }
  let value = inner.slice(inner.indexOf('=', operatorAt) + 1).trim();
  const quote = value.charAt(0);
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, value.length - 1);
  }
  return { terms: [{ kind: 'attribute', name: folded, operator, value: foldSearchText(value) }], next: close + 1 };
}

function readWord(text: string, at: number): TermRead {
  let end = at;
  while (end < text.length && !/\s/u.test(text.charAt(end))) {
    end += 1;
  }
  return { terms: queryWords(text.slice(at, end)).map((word): QueryTerm => ({ kind: 'word', word })), next: Math.max(end, at + 1) };
}

function nameEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && !NAME_BREAK.test(text.charAt(end))) {
    end += 1;
  }
  return end;
}

export function termsMatch(entry: NavigatorIndexEntry, terms: readonly QueryTerm[]): boolean {
  if (terms.length === 0) {
    return false;
  }
  return terms.every((term) => termMatches(entry, term));
}

function termMatches(entry: NavigatorIndexEntry, term: QueryTerm): boolean {
  switch (term.kind) {
    case 'word':
      return holdsEveryWord(entry.text, [term.word]);
    case 'class':
      return entry.classes.some((token) => token.startsWith(term.name));
    case 'id':
      return entry.id.length > 0 && entry.id.startsWith(term.name);
    case 'tag':
      return entry.tag.length > 0 && (term.whole === 'exact' ? entry.tag === term.name : entry.tag.startsWith(term.name));
    case 'comment':
      return entry.comment !== undefined && entry.comment.includes(term.text);
    case 'attribute':
      return attributeMatches(entry, term);
    default: {
      const exhaustive: never = term;
      return exhaustive;
    }
  }
}

function attributeMatches(entry: NavigatorIndexEntry, term: Extract<QueryTerm, { readonly kind: 'attribute' }>): boolean {
  if (!entry.attributes.has(term.name)) {
    return false;
  }
  const value = entry.attributes.get(term.name);
  switch (term.operator) {
    case 'exists':
      return true;
    case '=':
      return value === term.value || (value === undefined && term.value === '');
    case '^=':
      return value !== undefined && term.value.length > 0 && value.startsWith(term.value);
    case '$=':
      return value !== undefined && term.value.length > 0 && value.endsWith(term.value);
    case '*=':
      return value !== undefined && term.value.length > 0 && value.includes(term.value);
    case '~=':
      return value !== undefined && term.value.length > 0 && value.split(/\s+/u).includes(term.value);
    default: {
      const exhaustive: never = term.operator;
      return exhaustive;
    }
  }
}

export function navigatorHighlightWords(query: string): readonly string[] {
  const words: string[] = [];
  for (const term of parseNavigatorQuery(query)) {
    switch (term.kind) {
      case 'word':
        words.push(term.word);
        break;
      case 'class':
      case 'id':
      case 'tag':
        words.push(term.name);
        break;
      case 'attribute':
        words.push(term.value.length > 0 ? term.value : term.name);
        break;
      case 'comment':
        words.push(...queryWords(term.text));
        break;
      default: {
        const exhaustive: never = term;
        return exhaustive;
      }
    }
  }
  return words;
}
