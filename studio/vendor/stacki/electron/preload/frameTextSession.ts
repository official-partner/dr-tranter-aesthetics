import { assert } from '../../shared/core/assert';
import {
  canvasTextFolded,
  canvasTextWithoutLineEnds,
  parseCanvasTextCatalog,
  type CanvasTextCatalog,
  type CanvasTextTarget,
  parseRichBlockRequest,
  type CanvasRichEditName,
} from '../../shared/properties/canvasText';
import { parseCanvasTextClose, parseCanvasTextFocus } from '../../shared/properties/canvasTextOverlay';
import { canvasTextSourceMatches, pathsOf } from './frameRegions';
import { matchCanvasText, textRunsAround, type TextMatch, type TextRun } from './frameTextMatch';
import { openNativeText, type NativeTextResult } from './frameTextNative';
import { holdsInlineWords, openRichText, type RichTextKept, type RichTextPlace } from './frameRichText';
import { textEditorRoot, textSelection, type TextOffsets } from './frameTextSelection';

interface ActiveText {
  readonly catalog: CanvasTextCatalog;
  readonly editor: NonNullable<ReturnType<typeof openNativeText>>;
}

export const OPEN_SETTLE_MS = 400;

export function createCanvasTextSession(post: (message: unknown) => void) {
  let catalog: CanvasTextCatalog | undefined;
  let active: ActiveText | undefined;
  let typing: { readonly key: string; readonly element: Element } | undefined;
  let focus: ReadonlySet<string> = new Set();
  let openedAtMs = -Infinity;
  let rich: ReturnType<typeof openCanvasRich>;
  const finish = (action: 'apply' | 'cancel') => {
    rich?.finish(action);
    active?.editor.finish(action);
  };
  return {
    catalog: () => catalog,
    focus: () => focus,
    editing: () => (active ? typing?.key : undefined),
    editingElement: () => (active ? typing?.element : undefined),
    contains: (event: MouseEvent) => (rich ? rich.contains(event) : (active?.editor.contains(event) ?? false)),
    dismiss: () => finish('apply'),
    dismissOnMovement: () => {
      assert(OPEN_SETTLE_MS > 0, 'The settle window is positive');
      if (rich) {
        rich.replus();
        return;
      }
      if (performance.now() - openedAtMs >= OPEN_SETTLE_MS) {
        finish('apply');
      }
    },
    reconcile: () => {
      if (active && stale(active)) {
        finish('cancel');
      }
    },
    receive: (input: unknown) => {
      if (isRichMessage(input, 'avb:rich-hold')) {
        rich?.hold();
        return;
      }
      const step = richHistoryStep(input);
      if (step !== undefined) {
        rich?.step(step);
        return;
      }
      if (isRichMessage(input, 'avb:rich-resume')) {
        rich?.resume();
        return;
      }
      const choice = readRichBlockRequest(input);
      if (choice !== undefined) {
        rich?.choose(choice.choice);
        return;
      }
      const request = readCanvasTextRequest(input);
      if (!request) {
        return;
      }
      if (request.kind === 'focus') {
        focus = new Set(request.value.paths);
        return;
      }
      if (request.kind === 'close') {
        if (active?.catalog.session === request.value.session) {
          finish(request.value.action);
        }
        return;
      }
      const richGoesOn = rich !== undefined && catalog?.file === request.value.file;
      if (catalog?.session !== request.value.session && !richGoesOn) {
        finish('cancel');
      }
      const renewed = richGoesOn && catalog?.session !== request.value.session;
      catalog = request.value;
      if (renewed) {
        rich?.announce();
      }
    },
    open: (target: CanvasTextTarget, match: TextMatch, event: MouseEvent) => {
      finish('apply');
      const current = catalog;
      if (!current) {
        return;
      }
      const place = canvasEditingPlace(target, match);
      if (place !== undefined) {
        const name = {
          id: crypto.randomUUID(),
          file: current.file,
          root: place.kind === 'rich' ? place.richRoot : target.path,
          breaks: place.kind,
        };
        let reopen: ((kept: RichTextKept) => void) | undefined;
        const start = (kept?: RichTextKept): boolean => {
          const context = {
            session: () => catalog?.session ?? current.session,
            target,
            place,
            at: event,
            name,
            again: (unsaved: RichTextKept) => {
              if (rich === undefined && !active) {
                reopen?.(unsaved);
              }
            },
            ...(kept === undefined ? {} : { kept }),
          };
          rich = openCanvasRich(context, post, () => {
            rich = undefined;
          });
          return rich !== undefined;
        };
        reopen = start;
        start();
        if (rich) {
          openedAtMs = performance.now();
          return;
        }
      }
      const opened = { target, match };
      const runs = textRunsAround(current, opened);
      const space = { runs: runs.map((run) => run.match.nodes), primary: runs.indexOf(opened) };
      let stopSelection = () => {};
      const editor = openNativeText(
        match,
        space,
        event,
        {
          changed: (value) => post({ type: 'avb:text-draft', session: current.session, key: target.key, value: canvasTextWithoutLineEnds(value) }),
          refused: () =>
            post({ type: 'avb:text-refused', message: 'This selection reaches text that cannot be changed along with it.', reason: 'selection-reaches' }),
          done: (result) => {
            active = undefined;
            stopSelection();
            commitCanvasText({ catalog: current, runs }, result, post);
            post({ type: 'avb:text-inactive', session: current.session });
          },
        },
        target.breaks,
      );
      if (editor) {
        openedAtMs = performance.now();
        active = { catalog: current, editor };
        typing = { key: target.key, element: match.element };
        stopSelection = reportTextSelection({ catalog: current, opened, root: textEditorRoot(match), editor }, post);
        const box = match.element.getBoundingClientRect();
        post({ type: 'avb:text-active', session: current.session, key: target.key, rect: { x: box.left, y: box.top, w: box.width, h: box.height } });
      } else {
        post({ type: 'avb:text-refused', message: 'This text cannot be edited safely.', reason: 'unsafe' });
      }
    },
  };
}

