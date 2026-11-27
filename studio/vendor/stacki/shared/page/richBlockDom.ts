/// <reference lib="dom" />
import { assert } from '../core/assert';

const RICH_DOM_LIMITS = { depthMax: 64, nodesMax: 20_000, historyMax: 200 } as const;

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'HR',
  'TABLE',
  'FIGURE',
  'FIGCAPTION',
]);
const PHRASING_BLOCKS: ReadonlySet<string> = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);
const TYPING_BLOCKS: ReadonlySet<string> = new Set([...PHRASING_BLOCKS, 'BLOCKQUOTE', 'UL', 'OL']);
const CONTENT_SELECTOR = 'img, video, hr, table, iframe';
const MEDIA_TAGS: ReadonlySet<string> = new Set(['IMG', 'VIDEO', 'HR', 'TABLE', 'IFRAME']);

export function isBlockElement(node: Node): boolean {
  return node instanceof Element && (BLOCK_TAGS.has(node.tagName) || node.tagName === 'IMG' || node.tagName === 'VIDEO');
}

function isBlank(node: Node): boolean {
  if (node instanceof Element) {
    return !MEDIA_TAGS.has(node.tagName) && (node.textContent ?? '').replaceAll('​', '').trim() === '' && node.querySelector(CONTENT_SELECTOR) === null;
  }
  return (node.textContent ?? '').trim() === '';
}

export interface RichHistory {
  readonly record: (change: () => void) => void;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
}

interface Snapshot {
  readonly nodes: readonly ChildNode[];
  readonly html: string;
  readonly caret: readonly [Node, number, Node, number] | undefined;
}

export function createRichHistory(host: HTMLElement): RichHistory {
  const done: { readonly before: Snapshot; readonly after: Snapshot }[] = [];
  const undone: { readonly before: Snapshot; readonly after: Snapshot }[] = [];
  const take = (): Snapshot => {
    const selection = host.ownerDocument.getSelection();
    const anchor = selection?.anchorNode ?? undefined;
    const focus = selection?.focusNode ?? undefined;
    const caret =
      selection !== null && anchor !== undefined && focus !== undefined && host.contains(anchor)
        ? ([anchor, selection.anchorOffset, focus, selection.focusOffset] as const)
        : undefined;
    return { nodes: Array.from(host.childNodes), html: host.innerHTML, caret };
  };
  const restore = (snapshot: Snapshot): void => {
    host.replaceChildren(...snapshot.nodes);
    if (snapshot.caret !== undefined) {
      host.ownerDocument.getSelection()?.setBaseAndExtent(...snapshot.caret);
    }
  };
  return {
    record: (change) => {
      const before = take();
      change();
      done.push({ before, after: take() });
      undone.length = 0;
      if (done.length > RICH_DOM_LIMITS.historyMax) {
        done.shift();
      }
      assert(done.length <= RICH_DOM_LIMITS.historyMax, 'The history of placed blocks is bounded');
    },
    undo: () => {
      const entry = done.at(-1);
      if (entry === undefined || host.innerHTML !== entry.after.html) {
        return false;
      }
      done.pop();
      undone.push(entry);
      restore(entry.before);
      return true;
    },
    redo: () => {
      const entry = undone.at(-1);
      if (entry === undefined || host.innerHTML !== entry.before.html) {
        return false;
      }
      undone.pop();
      done.push(entry);
      restore(entry.after);
      return true;
    },
  };
}

function isMediaChild(host: HTMLElement, node: Node | undefined): node is Element {
  return node instanceof Element && node.parentNode === host && MEDIA_TAGS.has(node.tagName);
}

function selectedMedia(host: HTMLElement, range: Range): Element | undefined {
  assert(host.contains(range.commonAncestorContainer), 'The selection read is in the editor');
  if (range.startContainer !== host || range.endContainer !== host || range.endOffset !== range.startOffset + 1) {
    return undefined;
  }
  const node = host.childNodes[range.startOffset];
  return isMediaChild(host, node) ? node : undefined;
}

