import { assert } from '../../../shared/core/assert';
import { isHTMLElementInDocument } from './model/dom';


export const VARIABLE_REFERENCE_PATTERN = /var\(\s*--[A-Za-z0-9_-]+[^)]*\)/gi;

export const CLIPBOARD_LIMITS = {
  pastedCharactersMax: 65_536,
  referencesMax: 256,
  nestingDepthMax: 64,
} as const satisfies Record<string, number>;

const CARET_SLOT_PATTERN = /​/g;
const NO_BREAK_SPACE_PATTERN = / /g;

export type PastedSegment = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'reference'; readonly text: string };

export function pastedSegments(text: string): readonly PastedSegment[] {
  assert(text.length <= CLIPBOARD_LIMITS.pastedCharactersMax, 'pastedSegments: the text is bounded');
  const segments: PastedSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(VARIABLE_REFERENCE_PATTERN)) {
    if (segments.length >= CLIPBOARD_LIMITS.referencesMax * 2) {
      break;
    }
    const start = match.index;
    if (start > at) {
      segments.push({ kind: 'text', text: text.slice(at, start) });
    }
    segments.push({ kind: 'reference', text: match[0] });
    at = start + match[0].length;
  }
  if (at < text.length) {
    segments.push({ kind: 'text', text: text.slice(at) });
  }
  assert(segments.map((segment) => segment.text).join('') === text, 'pastedSegments: the segments are the text, in order');
  return segments;
}

export type PastedLineBreaks = 'keep' | 'join';

export function pastedText(raw: string, lineBreaks: PastedLineBreaks): string {
  const unixText = raw.replace(/\r\n?/g, '\n');
  const text = lineBreaks === 'keep' ? unixText : unixText.replace(/[ \t]*\n[ \t]*/g, ' ');
  assert(!text.includes('\r'), 'pastedText: no carriage return is left');
  if (text.length <= CLIPBOARD_LIMITS.pastedCharactersMax) {
    return text;
  }
  return text.slice(0, CLIPBOARD_LIMITS.pastedCharactersMax);
}

export function chipSource(binding: string, bare: string): string {
  if (/^var\(/i.test(binding)) {
    return binding;
  }
  return bare;
}

export function selectionRangeIn(root: HTMLElement): Range | undefined {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.commonAncestorContainer)) {
    return undefined;
  }
  const startChip = chipAround(root, range.startContainer);
  if (startChip !== undefined) {
    range.setStartBefore(startChip);
  }
  const endChip = chipAround(root, range.endContainer);
  if (endChip !== undefined) {
    range.setEndAfter(endChip);
  }
  assert(root.contains(range.commonAncestorContainer), 'selectionRangeIn: the widened range stays in the field');
  return range;
}

export function selectedSource(root: HTMLElement, bare: string): string | undefined {
  const range = selectionRangeIn(root);
  if (range === undefined || range.collapsed) {
    return undefined;
  }
  return fragmentSource(range.cloneContents(), root.ownerDocument, bare);
}

export function fragmentSource(node: Node, ownerDocument: Document, bare: string): string {
  let out = '';
  const walk = (parent: Node, depth: number): void => {
    if (depth > CLIPBOARD_LIMITS.nestingDepthMax) {
      return;
    }
    parent.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.textContent ?? '';
      } else if (isHTMLElementInDocument(child, ownerDocument) && child.dataset['chip'] !== undefined) {
        out += chipSource(child.dataset['binding'] ?? '', bare);
      } else if (isHTMLElementInDocument(child, ownerDocument) && child.tagName === 'BR') {
      } else {
        walk(child, depth + 1);
      }
    });
  };
  walk(node, 0);
  const source = out.replace(CARET_SLOT_PATTERN, '').replace(NO_BREAK_SPACE_PATTERN, ' ');
  assert(!source.includes('​'), 'fragmentSource: a copied value holds no caret slot');
  return source;
}

function chipAround(root: HTMLElement, node: Node): HTMLElement | undefined {
  const element = isHTMLElementInDocument(node, root.ownerDocument) ? node : node.parentElement;
  const chip = element?.closest<HTMLElement>('[data-chip]') ?? undefined;
  if (chip === undefined || !root.contains(chip)) {
    return undefined;
  }
  return chip;
}
