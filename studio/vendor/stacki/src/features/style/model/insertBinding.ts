import { assert } from '../../../../shared/core/assert';


function splitImportant(value: string): { body: string; suffix: string } {
  const match = value.match(/(\s*!\s*important\s*)$/i);
  return match ? { body: value.slice(0, match.index), suffix: match[1] ?? '' } : { body: value, suffix: '' };
}

const LONE_VAR = /^var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^)]*)?\)$/i;

export function replacesWholeValue(value: string): boolean {
  const { body } = splitImportant(String(value ?? ''));
  const trimmed = body.trim();
  if (!trimmed) {
    return true;
  }
  if (LONE_VAR.test(trimmed)) {
    return true;
  }
  if (trimmed.includes('(')) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  return true;
}

function varAround(value: string, caret: number): { start: number; end: number } | undefined {
  const re = /var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^)]*)?\)/gi;
  for (let match = re.exec(value); match !== null; match = re.exec(value)) {
    const start = match.index;
    const end = start + match[0].length;
    if (caret >= start && caret <= end) {
      return { start, end };
    }
  }
  return undefined;
}

export function insertBinding(value: string, binding: string, caret: number | undefined): string {
  const text = String(value ?? '');
  const { body, suffix } = splitImportant(text);

  if (replacesWholeValue(text)) {
    return binding + suffix;
  }

  if (caret === undefined) {
    const existing = body.match(/var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^)]*)?\)/i);
    return existing ? text.replace(existing[0], binding) : body + binding + suffix;
  }

  const at = Math.max(0, Math.min(caret, body.length));
  const around = varAround(body, at);
  if (around) {
    return body.slice(0, around.start) + binding + body.slice(around.end) + suffix;
  }
  return body.slice(0, at) + binding + body.slice(at) + suffix;
}

export interface ValueSelection {
  readonly start: number;
  readonly end: number;
}

export function insertBindingAt(value: string, binding: string, selection: ValueSelection | undefined): string {
  const text = String(value ?? '');
  if (selection === undefined) {
    return insertBinding(text, binding, undefined);
  }
  assert(selection.start <= selection.end, 'insertBindingAt: the selection does not end before it starts');
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  if (start === end) {
    return insertBinding(text, binding, start);
  }
  const widened = widenOverVariables(text, { start, end });
  assert(widened.start <= start, 'insertBindingAt: widening never shrinks the selection');
  return text.slice(0, widened.start) + binding + text.slice(widened.end);
}

function widenOverVariables(value: string, selection: ValueSelection): ValueSelection {
  let { start, end } = selection;
  const re = /var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^)]*)?\)/gi;
  for (let match = re.exec(value); match !== null; match = re.exec(value)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchStart < end && matchEnd > start) {
      start = Math.min(start, matchStart);
      end = Math.max(end, matchEnd);
    }
  }
  return { start, end };
}
