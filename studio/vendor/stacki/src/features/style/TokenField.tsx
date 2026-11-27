
import { useEffect, useLayoutEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { centralIcon } from '../../ui/central/CentralIcon';
import { droplet as centralDroplet, font as centralFont, number as centralNumber, ruler as centralRuler } from '../../ui/central/centralGeometry';
import type { MutableRefObject, RefObject } from 'react';
import { caretOffset, highlightCss, setCaretOffset, stepNumberAt, stepSize } from './model/cssCode';
import { isHTMLElementInDocument } from './model/dom';
import { commitTokenFieldInPlace } from './model/commitStyleInPlace';
import { assert } from '../../../shared/core/assert';
import { caretPlacementAt, placeCaret } from './tokenFieldCaret';
import { EMPTY_FIELD_HISTORY, type FieldHistory, type FieldSnapshot, recordEdit, redoStep, undoStep } from './tokenFieldHistory';
import { chipSource, type PastedLineBreaks, pastedSegments, pastedText, selectedSource, selectionRangeIn } from './tokenFieldClipboard';


const TOKEN_GLYPH_ICONS = {
  Color: centralIcon(centralDroplet),
  FontFamily: centralIcon(centralFont),
  Number: centralIcon(centralNumber),
  Size: centralIcon(centralRuler),
} as const;
const tokenGlyphCache = new Map<string, string>();

export function tokenGlyph(type: string): string {
  const cached = tokenGlyphCache.get(type);
  if (cached !== undefined) {
    return cached;
  }
  const Icon = type === 'Color' || type === 'FontFamily' || type === 'Number' ? TOKEN_GLYPH_ICONS[type] : TOKEN_GLYPH_ICONS.Size;
  const markup = renderToStaticMarkup(<Icon size={12} />);
  tokenGlyphCache.set(type, markup);
  return markup;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type Chip = { text: string; name: string; type: string; value?: string };

export const chipKey = (chips: Chip[]): string => chips.map((chip) => `${chip.text}|${chip.name}|${chip.type}|${chip.value ?? ''}`).join(',');

export function tokenChipHtml(chip: Chip): string {
  return (
    '<span class="embed-editor_varconnect-token" contenteditable="false" data-chip="1" ' +
    `data-binding="${escapeHtml(chip.text)}"${chipTitle(chip)}>` +
    `<span class="embed-editor_varconnect-token-icon">${tokenGlyph(chip.type)}</span>` +
    `<span class="embed-editor_varconnect-token-name">${escapeHtml(chip.name)}</span>` +
    '</span>'
  );
}

function chipTitle(chip: Chip): string {
  if (chip.value === undefined || chip.value === '') {
    return '';
  }
  const quoted = (text: string): string => escapeHtml(text).replace(/"/g, '&quot;');
  return ` data-value="${quoted(chip.value)}" title="${quoted(`${chip.name}: ${chip.value}`)}"`;
}

export function buildTokenHtml(value: string, chips: Chip[], code = false): string {
  const write = code ? highlightCss : escapeHtml;
  if (!chips.length) {
    return write(value);
  }
  let out = '';
  let at = 0;
  chips.forEach((chip, index) => {
    const found = value.indexOf(chip.text, at);
    if (found < 0) {
      return;
    }
    let before = runHtml(value.slice(at, found), write);
    if (before === '' && index === 0) {
      before = '\u200B';
    }
    out += before + tokenChipHtml(chip);
    at = found + chip.text.length;
  });
  let after = runHtml(value.slice(at), write);
  if (after === '') {
    after = '\u200B';
  }
  return out + after;
}

function runHtml(text: string, write: (text: string) => string): string {
  if (text !== '' && text.trim() === '') {
    return spaceRun(escapeHtml(text));
  }
  return spaceRun(write(text));
}

export function spaceRun(html: string): string {
  if (html === '' || html.trim() !== '') {
    return html;
  }
  return `<span class="embed-editor_varconnect-space">${html}</span>`;
}

export const CHIP_MARK = '\u0000';

export const TOKEN_FIELD_LIMITS = { nestingDepthMax: 64, chipsMax: 256 } as const;

export function fieldText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node, depth: number) => {
    if (depth > TOKEN_FIELD_LIMITS.nestingDepthMax) {
      return;
    }
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.textContent ?? '';
      } else if (isHTMLElementInDocument(child, root.ownerDocument) && child.dataset['chip'] !== undefined) {
        out += CHIP_MARK;
      } else if (isHTMLElementInDocument(child, root.ownerDocument) && child.tagName === 'BR') {
      } else {
        walk(child, depth + 1);
      }
    });
  };
  walk(root, 0);
  return out;
}

