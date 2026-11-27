import { assert } from '../../shared/core/assert';
import { pathsOf } from './frameRegions';
import { ownClasses } from './frameMeasure';
import { pasteRichText } from '../../shared/page/richPaste';
import { holdTextEditing, styleTextEditor } from './frameTextEditing';
import { installRichPointer, openingCaret } from './frameRichCaret';
import {
  createRichHistory,
  deleteBesideRichMedia,
  keepTypingInBlocks,
  selectRichMedia,
  insertRichBlocks,
  isSpareRichLine,
  leaveQuoteOnEnter,
  withoutTypingResidue,
  richCaret,
  richElement,
  tidyRichContent,
  withoutTrailingEmptyBlocks,
  type RichHistory,
} from '../../shared/page/richBlockDom';
import type { RichBlockChoice } from '../../shared/properties/canvasText';

export interface RichTextCallbacks {
  readonly plus: (box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined) => void;
  readonly draft: (html: string, caret: readonly number[]) => void;
  readonly edit: string;
  readonly done: (html: string | undefined, base: string) => void;
  readonly unsaved: (kept: RichTextKept) => void;
  readonly unconfirmed: () => void;
}

export interface RichTextKept {
  readonly original: readonly ChildNode[];
  readonly snapshot: readonly Node[];
  readonly startHTML: string;
  readonly opened: string;
}

const RICH_LIMITS = { childrenMax: 2_000, depthMax: 64 } as const;
const SHOWN_SAVE_MS_MAX = 20_000;
const HOLD_WAIT_MS = 120;

const awaiting = new Map<Element, () => void>();

export function awaitingRichRender(element: Element): boolean {
  return Array.from(awaiting.keys()).some((box) => box.isConnected && (box.contains(element) || element.contains(box)));
}

function showUntilRendered(entry: {
  readonly container: Element;
  readonly edit: string;
  readonly putBack: () => void;
  readonly unsaved: () => void;
  readonly unconfirmed: () => void;
}): void {
  const { container, putBack, unsaved, unconfirmed } = entry;
  const shown = new AbortController();
  const end = () => {
    clearTimeout(timer);
    shown.abort();
    awaiting.delete(container);
  };
  const settle = () => {
    end();
    putBack();
  };
  const keep = () => {
    end();
    unsaved();
  };
  const timer = setTimeout(() => {
    unconfirmed();
    keep();
  }, SHOWN_SAVE_MS_MAX);
  awaiting.set(container, settle);
  document.addEventListener('avb:before-morph', settle, { signal: shown.signal });
  window.addEventListener(
    'message',
    (event) => {
      const data: unknown = event.data;
      const type: unknown = typeof data === 'object' && data !== null && 'type' in data ? data.type : undefined;
      const mine = typeof data === 'object' && data !== null && 'edit' in data && data.edit === entry.edit;
      if (type === 'avb:rich-settled' && mine) {
        settle();
      } else if ((type === 'avb:rich-refused' && mine) || type === 'avb:insert-revert' || type === 'avb:move-revert') {
        keep();
      }
    },
    { signal: shown.signal },
  );
}

export function settleRichRender(element: Element): void {
  for (const [box, settle] of Array.from(awaiting)) {
    if (box.contains(element) || element.contains(box)) {
      settle();
    }
  }
}

function withoutSpacing(html: string): string {
  return html
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^<>]*>) ?/g, '$1');
}

export type RichTextPlace =
  { readonly kind: 'rich'; readonly block: Element; readonly richRoot: string } | { readonly kind: 'line'; readonly container: HTMLElement };

const INLINE_ELEMENTS: ReadonlySet<string> = new Set(['BR', 'STRONG', 'EM', 'B', 'I', 'A', 'SPAN', 'SUP', 'SUB', 'CODE', 'SMALL', 'MARK', 'U', 'S']);

export function holdsInlineWords(element: Element): boolean {
  const all = Array.from(element.querySelectorAll('*'));
  return all.length <= RICH_LIMITS.childrenMax && all.every((child) => INLINE_ELEMENTS.has(child.tagName));
}

