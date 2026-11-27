import { assert } from '../../shared/core/assert';
import { insertRichBlocks, richCaret, richElement, richHistoryOf } from '../../shared/page/richBlockDom';
import { BLOCKS, escapeHTML, type Block, type BlockShortcut, type InlineShortcut } from './richTextModel';

export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'superscript' | 'subscript';
export const MARKS: readonly Mark[] = ['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript'];

export interface FormatState {
  readonly marks: ReadonlySet<Mark>;
  readonly block: Block;
  readonly list: 'ul' | 'ol' | undefined;
  readonly link: HTMLAnchorElement | undefined;
}

export type RichTextAction =
  | { readonly kind: 'mark'; readonly mark: Mark }
  | { readonly kind: 'block'; readonly block: Block }
  | { readonly kind: 'list'; readonly list: 'ul' | 'ol' }
  | { readonly kind: 'rule' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'link' }
  | { readonly kind: 'history'; readonly step: 'undo' | 'redo' };

export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export function shortcutAction(press: KeyPress): RichTextAction | undefined {
  if (!press.mod) {
    return undefined;
  }
  const key = press.key.toLowerCase();
  if (press.alt) {
    if (press.shift) {
      return undefined;
    }
    const digit = /^Digit([0-6])$/.exec(press.code)?.[1];
    if (digit === undefined) {
      return undefined;
    }
    return { kind: 'block', block: digit === '0' ? 'p' : blockOf(`h${digit}`) };
  }
  if (press.shift) {
    const shifted: Readonly<Record<string, RichTextAction>> = {
      Digit7: { kind: 'list', list: 'ol' },
      Digit8: { kind: 'list', list: 'ul' },
      Digit9: { kind: 'block', block: 'blockquote' },
      KeyX: { kind: 'mark', mark: 'strike' },
    };
    return Object.hasOwn(shifted, press.code) ? shifted[press.code] : undefined;
  }
  if (key === 'k') {
    return { kind: 'link' };
  }
  if (key === 'e') {
    return { kind: 'mark', mark: 'code' };
  }
  if (key === '.') {
    return { kind: 'mark', mark: 'superscript' };
  }
  if (key === ',') {
    return { kind: 'mark', mark: 'subscript' };
  }
  return key === '\\' ? { kind: 'clear' } : undefined;
}

export function performAction(host: HTMLElement, action: Exclude<RichTextAction, { readonly kind: 'link' }>): void {
  switch (action.kind) {
    case 'mark':
      toggleMark(host, action.mark);
      return;
    case 'block':
      setBlock(host, action.block);
      return;
    case 'list':
      toggleList(action.list);
      return;
    case 'rule':
      insertRule(host);
      return;
    case 'clear':
      clearFormatting();
      return;
    case 'history':
      if (!richHistoryOf(host)[action.step]()) {
        document.execCommand(action.step);
      }
      return;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export const EMPTY_FORMAT: FormatState = {
  marks: new Set(),
  block: 'p',
  list: undefined,
  link: undefined,
};

const MARK_COMMANDS: Readonly<Record<Exclude<Mark, 'code'>, string>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikeThrough',
  superscript: 'superscript',
  subscript: 'subscript',
};

const BROWSER_MARKS: readonly Exclude<Mark, 'code'>[] = ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript'];

const BLOCK_SELECTOR = 'p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li';

export function rangeIn(host: HTMLElement): Range | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  return host.contains(range.commonAncestorContainer) ? range : undefined;
}

export function readFormat(host: HTMLElement): FormatState {
  const range = rangeIn(host);
  if (range === undefined) {
    return EMPTY_FORMAT;
  }
  const element = elementOf(range.startContainer);
  const marks = new Set<Mark>();
  for (const mark of BROWSER_MARKS) {
    if (document.queryCommandState(MARK_COMMANDS[mark])) {
      marks.add(mark);
    }
  }
  if (inside(element, host, 'code')) {
    marks.add('code');
  }
  const blockTag = inside(element, host, BLOCKS.filter((tag) => tag !== 'p').join(','));
  const list = inside(element, host, 'ul, ol');
  const link = inside(element, host, 'a');
  return {
    marks,
    block: blockOf(blockTag?.localName),
    list: list?.localName === 'ol' ? 'ol' : list === undefined ? undefined : 'ul',
    link: link instanceof HTMLAnchorElement ? link : undefined,
  };
}

export function toggleMark(host: HTMLElement, mark: Mark): void {
  assert(MARKS.includes(mark), 'A mark the editor knows');
  if (mark === 'code') {
    toggleCode(host);
  } else {
    document.execCommand(MARK_COMMANDS[mark]);
  }
}

export function setBlock(host: HTMLElement, block: Block): void {
  assert(BLOCKS.includes(block), 'A block the editor knows');
  const current = readFormat(host).block;
  const next = current === block ? 'p' : block;
  document.execCommand('formatBlock', false, `<${next}>`);
}