export function chipsOf(root: HTMLElement): Chip[] {
  return [...root.querySelectorAll<HTMLElement>('[data-chip]')].map((element) => {
    const value = element.dataset['value'];
    return {
      text: element.dataset['binding'] ?? '',
      name: element.querySelector('.embed-editor_varconnect-token-name')?.textContent ?? '',
      type: element.dataset['type'] ?? 'Size',
      ...(value === undefined ? {} : { value }),
    };
  });
}

export function paint(rootElement: HTMLElement, text: string, at: number | undefined, chips: Chip[]): void {
  const parts = text.split(CHIP_MARK);
  let html = highlightCss(parts[0] ?? '');
  for (let i = 1; i < parts.length; i++) {
    const chip = chips[i - 1];
    html += (chip ? tokenChipHtml(chip) : '') + highlightCss(parts[i] ?? '');
  }
  if (html === rootElement.innerHTML) {
    return;
  }
  rootElement.innerHTML = html;
  if (at !== undefined) {
    setCaretOffset(rootElement, at);
  }
}

export function serializeTokens(root: HTMLElement, bare: string, varForm: string): string {
  let out = '';
  let hasText = false;
  const chips: string[] = [];
  const walk = (node: Node, depth: number) => {
    if (depth > TOKEN_FIELD_LIMITS.nestingDepthMax) {
      return;
    }
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child.textContent ?? '';
        out += text;
        if (text.replace(/\u200B/g, '').trim() !== '') {
          hasText = true;
        }
      } else if (isHTMLElementInDocument(child, root.ownerDocument) && child.dataset['chip'] !== undefined) {
        chips.push(child.dataset['binding'] ?? '');
        out += '\u0000';
      } else if (isHTMLElementInDocument(child, root.ownerDocument) && child.tagName === 'BR') {
      } else {
        walk(child, depth + 1);
      }
    });
  };
  walk(root, 0);
  let at = 0;
  const value = out
    .replace(/\u0000/g, () => {
      const binding = chips[at++];
      if (chips.length === 1 && !hasText) {
        return chipSource(binding ?? '', bare);
      }
      return binding || varForm;
    })
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ');
  assert(!value.includes('\u00A0'), 'serializeTokens: a saved value holds no non-breaking space');
  return value;
}

export function jumpCaretPastChip(root: HTMLElement, direction: 'left' | 'right'): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }
  const chips = [...root.querySelectorAll<HTMLElement>('[data-chip]')];
  assert(chips.length <= TOKEN_FIELD_LIMITS.chipsMax, 'jumpCaretPastChip: the field holds a bounded number of chips');
  const { startContainer: node, startOffset: off } = selection.getRangeAt(0);
  const place = (target: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(target, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  for (const chip of chips) {
    if (direction === 'right' && caretBesideChip(chip, node, off, 'before')) {
      place(slotBeside(chip, 'after'), 0);
      return true;
    }
    if (direction === 'left' && caretBesideChip(chip, node, off, 'after')) {
      const slot = slotBeside(chip, 'before');
      place(slot, slot.length);
      return true;
    }
  }
  return false;
}

export function fieldHoldsOnlyChips(root: HTMLElement): boolean {
  const text = fieldText(root)
    .replace(/\u200B/g, '')
    .replace(/\s/g, '');
  return text !== '' && text.replace(new RegExp(CHIP_MARK, 'g'), '') === '';
}

export function settleCaretAfterChips(root: HTMLElement): boolean {
  if (!fieldHoldsOnlyChips(root)) {
    return false;
  }
  const chips = [...root.querySelectorAll<HTMLElement>('[data-chip]')];
  assert(chips.length <= TOKEN_FIELD_LIMITS.chipsMax, 'settleCaretAfterChips: the field holds a bounded number of chips');
  const last = chips[chips.length - 1];
  assert(last !== undefined, 'settleCaretAfterChips: a chip-only field has a chip');
  const slot = slotBeside(last, 'after');
  placeCaret(root, { kind: 'text', node: slot, offset: 0 });
  return true;
}

export function chipBesideCaret(root: HTMLElement, key: 'Backspace' | 'Delete'): HTMLElement | undefined {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return undefined;
  }
  const { startContainer: node, startOffset: offset } = selection.getRangeAt(0);
  if (!root.contains(node)) {
    return undefined;
  }
  const chips = [...root.querySelectorAll<HTMLElement>('[data-chip]')];
  assert(chips.length <= TOKEN_FIELD_LIMITS.chipsMax, 'chipBesideCaret: the field holds a bounded number of chips');
  const side = key === 'Backspace' ? 'after' : 'before';
  return chips.find((chip) => caretBesideChip(chip, node, offset, side));
}

