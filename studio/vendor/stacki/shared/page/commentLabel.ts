import { assert } from '../core/assert';

export const COMMENT_LABEL_LIMITS = {
  descriptionCharsMax: 4096,
  linesMax: 1024,
} as const satisfies Record<string, number>;

export interface CommentLabel {
  readonly title: string;
  readonly titleStart: number;
  readonly titleEnd: number;
  readonly description: string | undefined;
}

export type LabelPart = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'code'; readonly text: string };

export function commentLabel(body: string): CommentLabel {
  const lines = commentLines(body);
  assert(lines.length <= COMMENT_LABEL_LIMITS.linesMax, 'commentLabel: lines are bounded');
  const first = lines.find((line) => line.text !== '');
  if (first === undefined) {
    return { title: '', titleStart: body.length, titleEnd: body.length, description: undefined };
  }
  const titleLength = titleLengthOf(first.text);
  const title = first.text.slice(0, titleLength);
  const titleStart = first.start;
  const titleEnd = titleStart + titleLength;
  assert(body.slice(titleStart, titleEnd) === title, 'commentLabel: the title is a span of the body');
  assert(title.trim() === title, 'commentLabel: the title has no edge whitespace');
  return { title, titleStart, titleEnd, description: descriptionOf(lines, title) };
}

export function labelParts(title: string): readonly LabelPart[] {
  const pieces = title.split('`');
  assert(pieces.length <= title.length + 1, 'labelParts: one piece per backtick, plus one');
  const parts: LabelPart[] = [];
  const pairedCount = pieces.length % 2 === 1 ? pieces.length : pieces.length - 1;
  for (let index = 0; index < pairedCount; index++) {
    const text = pieces[index] ?? '';
    if (text !== '') {
      parts.push(index % 2 === 0 ? { kind: 'text', text } : { kind: 'code', text });
    }
  }
  if (pairedCount < pieces.length) {
    parts.push({ kind: 'text', text: `\`${pieces.slice(pairedCount).join('`')}` });
  }
  assert(
    parts.every((part) => part.text !== ''),
    'labelParts: no part is empty',
  );
  return mergeText(parts);
}

export function labelPlainText(title: string): string {
  return labelParts(title)
    .map((part) => part.text)
    .join('');
}

interface CommentLine {
  readonly text: string;
  readonly start: number;
}

const GUTTER = /^\s*(?:\*+(?=\s|$))?\s*/;

function commentLines(body: string): readonly CommentLine[] {
  const lines: CommentLine[] = [];
  let start = 0;
  while (start <= body.length) {
    if (lines.length < COMMENT_LABEL_LIMITS.linesMax) {
      const newline = body.indexOf('\n', start);
      const end = newline === -1 ? body.length : newline;
      const raw = body.slice(start, end);
      const gutterLength = GUTTER.exec(raw)?.[0].length ?? 0;
      lines.push({ text: raw.slice(gutterLength).trimEnd(), start: start + gutterLength });
      start = end + 1;
    } else {
      break;
    }
  }
  assert(lines.length > 0, 'commentLines: a body has at least one line');
  return lines;
}

function titleLengthOf(line: string): number {
  assert(line.trim() === line, 'titleLengthOf: the line is trimmed');
  assert(line !== '', 'titleLengthOf: the line has words');
  const sentence = line.slice(0, sentenceEnd(line));
  if (sentence.endsWith('.')) {
    if (sentence.endsWith('..')) {
      return sentence.length;
    }
    const bare = sentence.slice(0, -1).trimEnd();
    return bare === '' ? sentence.length : bare.length;
  }
  return sentence.length;
}

function sentenceEnd(line: string): number {
  let inCode = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '`') {
      inCode = !inCode;
    } else if (inCode) {
      continue;
    } else if (character === '.' || character === '!' || character === '?') {
      const next = line[index + 1];
      if (next === undefined || /\s/.test(next)) {
        return index + 1;
      }
    }
  }
  return line.length;
}

function descriptionOf(lines: readonly CommentLine[], title: string): string | undefined {
  const whole = lines
    .map((line) => line.text)
    .join('\n')
    .trim();
  assert(whole.startsWith(title), 'descriptionOf: the description starts with the title');
  if (whole === title || whole === `${title}.`) {
    return undefined;
  }
  if (whole.length <= COMMENT_LABEL_LIMITS.descriptionCharsMax) {
    return whole;
  }
  return `${whole.slice(0, COMMENT_LABEL_LIMITS.descriptionCharsMax - 1)}…`;
}

function mergeText(parts: readonly LabelPart[]): readonly LabelPart[] {
  const merged: LabelPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.kind === 'text' && part.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: last.text + part.text };
    } else {
      merged.push(part);
    }
  }
  assert(merged.length <= parts.length, 'mergeText: merging never adds a part');
  return merged;
}
