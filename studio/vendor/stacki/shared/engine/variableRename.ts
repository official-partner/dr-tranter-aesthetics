
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { diffCodePatch, type CodeHunk } from './codePatch';
import type { PageModel, PageNode } from '../page/pageNode';
import { bindingScope, innerNamesAt, readModuleScope, readTemplateScope, scopeAt, type JsAnalysis, type JsDefinitionForm, type JsScope } from './jsScope';

export interface FileCode {
  readonly source: string;
  readonly model: Pick<PageModel, 'nodes' | 'format' | 'hadFrontmatter' | 'bodyStart'>;
}

export interface VariableRename {
  readonly from: string;
  readonly to: string;
}

interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export type RenameProblem =
  | { readonly code: 'invalid-name'; readonly name: string }
  | { readonly code: 'reserved-word'; readonly name: string }
  | { readonly code: 'not-declared'; readonly name: string }
  | { readonly code: 'exists'; readonly name: string; readonly choose: 'none' | 'source-menu' }
  | { readonly code: 'frontmatter-invalid' }
  | { readonly code: 'partial' }
  | { readonly code: 'exported'; readonly name: string }
  | { readonly code: 'used-as-tag'; readonly name: string }
  | { readonly code: 'unreadable-code'; readonly excerpt: string }
  | { readonly code: 'captured'; readonly from: string; readonly to: string }
  | { readonly code: 'undeclared-in-head'; readonly name: string }
  | { readonly code: 'head-unparsed' }
  | { readonly code: 'too-large' };

export interface RenameRefusal {
  readonly message: string;
  readonly problem: RenameProblem;
}

export type RenamePlan = { readonly ok: true; readonly text: string; readonly hunks: readonly CodeHunk[] } | ({ readonly ok: false } & RenameRefusal);

export type HeadCheck =
  { readonly kind: 'edit' } | { readonly kind: 'rename'; readonly rename: VariableRename } | ({ readonly kind: 'problem' } & RenameRefusal);

export type StatementRename = { readonly kind: 'same' } | { readonly kind: 'rename'; readonly to: string } | { readonly kind: 'mixed' };

type UseForm = 'plain' | 'shorthand' | 'attribute';

export interface FileUse {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly form: UseForm;
  readonly written: boolean;
  readonly bindsInside: (name: string) => boolean;
}

interface FileDefinition {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly form: JsDefinitionForm;
}

export interface FileRead {
  readonly frontmatterValid: boolean;
  readonly bound: ReadonlySet<string>;
  readonly definitions: readonly FileDefinition[];
  readonly uses: readonly FileUse[];
  readonly exported: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
  readonly unreadable: readonly string[];
  readonly partial: boolean;
  readonly around: ReadonlyMap<string, ReadonlySet<string>>;
  readonly frontmatterEnd: number;
}

const IDENTIFIER_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;
const IDENTIFIER_CHAR_RE = /[\p{ID_Continue}$‌‍]/u;
const NAME_LIKE_RE = /^[\p{L}\p{N}_$-]+$/u;

const RESERVED_WORDS: ReadonlySet<string> = new Set(
  (
    'arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if ' +
    'implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof ' +
    'var void while with yield'
  ).split(' '),
);

const PAGE_GLOBALS: ReadonlySet<string> = new Set(
  (
    'Astro AggregateError Array ArrayBuffer Atomics BigInt BigInt64Array BigUint64Array Blob Boolean Buffer DataView Date Error EvalError FinalizationRegistry ' +
    'Float32Array Float64Array FormData Function Headers Infinity Int16Array Int32Array Int8Array Intl Iterator JSON Map Math NaN Number Object Promise Proxy ' +
    'RangeError ReferenceError Reflect RegExp Request Response Set SharedArrayBuffer String Symbol SyntaxError TextDecoder TextEncoder TypeError URIError URL ' +
    'URLSearchParams Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet atob btoa clearTimeout console crypto decodeURI ' +
    'decodeURIComponent encodeURI encodeURIComponent escape fetch globalThis isFinite isNaN parseFloat parseInt performance process queueMicrotask setTimeout ' +
    'structuredClone undefined unescape'
  ).split(' '),
);