export function removeChip(root: HTMLElement, chip: HTMLElement): void {
  assert(root.contains(chip), 'removeChip: the chip is in the field');
  const before = root.querySelectorAll('[data-chip]').length;
  const slot = slotBeside(chip, 'before');
  chip.remove();
  placeCaret(root, { kind: 'text', node: slot, offset: slot.length });
  assert(root.querySelectorAll('[data-chip]').length === before - 1, 'removeChip: exactly one chip went');
}

function slotBeside(chip: HTMLElement, side: 'before' | 'after'): Text {
  const ownerDocument = chip.ownerDocument;
  const sibling = (side === 'before' ? chip.previousSibling : chip.nextSibling) ?? undefined;
  const weldedChip = sibling !== undefined && isHTMLElementInDocument(sibling, ownerDocument) && sibling.dataset['chip'] !== undefined;
  const edge = sibling === undefined || weldedChip ? undefined : edgeTextNode(sibling, side === 'before' ? 'end' : 'start');
  const TextConstructor = ownerDocument.defaultView?.Text;
  assert(TextConstructor !== undefined, 'slotBeside: the field belongs to a window');
  if (edge instanceof TextConstructor) {
    return edge;
  }
  const parent = chip.parentNode;
  assert(parent !== null, 'slotBeside: the chip is in the field');
  const slot = ownerDocument.createTextNode('\u200B');
  parent.insertBefore(slot, side === 'before' ? chip : chip.nextSibling);
  return slot;
}

const isZeroWidth = (text: string): boolean => text.replace(/\u200B/g, '') === '';

function caretBesideChip(chip: HTMLElement, node: Node, offset: number, side: 'before' | 'after'): boolean {
  const own = side === 'before' ? edgeTextNode(chip.previousSibling ?? undefined, 'end') : edgeTextNode(chip.nextSibling ?? undefined, 'start');
  if (own !== undefined && node === own) {
    const text = own.textContent ?? '';
    return isZeroWidth(side === 'before' ? text.slice(offset) : text.slice(0, offset));
  }
  if (node === chip.parentNode) {
    const children = [...node.childNodes];
    const chipIndex = children.indexOf(chip);
    assert(chipIndex >= 0, 'caretBesideChip: the chip is among its parent’s children');
    const between = side === 'before' ? children.slice(offset, chipIndex) : children.slice(chipIndex + 1, offset);
    return offset <= children.length && between.every((child) => child.nodeType === 3 && isZeroWidth(child.textContent ?? ''));
  }
  return false;
}

function edgeTextNode(node: ChildNode | undefined, end: 'start' | 'end'): ChildNode | undefined {
  let current = node;
  for (let depth = 0; current !== undefined && depth < TOKEN_FIELD_LIMITS.nestingDepthMax; depth += 1) {
    const inner = end === 'start' ? current.firstChild : current.lastChild;
    if (inner === null) {
      return current;
    }
    current = inner;
  }
  return current;
}

export const BRACKET_KEYS = new Set(['(', ')', 'Backspace']);

