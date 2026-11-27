import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { parseCanvasReply, type CanvasAnswer } from './canvasReply';
export const CANVAS_LIMITS = { pendingMax: 1024 } as const;
interface QueryMessage {
  readonly type: 'avb:query';
  readonly id: number;
  readonly path: string;
  readonly selectors: readonly string[];
  readonly compute: readonly string[];
  readonly props: readonly string[];
  readonly textParentPath?: string;
  readonly pageMetadata?: boolean;
  readonly pageText?: boolean;
  readonly winning?: readonly string[];
  readonly scoped?: boolean;
}
interface PendingQuery {
  readonly resolve: (answer: CanvasAnswer | undefined) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly message: QueryMessage;
  held: boolean;
}


let frame: Pick<Window, 'postMessage'> | undefined = undefined;
let nextId = 1;
const pending = new Map<number, PendingQuery>();

const TIMEOUT_MS = 1500;

const send = (entry: PendingQuery): boolean => {
  try {
    frame?.postMessage(entry.message, '*');
    return true;
  } catch {
    return false;
  }
};

export function setCanvasFrame(target: Pick<Window, 'postMessage'> | undefined): void {
  if (frame === target) {
    return;
  }
  frame = target || undefined;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve(undefined);
  }
  pending.clear();
}

export function hasCanvas(): boolean {
  return !!frame;
}

export function requestCanvasReports(): boolean {
  return tellCanvas({ type: 'avb:resend-reports' });
}

export function tellCanvas(message: unknown): boolean {
  try {
    frame?.postMessage(message, '*');
    return !!frame;
  } catch {
    return false;
  }
}

export function queryCanvas(
  path: string,
  selectors: readonly string[] = [],
  compute: readonly string[] = [],
  props: readonly string[] = [],
  context: {
    readonly textParentPath?: string;
    readonly pageMetadata?: boolean;
    readonly pageText?: boolean;
    readonly winning?: readonly string[];
    readonly scoped?: boolean;
  } = {},
): Promise<CanvasAnswer | undefined> {
  if (!frame || typeof path !== 'string') {
    return Promise.resolve(undefined);
  }
  if (pending.size >= CANVAS_LIMITS.pendingMax) {
    return Promise.resolve(undefined);
  }
  assert(Number.isSafeInteger(nextId), 'Canvas query ID must remain a safe integer');
  assert(path.length <= LIMITS.attrCharsMax, 'Canvas query path exceeds limit');
  assert((context.textParentPath?.length ?? 0) <= LIMITS.attrCharsMax, 'Canvas text parent path exceeds limit');
  for (const values of [selectors, compute, props, context.winning ?? []]) {
    assert(values.length <= LIMITS.scanEntriesMax, 'Canvas query list exceeds limit');
    for (const value of values) {
      assert(value.length <= LIMITS.attrCharsMax, 'Canvas query value exceeds limit');
    }
  }
  const id = nextId++;
  return new Promise<CanvasAnswer | undefined>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(undefined);
    }, TIMEOUT_MS);
    const entry: PendingQuery = {
      resolve,
      timer,
      message: { type: 'avb:query', id, path, selectors, compute, props, ...context },
      held: false,
    };
    pending.set(id, entry);
    if (!send(entry)) {
      clearTimeout(timer);
      pending.delete(id);
      resolve(undefined);
    }
  });
}

export function noteCanvasReady(): void {
  for (const entry of pending.values()) {
    send(entry);
  }
  for (const listener of readyListeners) {
    listener();
  }
}

const readyListeners = new Set<() => void>();

export function onCanvasReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

const renderedListeners = new Set<() => void>();

export function onCanvasRendered(listener: () => void): () => void {
  renderedListeners.add(listener);
  return () => {
    renderedListeners.delete(listener);
  };
}

export function noteCanvasRendered(): void {
  for (const listener of renderedListeners) {
    listener();
  }
}

export function receiveCanvasReply(input: unknown): void {
  const parsed = parseCanvasReply(input);
  if (!parsed.ok) {
    return;
  }
  const data = parsed.value;
  const entry = pending.get(data?.id);
  if (!entry) {
    return;
  }
  if (!data.found && data.ready === false && !entry.held) {
    entry.held = true;
    return;
  }
  clearTimeout(entry.timer);
  pending.delete(data.id);
  entry.resolve(
    data.found
      ? {
          identity: data.identity,
          matched: data.matched || {},
          computed: data.computed || {},
          computedProps: data.computedProps || {},
          authoredProps: data.authoredProps || {},
          inheritedSources: data.inheritedSources || {},
          authoredOrigins: data.authoredOrigins || {},
          winning: data.winning || {},
          scoped: data.scoped || {},
          ...(data.pageImage === undefined ? {} : { pageImage: data.pageImage }),
          ...(data.pageType === undefined ? {} : { pageType: data.pageType }),
          ...(data.pageText === undefined ? {} : { pageText: data.pageText }),
        }
      : undefined,
  );
}