export function variableNameProblem(name: string): RenameRefusal | undefined {
  if (!IDENTIFIER_RE.test(name)) {
    return refusal({ code: 'invalid-name', name });
  }
  return RESERVED_WORDS.has(name) ? refusal({ code: 'reserved-word', name }) : undefined;
}

export function describeRenameProblem(problem: RenameProblem): string {
  switch (problem.code) {
    case 'invalid-name':
      return `“${problem.name}” isn’t a valid variable name. Use letters, numbers, _ or $, and don’t start with a number.`;
    case 'reserved-word':
      return `“${problem.name}” is a reserved word in JavaScript. Pick another name.`;
    case 'not-declared':
      return `“${problem.name}” isn’t declared in this file’s frontmatter, so it can’t be renamed here.`;
    case 'exists':
      return `“${problem.name}” already exists in this file.${problem.choose === 'source-menu' ? ' To loop over it, choose it in the Source menu.' : ''}`;
    case 'frontmatter-invalid':
      return 'The frontmatter has a syntax error, so this can’t be renamed safely. Fix it first.';
    case 'partial':
      return 'Part of this page isn’t readable yet, so this can’t be renamed safely. Try again once it has saved.';
    case 'exported':
      return `“${problem.name}” is exported, and other files can ask for it by name, so it can’t be renamed here.`;
    case 'used-as-tag':
      return `“${problem.name}” is used as a tag, <${problem.name}>, so it can’t be renamed here. Rename it in the code.`;
    case 'unreadable-code':
      return `This code can’t be read to rename it safely: ${problem.excerpt} Rename it in the code.`;
    case 'captured':
      return `“${problem.to}” is already a name inside a loop or function that reads “${problem.from}”, so it would read that instead.`;
    case 'undeclared-in-head':
      return `“${problem.name}” isn’t declared in this file, so the page would crash. Declare it in the frontmatter, or choose a list in the Source menu.`;
    case 'head-unparsed':
      return 'This code doesn’t parse. A loop reads like items.map((item) => (.';
    case 'too-large':
      return 'This file is too large to rename in.';
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}

function refusal(problem: RenameProblem): RenameRefusal {
  return { message: describeRenameProblem(problem), problem };
}

export function planVariableRename(file: FileCode, rename: VariableRename): RenamePlan {
  assert(rename.from !== rename.to, 'A rename changes the name');
  assert(rename.from !== '', 'A rename names what it renames');
  const read = readFile(file);
  const problem = renameProblem(read, rename, { around: new Set(), choose: 'none' });
  if (problem !== undefined) {
    return { ok: false, ...problem };
  }
  return writtenRename(file.source, read, rename);
}

export function checkLoopHead(file: FileCode, loop: { readonly id: string; readonly before: string; readonly after: string }): HeadCheck {
  assert(loop.id !== '', 'A loop head belongs to a node');
  if (file.model.format !== undefined) {
    return { kind: 'edit' };
  }
  const before = readHead(loop.before);
  if (before === undefined) {
    return { kind: 'edit' };
  }
  const read = readFile(file);
  const around = read.around.get(loop.id);
  if (around === undefined) {
    return { kind: 'edit' };
  }
  const token = changedToken(before, loop.before, loop.after);
  if (token !== undefined) {
    const checked = checkToken(read, token, { around, source: file.source });
    if (checked !== undefined) {
      return checked;
    }
  }
  const after = loop.after.trimEnd().endsWith('(') ? readHeadClosed(loop.after, before.closing) : undefined;
  if (after === undefined) {
    return { kind: 'problem', ...refusal({ code: 'head-unparsed' }) };
  }
  const undeclared = undeclaredName(read, { before, after, around });
  return undeclared === undefined ? { kind: 'edit' } : { kind: 'problem', ...refusal({ code: 'undeclared-in-head', name: undeclared }) };
}

export function statementRename(name: string, before: string, after: string): StatementRename {
  const declared = readModuleScope(after).definitions[0];
  if (declared === undefined || declared.name === name) {
    return { kind: 'same' };
  }
  assert(declared.from <= declared.to, 'A declared name starts before it ends');
  assert(declared.to <= after.length, 'A declared name lies inside its statement');
  const restored = after.slice(0, declared.from) + name + after.slice(declared.to);
  return restored.trim() === before.trim() ? { kind: 'rename', to: declared.name } : { kind: 'mixed' };
}

export function renamedFrontmatter(code: string, rename: VariableRename): string {
  assert(rename.from !== rename.to, 'A rename changes the name');
  const analysis = readModuleScope(code);
  const read = frontmatterRead(analysis, 0);
  return applied(code, renameChanges(read.definitions, read.uses, rename));
}


function renameProblem(
  read: FileRead,
  rename: VariableRename,
  context: { readonly around: ReadonlySet<string>; readonly choose: 'none' | 'source-menu' },
): RenameRefusal | undefined {
  assert(rename.from !== rename.to, 'A rename checked changes the name');
  const { from, to } = rename;
  const name = variableNameProblem(to);
  if (name !== undefined) {
    return name;
  }
  if (!read.bound.has(from)) {
    return refusal({ code: 'not-declared', name: from });
  }
  if (taken(read, to, context.around)) {
    return refusal({ code: 'exists', name: to, choose: context.choose });
  }
  return blockedReason(read, rename) ?? captureProblem(read, rename);
}

function taken(read: FileRead, name: string, around: ReadonlySet<string>): boolean {
  if (read.bound.has(name) || around.has(name) || PAGE_GLOBALS.has(name)) {
    return true;
  }
  return read.uses.some((use) => use.name === name);
}

function blockedReason(read: FileRead, rename: VariableRename): RenameRefusal | undefined {
  assert(read.bound.has(rename.from), 'Only a declared name reaches the blocking checks');
  const { from, to } = rename;
  if (!read.frontmatterValid) {
    return refusal({ code: 'frontmatter-invalid' });
  }
  if (read.partial) {
    return refusal({ code: 'partial' });
  }
  if (read.exported.has(from)) {
    return refusal({ code: 'exported', name: from });
  }
  if (read.tags.has(from)) {
    return refusal({ code: 'used-as-tag', name: from });
  }
  const unclear = read.unreadable.find((code) => mentions(code, from) || mentions(code, to));
  if (unclear !== undefined) {
    return refusal({ code: 'unreadable-code', excerpt: excerpt(unclear) });
  }
  return undefined;
}

function captureProblem(read: FileRead, rename: VariableRename): RenameRefusal | undefined {
  assert(rename.to !== '', 'Only a valid name reaches the capture check');
  const captured = read.uses.some((use) => use.name === rename.from && use.bindsInside(rename.to));
  return captured ? refusal({ code: 'captured', from: rename.from, to: rename.to }) : undefined;
}

function undeclaredName(
  read: FileRead,
  heads: { readonly before: HeadRead; readonly after: HeadRead; readonly around: ReadonlySet<string> },
): string | undefined {
  const known = new Set(freeNames(heads.before));
  for (const name of freeNames(heads.after)) {
    if (!known.has(name)) {
      if (!read.bound.has(name)) {
        if (!heads.around.has(name)) {
          if (!PAGE_GLOBALS.has(name)) {
            return name;
          }
        }
      }
    }
  }
  return undefined;
}

interface ChangedToken {
  readonly from: string;
  readonly to: string;
}

function checkToken(read: FileRead, token: ChangedToken, context: { readonly around: ReadonlySet<string>; readonly source: string }): HeadCheck | undefined {
  if (NAME_LIKE_RE.test(token.to)) {
    const problem = variableNameProblem(token.to);
    if (problem !== undefined) {
      return { kind: 'problem', ...problem };
    }
  }
  if (read.bound.has(token.from)) {
    if (!context.around.has(token.from)) {
      if (IDENTIFIER_RE.test(token.to)) {
        return checkHeadRename(read, token, context.around);
      }
    }
  }
  return undefined;
}

function checkHeadRename(read: FileRead, rename: VariableRename, around: ReadonlySet<string>): HeadCheck {
  const problem = renameProblem(read, rename, { around, choose: 'source-menu' });
  return problem === undefined ? { kind: 'rename', rename } : { kind: 'problem', ...problem };
}

function changedToken(before: HeadRead, oldHead: string, newHead: string): ChangedToken | undefined {
  const span = changedSpan(oldHead, newHead);
  const use = before.free.find((reference) => reference.from === span.start && reference.to === oldHead.length - span.end);
  if (use === undefined) {
    return undefined;
  }
  const to = newHead.slice(span.start, newHead.length - span.end).trim();
  return to === '' ? undefined : { from: use.name, to };
}

function changedSpan(before: string, after: string): { readonly start: number; readonly end: number } {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charAt(start) === after.charAt(start)) {
    start++;
  }
  let end = 0;
  while (end < shorter - start && before.charAt(before.length - 1 - end) === after.charAt(after.length - 1 - end)) {
    end++;
  }
  while (start > 0 && IDENTIFIER_CHAR_RE.test(before.charAt(start - 1))) {
    start--;
  }
  while (end > 0 && IDENTIFIER_CHAR_RE.test(before.charAt(before.length - end))) {
    end--;
  }
  assert(start + end <= before.length, 'The shared ends of two texts do not overlap');
  return { start, end };
}