export function TokenField({
  value,
  chips,
  chipBare,
  chipVar,
  className,
  ariaLabel,
  placeholder,
  disabled,
  code,
  stepMin,
  editorRef,
  onFocusField,
  onCommit,
  onDraft,
  onChipClick,
  chipOf,
  lineBreaks,
}: TokenFieldProps) {
  const historyRef = useRef<FieldHistory>(EMPTY_FIELD_HISTORY);
  const synced = useTokenFieldSync({ value, chips, code, editorRef, historyRef });
  const report = (element: HTMLElement) => {
    const next = serializeTokens(element, chipBare, chipVar);
    synced.current = next;
    onDraft?.(next);
  };
  const record = (element: HTMLElement, kind: string) => {
    historyRef.current = recordEdit(historyRef.current, captureField(element), { kind, atMs: Date.now(), grouped: GROUPED_EDITS.has(kind) });
  };
  const travel = (element: HTMLElement, direction: 'undo' | 'redo'): void => {
    const step = (direction === 'undo' ? undoStep : redoStep)(historyRef.current, captureField(element));
    if (step === undefined) {
      return;
    }
    historyRef.current = step.history;
    restoreField(element, step.show, { code: !!code });
    report(element);
  };
  useFieldHistoryInput(editorRef, { record, travel });
  const clipboard = (element: HTMLElement, edit: ClipboardEdit): void => {
    record(element, edit.kind);
    if (edit.kind === 'cut') {
      deleteSelection(element);
    } else {
      insertSource(element, edit.text, chipOf);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: CLIPBOARD_INPUT_TYPES[edit.kind] }));
  };
  return (
    <div
      ref={editorRef}
      className={className}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="false"
      aria-label={ariaLabel}
      data-placeholder={placeholder || undefined}
      spellCheck={false}
      onFocus={(event) => {
        settleCaretAfterChips(event.currentTarget);
        onFocusField();
      }}
      onBlur={() => {
        const element = editorRef.current;
        onCommit(element ? serializeTokens(element, chipBare, chipVar) : '');
      }}
      onInput={(event) => {
        const element = event.currentTarget;
        report(element);
        if (!code) {
          return;
        }
        paint(element, fieldText(element), caretOffset(element), chipsOf(element));
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
          const chip = pressedChip(event.currentTarget, event.target);
          if (chip !== undefined) {
            event.preventDefault();
            onChipClick(chip);
            return;
          }
        }
        const direction = historyKey(event);
        if (direction !== undefined) {
          event.preventDefault();
          historyKeyAtMs = Date.now();
          travel(event.currentTarget, direction);
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !disabled) {
          const element = event.currentTarget;
          const beside = chipBesideCaret(element, event.key);
          if (beside !== undefined) {
            event.preventDefault();
            record(element, `key:${event.key}`);
            removeChip(element, beside);
            if (code) {
              paint(element, fieldText(element), caretOffset(element), chipsOf(element));
            }
            report(element);
            return;
          }
        }
        tokenFieldKeyDown(event, { code: !!code, stepMin, report, record });
      }}
      onCopy={(event) => {
        const source = selectedSource(event.currentTarget, chipBare);
        if (source === undefined) {
          return;
        }
        event.preventDefault();
        event.clipboardData.setData('text/plain', source);
      }}
      onCut={(event) => {
        const source = selectedSource(event.currentTarget, chipBare);
        if (source === undefined) {
          return;
        }
        event.preventDefault();
        event.clipboardData.setData('text/plain', source);
        if (disabled) {
          return;
        }
        clipboard(event.currentTarget, { kind: 'cut' });
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = pastedText(event.clipboardData.getData('text/plain'), lineBreaks);
        if (disabled || text === '') {
          return;
        }
        clipboard(event.currentTarget, { kind: 'paste', text });
      }}
      onDragStart={(event) => {
        const source = selectedSource(event.currentTarget, chipBare);
        if (source === undefined) {
          return;
        }
        event.dataTransfer.clearData();
        event.dataTransfer.setData('text/plain', source);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const text = pastedText(event.dataTransfer.getData('text/plain'), lineBreaks);
        if (disabled || text === '') {
          return;
        }
        const element = event.currentTarget;
        placeCaretAtPoint(element, { x: event.clientX, y: event.clientY });
        element.focus();
        clipboard(element, { kind: 'drop', text });
      }}
      onMouseDown={(event) => {
        const chip = pressedChip(event.currentTarget, event.target);
        if (chip !== undefined) {
          event.preventDefault();
          settleCaretAfterChips(event.currentTarget);
          onChipClick(chip);
          return;
        }
        if (disabled) {
          return;
        }
        tokenFieldPress(event.currentTarget, event);
      }}
    />
  );
}

type ClipboardEdit = { readonly kind: 'cut' } | { readonly kind: 'paste' | 'drop'; readonly text: string };

const CLIPBOARD_INPUT_TYPES = { cut: 'deleteByCut', paste: 'insertFromPaste', drop: 'insertFromDrop' } as const satisfies Record<ClipboardEdit['kind'], string>;

