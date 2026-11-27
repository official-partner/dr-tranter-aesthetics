import { assert } from '../core/assert';
import { toIntent, type Intent, type Operation, type RejectionReason } from './intent';
import { LIMITS } from '../core/limits';
import type { ByteRelocation, Splice } from './planner';
import { isNodeKind, toAnchorRef, type AnchorRef } from '../page/ref';
import { err, ok, type Result } from '../core/result';
import type { Snapshot } from '../page/snapshot';
import { toByteSpan, toByteString, type ByteSpan } from '../core/span';
import { orderedSplices } from './splice';

export interface CommitRecord {
  readonly from: Snapshot['checksum'];
  readonly to: Snapshot['checksum'];
  readonly splices: readonly Splice[];
  readonly relocation?: ByteRelocation | undefined;
}

export function commitChain(log: readonly CommitRecord[], authored: Snapshot['checksum'], current: Snapshot['checksum']): readonly CommitRecord[] | undefined {
  assert(log.length <= LIMITS.commitLogEntriesMax, 'The commit log is inside its bound');
  const chain: CommitRecord[] = [];
  let at = authored;
  for (let pass = 0; pass <= log.length; pass++) {
    if (at === current) {
      return chain;
    }
    const next = log.find((record) => record.from === at && !chain.includes(record));
    if (next === undefined) {
      return undefined;
    }
    chain.push(next);
    at = next.to;
  }
  return undefined;
}

