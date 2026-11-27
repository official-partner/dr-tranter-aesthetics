import { assert } from '../core/assert';
import { BOUNDARY_LIMITS, count, record, text } from '../core/boundary';

export const PREVIEW_HEALTH_LIMITS = {
  thrownCharsMax: 2_000,
  logTailCharsMax: 8_000,
  thrownFrameLinesMax: 8,
  bodyBytesMax: 1_048_576,
} as const satisfies Record<string, number>;

export const PREVIEW_HEALTH_KINDS = ['ok', 'server-error', 'empty-page', 'truncated', 'dropped', 'error-overlay', 'unreachable'] as const;
export type PreviewHealthKind = (typeof PREVIEW_HEALTH_KINDS)[number];

export interface PreviewHealth {
  readonly kind: PreviewHealthKind;
  readonly status: number;
  readonly thrown: string | undefined;
  readonly logTail: string;
}

export interface PreviewResponseSample {
  readonly reached: boolean;
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: string;
  readonly reading: 'complete' | 'dropped' | 'capped';
}

export function classifyPreviewResponse(sample: PreviewResponseSample): PreviewHealth {
  assert(Number.isSafeInteger(sample.status), 'A response status is an integer');
  assert(sample.status >= 0, 'A response status is not negative');
  assert(sample.body.length <= PREVIEW_HEALTH_LIMITS.bodyBytesMax * 4, 'The body judged is the bounded sample, not a whole download');
  if (!sample.reached) {
    return verdict('unreachable', 0, undefined);
  }
  const { status } = sample;
  const html = isHtml(sample.contentType, sample.body);
  const overlayMessage = html ? overlayError(sample.body) : undefined;
  if (overlayMessage !== undefined) {
    return verdict('error-overlay', status, overlayMessage.length === 0 ? undefined : overlayMessage);
  }
  if (status >= 500) {
    return verdict('server-error', status, undefined);
  }
  if (!html) {
    return verdict('ok', status, undefined);
  }
  if (sample.reading === 'dropped') {
    return verdict('dropped', status, undefined);
  }
  if (visibleContent(sample.body).length === 0) {
    return verdict('empty-page', status, undefined);
  }
  if (sample.reading === 'complete' && isDocument(sample.body) && !endsDocument(sample.body)) {
    return verdict('truncated', status, undefined);
  }
  return verdict('ok', status, undefined);
}

export function extractThrownError(log: string): string | undefined {
  assert(typeof log === 'string', 'A log is text');
  assert(PREVIEW_HEALTH_LIMITS.thrownCharsMax > 0, 'The extracted error has room');
  const lines = stripColour(log).split('\n');
  let found = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (ERROR_LINE.test(lines[index] ?? '')) {
      found = index;
      break;
    }
  }
  if (found < 0) {
    return undefined;
  }
  const kept = [(lines[found] ?? '').trimEnd()];
  for (let index = found + 1; index < lines.length && kept.length <= PREVIEW_HEALTH_LIMITS.thrownFrameLinesMax; index++) {
    const line = lines[index] ?? '';
    if (/^\s+\S/.test(line)) {
      kept.push(line.trimEnd());
    } else {
      break;
    }
  }
  return kept.join('\n').slice(0, PREVIEW_HEALTH_LIMITS.thrownCharsMax);
}

export function parsePreviewHealth(input: unknown): PreviewHealth {
  const value = record(input);
  const kind = text(value['kind']);
  const known = PREVIEW_HEALTH_KINDS.find((candidate) => candidate === kind);
  if (known === undefined) {
    throw new Error('Preview health: unknown kind');
  }
  const status = count(value['status']);
  const logTail = text(value['logTail']);
  if (logTail.length > PREVIEW_HEALTH_LIMITS.logTailCharsMax) {
    throw new Error('Preview health: log tail exceeds limit');
  }
  const thrownInput = value['thrown'];
  if (thrownInput === undefined) {
    return { kind: known, status, thrown: undefined, logTail };
  }
  const thrown = text(thrownInput);
  if (thrown.length > PREVIEW_HEALTH_LIMITS.thrownCharsMax) {
    throw new Error('Preview health: thrown text exceeds limit');
  }
  assert(BOUNDARY_LIMITS.textLengthMax >= PREVIEW_HEALTH_LIMITS.thrownCharsMax, 'The wire carries an error of the size the notice shows');
  return { kind: known, status, thrown, logTail };
}

const ERROR_LINE = /\[(?:ERROR|error)\]|^\s*(?:[A-Z][A-Za-z]*Error|AstroUserError|Error)\b[:\s]/;

function verdict(kind: PreviewHealthKind, status: number, thrown: string | undefined): PreviewHealth {
  assert(PREVIEW_HEALTH_KINDS.includes(kind), 'A verdict is one of the known kinds');
  assert(status >= 0, 'A verdict carries a status');
  return { kind, status, thrown: thrown === undefined ? undefined : thrown.slice(0, PREVIEW_HEALTH_LIMITS.thrownCharsMax), logTail: '' };
}

function isHtml(contentType: string | undefined, body: string): boolean {
  if (contentType === undefined) {
    return /^\s*<(?:!doctype|html)/i.test(body);
  }
  return /html/i.test(contentType);
}

function isDocument(body: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html)/i.test(body);
}

const DOCUMENT_TAIL_CHARS = 4_096;
const AFTER_CLOSING_HTML = /<\/html\s*>(?:\s|<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>)*$/i;

function endsDocument(body: string): boolean {
  return AFTER_CLOSING_HTML.test(body.slice(-DOCUMENT_TAIL_CHARS));
}

function overlayError(body: string): string | undefined {
  if (!/vite-error-overlay|ErrorOverlay\(/.test(body)) {
    return undefined;
  }
  const match = /"message"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(body);
  if (match?.[1] === undefined) {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return '';
  }
}

function visibleContent(body: string): string {
  const inner = /<body[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(body);
  const scope = inner?.[1] ?? (isDocument(body) ? '' : body);
  return scope
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

function stripColour(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}