export function insertSource(root: HTMLElement, text: string, chipOf: (reference: string) => Chip): void {
  const range = selectionRangeIn(root) ?? endRange(root);
  const before = root.querySelectorAll('[data-chip]').length;
  const segments = pastedSegments(text);
  const references = segments.filter((segment) => segment.kind === 'reference').length;
  range.deleteContents();
  const left = root.querySelectorAll('[data-chip]').length;
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = segments.map((segment) => (segment.kind === 'reference' ? tokenChipHtml(chipOf(segment.text)) : escapeHtml(segment.text))).join('');
  const first = template.content.firstChild ?? undefined;
  const last = template.content.lastChild ?? undefined;
  range.insertNode(template.content);
  if (first !== undefined && isHTMLElementInDocument(first, root.ownerDocument) && first.dataset['chip'] !== undefined) {
    slotBeside(first, 'before');
  }
  assert(root.querySelectorAll('[data-chip]').length === left + references, 'insertSource: every reference went in as a chip');
  assert(left <= before, 'insertSource: replacing the selection only took chips away');
  if (last === undefined) {
    return;
  }
  if (isHTMLElementInDocument(last, root.ownerDocument) && last.dataset['chip'] !== undefined) {
    placeCaret(root, { kind: 'text', node: slotBeside(last, 'after'), offset: 0 });
    return;
  }
  assert(last.nodeType === 3, 'insertSource: the last thing put in is a chip or text');
  const TextConstructor = root.ownerDocument.defaultView?.Text;
  assert(TextConstructor !== undefined, 'insertSource: the field belongs to a window');
  if (last instanceof TextConstructor) {
    placeCaret(root, { kind: 'text', node: last, offset: last.length });
  }
}

export function deleteSelection(root: HTMLElement): void {
  const range = selectionRangeIn(root);
  if (range === undefined) {
    return;
  }
  range.deleteContents();
  const selection = root.ownerDocument.getSelection();
  assert(selection !== null, 'deleteSelection: a field with a selection has one to collapse');
  selection.removeAllRanges();
  selection.addRange(range);
  assert(range.collapsed, 'deleteSelection: nothing is left selected');
}

function endRange(root: HTMLElement): Range {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
}

function placeCaretAtPoint(root: HTMLElement, point: { readonly x: number; readonly y: number }): void {
  const ownerDocument = root.ownerDocument;
  const range = ownerDocument.caretRangeFromPoint(point.x, point.y);
  if (range === null || !root.contains(range.startContainer)) {
    return;
  }
  const selection = ownerDocument.getSelection();
  if (selection === null) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function tokenFieldPress(
  field: HTMLElement,
  press: Pick<MouseEvent, 'button' | 'detail' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'clientX' | 'clientY' | 'preventDefault'>,
): void {
  if (press.button !== 0) {
    return;
  }
  if (press.detail > 1) {
    return;
  }
  if (press.shiftKey || press.metaKey || press.ctrlKey || press.altKey) {
    return;
  }
  const placement = caretPlacementAt(field, { x: press.clientX, y: press.clientY });
  if (placement.kind === 'browser') {
    return;
  }
  press.preventDefault();
  if (field.ownerDocument.activeElement !== field) {
    field.focus();
  }
  placeCaret(field, placement.target);
  assert(field.ownerDocument.activeElement === field, 'tokenFieldPress: the pressed field holds focus');
}

export interface PressedChip {
  readonly index: number;
  readonly binding: string;
}

export function pressedChip(field: HTMLElement, target: EventTarget): PressedChip | undefined {
  if (!isHTMLElementInDocument(target, field.ownerDocument)) {
    return undefined;
  }
  const chip = target.closest<HTMLElement>('[data-chip]');
  if (chip === null || !field.contains(chip)) {
    return undefined;
  }
  const index = [...field.querySelectorAll('[data-chip]')].indexOf(chip);
  assert(index >= 0, 'pressedChip: a chip inside the field is among its chips');
  return { index, binding: chip.dataset['binding'] ?? '' };
}

export type TokenFieldProps = {
  value: string;
  chips: Chip[];
  chipBare: string;
  chipVar: string;
  className: string;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  editorRef: RefObject<HTMLDivElement>;
  onFocusField: () => void;
  onCommit: (value: string) => void;
  onDraft?: (value: string) => void;
  onChipClick: (chip: PressedChip) => void;
  chipOf: (reference: string) => Chip;
  lineBreaks: PastedLineBreaks;
  code?: boolean;
  stepMin?: number;
};

export function useTokenFieldSync({
  value,
  chips,
  code,
  editorRef,
  historyRef,
}: Pick<TokenFieldProps, 'value' | 'chips' | 'editorRef'> & { code: boolean | undefined; historyRef: MutableRefObject<FieldHistory> }) {
  const synced = useRef<string | undefined>(undefined);
  const chipsKey = chipKey(chips);
  const latest = useRef({ value, chips });
  latest.current = { value, chips };

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element || value === synced.current) {
      return;
    }
    synced.current = value;
    const focused = element.ownerDocument.activeElement === element;
    const at = focused ? caretOffset(element) : undefined;
    historyRef.current = focused
      ? recordEdit(historyRef.current, captureField(element), { kind: 'replace', atMs: Date.now(), grouped: false })
      : EMPTY_FIELD_HISTORY;
    element.innerHTML = buildTokenHtml(value, latest.current.chips, code);
    if (!focused) {
      return;
    }
    element.focus();
    if (at !== undefined) {
      setCaretOffset(element, Math.min(at, fieldText(element).length));
    }
  }, [value, chipsKey, code, editorRef, historyRef]);

  useEffect(() => {
    const element = editorRef.current;
    if (!element || document.activeElement === element) {
      return;
    }
    synced.current = latest.current.value;
    element.innerHTML = buildTokenHtml(latest.current.value, latest.current.chips, code);
  }, [chipsKey, code, editorRef]);
  return synced;
}