export function toggleList(list: 'ul' | 'ol'): void {
  document.execCommand(list === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
}

export function insertRule(host: HTMLElement): void {
  insertBlock(host, richElement(host.ownerDocument, 'hr'));
}

export function insertBlock(host: HTMLElement, block: Element): void {
  richHistoryOf(host).record(() => insertRichBlocks(host, richCaret(host), [block]));
}

export function clearFormatting(): void {
  document.execCommand('removeFormat');
  document.execCommand('unlink');
}

export function applyLink(host: HTMLElement, href: string): void {
  const range = rangeIn(host);
  assert(range !== undefined, 'A link is applied where the editor has its selection');
  const link = readFormat(host).link;
  if (link !== undefined) {
    selectNode(link);
  }
  if (rangeIn(host)?.collapsed === true) {
    const text = escapeHTML(href);
    document.execCommand('insertHTML', false, `<a href="${text}">${text}</a>`);
  } else {
    document.execCommand('createLink', false, href);
  }
}

export function removeLink(host: HTMLElement): void {
  const link = readFormat(host).link;
  if (link !== undefined) {
    selectNode(link);
  }
  document.execCommand('unlink');
}

export function applyBlockShortcut(host: HTMLElement, shortcut: BlockShortcut): void {
  const range = rangeIn(host);
  assert(range !== undefined, 'A shortcut is typed where the editor has its selection');
  const prefix = lineRange(host, range);
  selectRange(prefix);
  document.execCommand('delete');
  switch (shortcut.kind) {
    case 'block':
      document.execCommand('formatBlock', false, `<${shortcut.block}>`);
      return;
    case 'list':
      toggleList(shortcut.list);
      return;
    case 'rule':
      insertRule(host);
      return;
    default: {
      const exhaustive: never = shortcut;
      return exhaustive;
    }
  }
}

export function applyInlineShortcut(host: HTMLElement, shortcut: InlineShortcut): void {
  const range = rangeIn(host);
  assert(range !== undefined, 'A shortcut is typed where the editor has its selection');
  const node = range.startContainer;
  assert(node instanceof Text, 'An inline shortcut closes in a run of text');
  assert(range.startOffset >= shortcut.length, 'The typed run is all before the caret');
  const typed = document.createRange();
  typed.setStart(node, range.startOffset - shortcut.length);
  typed.setEnd(node, range.startOffset);
  selectRange(typed);
  const html = `<${shortcut.tag}>${escapeHTML(shortcut.text)}</${shortcut.tag}>`;
  document.execCommand('insertHTML', false, html);
  const command = shortcut.tag === 'code' ? undefined : TAG_COMMANDS[shortcut.tag];
  if (command !== undefined && document.queryCommandState(command)) {
    document.execCommand(command);
  }
}

const TAG_COMMANDS: Readonly<Record<'strong' | 'em' | 's', string>> = {
  strong: 'bold',
  em: 'italic',
  s: 'strikeThrough',
};

export function lineBeforeCaret(host: HTMLElement): string | undefined {
  const range = rangeIn(host);
  return range === undefined ? undefined : lineRange(host, range).toString().replaceAll('\u00a0', ' ');
}

export function inParagraph(host: HTMLElement): boolean {
  const range = rangeIn(host);
  if (range === undefined) {
    return false;
  }
  const block = elementOf(range.startContainer)?.closest(BLOCK_SELECTOR);
  if (block === null || block === undefined || !host.contains(block)) {
    return true;
  }
  return block.localName === 'p' || block.localName === 'div';
}

export function inCode(host: HTMLElement): boolean {
  const range = rangeIn(host);
  return range !== undefined && inside(elementOf(range.startContainer), host, 'code, pre') !== undefined;
}

function toggleCode(host: HTMLElement): void {
  const range = rangeIn(host);
  if (range === undefined) {
    return;
  }
  const code = inside(elementOf(range.startContainer), host, 'code');
  if (code !== undefined) {
    selectNode(code);
    document.execCommand('insertHTML', false, escapeHTML(code.textContent ?? ''));
    return;
  }
  if (!range.collapsed) {
    document.execCommand('insertHTML', false, `<code>${escapeHTML(range.toString())}</code>`);
  }
}

function lineRange(host: HTMLElement, range: Range): Range {
  const block = elementOf(range.startContainer)?.closest(BLOCK_SELECTOR);
  const line = document.createRange();
  line.setStart(block !== null && block !== undefined && host.contains(block) ? block : host, 0);
  line.setEnd(range.startContainer, range.startOffset);
  return line;
}

function inside(element: Element | undefined, host: HTMLElement, selector: string) {
  const found = element?.closest(selector);
  return found !== null && found !== undefined && host.contains(found) ? found : undefined;
}

function elementOf(node: Node): Element | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  return element ?? undefined;
}

function blockOf(tag: string | undefined): Block {
  const block = BLOCKS.find((known) => known === tag);
  return block ?? 'p';
}

function selectNode(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  selectRange(range);
}

function selectRange(range: Range): void {
  const selection = window.getSelection();
  assert(selection !== null, 'The editor has a selection to set');
  selection.removeAllRanges();
  selection.addRange(range);
}