interface HeadRead {
  readonly closing: HeadClosing;
  readonly free: readonly { readonly name: string; readonly from: number; readonly to: number }[];
}

interface HeadClosing {
  readonly form: 'value' | 'block';
  readonly parentheses: number;
}

const HEAD_PARENTHESES_MAX = 5;

function headClosings(): readonly HeadClosing[] {
  const closings: HeadClosing[] = [];
  for (let parentheses = 1; parentheses <= HEAD_PARENTHESES_MAX; parentheses++) {
    closings.push({ form: 'value', parentheses }, { form: 'block', parentheses });
  }
  return closings;
}

function closedHead(head: string, closing: HeadClosing): string {
  assert(closing.parentheses >= 1, 'A closing shuts at least the head’s own call');
  assert(closing.parentheses <= HEAD_PARENTHESES_MAX, 'A closing stays inside the bound tried');
  const parentheses = ')'.repeat(closing.parentheses);
  return closing.form === 'value' ? `${head}null)${parentheses}` : `${head.replace(/\($/, '')}{ return null; }${parentheses}`;
}

function readHeadClosed(head: string, closing: HeadClosing): HeadRead | undefined {
  const analysis = readTemplateScope(`(${closedHead(head, closing)}\n)`);
  if (!analysis.valid) {
    return undefined;
  }
  const free = analysis.references
    .filter((reference) => bindingScope(reference.scope, reference.name) === undefined)
    .map((reference) => ({ name: reference.name, from: reference.from - 1, to: reference.to - 1 }));
  assert(
    free.every((reference) => reference.from >= 0),
    'A head’s reads lie after the parenthesis around it',
  );
  return { closing, free };
}

