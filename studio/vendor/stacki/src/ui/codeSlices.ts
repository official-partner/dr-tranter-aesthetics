
import { assert } from '../../shared/core/assert';

export interface LineSlice {
  readonly start: number;
  readonly end: number;
  readonly last: boolean;
}

export function nextLineSlice(text: string, start: number, charsMax: number): LineSlice {
  assert(Number.isSafeInteger(charsMax), 'nextLineSlice: the slice size is a safe integer');
  assert(charsMax > 0, 'nextLineSlice: a slice holds at least one character');
  assert(start >= 0, 'nextLineSlice: a slice starts inside the text');
  assert(start <= text.length, 'nextLineSlice: a slice does not start past the text');
  const limit = start + charsMax;
  if (limit >= text.length) {
    return { start, end: text.length, last: true };
  }
  const lastBreak = text.lastIndexOf('\n', limit);
  const lineEnd = lastBreak >= start ? lastBreak : text.indexOf('\n', start);
  if (lineEnd < 0) {
    return { start, end: text.length, last: true };
  }
  assert(lineEnd >= start, 'nextLineSlice: a slice ends at or after its start');
  return { start, end: lineEnd, last: false };
}

export interface LineIndex {
  readonly length: number;
  lineAt(position: number): { readonly from: number; readonly to: number };
}

export function nextDocumentLineSlice(document: LineIndex, start: number, charsMax: number): LineSlice {
  assert(charsMax > 0, 'nextDocumentLineSlice: a slice holds at least one character');
  assert(start >= 0, 'nextDocumentLineSlice: a slice starts inside the document');
  assert(start <= document.length, 'nextDocumentLineSlice: a slice does not start past the document');
  const limit = start + charsMax;
  if (limit >= document.length) {
    return { start, end: document.length, last: true };
  }
  const line = document.lineAt(limit);
  const end = line.from > start ? line.from - 1 : line.to;
  assert(end >= start, 'nextDocumentLineSlice: a slice ends at or after its start');
  return { start, end, last: end >= document.length };
}

export function* lineSlices(text: string, start: number, charsMax: number): Generator<LineSlice> {
  let cursor = start;
  for (let steps = 0; steps <= text.length + 1; steps++) {
    const slice = nextLineSlice(text, cursor, charsMax);
    yield slice;
    if (slice.last) {
      return;
    }
    assert(slice.end + 1 > cursor, 'lineSlices: every slice advances');
    cursor = slice.end + 1;
  }
  assert(false, 'lineSlices: the text ran out before the slices did');
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