export function tokenFieldKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  {
    code,
    stepMin,
    report,
    record,
  }: { code: boolean; stepMin: number | undefined; report: (element: HTMLElement) => void; record: (element: HTMLElement, kind: string) => void },
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitTokenFieldInPlace(event.currentTarget);
    return;
  }
  const element = event.currentTarget;
  if (code) {
    const edit = codeKeyEdit(event, element, stepMin);
    if (edit !== 'unhandled') {
      if (edit !== undefined) {
        event.preventDefault();
        record(element, `key:${event.key}`);
        paint(element, edit.text, edit.caret, chipsOf(element));
        report(element);
      }
      return;
    }
  }
  if (event.key === 'ArrowRight' && jumpCaretPastChip(element, 'right')) {
    event.preventDefault();
  } else if (event.key === 'ArrowLeft' && jumpCaretPastChip(element, 'left')) {
    event.preventDefault();
  }
}

export function codeKeyEdit(
  event: React.KeyboardEvent<HTMLDivElement>,
  element: HTMLElement,
  stepMin: number | undefined,
): { text: string; caret: number } | undefined | 'unhandled' {
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  if (plain && BRACKET_KEYS.has(event.key)) {
    const at = caretOffset(element);
    const collapsed = element.ownerDocument.getSelection()?.isCollapsed !== false;
    if (at !== undefined && collapsed) {
      const edit = bracketEdit(fieldText(element), at, event.key);
      if (edit !== undefined) {
        return edit;
      }
    }
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const at = caretOffset(element);
    const step = stepSize(event) * (event.key === 'ArrowUp' ? 1 : -1);
    return at === undefined ? undefined : stepNumberAt(fieldText(element), at, step, stepMin);
  }
  return 'unhandled';
}

const NUMBER_WITH_UNIT = /^[-+]?(?:\d+\.?\d*|\.\d+)[a-zA-Z%]*/;
const IDENTIFIER = /^-{0,2}[A-Za-z_][\w-]*/;

const BRACKET_SCAN_MAX = 4_096;

function wrappedToken(rest: string): string {
  if (rest.startsWith(CHIP_MARK)) {
    return CHIP_MARK;
  }
  const word = IDENTIFIER.exec(rest)?.[0];
  if (word !== undefined) {
    if (rest[word.length] !== '(') {
      return word;
    }
    const end = matchingBracket(rest, word.length);
    return end === undefined ? '' : rest.slice(0, end + 1);
  }
  return NUMBER_WITH_UNIT.exec(rest)?.[0] ?? '';
}