function readHead(head: string): HeadRead | undefined {
  for (const closing of headClosings()) {
    const read = readHeadClosed(head, closing);
    if (read !== undefined) {
      return read;
    }
  }
  return undefined;
}

function freeNames(head: HeadRead): readonly string[] {
  return head.free.map((reference) => reference.name);
}


interface Walk {
  readonly source: string;
  readonly uses: FileUse[];
  readonly tags: Set<string>;
  readonly unreadable: string[];
  readonly around: Map<string, ReadonlySet<string>>;
  readonly unplaced: string[];
  readonly leaving: string | undefined;
}

export function readFile(file: FileCode, options: { readonly leaving?: string } = {}): FileRead {
  const at = frontmatterRange(file);
  assert(at.from <= at.to, 'The frontmatter opens before it closes');
  assert(at.to <= file.source.length, 'The frontmatter ends inside the file');
  const analysis = readModuleScope(file.source.slice(at.from, at.to));
  const top = frontmatterRead(analysis, at.from);
  const walk: Walk = { source: file.source, uses: [...top.uses], tags: new Set(), unreadable: [], around: new Map(), unplaced: [], leaving: options.leaving };
  walkNodes(file.model.nodes, new Set(), { walk, depth: 0 });
  return {
    frontmatterValid: analysis.valid,
    bound: analysis.root.names,
    definitions: top.definitions,
    uses: walk.uses,
    exported: analysis.exported,
    tags: walk.tags,
    unreadable: walk.unreadable,
    partial: walk.unplaced.length > 0,
    around: walk.around,
    frontmatterEnd: at.to,
  };
}

