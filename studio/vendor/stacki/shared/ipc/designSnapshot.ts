import { assert } from '../core/assert';
import { count, record, text } from '../core/boundary';

export const DESIGN_SNAPSHOT_LIMITS = {
  elementsMax: 20_000,
  htmlCharsMax: 10_000_000,
  assetsCharsMax: 5_000_000,
  assetCharsMax: 900_000,
  liveSheetsMax: 400,
  liveElementsMax: 400,
  totalCharsMax: 48_000_000,
  fontsMax: 24,
  fontsCharsMax: 3_000_000,
  fontCharsMax: 1_200_000,
  titleCharsMax: 400,
  urlCharsMax: 2_000,
  nonceCharsMax: 64,
  detailCharsMax: 400,
  pixelsMax: 20_000,
} as const satisfies Record<string, number>;

export const DESIGN_ID_ATTRIBUTE = 'data-dm-id';

export interface DesignLiveSheet {
  readonly id: number;
  readonly css: string;
}

export interface DesignLiveElement {
  readonly id: number;
  readonly style: string | undefined;
  readonly className: string | undefined;
}

export const DESIGN_FRAME_WINDOW_NAME = 'stacki-design-frame';

export const DESIGN_NODE_ATTRIBUTE = 'data-dm-node';

export function designNodeMark(path: string, copy: number): string {
  assert(Number.isSafeInteger(copy), 'A node copy is counted in whole numbers');
  assert(copy >= 0, 'A node copy is counted from zero');
  const mark = `${encodeURIComponent(path)}:${String(copy)}`;
  assert(!mark.includes(' '), 'A mark holds no space, which is what separates marks');
  return mark;
}

export interface DesignNodeAt {
  readonly path: string;
  readonly copy: number;
}

export function deepestDesignNode(attribute: string): DesignNodeAt | undefined {
  let best: DesignNodeAt | undefined = undefined;
  for (const mark of attribute.split(' ').slice(0, 64)) {
    const colon = mark.lastIndexOf(':');
    const copy = Number(mark.slice(colon + 1));
    if (colon <= 0 || !Number.isSafeInteger(copy) || copy < 0) {
      continue;
    }
    let path: string;
    try {
      path = decodeURIComponent(mark.slice(0, colon));
    } catch {
      continue;
    }
    if (best === undefined || path.split('.').length > best.path.split('.').length) {
      best = { path, copy };
    }
  }
  assert(best === undefined || best.copy >= 0, 'A found node copy is counted from zero');
  return best;
}

export type DesignSnapshotRequest =
  | { readonly type: 'stacki:design-snapshot'; readonly nonce: string }
  | { readonly type: 'stacki:design-page-html'; readonly nonce: string }
  | { readonly type: 'stacki:design-watch' };

export interface DesignSnapshot {
  readonly html: string;
  readonly url: string;
  readonly title: string;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}

export const DESIGN_SNAPSHOT_FAILURES = ['no-document', 'too-many-elements', 'too-large', 'failed'] as const;

export const DESIGN_PAGE_HTML_FAILURES = ['not-a-page', 'too-large', 'failed'] as const;
export type DesignPageHtmlFailure = (typeof DESIGN_PAGE_HTML_FAILURES)[number];
export type DesignSnapshotFailure = (typeof DESIGN_SNAPSHOT_FAILURES)[number];

export type DesignCanvasMessage =
  | { readonly type: 'stacki:design-snapshot-reply'; readonly nonce: string; readonly ok: true; readonly snapshot: DesignSnapshot }
  | {
      readonly type: 'stacki:design-snapshot-reply';
      readonly nonce: string;
      readonly ok: false;
      readonly failure: DesignSnapshotFailure;
      readonly detail: string;
    }
  | {
      readonly type: 'stacki:design-live';
      readonly sheets: readonly DesignLiveSheet[];
      readonly elements: readonly DesignLiveElement[];
      readonly variables: string;
    }
  | { readonly type: 'stacki:design-page-html-reply'; readonly nonce: string; readonly ok: true; readonly html: string }
  | { readonly type: 'stacki:design-page-html-reply'; readonly nonce: string; readonly ok: false; readonly failure: DesignPageHtmlFailure }
  | { readonly type: 'stacki:design-changed' };

function bounded(input: unknown, charsMax: number, what: string): string {
  const value = text(input);
  if (value.length > charsMax) {
    throw new Error(`${what}: exceeds ${charsMax} characters`);
  }
  return value;
}

function pixels(input: unknown, what: string): number {
  const value = count(input);
  if (value > DESIGN_SNAPSHOT_LIMITS.pixelsMax) {
    throw new Error(`${what}: too large`);
  }
  return value;
}

