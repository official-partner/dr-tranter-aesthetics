
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';

export type CssToken = { kind: string; text: string };

const COMMENT = /^\/\*[\s\S]*?(?:\*\/|$)/;
const STRING = /^"[^"]*"?|^'[^']*'?/;
const CUSTOM_PROP = /^--[\w-]+/;
const FUNCTION = /^[A-Za-z_][\w-]*(?=\()/;
const HEX = /^#[0-9a-fA-F]{3,8}/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const UNIT = /^(?:[A-Za-z]+|%)/;
const IDENT = /^[A-Za-z_][\w-]*/;
const IMPORTANT = /^!\s*important\b/i;

export function cssTokens(value: string): CssToken[] {
  const out: CssToken[] = [];
  const push = (kind: string, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) {
      last.text += text;
    } else {
      out.push({ kind, text });
    }
  };
  let rest = value;
  while (rest) {
    let match: RegExpMatchArray | undefined;
    let consumedLength = 0;
    if ((match = rest.match(COMMENT) ?? undefined)) {
      push('comment', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(STRING) ?? undefined)) {
      push('string', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(CUSTOM_PROP) ?? undefined)) {
      push('prop', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(FUNCTION) ?? undefined)) {
      push('fn', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(IMPORTANT) ?? undefined)) {
      push('important', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(HEX) ?? undefined)) {
      push('hex', match[0]);
      consumedLength = match[0].length;
    } else if ((match = rest.match(NUMBER) ?? undefined)) {
      push('num', match[0]);
      consumedLength = match[0].length;
      const unit = rest.slice(match[0].length).match(UNIT);
      if (unit) {
        push('unit', unit[0]);
        consumedLength += unit[0].length;
      }
    } else if ((match = rest.match(IDENT) ?? undefined)) {
      push('ident', match[0]);
      consumedLength = match[0].length;
    } else {
      const plain = rest[0] ?? '';
      push('plain', plain);
      consumedLength = plain.length;
    }
    rest = rest.slice(consumedLength);
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightCss(value: string): string {
  return cssTokens(value)
    .map((token) => (token.kind === 'plain' ? plainHtml(token.text) : `<span class="cx-${token.kind}">${escapeHtml(token.text)}</span>`))
    .join('');
}

const WHITESPACE_RUN = /(\s+)/;
const WHITESPACE = /\s/;
function plainHtml(text: string): string {
  if (WHITESPACE.test(text)) {
    return text.split(WHITESPACE_RUN).map(plainPartHtml).join('');
  }
  return escapeHtml(text);
}
function plainPartHtml(part: string): string {
  if (part.trim() === '') {
    return part === '' ? '' : `<span class="cx-space">${part}</span>`;
  }
  return escapeHtml(part);
}


export function stepSize(event: { altKey?: boolean; shiftKey?: boolean }): number {
  if (event.altKey) {
    return 0.1;
  }
  if (event.shiftKey) {
    return 10;
  }
  return 1;
}

const NUMBER_AT = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function precisionOf(text: string, step: number): number {
  const had = text.includes('.') ? (text.split('.')[1] ?? '').length : 0;
  const needed = Number.isInteger(step) ? 0 : (String(step).split('.')[1] ?? '').length;
  return Math.max(had, needed);
}

export function stepNumberAt(
  text: string,
  caret: number,
  delta: number,
  min?: number,
): { text: string; caret: number } | undefined {
  NUMBER_AT.lastIndex = 0;
  let hit: { start: number; end: number; text: string } | undefined;
  for (let match = NUMBER_AT.exec(text); match !== null; match = NUMBER_AT.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (caret >= start && caret <= unitEndAt(text, start, end)) {
      hit = { start, end, text: match[0] };
      break;
    }
    if (start > caret) {
      break;
    }
  }
  if (!hit) {
    return undefined;
  }
  const signed = hit.start > 0 && text[hit.start - 1] === '-' && !/[\d.\w%)]\s*$/.test(text.slice(0, hit.start - 1));
  const start = signed ? hit.start - 1 : hit.start;
  const current = Number((signed ? '-' : '') + hit.text);
  if (!Number.isFinite(current)) {
    return undefined;
  }
  const next = min === undefined ? current + delta : Math.max(min, current + delta);
  const shown = next
    .toFixed(precisionOf(hit.text, delta))
    .replace(/^(-?)0\./, '$1.')
    .replace(/\.$/, '');
  const unitOffset = Math.max(0, caret - hit.end);
  return {
    text: text.slice(0, start) + shown + text.slice(hit.end),
    caret: start + shown.length + unitOffset,
  };
}

function unitEndAt(text: string, start: number, end: number): number {
  assert(start < end, 'unitEndAt: a number has characters');
  if (start > 0 && /[\w#]/.test(text.charAt(start - 1))) {
    return end;
  }
  const unit = /^[a-zA-Z%]*/.exec(text.slice(end))?.[0] ?? '';
  const unitEnd = end + unit.length;
  assert(unitEnd <= text.length, 'unitEndAt: the unit is inside the text');
  return unitEnd;
}


const isChip = (node: Node): boolean => node instanceof HTMLElement && node.dataset['chip'] !== undefined;

export function caretOffset(root: HTMLElement): number | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  return pointOffset(root, range.endContainer, range.endOffset);
}

export function selectionOffsets(root: HTMLElement): { readonly start: number; readonly end: number } | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  const start = pointOffset(root, range.startContainer, range.startOffset);
  const end = pointOffset(root, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return start <= end ? { start, end } : { start: end, end: start };
}

function pointOffset(root: HTMLElement, container: Node, containerOffset: number): number | undefined {
  if (!root.contains(container)) {
    return undefined;
  }
  let offset = 0;
  let found = false;
  const walk = (node: Node, depth: number) => {
    if (depth > LIMITS.treeDepthMax) {
      return;
    }
    if (found) {
      return;
    }
    if (node === container && node.nodeType !== Node.TEXT_NODE) {
      let i = 0;
      for (const child of Array.from(node.childNodes)) {
        if (i++ >= containerOffset) {
          break;
        }
        walk(child, depth + 1);
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === container) {
        offset += containerOffset;
        found = true;
      } else {
        offset += (node.textContent ?? '').length;
      }
      return;
    }
    if (isChip(node)) {
      offset += 1;
      return;
    }
    node.childNodes.forEach((child) => walk(child, depth + 1));
  };
  if (container === root) {
    walk(root, -1);
  } else {
    root.childNodes.forEach((child) => walk(child, 0));
  }
  return found ? offset : undefined;
}

export function setCaretOffset(root: HTMLElement, offset: number): void {
  const ownerDocument = root.ownerDocument;
  const selection = ownerDocument.getSelection();
  if (!selection) {
    return;
  }
  let left = offset;
  const target: { value: { node: Node; at: number } | undefined } = { value: undefined };
  const walk = (node: Node) => {
    if (target.value) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (left <= length) {
        target.value = { node, at: left };
      } else {
        left -= length;
      }
      return;
    }
    if (isChip(node)) {
      const parent = node.parentNode;
      if (left <= 0 && parent !== null) {
        target.value = {
          node: parent,
          at: Array.from(parent.childNodes).findIndex((child) => child === node),
        };
      } else {
        left -= 1;
      }
      return;
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  const range = ownerDocument.createRange();
  if (target.value) {
    range.setStart(target.value.node, target.value.at);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