function frontmatterRange(file: FileCode): { readonly from: number; readonly to: number } {
  if (!file.model.hadFrontmatter) {
    return { from: 0, to: 0 };
  }
  const fence = '---';
  const open = file.source.indexOf(fence);
  const close = file.source.lastIndexOf(fence, file.model.bodyStart ?? file.source.length);
  assert(open >= 0, 'A page with frontmatter has its opening fence');
  assert(close > open, 'A page with frontmatter has its closing fence');
  return { from: open + fence.length, to: close };
}

function frontmatterRead(analysis: JsAnalysis, offset: number): { readonly definitions: readonly FileDefinition[]; readonly uses: readonly FileUse[] } {
  assert(offset >= 0, 'The frontmatter sits at an offset of the file');
  const definitions = analysis.definitions
    .filter((definition) => definition.scope === analysis.root)
    .map((definition) => ({ name: definition.name, from: definition.from + offset, to: definition.to + offset, form: definition.form }));
  const uses: FileUse[] = [];
  for (const reference of analysis.references) {
    const scope = bindingScope(reference.scope, reference.name);
    if (scope === undefined || scope === analysis.root) {
      uses.push({
        name: reference.name,
        from: reference.from + offset,
        to: reference.to + offset,
        form: reference.shorthand ? 'shorthand' : 'plain',
        written: reference.written,
        bindsInside: (name) => bindsBelowRoot(analysis, reference.scope, name),
      });
    }
  }
  return { definitions, uses };
}

function bindsBelowRoot(analysis: JsAnalysis, scope: JsScope, name: string): boolean {
  assert(name !== '', 'A capture is asked about a name');
  const found = bindingScope(scope, name);
  return found !== undefined && found !== analysis.root;
}

function walkNodes(nodes: readonly PageNode[], around: ReadonlySet<string>, context: { readonly walk: Walk; readonly depth: number }): void {
  assert(context.depth <= LIMITS.treeDepthMax, 'A page tree stays inside its depth bound');
  for (const node of nodes) {
    context.walk.around.set(node.id, around);
    readNode(node, around, { walk: context.walk, depth: context.depth + 1 });
  }
}

function readNode(node: PageNode, around: ReadonlySet<string>, context: { readonly walk: Walk; readonly depth: number }): void {
  const { walk } = context;
  if (node.id === walk.leaving) {
    return;
  }
  switch (node.kind) {
    case 'text':
    case 'comment':
    case 'raw-line':
      return;
    case 'branch':
      walkNodes(node.children, around, context);
      return;
    case 'chunk-group':
      walk.unplaced.push(node.id);
      return;
    case 'element':
    case 'component':
    case 'raw':
      readTag(node, around, walk);
      if (node.kind !== 'raw') {
        walkNodes(node.children ?? [], around, context);
      }
      return;
    case 'expr':
      readCode(node, [], around, context);
      return;
    case 'map':
    case 'cond':
      readCode(node, node.children, around, context);
      return;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

interface Range {
  readonly from: number;
  readonly to: number;
}

function rangeOf(node: PageNode): Range | undefined {
  return node.start === undefined || node.end === undefined ? undefined : { from: node.start, to: node.end };
}

function readCode(node: PageNode, children: readonly PageNode[], around: ReadonlySet<string>, context: { readonly walk: Walk; readonly depth: number }): void {
  const { walk } = context;
  const range = rangeOf(node);
  if (range === undefined) {
    walk.unplaced.push(node.id);
    return;
  }
  const holes = holesOf(children, walk);
  assert(holes.length <= children.length, 'Children make at most one mask each');
  const inner = withoutBraces(walk.source, range);
  const analysis = readRegion(inner, holes, around, walk);
  for (const child of children) {
    const start = rangeOf(child)?.from ?? inner.from;
    const names = analysis === undefined ? around : namesAt(analysis, start - inner.from + 1, around);
    walk.around.set(child.id, names);
    readNode(child, names, { walk, depth: context.depth + 1 });
  }
}

function namesAt(analysis: JsAnalysis, position: number, around: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...around, ...innerNamesAt(analysis, scopeAt(analysis, position))]);
}

