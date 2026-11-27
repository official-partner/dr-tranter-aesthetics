import { toDigest, type Digest } from '../core/brand';
import { LIMITS } from '../core/limits';
import { parseRejectionReason, type RejectionReason, type SourceEdit } from '../engine/intent';
import { parsePageReadResult, type ParsePageResult } from '../page/pageNode';
import { toArray, toRecord } from '../core/record';
import { err, ok, type Result } from '../core/result';
import { parseByteSpan, spansAscending } from '../core/span';

export type PageDiskRead = ParsePageResult & {
  readonly source: string;
  readonly checksum: Digest;
};

export type PageWriteFailure =
  | { readonly code: 'missing'; readonly message: string }
  | { readonly code: 'filesystem'; readonly message: string }
  | { readonly code: 'write-race'; readonly message: string }
  | { readonly code: 'uncertain'; readonly message: string }
  | { readonly code: 'backpressured'; readonly message: string };

export type PageEdited = PageDiskRead & { readonly inverse: readonly SourceEdit[] };

export type PageEditError =
  | {
      readonly code: 'rejected';
      readonly reason: RejectionReason;
      readonly message: string;
      readonly diskChecksum: Digest | undefined;
    }
  | PageWriteFailure;

export function parsePageEditResult(input: unknown): Result<PageEdited, PageEditError> {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error('PageEditResult: expected object');
  }
  if (record['ok'] === true) {
    return ok({ ...parsePageDiskRead(input), inverse: parseInverse(record['inverse']) });
  }
  if (record['ok'] === false) {
    return err(parsePageEditError(record['error']));
  }
  throw new Error('PageEditResult.ok: expected boolean');
}

function parseInverse(input: unknown): readonly SourceEdit[] {
  const hunks = toArray(input);
  if (hunks === undefined) {
    throw new Error('PageEdited.inverse: expected array');
  }
  const parsed = hunks.map((hunk, index) => {
    const record = toRecord(hunk);
    if (record === undefined) {
      throw new Error(`PageEdited.inverse[${index}]: expected object`);
    }
    const text = record['text'];
    if (typeof text !== 'string') {
      throw new Error(`PageEdited.inverse[${index}].text: expected string`);
    }
    return { span: parseByteSpan(record['span'], `PageEdited.inverse[${index}].span`), text };
  });
  if (!spansAscending(parsed.map((hunk) => hunk.span))) {
    throw new Error('PageEdited.inverse: expected ascending disjoint spans');
  }
  return parsed;
}

function parsePageEditError(input: unknown): PageEditError {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error('PageEditError: expected object');
  }
  if (record['code'] === 'rejected') {
    const message = record['message'];
    if (typeof message !== 'string' || message.length > LIMITS.attrCharsMax) {
      throw new Error('PageEditError.message: expected bounded string');
    }
    const disk = record['diskChecksum'];
    return {
      code: 'rejected',
      reason: parseRejectionReason(record['reason'], 'PageEditError.reason'),
      message,
      diskChecksum: disk === undefined ? undefined : checksumField(disk, 'PageEditError.diskChecksum'),
    };
  }
  return parsePageWriteFailure(input);
}

export function parsePageDiskRead(input: unknown): PageDiskRead {
  const page = parsePageReadResult(input);
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error('PageDiskRead: expected object');
  }
  return { ...page, checksum: checksumField(record['checksum'], 'PageDiskRead.checksum') };
}

function parsePageWriteFailure(input: unknown): PageWriteFailure {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error('PageWriteFailure: expected object');
  }
  const message = record['message'];
  if (typeof message !== 'string') {
    throw new Error('PageWriteFailure.message: expected string');
  }
  if (message.length > LIMITS.attrCharsMax) {
    throw new Error('PageWriteFailure.message: exceeds limit');
  }
  const code = record['code'];
  switch (code) {
    case 'missing':
    case 'filesystem':
    case 'write-race':
    case 'uncertain':
    case 'backpressured':
      return { code, message };
    default:
      throw new Error('PageWriteFailure.code: unknown value');
  }
}

function checksumField(input: unknown, where: string): Digest {
  if (typeof input !== 'string') {
    throw new Error(`${where}: expected string`);
  }
  try {
    return toDigest(input);
  } catch (error: unknown) {
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