interface CanvasRichContext {
  readonly session: () => string;
  readonly target: CanvasTextTarget;
  readonly place: RichTextPlace;
  readonly at: MouseEvent;
  readonly name: CanvasRichEditName;
  readonly again: (kept: RichTextKept) => void;
  readonly kept?: RichTextKept;
}

function openCanvasRich(context: CanvasRichContext, post: (message: unknown) => void, closed: () => void) {
  const editor = openRichText(
    context.place,
    context.at,
    {
      edit: context.name.id,
      plus: (rect) => post({ type: 'avb:rich-plus', session: context.session(), ...(rect ? { rect } : {}) }),
      draft: (html, caret) => post({ type: 'avb:rich-draft', session: context.session(), key: context.target.key, html, caret, edit: context.name }),
      done: (html, base) => {
        closed();
        if (html !== undefined) {
          post({ type: 'avb:rich-save', session: context.session(), key: context.target.key, html, base, edit: context.name });
        }
        post({ type: 'avb:text-inactive', session: context.session() });
      },
      unsaved: context.again,
      unconfirmed: () =>
        post({ type: 'avb:text-refused', message: 'The page changed while editing. The text was not saved; select it again.', reason: 'page-changed' }),
    },
    context.kept,
  );
  if (!editor) {
    return undefined;
  }
  const announce = () => {
    const box = editor.container.getBoundingClientRect();
    const rect = { x: box.left, y: box.top, w: box.width, h: box.height };
    post({ type: 'avb:text-active', session: context.session(), key: context.target.key, rect, blocks: true });
    editor.replus();
  };
  announce();
  return { ...editor, announce };
}

function isRichMessage(input: unknown, type: 'avb:rich-hold' | 'avb:rich-resume'): boolean {
  return typeof input === 'object' && input !== null && 'type' in input && input.type === type;
}

function richHistoryStep(input: unknown): 'undo' | 'redo' | undefined {
  if (typeof input !== 'object' || input === null || !('type' in input) || input.type !== 'avb:rich-history' || !('step' in input)) {
    return undefined;
  }
  return input.step === 'undo' || input.step === 'redo' ? input.step : undefined;
}

function readRichBlockRequest(input: unknown) {
  try {
    return parseRichBlockRequest(input);
  } catch {
    return undefined;
  }
}

const INLINE_TAGS_SET: ReadonlySet<string> = new Set(['STRONG', 'EM', 'B', 'I', 'A', 'SPAN', 'SUP', 'SUB', 'CODE', 'SMALL', 'MARK', 'U', 'S']);

function canvasEditingPlace(target: CanvasTextTarget, match: TextMatch): RichTextPlace | undefined {
  if (target.breaks === 'rich' && target.richRoot !== undefined) {
    return { kind: 'rich', block: match.element, richRoot: target.richRoot };
  }
  let container = target.breaks === 'line' ? textEditorRoot(match) : undefined;
  for (let depth = 0; container?.parentElement && INLINE_TAGS_SET.has(container.tagName) && depth < 16; depth++) {
    container = container.parentElement;
  }
  return container !== undefined && holdsInlineWords(container) ? { kind: 'line', container } : undefined;
}

function stale(active: ActiveText): boolean {
  if (!active.editor.intact()) {
    return true;
  }
  return !canvasTextSourceMatches(active.catalog.file, active.catalog.checksum);
}