function withoutBraces(source: string, range: Range): Range {
  assert(range.from <= range.to, 'A code range starts before it ends');
  assert(range.to <= source.length, 'A code range ends inside the file');
  const braced = source.charAt(range.from) === '{' && source.charAt(range.to - 1) === '}';
  return braced ? { from: range.from + 1, to: range.to - 1 } : range;
}

function holesOf(children: readonly PageNode[], walk: Walk): readonly Range[] {
  const holes: Range[] = [];
  for (const child of children) {
    const range = rangeOf(child);
    if (range === undefined) {
      walk.unplaced.push(child.id);
      continue;
    }
    const last = holes[holes.length - 1];
    if (last !== undefined && walk.source.slice(last.to, range.from).trim() === '') {
      holes[holes.length - 1] = { from: last.from, to: range.to };
    } else {
      holes.push(range);
    }
  }
  return holes;
}

function maskedRegion(source: string, region: Range, holes: readonly Range[]): string {
  assert(region.from <= region.to, 'A masked region starts before it ends');
  assert(region.to <= source.length, 'A masked region ends inside the file');
  const pieces: string[] = [];
  let at = region.from;
  for (const hole of holes) {
    assert(hole.from >= at, 'Masks are in order and inside their region');
    assert(hole.to <= region.to, 'A mask ends inside its region');
    const length = hole.to - hole.from;
    pieces.push(source.slice(at, hole.from), (length >= 4 ? 'null' : '0').padEnd(length, ' '));
    at = hole.to;
  }
  pieces.push(source.slice(at, region.to));
  return pieces.join('');
}

function readRegion(region: Range, holes: readonly Range[], around: ReadonlySet<string>, walk: Walk): JsAnalysis | undefined {
  const masked = maskedRegion(walk.source, region, holes);
  const analysis = readTemplateScope(`(${masked}\n)`);
  if (!analysis.valid) {
    walk.unreadable.push(masked);
    return undefined;
  }
  collectUses(analysis, region.from - 1, around, walk);
  return analysis;
}

function collectUses(analysis: JsAnalysis, offset: number, around: ReadonlySet<string>, walk: Walk): void {
  assert(analysis.valid, 'Only code that was read has uses to collect');
  for (const reference of analysis.references) {
    if (bindingScope(reference.scope, reference.name) === undefined) {
      if (!around.has(reference.name)) {
        walk.uses.push({
          name: reference.name,
          from: reference.from + offset,
          to: reference.to + offset,
          form: reference.shorthand ? 'shorthand' : 'plain',
          written: reference.written,
          bindsInside: (name) => around.has(name) || bindingScope(reference.scope, name) !== undefined,
        });
      }
    }
  }
  for (const tag of analysis.tags) {
    if (bindingScope(tag.scope, tag.name) === undefined) {
      if (!around.has(tag.name)) {
        walk.tags.add(tag.name);
      }
    }
  }
}

function readTag(node: Extract<PageNode, { readonly kind: 'element' | 'component' | 'raw' }>, around: ReadonlySet<string>, walk: Walk): void {
  const range = rangeOf(node);
  if (range === undefined) {
    walk.unplaced.push(node.id);
    return;
  }
  if (node.kind !== 'raw') {
    const root = node.name.split('.')[0] ?? '';
    if (node.kind === 'component' || node.dynamicTag === true || root !== node.name) {
      if (!around.has(root)) {
        walk.tags.add(root);
      }
    }
  }
  const { source } = walk;
  let at = range.from + 1;
  while (at < range.to) {
    const char = source.charAt(at);
    if (char === '>') {
      return;
    }
    const next = readTagPart(char, at, { range, around, walk });
    assert(next > at, 'Every pass over a tag moves forward');
    at = next;
  }
}

function readTagPart(char: string, at: number, context: { readonly range: Range; readonly around: ReadonlySet<string>; readonly walk: Walk }): number {
  const { range, around, walk } = context;
  const { source } = walk;
  assert(at < range.to, 'A tag is read inside its own range');
  if (char === '"' || char === "'") {
    const close = source.indexOf(char, at + 1);
    return close === -1 ? range.to : close + 1;
  }
  if (char === '`' || char === '{') {
    const close = closingOf(source, at, range.to);
    if (close === undefined) {
      walk.unreadable.push(source.slice(at, range.to));
      return range.to;
    }
    readTagCode({ from: at, to: close + 1 }, around, walk);
    return close + 1;
  }
  return at + 1;
}