export function openRichText(place: RichTextPlace, at: Pick<MouseEvent, 'clientX' | 'clientY' | 'target'>, callbacks: RichTextCallbacks, kept?: RichTextKept) {
  const container = place.kind === 'line' ? place.container : instanceBlock(place.block, place.richRoot)?.parentElement;
  if (!(container instanceof HTMLElement) || container.childNodes.length > RICH_LIMITS.childrenMax) {
    return undefined;
  }
  if (place.kind === 'line' && !holdsInlineWords(container)) {
    return undefined;
  }
  const original = kept?.original ?? Array.from(container.childNodes);
  const snapshot = kept?.snapshot ?? original.map((node) => node.cloneNode(true));
  const read = () => withoutTrailingCaretBreak(place.kind === 'line' ? readWholeHTML(container) : readInstanceHTML(container, original, place.richRoot));
  const opened = kept?.opened ?? read();
  const written = () => (place.kind === 'rich' ? savedRich(read(), opened) : savedLine(read(), opened));
  const startHTML = kept?.startHTML ?? written();
  const history = createRichHistory(container);
  const attribute = container.getAttribute('contenteditable');
  container.setAttribute('contenteditable', 'true');
  container.setAttribute('data-avb-text-editor', '');
  container.setAttribute('data-avb-text-blocks', place.kind);
  styleTextEditor(undefined);
  const release = holdTextEditing(container);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const controller = new AbortController();
  const listen = { capture: true, signal: controller.signal };
  let closed = false;
  let rendered = false;
  document.addEventListener(
    'avb:before-morph',
    () => {
      rendered = true;
    },
    { signal: controller.signal },
  );
  const finish = (action: 'apply' | 'cancel') => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    release();
    callbacks.plus(undefined);
    const html = action === 'apply' ? written() : undefined;
    const saved = html !== undefined && withoutSpacing(html) !== withoutSpacing(startHTML);
    const putBack = () => container.replaceChildren(...snapshot);
    if (saved) {
      showUntilRendered({
        container,
        edit: callbacks.edit,
        putBack,
        unsaved: () => callbacks.unsaved({ original, snapshot, startHTML, opened }),
        unconfirmed: callbacks.unconfirmed,
      });
    } else {
      putBack();
    }
    if (attribute === null) {
      container.removeAttribute('contenteditable');
    } else {
      container.setAttribute('contenteditable', attribute);
    }
    container.removeAttribute('data-avb-text-editor');
    container.removeAttribute('data-avb-text-blocks');
    container.blur();
    callbacks.done(saved ? html : undefined, startHTML);
    if (!saved && rendered && kept !== undefined) {
      window.location.reload();
    }
  };
  let pressed = false;
  window.addEventListener(
    'mousedown',
    (event) => {
      pressed = event.target instanceof Node && container.contains(event.target);
    },
    listen,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.target instanceof Node) || !container.contains(event.target) || event.isComposing) {
        return;
      }
      event.stopImmediatePropagation();
      plainPaste = (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyV';
      if (place.kind === 'rich' && (event.key === 'Backspace' || event.key === 'Delete') && deleteBesideRichMedia(container, history, event.key)) {
        event.preventDefault();
        report();
        return;
      }
      if (undoneBlocks(history, event)) {
        event.preventDefault();
        report();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish('cancel');
      } else if (
        event.key === 'Enter' &&
        place.kind === 'rich' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        leaveQuoteOnEnter(container, history)
      ) {
        event.preventDefault();
        report();
      } else if (event.key === 'Enter' && (place.kind === 'line' || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        document.execCommand('insertLineBreak');
        report();
      }
    },
    listen,
  );
  let plainPaste = false;
  window.addEventListener(
    'paste',
    (event) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const data = event.clipboardData ?? undefined;
      if (data !== undefined) {
        pasteRichText(
          { host: container, history, kind: place.kind, media: place.kind === 'rich' },
          { html: data.getData('text/html'), text: data.getData('text/plain'), plain: plainPaste },
        );
        report();
      }
      plainPaste = false;
    },
    listen,
  );
  window.addEventListener(
    'drop',
    (event) => {
      if (event.target instanceof Node && container.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    listen,
  );
  if (place.kind === 'rich') {
    window.addEventListener(
      'mouseup',
      (event) => {
        const pressed = event.target;
        if (event.button === 0 && pressed instanceof Element && container.contains(pressed) && pressed.matches('img, video, hr')) {
          selectRichMedia(pressed);
        }
      },
      listen,
    );
    container.addEventListener(
      'beforeinput',
      (event) => {
        if (event.inputType === 'insertText') {
          keepTypingInBlocks(container, history);
        }
      },
      { signal: controller.signal },
    );
  }
  let said = '';
  let saying: ReturnType<typeof setTimeout> | undefined;
  const say = () => {
    saying = undefined;
    if (closed) {
      return;
    }
    const html = read();
    const caret = place.kind === 'rich' ? caretPositions(container, original, place.richRoot) : [];
    const next = `${caret.join('.')}\n${html}`;
    if (next !== said) {
      said = next;
      callbacks.draft(html, caret);
    }
  };
  const report = () => {
    callbacks.plus(place.kind === 'rich' ? emptyBlockBox(container) : undefined);
    saying ??= setTimeout(say, 0);
  };
  document.addEventListener('selectionchange', report, { signal: controller.signal });
  container.addEventListener('input', report, { signal: controller.signal });
  let held = false;
  window.addEventListener(
    'blur',
    () => {
      setTimeout(() => {
        if (!held) {
          finish('apply');
        }
      }, HOLD_WAIT_MS);
    },
    { signal: controller.signal },
  );
  const ownsContent = place.kind === 'line' ? () => true : ownedBy(original, place.richRoot);
  installRichPointer(container, ownsContent, controller.signal);
  container.focus({ preventScroll: true });
  if (kept === undefined) {
    openingCaret(container, ownsContent, at);
  }
  report();
  return {
    finish,
    container,
    contains: (event: MouseEvent) => pressed || (event.target instanceof Node && container.contains(event.target)),
    replus: () => {
      said = '';
      report();
    },
    hold: () => {
      held = true;
    },
    step: (step: 'undo' | 'redo') => {
      if (!closed) {
        if (!history[step]()) {
          document.execCommand(step);
        }
        report();
      }
    },
    resume: () => {
      held = false;
      if (!closed) {
        focusKeepingCaret(container);
        report();
      }
    },
    choose: (choice: RichBlockChoice) => {
      held = false;
      if (!closed) {
        applyRichChoice(container, history, choice);
        report();
      }
    },
  };
}

function instanceBlock(element: Element, richRoot: string): Element | undefined {
  const own = new RegExp(`^${richRoot.replaceAll('.', '\\.')}\\.\\d+$`);
  let current: Element | undefined = element;
  for (let depth = 0; current && depth < RICH_LIMITS.depthMax; depth++) {
    if (pathsOf(current).some((path) => own.test(path))) {
      return current;
    }
    current = current.parentElement ?? undefined;
  }
  return undefined;
}

function ownedBy(original: readonly Node[], richRoot: string): (node: Node) => boolean {
  return (node) => !original.includes(node) || (node instanceof Element && pathsOf(node).some((path) => path.startsWith(`${richRoot}.`)));
}

function caretPositions(container: Element, original: readonly Node[], richRoot: string): readonly number[] {
  const anchor = window.getSelection()?.focusNode ?? undefined;
  if (anchor === undefined || !container.contains(anchor)) {
    return [];
  }
  const blocks = Array.from(container.children).filter(ownedBy(original, richRoot));
  const index = blocks.findIndex((block) => block.contains(anchor));
  const block = blocks[index];
  if (block === undefined) {
    return [];
  }
  const item = block.tagName === 'UL' || block.tagName === 'OL' ? Array.from(block.children).findIndex((child) => child.contains(anchor)) : -1;
  return item < 0 ? [index] : [index, item];
}

export function readInstanceHTML(container: Element, original: readonly Node[], richRoot: string): string {
  const own = ownedBy(original, richRoot);
  const parts: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node instanceof Element && own(node) && !isSpareRichLine(node)) {
      parts.push(tidied(cleanElement(node)));
    } else if (node instanceof Text && own(node) && node.data.trim() !== '') {
      parts.push(escapeText(node.data));
    }
  }
  assert(parts.length <= RICH_LIMITS.childrenMax, 'Rich text reads a bounded number of blocks');
  return parts.join('');
}

