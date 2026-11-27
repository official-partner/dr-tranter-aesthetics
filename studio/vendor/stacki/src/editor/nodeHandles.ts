import { assert } from '../../shared/core/assert';
import { toNodeId, toUtf16Offset, type Digest } from '../../shared/core/brand';
import { DIFF_BUDGET, diffBytes } from '../../shared/engine/diff';
import type { SourceEdit } from '../../shared/engine/intent';
import { LIMITS } from '../../shared/core/limits';
import { mapSpanThroughOutcome } from '../../shared/engine/mapSpan';
import type { PageModel, PageNode } from '../../shared/page/pageNode';
import type { Splice } from '../../shared/engine/planner';
import { rebaseSpan } from '../../shared/engine/rebase';
import { byteStringsEqual, encodeUtf8, toByteSpan, toByteString, utf16ToByteOffsets, type ByteSpan, type ByteString } from '../../shared/core/span';
import { applySplices, witnessesHold } from '../../shared/engine/splice';

export interface ParsedText {
  readonly source: string;
  readonly model: PageModel;
}

export interface CarryInput {
  readonly before: ParsedText;
  readonly after: ParsedText & { readonly seed: string };
  readonly own: readonly SourceEdit[] | undefined;
  readonly predicted: PageModel | undefined;
}

export function seedOf(checksum: Digest): string {
  return checksum.slice(0, 16);
}

