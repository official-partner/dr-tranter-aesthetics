import { assert } from '../../shared/core/assert';
import type { RejectionReason, SourceEdit } from '../../shared/engine/intent';
import { decodeEntities, encodeText, textValue } from '../../shared/page/htmlText';
import { err, ok, type Result } from '../../shared/core/result';
import { toByteSpan } from '../../shared/core/span';

const SQUEEZED = /&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);|\s+/gi;

interface Unit {
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly entity: boolean;
  readonly atomic: boolean;
}

export function entityTextHunks(raw: string, previousValue: string, nextValue: string): Result<readonly SourceEdit[], RejectionReason> | undefined {
  if (!raw.includes('&')) {
    return undefined;
  }
  const characters = textValue(raw);
  if (characters !== previousValue) {
    return undefined;
  }
  const change = changedMiddle(previousValue, nextValue);
  if (change === undefined) {
    return err('unsupported-operation');
  }
  const units = unitsOf(raw);
  assert(units.length > 0, 'A run with an ampersand has units');
  if (!units.some((unit) => unit.entity)) {
    return undefined;
  }
  const start = boundaryAtOrBefore(units, change.start);
  const end = boundaryAtOrAfter(units, change.end);
  assert(start.chars <= change.start, 'A boundary before the change starts at or before it');
  assert(end.chars >= change.end, 'A boundary after the change ends at or after it');
  const replacement =
    previousValue.slice(start.chars, change.start) + nextValue.slice(change.start, change.nextEnd) + previousValue.slice(change.end, end.chars);
  const written = encodeText(replacement);
  const rewritten = raw.slice(0, start.raw) + written + raw.slice(end.raw);
  if (textValue(rewritten) !== nextValue) {
    return undefined;
  }
  const span = toByteSpan(Buffer.byteLength(raw.slice(0, start.raw), 'utf8'), Buffer.byteLength(raw.slice(0, end.raw), 'utf8'));
  return ok([{ span, text: written }]);
}

function changedMiddle(previousValue: string, nextValue: string): { readonly start: number; readonly end: number; readonly nextEnd: number } | undefined {
  if (previousValue === nextValue) {
    return undefined;
  }
  const shorter = Math.min(previousValue.length, nextValue.length);
  let start = 0;
  while (start < shorter && previousValue.charCodeAt(start) === nextValue.charCodeAt(start)) {
    start++;
  }
  let tail = 0;
  while (tail < shorter - start && previousValue.charCodeAt(previousValue.length - 1 - tail) === nextValue.charCodeAt(nextValue.length - 1 - tail)) {
    tail++;
  }
  if (splitsPair(previousValue, start)) {
    start--;
  }
  if (splitsPair(previousValue, previousValue.length - tail)) {
    tail--;
  }
  assert(start >= 0, 'The change starts inside the run');
  assert(tail >= 0, 'The change ends inside the run');
  return { start, end: previousValue.length - tail, nextEnd: nextValue.length - tail };
}

function splitsPair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }
  const before = text.charCodeAt(offset - 1);
  const at = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
}

function unitsOf(raw: string): readonly Unit[] {
  const units: Unit[] = [];
  let rawAt = 0;
  let charAt = 0;
  const plainUntil = (rawEnd: number): void => {
    if (rawEnd > rawAt) {
      const plain = rawEnd - rawAt;
      units.push({ rawStart: rawAt, rawEnd, charStart: charAt, charEnd: charAt + plain, entity: false, atomic: false });
      charAt += plain;
      rawAt = rawEnd;
    }
  };
  for (const match of raw.matchAll(SQUEEZED)) {
    const text = match[0];
    const decoded = text.startsWith('&') ? decodeEntities(text) : ' ';
    if (decoded === text) {
      continue;
    }
    plainUntil(match.index);
    units.push({
      rawStart: match.index,
      rawEnd: match.index + text.length,
      charStart: charAt,
      charEnd: charAt + decoded.length,
      entity: text.startsWith('&'),
      atomic: true,
    });
    charAt += decoded.length;
    rawAt = match.index + text.length;
  }
  plainUntil(raw.length);
  return units;
}

interface Boundary {
  readonly chars: number;
  readonly raw: number;
}

function boundaryAtOrBefore(units: readonly Unit[], chars: number): Boundary {
  for (const unit of units) {
    if (chars >= unit.charStart && chars <= unit.charEnd) {
      if (!unit.atomic) {
        return { chars, raw: unit.rawStart + (chars - unit.charStart) };
      }
      return chars === unit.charEnd ? { chars, raw: unit.rawEnd } : { chars: unit.charStart, raw: unit.rawStart };
    }
  }
  throw new Error(`Assertion failed: character ${chars} lies inside the run`);
}

function boundaryAtOrAfter(units: readonly Unit[], chars: number): Boundary {
  for (const unit of units) {
    if (chars >= unit.charStart && chars <= unit.charEnd) {
      if (!unit.atomic) {
        return { chars, raw: unit.rawStart + (chars - unit.charStart) };
      }
      return chars === unit.charStart ? { chars, raw: unit.rawStart } : { chars: unit.charEnd, raw: unit.rawEnd };
    }
  }
  throw new Error(`Assertion failed: character ${chars} lies inside the run`);
}