export function parseDesignSnapshot(input: unknown): DesignSnapshot {
  const value = record(input);
  const html = bounded(value['html'], DESIGN_SNAPSHOT_LIMITS.htmlCharsMax, 'Design snapshot');
  if (html.length === 0) {
    throw new Error('Design snapshot: expected a document');
  }
  return {
    html,
    url: bounded(value['url'], DESIGN_SNAPSHOT_LIMITS.urlCharsMax, 'Design snapshot address'),
    title: bounded(value['title'], DESIGN_SNAPSHOT_LIMITS.titleCharsMax, 'Design snapshot title'),
    viewportWidthPx: pixels(value['viewportWidthPx'], 'Design snapshot width'),
    viewportHeightPx: pixels(value['viewportHeightPx'], 'Design snapshot height'),
  };
}

export function parseDesignSnapshotRequest(input: unknown): DesignSnapshotRequest | undefined {
  if (typeof input !== 'object' || !input || !('type' in input)) {
    return undefined;
  }
  if (input.type === 'stacki:design-watch') {
    return { type: input.type };
  }
  if ((input.type !== 'stacki:design-snapshot' && input.type !== 'stacki:design-page-html') || !('nonce' in input)) {
    return undefined;
  }
  const { nonce } = input;
  if (typeof nonce !== 'string' || nonce.length > DESIGN_SNAPSHOT_LIMITS.nonceCharsMax) {
    return undefined;
  }
  return { type: input.type, nonce };
}

function parseDesignLive(value: Readonly<Record<string, unknown>>): DesignCanvasMessage {
  const listed = (input: unknown, itemsMax: number, what: string): readonly Readonly<Record<string, unknown>>[] => {
    if (!Array.isArray(input) || input.length > itemsMax) {
      throw new Error(`${what}: expected a bounded list`);
    }
    return input.map((entry: unknown) => record(entry));
  };
  const optionalText = (input: unknown, what: string): string | undefined =>
    input === undefined ? undefined : bounded(input, DESIGN_SNAPSHOT_LIMITS.assetCharsMax, what);
  return {
    type: 'stacki:design-live',
    sheets: listed(value['sheets'], DESIGN_SNAPSHOT_LIMITS.liveSheetsMax, 'Design live sheets').map((sheet) => ({
      id: count(sheet['id']),
      css: bounded(sheet['css'], DESIGN_SNAPSHOT_LIMITS.htmlCharsMax, 'Design live sheet'),
    })),
    elements: listed(value['elements'], DESIGN_SNAPSHOT_LIMITS.liveElementsMax, 'Design live elements').map((element) => ({
      id: count(element['id']),
      style: optionalText(element['style'], 'Design live style'),
      className: optionalText(element['className'], 'Design live class'),
    })),
    variables: bounded(value['variables'], DESIGN_SNAPSHOT_LIMITS.assetCharsMax, 'Design live variables'),
  };
}

export function parseDesignCanvasMessage(input: unknown): DesignCanvasMessage | undefined {
  if (typeof input !== 'object' || !input || !('type' in input)) {
    return undefined;
  }
  if (input.type === 'stacki:design-changed') {
    return { type: input.type };
  }
  if (input.type === 'stacki:design-live') {
    try {
      return parseDesignLive(record(input));
    } catch {
      return undefined;
    }
  }
  if (input.type === 'stacki:design-page-html-reply') {
    return parsePageHtmlReply(input);
  }
  if (input.type !== 'stacki:design-snapshot-reply') {
    return undefined;
  }
  try {
    const value = record(input);
    const nonce = bounded(value['nonce'], DESIGN_SNAPSHOT_LIMITS.nonceCharsMax, 'Design nonce');
    if (value['ok'] === true) {
      return { type: input.type, nonce, ok: true, snapshot: parseDesignSnapshot(value['snapshot']) };
    }
    const failure = DESIGN_SNAPSHOT_FAILURES.find((entry) => entry === value['failure']) ?? 'failed';
    const detail = bounded(value['detail'], DESIGN_SNAPSHOT_LIMITS.detailCharsMax, 'Design detail');
    return { type: input.type, nonce, ok: false, failure, detail };
  } catch {
    return undefined;
  }
}

function parsePageHtmlReply(input: object): DesignCanvasMessage | undefined {
  try {
    const value = record(input);
    const nonce = bounded(value['nonce'], DESIGN_SNAPSHOT_LIMITS.nonceCharsMax, 'Design nonce');
    if (value['ok'] === true) {
      const html = bounded(value['html'], DESIGN_SNAPSHOT_LIMITS.htmlCharsMax, 'Design page text');
      return { type: 'stacki:design-page-html-reply', nonce, ok: true, html };
    }
    const failure = DESIGN_PAGE_HTML_FAILURES.find((entry) => entry === value['failure']) ?? 'failed';
    return { type: 'stacki:design-page-html-reply', nonce, ok: false, failure };
  } catch {
    return undefined;
  }
}