export function randomSeed(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function carryHandles(input: CarryInput): PageModel {
  const beforeBytes = encodeUtf8(input.before.source);
  const afterBytes = encodeUtf8(input.after.source);
  const befores = entriesOf(input.before);
  const afters = entriesOf(input.after);
  const own = input.own;
  const splices = own === undefined ? undefined : ownSplices(own, beforeBytes, afterBytes);
  const map = spanMapper(beforeBytes, afterBytes, splices);
  const handles = new Map<string, string>();
  const used = new Set<string>();
  const assign = (entry: Entry, handle: string): void => {
    assert(!handles.has(entry.key), 'A node is given one handle');
    assert(!used.has(handle), 'A handle names one node');
    handles.set(entry.key, handle);
    used.add(handle);
  };
  const kept = input.predicted === undefined ? undefined : new Set<string>(inOrder(input.predicted).map((entry) => entry.node.id));
  carryMapped(befores, afters, { map, exact: splices !== undefined, kept }, assign);
  if (input.own !== undefined && input.predicted !== undefined) {
    const created = createdRanges(input.own);
    pairCreated(afters, handles, used, created, input.predicted, assign);
  }
  assert(/^[0-9a-f]{16}$/.test(input.after.seed), 'A seed is 16 hex characters');
  for (const entry of afters) {
    if (!handles.has(entry.key)) {
      assign(entry, freshHandle(entry, input.after.seed, used));
    }
  }
  assert(handles.size === afters.length, 'Every node of the fresh parse has a handle');
  return rekeyed(input.after.model, handles);
}


interface Entry {
  readonly node: PageNode;
  readonly key: string;
  readonly span: ByteSpan | undefined;
}

type SpanMap = (span: ByteSpan) => ByteSpan | undefined;

type RangeHome = 'page' | 'chunk';

interface Ordered {
  readonly node: PageNode;
  readonly key: string;
  readonly home: RangeHome;
}

function entriesOf(parsed: ParsedText): readonly Entry[] {
  return withByteSpans(parsed.source, inOrder(parsed.model));
}

function inOrder(model: PageModel): readonly Ordered[] {
  const found: Ordered[] = [];
  const pending: Ordered[] = [];
  const push = (list: readonly PageNode[], prefix: string, home: RangeHome): void => {
    for (let index = list.length - 1; index >= 0; index--) {
      const node = list[index];
      assert(node !== undefined, 'A listed node exists');
      pending.push({ node, key: prefix === '' ? String(index) : `${prefix}.${index}`, home });
    }
  };
  push(model.nodes, '', 'page');
  while (pending.length > 0) {
    assert(found.length < LIMITS.treeNodesMax, 'A tree stays inside its node bound');
    const entry = pending.pop();
    assert(entry !== undefined, 'The pending stack is not empty');
    found.push(entry);
    const node = entry.node;
    if ('children' in node && Array.isArray(node.children)) {
      const home = node.kind === 'chunk-group' ? 'chunk' : entry.home;
      push(node.children, entry.key, home);
    }
  }
  return found;
}

function withByteSpans(source: string, found: readonly Ordered[]): readonly Entry[] {
  const offsets = new Set<number>();
  for (const { node, home } of found) {
    if (home === 'page' && node.start !== undefined && node.end !== undefined) {
      offsets.add(node.start);
      offsets.add(node.end);
    }
  }
  const ascending = [...offsets].sort((left, right) => left - right);
  const converted = utf16ToByteOffsets(source, ascending.map(toUtf16Offset));
  const bytes = new Map(ascending.map((offset, index) => [offset, converted[index]]));
  return found.map(({ node, key, home }) => {
    if (home === 'chunk' || node.start === undefined || node.end === undefined) {
      return { node, key, span: undefined };
    }
    const start = bytes.get(node.start);
    const end = bytes.get(node.end);
    assert(start !== undefined, 'Every start was converted');
    assert(end !== undefined, 'Every end was converted');
    return { node, key, span: toByteSpan(start, end) };
  });
}

function ownSplices(own: readonly SourceEdit[], before: ByteString, after: ByteString): readonly Splice[] | undefined {
  let delta = 0;
  const splices: Splice[] = [];
  for (const hunk of own) {
    const expectedBytes = encodeUtf8(hunk.text);
    const start = hunk.span.start - delta;
    if (start < 0 || hunk.span.end > after.length) {
      return undefined;
    }
    const range = toByteSpan(start, start + expectedBytes.length);
    const replacementBytes = toByteString(after.subarray(hunk.span.start, hunk.span.end));
    splices.push({ range, expectedBytes, replacementBytes });
    delta += replacementBytes.length - expectedBytes.length;
  }
  const inside = splices.every((splice) => splice.range.end <= before.length);
  if (!inside || !witnessesHold(before, splices)) {
    return undefined;
  }
  return byteStringsEqual(applySplices(before, splices), after) ? splices : undefined;
}

function spanMapper(before: ByteString, after: ByteString, splices: readonly Splice[] | undefined): SpanMap {
  if (splices !== undefined) {
    return (span) => rebaseSpan(span, splices);
  }
  const diff = diffBytes(before, after, DIFF_BUDGET);
  return (span) => {
    if (span.start === span.end) {
      return undefined;
    }
    const mapped = mapSpanThroughOutcome(diff, span);
    return mapped.tag === 'resolved' ? mapped.span : undefined;
  };
}

function carryMapped(
  befores: readonly Entry[],
  afters: readonly Entry[],
  mapping: {
    readonly map: SpanMap;
    readonly exact: boolean;
    readonly kept: ReadonlySet<string> | undefined;
  },
  assign: (entry: Entry, handle: string) => void,
): void {
  const bySpan = new Map<string, Entry[]>();
  for (const entry of afters) {
    if (entry.span !== undefined) {
      const key = spanKey(entry.span);
      bySpan.set(key, [...(bySpan.get(key) ?? []), entry]);
    }
  }
  const taken = new Set<string>();
  for (const entry of befores) {
    const mapped = entry.span === undefined ? undefined : mapping.map(entry.span);
    const candidates = mapped === undefined ? [] : (bySpan.get(spanKey(mapped)) ?? []);
    const free = candidates.filter((candidate) => !taken.has(candidate.key));
    const kin = free.filter((candidate) => candidate.node.kind === entry.node.kind);
    const removed = mapping.kept?.has(entry.node.id) === false;
    const renamed = mapping.exact && !removed && kin.length === 0 && free.length === 1 ? free : [];
    const [target, ...others] = kin.length > 0 ? kin : renamed;
    if (target !== undefined && others.length === 0) {
      taken.add(target.key);
      assign(target, entry.node.id);
    }
  }
}

function createdRanges(own: readonly SourceEdit[]): readonly ByteSpan[] {
  return own.map((hunk) => hunk.span).filter((span) => span.start < span.end);
}

function pairCreated(
  afters: readonly Entry[],
  handles: ReadonlyMap<string, string>,
  used: ReadonlySet<string>,
  created: readonly ByteSpan[],
  predicted: PageModel,
  assign: (entry: Entry, handle: string) => void,
): void {
  const touches = (span: ByteSpan | undefined): boolean => span !== undefined && created.some((range) => span.start < range.end && range.start < span.end);
  const unpaired = afters.filter((entry) => !handles.has(entry.key) && touches(entry.span));
  const own = inOrder(predicted).filter((entry) => !used.has(entry.node.id));
  let next = 0;
  for (const entry of unpaired) {
    const kind = entry.node.kind;
    const at = own.findIndex((candidate, index) => index >= next && candidate.node.kind === kind);
    if (at === -1) {
      continue;
    }
    const match = own[at];
    assert(match !== undefined, 'A found index names an entry');
    next = at + 1;
    assign(entry, match.node.id);
  }
}

function freshHandle(entry: Entry, seed: string, used: ReadonlySet<string>): string {
  if (entry.node.id === 'layout' && !used.has('layout')) {
    return 'layout';
  }
  const base = `s${seed}.${entry.key}`;
  let handle = base;
  for (let suffix = 2; used.has(handle); suffix++) {
    assert(suffix <= LIMITS.treeNodesMax + 1, 'A free handle is found within the tree bound');
    handle = `${base}~${suffix}`;
  }
  return handle;
}

function spanKey(span: ByteSpan): string {
  return `${span.start}:${span.end}`;
}

function rekeyed(model: PageModel, handles: ReadonlyMap<string, string>): PageModel {
  const visit = (list: readonly PageNode[], prefix: string, depth: number): PageNode[] => {
    assert(depth <= LIMITS.treeDepthMax, 'A tree stays inside its depth bound');
    return list.map((node, index) => {
      const key = prefix === '' ? String(index) : `${prefix}.${index}`;
      const handle = handles.get(key);
      assert(handle !== undefined, 'Every node has a handle');
      const children = 'children' in node && Array.isArray(node.children) ? { children: visit(node.children, key, depth + 1) } : {};
      return Object.assign({}, node, { id: toNodeId(handle) }, children);
    });
  };
  return { ...model, nodes: visit(model.nodes, '', 0) };
}
