import { assert } from './assert';
import { toByteOffset, toUtf16Offset, type Brand, type ByteOffset, type Utf16Offset } from './brand';
import { LIMITS } from './limits';
import { toRecord } from './record';
import { err, ok, type Result } from './result';

export interface ByteSpan {
  readonly start: ByteOffset;
  readonly end: ByteOffset;
}

export interface Utf16Span {
  readonly start: Utf16Offset;
  readonly end: Utf16Offset;
}

export type ByteString = Brand<Uint8Array, 'ByteString'>;

export function toByteSpan(start: number, end: number): ByteSpan {
  const span = { start: toByteOffset(start), end: toByteOffset(end) };
  if (span.end < span.start) {
    throw new Error('ByteSpan: end must not precede start');
  }
  return span;
}

export function toUtf16Span(start: number, end: number): Utf16Span {
  const span = { start: toUtf16Offset(start), end: toUtf16Offset(end) };
  if (span.end < span.start) {
    throw new Error('Utf16Span: end must not precede start');
  }
  return span;
}

export function parseByteSpan(input: unknown, where: string): ByteSpan {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error(`${where}: expected span object`);
  }
  const start = record['start'];
  const end = record['end'];
  if (typeof start !== 'number') {
    throw new Error(`${where}.start: expected number`);
  }
  if (typeof end !== 'number') {
    throw new Error(`${where}.end: expected number`);
  }
  if (end > LIMITS.sourceBytesMax) {
    throw new Error(`${where}.end: exceeds ${LIMITS.sourceBytesMax} bytes`);
  }
  return toByteSpan(start, end);
}

export function parseUtf16Span(input: unknown, where: string): Utf16Span {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error(`${where}: expected span object`);
  }
  const start = record['start'];
  const end = record['end'];
  if (typeof start !== 'number') {
    throw new Error(`${where}.start: expected number`);
  }
  if (typeof end !== 'number') {
    throw new Error(`${where}.end: expected number`);
  }
  if (end > LIMITS.ipcFieldCharsMax) {
    throw new Error(`${where}.end: exceeds ${LIMITS.ipcFieldCharsMax} chars`);
  }
  return toUtf16Span(start, end);
}

export function spanContains(outer: ByteSpan | Utf16Span, inner: ByteSpan | Utf16Span): boolean {
  if (outer.start <= inner.start) {
    return inner.end <= outer.end;
  }
  return false;
}

export function spansAscending(spans: readonly (ByteSpan | Utf16Span)[]): boolean {
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1];
    const current = spans[index];
    assert(previous !== undefined, 'Previous span exists inside the bounds');
    assert(current !== undefined, 'Current span exists inside the bounds');
    if (previous.end <= current.start) {
      continue;
    }
    return false;
  }
  return true;
}

export function utf16ToByteOffsets(text: string, offsets: readonly Utf16Offset[]): readonly ByteOffset[] {
  assert(text.length <= LIMITS.ipcFieldCharsMax, 'Converted text is inside the source bound');
  const result: ByteOffset[] = [];
  let bytes = 0;
  let unit = 0;
  for (const offset of offsets) {
    assert(offset <= text.length, 'UTF-16 offset lies inside the text');
    const previous = result.length === 0 ? undefined : offsets[result.length - 1];
    if (previous !== undefined) {
      assert(previous <= offset, 'UTF-16 offsets are converted in ascending order');
    }
    while (unit < offset) {
      const code = text.charCodeAt(unit);
      if (code < 0x800) {
        bytes += code < 0x80 ? 1 : 2;
        unit += 1;
      } else {
        const width = utf16PointUnits(text, unit);
        bytes += width === 2 ? 4 : utf8UnitBytes(code);
        unit += width;
      }
    }
    assert(unit <= offset, 'UTF-16 offset does not split a surrogate pair');
    assert(unit === offset, 'Conversion walked exactly to the requested offset');
    result.push(toByteOffset(bytes));
  }
  return result;
}

export function utf8ByteLength(text: string): number {
  const [end] = utf16ToByteOffsets(text, [toUtf16Offset(text.length)]);
  assert(end !== undefined, 'Conversion returns one offset per input');
  return end;
}

export function toByteString(bytes: Uint8Array): ByteString {
  if (bytes.length > LIMITS.sourceBytesMax) {
    throw new Error(`ByteString: exceeds ${LIMITS.sourceBytesMax} bytes`);
  }
  const copy = new Uint8Array(bytes);
  assert(copy.length === bytes.length, 'Copied bytes keep their length');
  assert(copy.buffer !== bytes.buffer, 'A byte string shares no memory with its input');
  return copy as ByteString;
}

export function encodeUtf8(text: string): ByteString {
  return toByteString(new TextEncoder().encode(text));
}

export type DecodeError = { readonly code: 'invalid-utf8'; readonly message: string };

export function decodeUtf8(bytes: ByteString): Result<string, DecodeError> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    return ok(decoder.decode(bytes));
  } catch (error: unknown) {
    return err({ code: 'invalid-utf8', message: String(error) });
  }
}

export function byteStringsEqual(left: ByteString, right: ByteString): boolean {
  if (left.length === right.length) {
    return sameLengthBytesEqual(left, right);
  }
  return false;
}

function sameLengthBytesEqual(left: ByteString, right: ByteString): boolean {
  assert(left.length === right.length, 'Compared bytes have one length');
  assert(left.length <= LIMITS.sourceBytesMax, 'Compared bytes are inside the file bound');
  let index = 0;
  if (left.byteOffset % 4 === 0) {
    if (right.byteOffset % 4 === 0) {
      const words = Math.floor(left.length / 4);
      const leftWords = new Uint32Array(left.buffer, left.byteOffset, words);
      const rightWords = new Uint32Array(right.buffer, right.byteOffset, words);
      for (let word = 0; word < words; word++) {
        if (leftWords[word] !== rightWords[word]) {
          return false;
        }
      }
      index = words * 4;
    }
  }
  for (; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function utf16PointUnits(text: string, unit: number): 1 | 2 {
  const code = text.charCodeAt(unit);
  if (code >= 0xd800) {
    if (code <= 0xdbff) {
      const next = text.charCodeAt(unit + 1);
      if (next >= 0xdc00) {
        return next <= 0xdfff ? 2 : 1;
      }
    }
  }
  return 1;
}

function utf8UnitBytes(code: number): number {
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  return 3;
}