export function deleteBesideRichMedia(host: HTMLElement, history: RichHistory, key: 'Backspace' | 'Delete'): boolean {
  const selection = host.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (range === undefined || !host.contains(range.commonAncestorContainer)) {
    return false;
  }
  const back = key === 'Backspace';
  const selected = selectedMedia(host, range);
  if (selected !== undefined) {
    history.record(() => {
      assert(selected.parentNode === host, "A selected block is one of the editor's blocks");
      const next = selected.nextElementSibling ?? undefined;
      const previous = selected.previousElementSibling ?? undefined;
      selected.remove();
      caretBeside(host, previous, next);
    });
    return true;
  }
  if (!range.collapsed) {
    return false;
  }
  const position = topPosition(host, range.startContainer, range.startOffset);
  const block = position.top;
  if (block === undefined || MEDIA_TAGS.has(block.tagName)) {
    return false;
  }
  const rest = host.ownerDocument.createRange();
  rest.selectNodeContents(block);
  if (back) {
    rest.setEnd(range.startContainer, range.startOffset);
  } else {
    rest.setStart(range.startContainer, range.startOffset);
  }
  const neighbour = (back ? block.previousElementSibling : block.nextElementSibling) ?? undefined;
  const atEdge = rest.toString().trim() === '' && rest.cloneContents().querySelector(`${CONTENT_SELECTOR}, li ~ li`) === null;
  if (!atEdge || !isMediaChild(host, neighbour)) {
    return false;
  }
  history.record(() => {
    assert(block.parentNode === host, "The caret's block is one of the editor's blocks");
    if (isBlank(block)) {
      const beyond = (back ? neighbour.previousElementSibling : neighbour.nextElementSibling) ?? undefined;
      block.remove();
      caretBeside(host, back ? beyond : undefined, back ? undefined : beyond);
      if (beyond === undefined || MEDIA_TAGS.has(beyond.tagName)) {
        selectRichMedia(neighbour);
      }
    } else {
      neighbour.remove();
    }
  });
  return true;
}

function caretBeside(host: HTMLElement, previous: Element | undefined, next: Element | undefined): void {
  assert(previous === undefined || previous.parentNode === host, 'The block before stays in the editor');
  assert(next === undefined || next.parentNode === host, 'The block after stays in the editor');
  if (previous !== undefined && TYPING_BLOCKS.has(previous.tagName)) {
    const items = previous.querySelectorAll('li');
    const end = items[items.length - 1] ?? previous;
    collapseAt(end, end.childNodes.length);
  } else if (next !== undefined && TYPING_BLOCKS.has(next.tagName)) {
    collapseAt(next.querySelector('li') ?? next, 0);
  } else {
    collapseAt(host, 0);
  }
}