function reportTextSelection(
  context: {
    readonly catalog: CanvasTextCatalog;
    readonly opened: TextRun;
    readonly root: HTMLElement | undefined;
    readonly editor: { readonly spread: () => boolean; readonly edited: () => boolean };
  },
  post: (message: unknown) => void,
): () => void {
  const session = context.catalog.session;
  let last = '';
  let lastKey = context.opened.target.key;
  const report = () => {
    const selection = window.getSelection();
    const held = selectedText(context);
    let range = undefined;
    if (held && selection?.rangeCount) {
      const text = held.nodes.map((node) => node.data).join('');
      const start = canvasTextFolded(text, held.offsets.start);
      const end = canvasTextFolded(text, held.offsets.end);
      if (start < end) {
        const box = selection.getRangeAt(0).getBoundingClientRect();
        range = { start, end, rect: { x: box.left, y: box.top, w: box.width, h: box.height } };
      }
    }
    const key = held && range ? held.key : lastKey;
    const next = range ? JSON.stringify({ key, range }) : 'none';
    if (next !== last) {
      last = next;
      lastKey = key;
      post({ type: 'avb:text-selection', session, key, ...(range ? { range } : {}) });
    }
  };
  document.addEventListener('selectionchange', report);
  return () => {
    document.removeEventListener('selectionchange', report);
    if (last !== '' && last !== 'none') {
      post({ type: 'avb:text-selection', session, key: lastKey });
    }
  };
}

interface SelectedText {
  readonly key: string;
  readonly nodes: readonly Text[];
  readonly offsets: TextOffsets;
}

function selectedText(context: Parameters<typeof reportTextSelection>[0]): SelectedText | undefined {
  const { opened, editor } = context;
  const own = textSelection(opened.match.nodes);
  if (own) {
    return editor.spread() ? undefined : { key: opened.target.key, nodes: opened.match.nodes, offsets: own };
  }
  if (editor.edited()) {
    return undefined;
  }
  const selection = window.getSelection();
  const container = selection?.rangeCount ? selection.getRangeAt(0).startContainer : undefined;
  if (!(container instanceof Text) || !container.parentElement || !context.root?.contains(container)) {
    return undefined;
  }
  const target = innerTextTarget(context.catalog, container);
  if (!target) {
    return undefined;
  }
  assert(target.match.nodes.includes(container), 'The found text holds the selection start');
  const offsets = textSelection(target.match.nodes);
  return offsets ? { key: target.target.key, nodes: target.match.nodes, offsets } : undefined;
}

function innerTextTarget(catalog: CanvasTextCatalog, node: Text): TextRun | undefined {
  const element = node.parentElement;
  assert(element !== null, 'A selected text sits in an element');
  const ancestors = new Set<string>();
  let current: Element | undefined = element;
  for (let depth = 0; current && depth < 32; depth++) {
    pathsOf(current).forEach((path) => ancestors.add(path));
    current = current.parentElement ?? undefined;
  }
  for (const target of catalog.targets) {
    if (target.literal !== true || !ancestors.has(target.parent)) {
      continue;
    }
    if (target.scope !== undefined && !ancestors.has(target.scope)) {
      continue;
    }
    const match = matchCanvasText(target, element);
    if (match?.nodes.includes(node)) {
      return { target, match };
    }
  }
  return undefined;
}

function commitCanvasText(
  entry: {
    readonly catalog: CanvasTextCatalog;
    readonly runs: readonly TextRun[];
  },
  result: NativeTextResult,
  post: (message: unknown) => void,
) {
  const edits = result.changes.flatMap(({ run, value: typed }) => {
    const entryRun = entry.runs[run];
    assert(entryRun !== undefined, 'A changed run is one of the editor runs');
    const value = canvasTextWithoutLineEnds(typed);
    return value === entryRun.target.value ? [] : [{ run: entryRun, value }];
  });
  const [first, ...also] = edits;
  if (!first) {
    return;
  }
  const unchanged = edits.every(({ run }) => matchCanvasText(run.target, run.match.element));
  if (!result.restored || !unchanged || !canvasTextSourceMatches(entry.catalog.file, entry.catalog.checksum)) {
    post({
      type: 'avb:text-refused',
      message: 'The page changed while editing. The text was not saved; select it again.',
      reason: 'page-changed',
    });
    return;
  }
  post({
    type: 'avb:text-save',
    session: entry.catalog.session,
    key: first.run.target.key,
    value: first.value,
    ...(also.length ? { also: also.map(({ run, value }) => ({ key: run.target.key, value })) } : {}),
  });
  if (!edits.some(({ run, value }) => run.target.breaks !== undefined && value.includes('\n'))) {
    result.keep();
  }
}

function readCanvasTextRequest(input: unknown) {
  try {
    const focus = parseCanvasTextFocus(input);
    if (focus) {
      return { kind: 'focus', value: focus } as const;
    }
    const close = parseCanvasTextClose(input);
    if (close) {
      return { kind: 'close', value: close } as const;
    }
    return { kind: 'catalog', value: parseCanvasTextCatalog(input) } as const;
  } catch {
    return undefined;
  }
}