export function minimalSplices(splices: readonly Splice[]): readonly Splice[] {
  return orderedSplices(splices).map((splice) => {
    const expected = splice.expectedBytes;
    const replacement = splice.replacementBytes;
    let prefix = 0;
    const shorter = Math.min(expected.length, replacement.length);
    while (prefix < shorter && expected[prefix] === replacement[prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (suffix < shorter - prefix && expected[expected.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]) {
      suffix++;
    }
    const start = splice.range.start + prefix;
    return {
      range: toByteSpan(start, splice.range.end - suffix),
      expectedBytes: toByteString(expected.subarray(prefix, expected.length - suffix)),
      replacementBytes: toByteString(replacement.subarray(prefix, replacement.length - suffix)),
    };
  });
}

export function rebaseSpan(span: ByteSpan, splices: readonly Splice[]): ByteSpan | undefined {
  let start: number = span.start;
  let end: number = span.end;
  let startShift = 0;
  let endShift = 0;
  for (const splice of orderedSplices(splices)) {
    const delta = splice.replacementBytes.length - (splice.range.end - splice.range.start);
    const first = splice.range.start;
    const last = splice.range.end;
    if (last <= span.start) {
      if (first < span.start || first === last) {
        startShift += delta;
        endShift += delta;
        continue;
      }
    }
    if (span.end <= first) {
      continue;
    }
    if (span.start <= first && last <= span.end) {
      endShift += delta;
      continue;
    }
    return undefined;
  }
  start += startShift;
  end += endShift;
  assert(start <= end, 'An image keeps its order');
  return toByteSpan(start, end);
}

export function rebaseIntent(intent: Intent, chain: readonly CommitRecord[], current: Snapshot): Result<Intent, RejectionReason> {
  assert(chain.length > 0, 'A rebase follows at least one commit');
  assert(chain[chain.length - 1]?.to === current.checksum, 'The chain ends at the current bytes');
  const through = (span: ByteSpan): ByteSpan | undefined =>
    chain.reduce<ByteSpan | undefined>((image, record) => (image === undefined ? undefined : rebaseCommittedSpan(image, record, rebaseSpan)), span);
  const untouched = (span: ByteSpan): ByteSpan | undefined =>
    chain.reduce<ByteSpan | undefined>((image, record) => (image === undefined ? undefined : rebaseCommittedSpan(image, record, shiftUntouched)), span);
  const anchor = rebaseAnchor(intent.anchor, through, current);
  if (!anchor.ok) {
    return anchor;
  }
  const operation = rebaseOperation(intent.operation, { through, untouched }, current);
  if (!operation.ok) {
    return operation;
  }
  return ok(
    toIntent({
      id: intent.id,
      file: intent.file,
      authoredChecksum: current.checksum,
      anchor: anchor.value,
      operation: operation.value,
    }),
  );
}

type Through = (span: ByteSpan) => ByteSpan | undefined;

function rebaseCommittedSpan(
  span: ByteSpan,
  record: CommitRecord,
  map: (span: ByteSpan, splices: readonly Splice[]) => ByteSpan | undefined,
): ByteSpan | undefined {
  const relocation = record.relocation;
  if (relocation !== undefined) {
    const { source, target } = relocation;
    assert(source.start < source.end, 'A relocation has a non-empty source');
    assert(source.end - source.start === target.end - target.start, 'A relocation preserves its bytes and length');
    if (span.start === span.end) {
      if (span.start === source.start) {
        return undefined;
      }
      if (span.end === source.end) {
        return undefined;
      }
    }
    if (source.start <= span.start) {
      if (span.end <= source.end) {
        const shift = target.start - source.start;
        return toByteSpan(span.start + shift, span.end + shift);
      }
    }
  }
  return map(span, record.splices);
}

interface Images {
  readonly through: Through;
  readonly untouched: Through;
}

export function shiftUntouched(span: ByteSpan, splices: readonly Splice[]): ByteSpan | undefined {
  for (const splice of splices) {
    if (splice.range.start <= span.end) {
      if (span.start <= splice.range.end) {
        return undefined;
      }
    }
  }
  const image = rebaseSpan(span, splices);
  assert(image !== undefined, 'A span no splice touches has an image');
  assert(image.end - image.start === span.end - span.start, 'An untouched span keeps its length');
  return image;
}

function rebaseAnchor(anchor: AnchorRef, through: Through, current: Snapshot): Result<AnchorRef, RejectionReason> {
  if (anchor.expectedKind === 'document') {
    return ok(
      toAnchorRef({
        span: toByteSpan(0, current.bytes.length),
        path: [],
        expectedKind: 'document',
      }),
    );
  }
  const span = through(anchor.span);
  if (span === undefined) {
    return err('anchor-moved');
  }
  const projection = current.projection;
  if (projection.tag === 'parse-error') {
    return err('source-invalid');
  }
  if (anchor.expectedKind === 'frontmatter') {
    const block = projection.frontmatter;
    if (block === undefined) {
      return err('anchor-moved');
    }
    if (block.start === span.start && block.end === span.end) {
      return ok(toAnchorRef({ span, path: [], expectedKind: 'frontmatter' }));
    }
    return err('anchor-moved');
  }
  assert(isNodeKind(anchor.expectedKind), 'The remaining anchors name nodes');
  const found = projection.nodes.filter((node) => node.kind === anchor.expectedKind && node.span.start === span.start && node.span.end === span.end);
  const [node] = found;
  if (node === undefined) {
    return err('anchor-moved');
  }
  if (found.length > 1) {
    return err('anchor-ambiguous');
  }
  return ok(toAnchorRef({ span, path: node.path, expectedKind: node.kind }));
}

function rebaseOperation(operation: Operation, images: Images, current: Snapshot): Result<Operation, RejectionReason> {
  const { through } = images;
  switch (operation.tag) {
    case 'set-attribute':
    case 'remove-attribute':
    case 'insert-node':
    case 'remove-node':
    case 'set-inline-style':
    case 'rename-tag':
    case 'rename-attribute':
    case 'append-body':
    case 'insert-frontmatter':
      return ok(operation);
    case 'rewrite-text':
      return err('region-externally-modified');
    case 'move-node': {
      const destination = rebaseAnchor(operation.destination, through, current);
      return destination.ok ? ok({ ...operation, destination: destination.value }) : destination;
    }
    case 'wrap-nodes': {
      const last = rebaseAnchor(operation.last, through, current);
      return last.ok ? ok({ ...operation, last: last.value }) : last;
    }
    case 'rename-binding': {
      const sites = rebaseSpans(operation.sites, through);
      return sites === undefined ? err('anchor-moved') : ok({ ...operation, sites });
    }
    case 'edit-frontmatter-slot': {
      const slot = through(operation.slot);
      return slot === undefined ? err('region-externally-modified') : ok({ ...operation, slot });
    }
    case 'apply-code-patch':
    case 'revert-splices':
    case 'rewrite-node': {
      const spans = rebaseSpans(
        operation.hunks.map((hunk) => hunk.span),
        operation.tag === 'revert-splices' ? through : images.untouched,
      );
      if (spans === undefined) {
        return err(operation.tag === 'apply-code-patch' ? 'merge-conflict' : 'region-externally-modified');
      }
      const hunks = operation.hunks.map((hunk, index) => {
        const span = spans[index];
        assert(span !== undefined, 'Every hunk has an image');
        return { span, text: hunk.text };
      });
      return ok({ ...operation, hunks });
    }
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function rebaseSpans(spans: readonly ByteSpan[], through: Through): readonly ByteSpan[] | undefined {
  const images: ByteSpan[] = [];
  for (const span of spans) {
    const image = through(span);
    if (image === undefined) {
      return undefined;
    }
    images.push(image);
  }
  return images;
}
