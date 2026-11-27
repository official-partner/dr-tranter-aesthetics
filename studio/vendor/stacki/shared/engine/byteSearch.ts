import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import type { ByteString } from '../core/span';

export function countOccurrences(haystack: ByteString, needle: ByteString, countMax: number): number {
  assert(needle.length > 0, 'Only a non-empty needle is searched for');
  assert(haystack.length <= LIMITS.sourceBytesMax, 'The haystack is inside the source bound');
  assert(Number.isSafeInteger(countMax), 'The count bound is an integer');
  assert(countMax > 0, 'The count bound is positive');
  const failure = failureTable(needle);
  let count = 0;
  let matched = 0;
  for (let index = 0; index < haystack.length; index++) {
    const byte = haystack[index];
    matched = extendMatch(needle, failure, matched, byte);
    if (matched === needle.length) {
      count += 1;
      if (count === countMax) {
        return count;
      }
      matched = failure[matched - 1] ?? 0;
    }
  }
  assert(count < countMax, 'A search that reached the bound returned inside the loop');
  return count;
}


function failureTable(needle: ByteString): Uint32Array {
  const failure = new Uint32Array(needle.length);
  let border = 0;
  for (let index = 1; index < needle.length; index++) {
    border = extendMatch(needle, failure, border, needle[index]);
    failure[index] = border;
  }
  assert(failure[0] === 0, 'The one-byte prefix has no proper border');
  return failure;
}

function extendMatch(needle: ByteString, failure: Uint32Array, matched: number, byte: number | undefined): number {
  assert(byte !== undefined, 'The byte read lies inside its array');
  assert(matched < needle.length, 'A full match was reset before the next byte');
  let length = matched;
  while (length > 0) {
    if (needle[length] === byte) {
      return length + 1;
    }
    length = failure[length - 1] ?? 0;
  }
  return needle[0] === byte ? 1 : 0;
}