function savedRich(html: string, opened: string): string {
  return withoutTrailingEmptyBlocks(savedLine(html, opened));
}

function savedLine(html: string, opened: string): string {
  const holder = document.createElement('template');
  holder.innerHTML = html;
  const root = document.createElement('div');
  root.append(holder.content);
  withoutTypingResidue(root, opened);
  return root.innerHTML;
}

function tidied(copy: Element): string {
  const holder = copy.ownerDocument.createElement('div');
  holder.append(copy);
  tidyRichContent(holder);
  return holder.innerHTML;
}

function cleanElement(element: Element): Element {
  const copy = element.cloneNode(true);
  assert(copy instanceof Element, 'A cloned element is an element');
  const marked = [copy, ...Array.from(copy.querySelectorAll('*'))];
  for (const node of marked) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^data-(?:avb|astro)/.test(attribute.name) || attribute.name === 'contenteditable') {
        node.removeAttribute(attribute.name);
      }
    }
    const kept = ownClasses(node).filter((name) => !name.startsWith('astro-'));
    if (node.hasAttribute('class')) {
      if (kept.length === 0) {
        node.removeAttribute('class');
      } else {
        node.setAttribute('class', kept.join(' '));
      }
    }
  }
  const all = [copy, ...Array.from(copy.querySelectorAll('*'))];
  for (const node of all) {
    for (let end = node.lastChild; end instanceof Element && end.tagName === 'BR'; end = node.lastChild) {
      end.remove();
    }
  }
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  for (let node = walker.nextNode(); node && comments.length < RICH_LIMITS.childrenMax; node = walker.nextNode()) {
    comments.push(node);
  }
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));
  return copy;
}