function readTagCode(range: Range, around: ReadonlySet<string>, walk: Walk): void {
  const { source } = walk;
  assert(range.from < range.to, 'Code in a tag holds at least its delimiters');
  if (source.charAt(range.from) === '`') {
    readRegion(range, [], around, walk);
    return;
  }
  const inner = withoutBraces(source, range);
  const text = source.slice(inner.from, inner.to);
  const trimmed = text.trim();
  if (precededByEquals(source, range.from)) {
    readRegion(inner, [], around, walk);
    return;
  }
  if (trimmed.startsWith('...')) {
    readRegion({ from: inner.from + text.indexOf('...') + 3, to: inner.to }, [], around, walk);
    return;
  }
  if (IDENTIFIER_RE.test(trimmed)) {
    readShorthandAttribute(trimmed, range, around, walk);
    return;
  }
  walk.unreadable.push(text);
}

function readShorthandAttribute(name: string, range: Range, around: ReadonlySet<string>, walk: Walk): void {
  assert(IDENTIFIER_RE.test(name), 'A shorthand attribute is a name');
  assert(walk.source.charAt(range.from) === '{', 'A shorthand attribute opens with its brace');
  if (!around.has(name)) {
    walk.uses.push({ name, from: range.from, to: range.to, form: 'attribute', written: false, bindsInside: (inner) => around.has(inner) });
  }
}

function precededByEquals(source: string, at: number): boolean {
  assert(at < source.length, 'A value starts inside the file');
  let before = at - 1;
  while (before > 0 && source.charAt(before).trim() === '') {
    before--;
  }
  return source.charAt(before) === '=';
}

type Lexing = 'code' | 'template';

function closingOf(source: string, open: number, end: number): number | undefined {
  assert(open < end, 'What opens sits before the end searched to');
  assert(end <= source.length, 'A search for a closing stays inside the file');
  const modes: Lexing[] = [source.charAt(open) === '`' ? 'template' : 'code'];
  for (let at = open + 1; at < end; at++) {
    const mode = modes[modes.length - 1];
    const char = source.charAt(at);
    if (mode === 'template') {
      at = stepTemplate(source, at, modes);
    } else {
      at = stepCode(source, at, modes);
    }
    if (modes.length === 0) {
      assert(char === '}' || char === '`', 'Only a closing brace or backtick empties the stack');
      return at;
    }
  }
  return undefined;
}

function stepTemplate(source: string, at: number, modes: Lexing[]): number {
  assert(modes[modes.length - 1] === 'template', 'stepTemplate: reads a template');
  const char = source.charAt(at);
  if (char === '\\') {
    return at + 1;
  }
  if (char === '`') {
    modes.pop();
    return at;
  }
  if (char === '$' && source.charAt(at + 1) === '{') {
    modes.push('code');
    return at + 1;
  }
  return at;
}

function stepCode(source: string, at: number, modes: Lexing[]): number {
  assert(modes[modes.length - 1] === 'code', 'stepCode: reads code');
  const char = source.charAt(at);
  switch (char) {
    case '"':
    case "'":
      return stringEnd(source, at);
    case '`':
      modes.push('template');
      return at;
    case '{':
      modes.push('code');
      return at;
    case '}':
      modes.pop();
      return at;
    case '/':
      return commentEnd(source, at);
    default:
      return at;
  }
}

function stringEnd(source: string, open: number): number {
  const quote = source.charAt(open);
  assert(quote === '"' || quote === "'", 'stringEnd: starts at a quote');
  for (let at = open + 1; at < source.length; at++) {
    const char = source.charAt(at);
    if (char === '\\') {
      at++;
    } else if (char === quote) {
      return at;
    }
  }
  return source.length;
}