export function selectRichMedia(media: Element): void {
  assert(media.parentNode !== null, 'A selected block is in the content');
  const document = media.ownerDocument;
  const range = document.createRange();
  range.selectNode(media);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function keepTypingInBlocks(host: HTMLElement, history: RichHistory): void {
  const range = richCaret(host);
  if (range.startContainer !== host || host.children.length === 0) {
    return;
  }
  const media = selectedMedia(host, range);
  if (!range.collapsed && media === undefined) {
    return;
  }
  const index = media === undefined ? range.startOffset : range.startOffset + 1;
  assert(index <= host.childNodes.length, 'The new paragraph has a place among the blocks');
  const paragraph = host.ownerDocument.createElement('p');
  paragraph.setAttribute(SPARE_LINE, '');
  paragraph.append(host.ownerDocument.createElement('br'));
  history.record(() => {
    const next = host.childNodes[index];
    if (next === undefined) {
      host.append(paragraph);
    } else {
      next.before(paragraph);
    }
    collapseAt(paragraph, 0);
  });
}

const histories = new WeakMap<HTMLElement, RichHistory>();

export function richHistoryOf(host: HTMLElement): RichHistory {
  const history = histories.get(host) ?? createRichHistory(host);
  histories.set(host, history);
  return history;
}

export function richElement(document: Document, kind: 'img' | 'video' | 'hr' | 'ul' | 'ol', address = ''): Element {
  const element = document.createElement(kind);
  if (kind === 'img') {
    element.setAttribute('src', address);
    element.setAttribute('alt', '');
  } else if (kind === 'video') {
    element.setAttribute('src', address);
    element.setAttribute('controls', '');
  } else if (kind !== 'hr') {
    const item = document.createElement('li');
    item.append(document.createElement('br'));
    element.append(item);
  }
  return element;
}

export function richCaret(host: HTMLElement): Range {
  const selection = host.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (range !== undefined && host.contains(range.commonAncestorContainer)) {
    return range.cloneRange();
  }
  const end = host.ownerDocument.createRange();
  end.selectNodeContents(host);
  end.collapse(false);
  return end;
}

export function withoutTrailingEmptyBlocks(html: string): string {
  let result = html;
  for (let step = 0; step < RICH_DOM_LIMITS.nodesMax; step++) {
    const next = result.replace(/\s*<(p|h[1-6]|blockquote|pre)(?:\s[^<>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>\s*$/, '');
    if (next === result) {
      break;
    }
    result = next;
  }
  assert(result.length <= html.length, 'Trimming never adds content');
  return result;
}

const SPARE_LINE = 'data-avb-line';

export function isSpareRichLine(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(SPARE_LINE) && isBlank(node);
}

export function insertRichBlocks(host: HTMLElement, range: Range, blocks: readonly Element[]): void {
  assert(blocks.length > 0, 'There is a block to insert');
  assert(host.contains(range.commonAncestorContainer), 'The caret is in the editor');
  const document = host.ownerDocument;
  const start = topPosition(host, range.startContainer, range.startOffset);
  const end = topPosition(host, range.endContainer, range.endOffset);
  let from = start.index;
  let to = end.top === undefined ? end.index : end.index + 1;
  const head = start.top === undefined ? undefined : halfOf(document, [host, start.index], [range.startContainer, range.startOffset], 'head');
  const tail = end.top === undefined ? undefined : halfOf(document, [range.endContainer, range.endOffset], [host, end.index + 1], 'tail');
  const replacesLine = start.top !== undefined && start.top === end.top && isBlank(start.top);
  const kept: Node[] = [];
  const after: Node[] = [];
  if (start.top !== undefined && head === undefined && tail !== undefined && range.collapsed) {
    to = from;
  } else if (end.top !== undefined && tail === undefined && head !== undefined && range.collapsed) {
    from = to;
  } else {
    if (head !== undefined) {
      kept.push(head);
    }
    if (tail !== undefined) {
      after.push(tail);
    }
  }
  const removed = Array.from(host.childNodes).slice(from, to);
  const next = host.childNodes[to];
  removed.forEach((node) => node.remove());
  const added = [...kept, ...blocks, ...after];
  for (const node of added) {
    if (next === undefined) {
      host.append(node);
    } else {
      host.insertBefore(node, next);
    }
  }
  const last = blocks.at(-1);
  assert(last !== undefined, 'There is a last block');
  placeCaretAfter(host, last, { newLine: replacesLine });
}

function topPosition(host: HTMLElement, container: Node, offset: number): { readonly top: Element | undefined; readonly index: number } {
  assert(offset >= 0, 'A position has no negative offset');
  const children = Array.from(host.childNodes);
  if (container === host) {
    return { top: undefined, index: Math.min(offset, children.length) };
  }
  let node: Node = container;
  for (let depth = 0; node.parentNode !== host && node.parentNode !== null && depth < RICH_DOM_LIMITS.depthMax; depth++) {
    node = node.parentNode;
  }
  const index = children.findIndex((child) => child === node);
  assert(index >= 0, 'The position is inside the editor');
  return node instanceof Element ? { top: node, index } : { top: undefined, index: offset > 0 ? index + 1 : index };
}

function halfOf(document: Document, start: readonly [Node, number], end: readonly [Node, number], side: 'head' | 'tail'): Element | undefined {
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const part = range.cloneContents().firstElementChild ?? undefined;
  if (part === undefined || isBlank(part)) {
    return undefined;
  }
  let edge: Element | undefined = part;
  for (let depth = 0; edge !== undefined && depth < RICH_DOM_LIMITS.depthMax; depth++) {
    let child: ChildNode | undefined = (side === 'head' ? edge.lastChild : edge.firstChild) ?? undefined;
    for (
      let step = 0;
      child !== undefined && isBlank(child) && !(child instanceof Element && child.tagName === 'BR') && step < RICH_DOM_LIMITS.nodesMax;
      step++
    ) {
      child.remove();
      child = (side === 'head' ? edge.lastChild : edge.firstChild) ?? undefined;
    }
    edge = child instanceof Element ? child : undefined;
  }
  return part;
}

function placeCaretAfter(host: HTMLElement, block: Element, options: { readonly newLine: boolean }): void {
  assert(block.parentNode === host, "The placed block is one of the editor's blocks");
  const document = host.ownerDocument;
  const items = block.querySelectorAll('li');
  const own = MEDIA_TAGS.has(block.tagName) ? undefined : (items[items.length - 1] ?? block);
  if (own !== undefined) {
    collapseAt(own, own.querySelector('br') !== null && isBlank(own) ? 0 : own.childNodes.length);
    return;
  }
  let following = block.nextElementSibling ?? undefined;
  if (options.newLine || following === undefined || !TYPING_BLOCKS.has(following.tagName)) {
    following = document.createElement('p');
    following.setAttribute(SPARE_LINE, '');
    following.append(document.createElement('br'));
    block.after(following);
  }
  collapseAt(following.querySelector('li') ?? following, 0);
}

function collapseAt(node: Node, offset: number): void {
  const document = node.ownerDocument;
  assert(document !== null, 'A node in the editor has a document');
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function leaveQuoteOnEnter(host: HTMLElement, history: RichHistory): boolean {
  const selection = host.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (range === undefined || !range.collapsed || !host.contains(range.startContainer)) {
    return false;
  }
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const quote = start?.closest('blockquote') ?? undefined;
  if (quote === undefined || quote.parentElement !== host || quote.querySelector('p, ul, ol, div') !== null) {
    return false;
  }
  const rest = host.ownerDocument.createRange();
  rest.setStart(range.startContainer, range.startOffset);
  rest.setEnd(quote, quote.childNodes.length);
  if (rest.toString().trim() !== '') {
    return false;
  }
  const paragraph = host.ownerDocument.createElement('p');
  paragraph.append(host.ownerDocument.createElement('br'));
  history.record(() => {
    quote.after(paragraph);
    assert(paragraph.parentNode === host, 'The paragraph follows the quote among the blocks');
    collapseAt(paragraph, 0);
  });
  return true;
}

const TYPED_EMPTY = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
const NON_BREAKING = /\u00a0|&nbsp;|&#160;|&#xa0;/i;
const RENAMED: readonly (readonly [string, string])[] = [
  ['b', 'strong'],
  ['i', 'em'],
];

export function withoutTypingResidue(root: Element, opened: string): void {
  for (const element of [root, ...Array.from(root.querySelectorAll(TYPED_EMPTY))]) {
    for (let end = element.lastChild; element !== root && end instanceof Element && end.tagName === 'BR'; end = element.lastChild) {
      end.remove();
    }
  }
  for (const [from, to] of RENAMED) {
    if (!new RegExp(`<${from}[\\s>]`, 'i').test(opened)) {
      for (const element of Array.from(root.querySelectorAll(from))) {
        const renamed = root.ownerDocument.createElement(to);
        for (const attribute of Array.from(element.attributes)) {
          renamed.setAttribute(attribute.name, attribute.value);
        }
        renamed.append(...Array.from(element.childNodes));
        element.replaceWith(renamed);
      }
      assert(root.querySelector(from) === null, 'No element of the renamed kind is left');
    }
  }
  if (!NON_BREAKING.test(opened)) {
    const blocks = Array.from(root.querySelectorAll(TYPED_EMPTY));
    (blocks.length === 0 ? [root] : blocks).forEach(plainSpaces);
  }
  if (!/<(p|h[1-6]|li|blockquote|pre)(\s[^<>]*)?>\s*<\/\1>/i.test(opened)) {
    for (const block of Array.from(root.querySelectorAll(TYPED_EMPTY)).reverse()) {
      if (isBlank(block) && block.querySelector('br') === null) {
        const list = block.parentElement;
        block.remove();
        if (list !== null && (list.tagName === 'UL' || list.tagName === 'OL') && list.children.length === 0) {
          list.remove();
        }
      }
    }
  }
}

function plainSpaces(block: Element): void {
  if (block.tagName === 'PRE') {
    return;
  }
  const walker = block.ownerDocument.createTreeWalker(block, 4);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node && texts.length < RICH_DOM_LIMITS.nodesMax; node = walker.nextNode()) {
    if (node instanceof Text) {
      texts.push(node);
    }
  }
  const whole = texts.map((node) => node.data).join('');
  const trimmed = whole.replace(/\u00a0+$/, '').length;
  let at = 0;
  for (const node of texts) {
    const next = Array.from(node.data, (character, index) => {
      const position = at + index;
      if (character !== '\u00a0') {
        return character;
      }
      if (position >= trimmed) {
        return '';
      }
      return /\S/.test(whole.charAt(position - 1)) && /\S/.test(whole.charAt(position + 1)) ? ' ' : character;
    }).join('');
    at += node.data.length;
    if (next !== node.data) {
      node.data = next;
    }
  }
  assert(at === whole.length, "Every one of the block's words was read");
}

export function tidyRichContent(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('[style]'))) {
    element.removeAttribute('style');
    if (element.tagName === 'SPAN' && element.attributes.length === 0) {
      element.replaceWith(...Array.from(element.childNodes));
    }
  }
  const wrappers = Array.from(root.querySelectorAll('*')).filter((element) => PHRASING_BLOCKS.has(element.tagName));
  assert(wrappers.length <= RICH_DOM_LIMITS.nodesMax, 'Rich text holds a bounded number of blocks');
  for (const wrapper of wrappers.reverse()) {
    if (Array.from(wrapper.children).some((child) => BLOCK_TAGS.has(child.tagName))) {
      unnest(wrapper);
    }
  }
}

function unnest(wrapper: Element): void {
  const parts: Node[] = [];
  let run: Element | undefined;
  const close = () => {
    if (run !== undefined && !isBlank(run)) {
      parts.push(run);
    }
    run = undefined;
  };
  for (const child of Array.from(wrapper.childNodes)) {
    if (child instanceof Element && BLOCK_TAGS.has(child.tagName)) {
      close();
      parts.push(child);
    } else {
      const shallow = run ?? wrapper.cloneNode(false);
      assert(shallow instanceof Element, 'A cloned element is an element');
      run = shallow;
      run.append(child);
    }
  }
  close();
  assert(wrapper.parentNode !== null, 'A block being unnested is still in the content');
  wrapper.replaceWith(...parts);
}