function readWholeHTML(container: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node instanceof Element) {
      parts.push(tidied(cleanElement(node)));
    } else if (node instanceof Text) {
      parts.push(escapeText(node.data));
    }
  }
  assert(parts.length <= RICH_LIMITS.childrenMax, 'A line of words reads a bounded number of nodes');
  return parts.join('');
}

export function withoutTrailingCaretBreak(html: string): string {
  return html.replace(/(?:<br>\s*)+$/, '');
}

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function emptyBlockBox(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) {
    return undefined;
  }
  let node: Node | undefined = selection.getRangeAt(0).startContainer;
  for (let depth = 0; node && depth < RICH_LIMITS.depthMax; depth++) {
    if (node instanceof HTMLElement && (node.parentElement === container || node.tagName === 'LI')) {
      const empty = (node.textContent ?? '').trim() === '' && !node.querySelector('img, hr, video') && !['HR', 'IMG', 'VIDEO'].includes(node.tagName);
      if (!empty) {
        return undefined;
      }
      const box = node.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height };
    }
    node = node.parentNode ?? undefined;
  }
  return undefined;
}

function undoneBlocks(history: RichHistory, event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') {
    return event.shiftKey ? history.redo() : history.undo();
  }
  return key === 'y' && history.redo();
}

export function applyRichChoice(container: HTMLElement, history: RichHistory, choice: RichBlockChoice): void {
  focusKeepingCaret(container);
  const place = (element: Element) => history.record(() => insertRichBlocks(container, richCaret(container), [element]));
  switch (choice.kind) {
    case 'block':
      document.execCommand('formatBlock', false, `<${choice.block}>`);
      return;
    case 'list':
      place(richElement(document, choice.list));
      return;
    case 'rule':
      place(richElement(document, 'hr'));
      return;
    case 'link': {
      const href = attributeText(choice.href);
      document.execCommand('insertHTML', false, `<a href="${href}">${escapeText(choice.href)}</a>`);
      return;
    }
    case 'media':
      place(richElement(document, choice.media === 'image' ? 'img' : 'video', choice.address));
      return;
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

function focusKeepingCaret(container: HTMLElement): void {
  const selection = window.getSelection();
  const kept = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  container.focus({ preventScroll: true });
  if (kept !== undefined && container.contains(kept.startContainer)) {
    selection?.removeAllRanges();
    selection?.addRange(kept);
  }
}

function attributeText(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}
