
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { domToNodes, isDOMElement, type InlineNode } from './richContentModel';

export interface FormatState {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  readonly code?: boolean;
  readonly span?: boolean;
  readonly link?: boolean;
}

export interface RichTarget {
  readonly host: HTMLElement | undefined;
  readonly savedRange: { current: Range | undefined };
}

export type RichCommand = 'bold' | 'italic' | 'superscript' | 'subscript';
export type RichWrapTag = 'code' | 'span';

export function richTagAround(host: HTMLElement | undefined, tag: string): Element | undefined {
  const selection = window.getSelection();
  if (!host || !selection || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  const at = (container: Node, offset: number) => {
    const node = container.nodeType === 1 ? container.childNodes[offset] || container : container;
    const element = isDOMElement(node) ? node : node.parentElement;
    return element ? element.closest(tag) : undefined;
  };
  const start = at(range.startContainer, range.startOffset);
  const end = at(range.endContainer, range.endOffset - (range.endContainer.nodeType === 1 ? 1 : 0));
  const element = start && start === end ? start : undefined;
  return element && host.contains(element) && element !== host ? element : undefined;
}

export function richReadStates(host: HTMLElement | undefined): FormatState {
  const inTag = (tag: string) => !!richTagAround(host, tag);
  let states: FormatState = {};
  try {
    states = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      superscript: document.queryCommandState('superscript'),
      subscript: document.queryCommandState('subscript'),
    };
  } catch {
    states = {};
  }
  return { ...states, code: inTag('code'), span: inTag('span'), link: inTag('a') };
}

export function richSaveSelection(target: RichTarget): void {
  const { host, savedRange } = target;
  const selection = window.getSelection();
  if (!host || !selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (host.contains(range.commonAncestorContainer)) {
    savedRange.current = range.cloneRange();
  }
}

export function richRestoreSelection(target: RichTarget): void {
  const range = target.savedRange.current;
  if (!range) {
    return;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range.cloneRange());
}

export function richExec(target: RichTarget, command: RichCommand): void {
  target.host?.focus();
  richRestoreSelection(target);
  document.execCommand(command, false);
  richSaveSelection(target);
}

function richUnwrapTag(target: RichTarget, tag: string): boolean {
  const selection = window.getSelection();
  const element = richTagAround(target.host, tag);
  if (!element) {
    return false;
  }
  const parent = element.parentNode;
  assert(parent !== null, 'RichContent: inline wrapper has a parent');
  const first = element.firstChild;
  const last = element.lastChild;
  assert(element.childNodes.length <= LIMITS.treeNodesMax, 'RichContent: unwrap child limit exceeded');
  for (const child of Array.from(element.childNodes)) {
    parent.insertBefore(child, element);
  }
  parent.removeChild(element);
  if (first && last) {
    const wrappedRange = document.createRange();
    wrappedRange.setStartBefore(first);
    wrappedRange.setEndAfter(last);
    selection?.removeAllRanges();
    selection?.addRange(wrappedRange);
  }
  return true;
}

export function richWrapTag(target: RichTarget, tag: RichWrapTag): boolean {
  target.host?.focus();
  richRestoreSelection(target);
  if (richUnwrapTag(target, tag)) {
    richSaveSelection(target);
    return true;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const element = document.createElement(tag);
  try {
    range.surroundContents(element);
  } catch {
    element.appendChild(range.extractContents());
    range.insertNode(element);
  }
  selection.removeAllRanges();
  const contentsRange = document.createRange();
  contentsRange.selectNodeContents(element);
  selection.addRange(contentsRange);
  richSaveSelection(target);
  return true;
}

export function richApplyLink(target: RichTarget, url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  target.host?.focus();
  richRestoreSelection(target);
  document.execCommand('createLink', false, trimmed);
  richSaveSelection(target);
  return true;
}

export function richContentNodes(element: HTMLElement): InlineNode[] {
  const next = domToNodes(element);
  const only = next.length === 1 ? next[0] : undefined;
  if (only?.kind === 'element' && only.name === 'br') {
    return [];
  }
  return next;
}