function commentEnd(source: string, at: number): number {
  assert(source.charAt(at) === '/', 'commentEnd: starts at a slash');
  const next = source.charAt(at + 1);
  if (next === '/') {
    const line = source.indexOf('\n', at);
    return line === -1 ? source.length : line;
  }
  if (next === '*') {
    const close = source.indexOf('*/', at);
    return close === -1 ? source.length : close + 1;
  }
  return at;
}


function writtenRename(source: string, read: FileRead, rename: VariableRename): RenamePlan {
  assertSpelled(source, read, rename);
  const changes = renameChanges(read.definitions, read.uses, rename);
  assert(changes.length > 0, 'A declared name is at least declared');
  const text = applied(source, changes);
  const patch = diffCodePatch(source, text);
  return patch.ok ? { ok: true, text, hunks: patch.value } : { ok: false, ...refusal({ code: 'too-large' }) };
}

function assertSpelled(source: string, read: FileRead, rename: VariableRename): void {
  for (const definition of read.definitions) {
    if (definition.name === rename.from) {
      assert(source.slice(definition.from, definition.to) === rename.from, 'A definition replaced is spelled as the old name');
    }
  }
  for (const use of read.uses) {
    if (use.name === rename.from) {
      const text = source.slice(use.from, use.to);
      assert(text.includes(rename.from), 'A use replaced holds the old name');
      assert(use.form === 'attribute' || text === rename.from, 'A use replaced is the old name alone, unless it is a shorthand attribute');
    }
  }
}

function renameChanges(definitions: readonly FileDefinition[], uses: readonly FileUse[], rename: VariableRename): readonly TextChange[] {
  const { from, to } = rename;
  const declared = definitions
    .filter((definition) => definition.name === from)
    .map((definition) => ({ ...definition, text: definitionText(definition.form, rename) }));
  const read = uses.filter((use) => use.name === from).map((use) => ({ from: use.from, to: use.to, text: useText(use.form, rename) }));
  assert(to.length > 0, 'A rename names what it renames to');
  return [...declared, ...read].sort((first, second) => first.from - second.from);
}

function definitionText(form: JsDefinitionForm, rename: VariableRename): string {
  assert(rename.to !== '', 'A definition is given a name');
  switch (form) {
    case 'plain':
      return rename.to;
    case 'shorthand':
      return `${rename.from}: ${rename.to}`;
    case 'import-member':
      return `${rename.from} as ${rename.to}`;
    default: {
      const exhaustive: never = form;
      return exhaustive;
    }
  }
}

function useText(form: UseForm, rename: VariableRename): string {
  assert(rename.to !== '', 'A use is given a name');
  switch (form) {
    case 'plain':
      return rename.to;
    case 'shorthand':
      return `${rename.from}: ${rename.to}`;
    case 'attribute':
      return `${rename.from}={${rename.to}}`;
    default: {
      const exhaustive: never = form;
      return exhaustive;
    }
  }
}

function applied(text: string, changes: readonly TextChange[]): string {
  const pieces: string[] = [];
  let at = 0;
  for (const change of changes) {
    assert(change.from >= at, 'Changes are in order and never overlap');
    assert(change.to <= text.length, 'A change ends inside its text');
    pieces.push(text.slice(at, change.from), change.text);
    at = change.to;
  }
  pieces.push(text.slice(at));
  return pieces.join('');
}

export function mentions(code: string, name: string): boolean {
  if (name === '') {
    return false;
  }
  let at = code.indexOf(name);
  while (at !== -1) {
    const before = at === 0 ? '' : code.charAt(at - 1);
    const after = code.charAt(at + name.length);
    if (!IDENTIFIER_CHAR_RE.test(before)) {
      if (!IDENTIFIER_CHAR_RE.test(after)) {
        return true;
      }
    }
    at = code.indexOf(name, at + name.length);
  }
  return false;
}

const EXCERPT_CHARS_MAX = 60;

function excerpt(code: string): string {
  const flat = code.replace(/\s+/g, ' ').trim();
  const shown = flat.length > EXCERPT_CHARS_MAX ? `${flat.slice(0, EXCERPT_CHARS_MAX)}….` : `${flat}.`;
  assert(shown.length <= EXCERPT_CHARS_MAX + 2, 'An excerpt stays short enough to show under a field');
  return shown;
}
