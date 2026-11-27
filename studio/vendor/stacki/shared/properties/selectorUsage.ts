import { assert } from '../core/assert';
import { count, digest, list, object, pathText, record, text } from '../core/boundary';
import type { Digest } from '../core/brand';
import { parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { err, ok, type Result } from '../core/result';
import { parseRefusal, type PropertyError } from './propertyErrors';

export const SELECTOR_USAGE_LIMITS = {
  entriesMax: 50_000,
  selectorCharsMax: 2_048,
  namesPerEntryMax: 64,
  nameCharsMax: 256,
  notesMax: 500,
  filesMax: 5_000,
  removalsMax: 10_000,
} as const satisfies Record<string, number>;

export type SelectorScope = 'global' | 'scoped';

export type SelectorVerdict =
  | { readonly kind: 'used' }
  | { readonly kind: 'untracked' }
  | { readonly kind: 'unused'; readonly names: readonly string[] }
  | { readonly kind: 'kept'; readonly names: readonly string[]; readonly inUse?: true }
  | { readonly kind: 'unknown'; readonly names: readonly string[]; readonly reason: string; readonly reasonRef?: MessageRef | undefined }
  | { readonly kind: 'checking'; readonly names: readonly string[] };

export type SelectorVerdictKind = SelectorVerdict['kind'];

export interface SelectorEntry {
  readonly id: string;
  readonly rel: string;
  readonly line: number;
  readonly selector: string;
  readonly scope: SelectorScope;
  readonly verdict: SelectorVerdict;
}

export interface SelectorNote {
  readonly rel: string;
  readonly message: string;
  readonly messageRef?: MessageRef | undefined;
}

export interface SelectorFileDigest {
  readonly rel: string;
  readonly digest: Digest;
}

export interface SelectorReport {
  readonly entries: readonly SelectorEntry[];
  readonly notes: readonly SelectorNote[];
  readonly files: readonly SelectorFileDigest[];
}

export interface SelectorFileChange {
  readonly rel: string;
  readonly before: string;
  readonly after: string;
}

export interface SelectorRemoval {
  readonly removed: number;
  readonly changes: readonly SelectorFileChange[];
}

export function parseSelectorReport(input: unknown): SelectorReport {
  const value = record(input);
  const entries = list(parseSelectorEntry)(value['entries']);
  if (entries.length > SELECTOR_USAGE_LIMITS.entriesMax) {
    throw new Error('Selector report exceeds its entry limit');
  }
  const notes = list(parseNote)(value['notes']);
  if (notes.length > SELECTOR_USAGE_LIMITS.notesMax) {
    throw new Error('Selector report exceeds its note limit');
  }
  const files = list(object({ rel: pathText, digest }))(value['files']);
  if (files.length > SELECTOR_USAGE_LIMITS.filesMax) {
    throw new Error('Selector report exceeds its file limit');
  }
  return { entries, notes, files };
}

export function parseSelectorReportResult(input: unknown): Result<SelectorReport> {
  return parseResult(input, parseSelectorReport);
}

export function parseSelectorRemovalResult(input: unknown): Result<SelectorRemoval, PropertyError> {
  return parseResult(input, parseSelectorRemoval);
}

export function parseSelectorRemoval(input: unknown): SelectorRemoval {
  const value = record(input);
  const changes = list(parseSelectorFileChange)(value['changes']);
  if (changes.length > SELECTOR_USAGE_LIMITS.filesMax) {
    throw new Error('Selector cleanup exceeds its file limit');
  }
  return { removed: count(value['removed']), changes };
}

export function parseSelectorFileChange(input: unknown): SelectorFileChange {
  return object({ rel: pathText, before: text, after: text })(input);
}

export function parseSelectorIds(input: unknown): readonly string[] {
  const ids = list(selectorId)(input);
  if (ids.length === 0) {
    throw new Error('Choose at least one selector to remove');
  }
  if (ids.length > SELECTOR_USAGE_LIMITS.removalsMax) {
    throw new Error(`A cleanup removes at most ${SELECTOR_USAGE_LIMITS.removalsMax} selectors`);
  }
  return ids;
}

export function parseSelectorFileDigests(input: unknown): readonly SelectorFileDigest[] {
  const files = list(object({ rel: pathText, digest }))(input);
  if (files.length > SELECTOR_USAGE_LIMITS.filesMax) {
    throw new Error('Selector cleanup exceeds its file limit');
  }
  return files;
}

export function parseSelectorFileChanges(input: unknown): readonly SelectorFileChange[] {
  const changes = list(parseSelectorFileChange)(input);
  if (changes.length === 0) {
    throw new Error('Nothing to restore');
  }
  if (changes.length > SELECTOR_USAGE_LIMITS.filesMax) {
    throw new Error('Selector restore exceeds its file limit');
  }
  return changes;
}

export function verdictNames(verdict: SelectorVerdict): readonly string[] {
  switch (verdict.kind) {
    case 'used':
    case 'untracked':
      return [];
    case 'unused':
    case 'kept':
    case 'unknown':
    case 'checking':
      return verdict.names;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

export function selectorEntryId(input: { readonly rel: string; readonly block: number; readonly offset: number; readonly index: number }): string {
  assert(Number.isSafeInteger(input.block), 'selectorEntryId: block is an index');
  assert(input.block >= 0, 'selectorEntryId: block is nonnegative');
  assert(Number.isSafeInteger(input.offset), 'selectorEntryId: offset is an index');
  assert(input.offset >= 0, 'selectorEntryId: offset is nonnegative');
  assert(Number.isSafeInteger(input.index), 'selectorEntryId: list index is an index');
  assert(input.index >= 0, 'selectorEntryId: list index is nonnegative');
  assert(input.rel !== '', 'selectorEntryId: the stylesheet is named');
  return `${input.rel}|${input.block}|${input.offset}|${input.index}`;
}

function parseSelectorEntry(input: unknown): SelectorEntry {
  const value = record(input);
  const line = count(value['line']);
  if (line === 0) {
    throw new Error('Selector line is 1-based');
  }
  const scope = value['scope'];
  if (scope !== 'global' && scope !== 'scoped') {
    throw new Error('Unknown selector scope');
  }
  const selector = text(value['selector']);
  if (selector.length > SELECTOR_USAGE_LIMITS.selectorCharsMax) {
    throw new Error('Selector exceeds its display limit');
  }
  return { id: selectorId(value['id']), rel: pathText(value['rel']), line, selector, scope, verdict: parseVerdict(value['verdict']) };
}

function parseVerdict(input: unknown): SelectorVerdict {
  const value = record(input);
  const kind = value['kind'];
  switch (kind) {
    case 'used':
    case 'untracked':
      return { kind };
    case 'unused':
    case 'checking':
      return { kind, names: parseNames(value['names']) };
    case 'kept': {
      const names = parseNames(value['names']);
      return value['inUse'] === true ? { kind, names, inUse: true } : { kind, names };
    }
    case 'unknown': {
      const names = parseNames(value['names']);
      const reason = text(value['reason']);
      const reasonRef = parseOptionalMessageRef(value['reasonRef']);
      return reasonRef === undefined ? { kind, names, reason } : { kind, names, reason, reasonRef };
    }
    default:
      throw new Error('Unknown selector verdict');
  }
}

function parseNote(input: unknown): SelectorNote {
  const value = record(input);
  const note = { rel: pathText(value['rel']), message: text(value['message']) };
  const messageRef = parseOptionalMessageRef(value['messageRef']);
  return messageRef === undefined ? note : { ...note, messageRef };
}

function parseNames(input: unknown): readonly string[] {
  const names = list(text)(input);
  if (names.length > SELECTOR_USAGE_LIMITS.namesPerEntryMax) {
    throw new Error('Selector names exceed their limit');
  }
  for (const name of names) {
    if (name.length === 0 || name.length > SELECTOR_USAGE_LIMITS.nameCharsMax) {
      throw new Error('Selector name length is out of range');
    }
  }
  return names;
}

function selectorId(input: unknown): string {
  const value = text(input);
  if (!/^[^|]+\|\d+\|\d+\|\d+$/.test(value)) {
    throw new Error('Invalid selector id');
  }
  return value;
}

function parseResult<T>(input: unknown, parse: (value: unknown) => T): Result<T, PropertyError> {
  const value = record(input);
  if (value['ok'] === true) {
    return ok(parse(value['value']));
  }
  if (value['ok'] === false) {
    return err(parseRefusal(value['error']));
  }
  throw new Error('Expected a result');
}