function matchingBracket(text: string, open: number): number | undefined {
  assert(text[open] === '(', 'matchingBracket: starts at an open bracket');
  let depth = 0;
  const limit = Math.min(text.length, open + BRACKET_SCAN_MAX);
  for (let index = open; index < limit; index++) {
    if (text[index] === '(') {
      depth += 1;
    } else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function insideLiteral(text: string, at: number): boolean {
  let quote: string | undefined;
  let url = false;
  for (let index = Math.max(0, at - BRACKET_SCAN_MAX); index < at; index++) {
    const ch = text[index];
    if (quote !== undefined) {
      if (ch === '\\') {
        index += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (url) {
      if (ch === ')') {
        url = false;
      }
    } else if (ch === '(' && /url$/i.test(text.slice(Math.max(0, index - 3), index))) {
      url = true;
    }
  }
  return quote !== undefined || url;
}

function hasSurplusCloser(text: string): boolean {
  let balance = 0;
  const limit = Math.min(text.length, BRACKET_SCAN_MAX);
  for (let index = 0; index < limit; index++) {
    if (text[index] === '(') {
      balance += 1;
    } else if (text[index] === ')') {
      balance -= 1;
    }
  }
  return balance < 0;
}

export function bracketEdit(text: string, at: number, key: string): { text: string; caret: number } | undefined {
  if (key === '(') {
    if (insideLiteral(text, at)) {
      return undefined;
    }
    if (hasSurplusCloser(text)) {
      return { text: `${text.slice(0, at)}(${text.slice(at)}`, caret: at + 1 };
    }
    const wrapped = wrappedToken(text.slice(at));
    const closeAt = at + wrapped.length;
    return { text: `${text.slice(0, at)}(${wrapped})${text.slice(closeAt)}`, caret: at + 1 + wrapped.length };
  }
  if (key === ')' && text[at] === ')') {
    return { text, caret: at + 1 };
  }
  if (key === 'Backspace' && text[at - 1] === '(' && text[at] === ')') {
    return { text: text.slice(0, at - 1) + text.slice(at + 1), caret: at - 1 };
  }
  if (key === 'Backspace' && text[at - 1] === '(' && !insideLiteral(text, at - 1)) {
    const wrapped = wrappedToken(text.slice(at));
    if (wrapped !== '' && text[at + wrapped.length] === ')') {
      return { text: text.slice(0, at - 1) + wrapped + text.slice(at + wrapped.length + 1), caret: at - 1 };
    }
  }
  return undefined;
}

const GROUPED_EDITS: ReadonlySet<string> = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward']);

let historyKeyAtMs = 0;
const HISTORY_ECHO_MS = 250;

export function historyKey(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): 'undo' | 'redo' | undefined {
  if (!event.metaKey && !event.ctrlKey) {
    return undefined;
  }
  if (event.altKey) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }
  return key === 'y' && !event.shiftKey ? 'redo' : undefined;
}

function useFieldHistoryInput(
  editorRef: RefObject<HTMLDivElement>,
  handlers: { readonly record: (element: HTMLElement, kind: string) => void; readonly travel: (element: HTMLElement, direction: 'undo' | 'redo') => void },
): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const element = editorRef.current;
    if (!element) {
      return undefined;
    }
    const onBeforeInput = (event: InputEvent): void => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        if (Date.now() - historyKeyAtMs > HISTORY_ECHO_MS) {
          latest.current.travel(element, event.inputType === 'historyUndo' ? 'undo' : 'redo');
        }
        return;
      }
      latest.current.record(element, event.inputType);
    };
    element.addEventListener('beforeinput', onBeforeInput);
    return () => element.removeEventListener('beforeinput', onBeforeInput);
  }, [editorRef]);
}

export function captureField(element: HTMLElement): FieldSnapshot {
  const text = fieldText(element);
  return { text, chips: chipsOf(element), caret: caretOffset(element) ?? text.length };
}

export function restoreField(element: HTMLElement, snapshot: FieldSnapshot, options: { readonly code: boolean }): void {
  const write = options.code ? highlightCss : escapeHtml;
  const parts = snapshot.text.split(CHIP_MARK);
  assert(parts.length - 1 <= snapshot.chips.length, 'restoreField: every mark in the text has its chip');
  let html = write(parts[0] ?? '');
  for (let index = 1; index < parts.length; index++) {
    const chip = snapshot.chips[index - 1];
    html += (chip === undefined ? '' : tokenChipHtml(chip)) + write(parts[index] ?? '');
  }
  element.innerHTML = html;
  assert(fieldText(element).length === snapshot.text.length, 'restoreField: the field shows the snapshot text');
  if (element.ownerDocument.activeElement === element) {
    setCaretOffset(element, Math.min(snapshot.caret, snapshot.text.length));
  }
}
