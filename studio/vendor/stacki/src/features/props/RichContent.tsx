import { assert } from '../../../shared/core/assert';
import Popup from '../../ui/Popup';
import { dataPickerPosition } from './dataPickerPosition';
import React, { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import DataPicker from './DataPicker';
import type { DataPickerProps } from './DataPicker';
import type { DataOrigin } from './dataPickerModel';
import type { NewPropHost } from './newPropModel';
import { dataTree } from '../../editor/dataSuggest';
import type { DataContext } from '../../editor/dataSuggest';
import type { ImportNeed } from '../../editor/dataSample';
import { resolvePick } from '../../editor/bindings';
import { deleteChipAtCaret } from './chipKeys';
import { insertAtRange } from './fieldFocus';
import { CARET_BREAK_ATTRIBUTE, LITERAL_ATTRIBUTE, isDOMElement, nodesToHtml, isChippable, withoutTrailingBreaks } from './richContentModel';
import type { InlineNode } from './richContentModel';
import { richApplyLink, richContentNodes, richExec, richReadStates, richWrapTag, type FormatState, type RichTarget } from './richFormat';
import { RichFormatButtons, RichLinkField, richBubblePlace, type Bubble, type BubblePosition } from './RichFormatButtons';
export { INLINE_TAGS, isSimpleExpr, isInlineOnly, isChippable, nodesToHtml } from './richContentModel';
export type { InlineNode } from './richContentModel';

export interface RichContext extends DataContext {
  readonly entryNav?: DataPickerProps['entries'];
  readonly onStepItem?: DataPickerProps['onStepItem'];
  readonly onNeedSample?: (collection: string, index?: number) => void;
  readonly origin?: DataOrigin | undefined;
  readonly ensureQuery?: (collection: string) => string | undefined;
  readonly ensureImport?: (need: ImportNeed) => string | undefined;
  readonly newProp?: NewPropHost | undefined;
}
export interface RichInsertAPI {
  readonly insert: (path: string) => void;
}
interface RichContentProps {
  readonly nodes: readonly InlineNode[];
  readonly onChange: (nodes: InlineNode[]) => void;
  readonly bindContext?: RichContext | undefined;
  readonly insertRef?: MutableRefObject<RichInsertAPI | undefined>;
}
interface ChipMenu {
  readonly chip: Element;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly current: string;
}
export default function RichContent({ nodes, onChange, bindContext, insertRef }: RichContentProps) {
  const state = useRichState();
  const { hostRef } = state;
  const emit = () => richEmit(state, onChange);
  const { onChipMouseDown, pickExpr } = richChipActions(state, emit);
  useRichSync(nodes, state);
  useRichCaret(state);
  useRichInsertion(insertRef, state, emit);
  useRichSelection(state);
  useRichPosition(state);
  const onBlur = useRichBlur(state);
  return (
    <>
      <div
        ref={hostRef}
        className="rich-content"
        data-app-undo=""
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={onBlur}
        onInput={emit}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand('insertHTML', false, plainPasteHTML(event.clipboardData.getData('text/plain')));
          emit();
        }}
        onMouseDown={onChipMouseDown}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            richLineBreak(hostRef.current ?? undefined);
            emit();
            return;
          }
          if (deleteChipAtCaret(hostRef.current ?? undefined, event)) {
            event.preventDefault();
            emit();
          }
        }}
      />
      <RichChipMenu state={state} bindContext={bindContext} pickExpr={pickExpr} />
      <RichBubble state={state} emit={emit} />
    </>
  );
}

export function richLineBreak(host: HTMLElement | undefined): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (host === undefined || range === undefined || !host.contains(range.endContainer)) {
    document.execCommand('insertHTML', false, '<br>');
    return;
  }
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(host, host.childNodes.length);
  const rest = Array.from(after.cloneContents().childNodes);
  const shows = (node: Node): boolean =>
    (node.textContent ?? '') !== '' ||
    (isDOMElement(node) &&
      (node.tagName === 'BR' ? !node.hasAttribute(CARET_BREAK_ATTRIBUTE) : node.querySelector(`br:not([${CARET_BREAK_ATTRIBUTE}]), img`) !== null));
  const atEnd = rest.every((node) => !shows(node));
  const held = rest.some((node) => isDOMElement(node) && node.hasAttribute(CARET_BREAK_ATTRIBUTE));
  if (atEnd && !held) {
    range.deleteContents();
    let outer: Node | undefined;
    for (let node: Node | undefined = range.endContainer; node !== undefined && node !== host; node = node.parentNode ?? undefined) {
      outer = node.parentNode === host ? node : outer;
    }
    if (outer !== undefined && isDOMElement(outer) && outer.tagName !== 'BR') {
      range.setStartAfter(outer);
      range.collapse(true);
    }
    const line = document.createElement('br');
    const caret = document.createElement('br');
    caret.setAttribute(CARET_BREAK_ATTRIBUTE, '');
    range.insertNode(caret);
    range.insertNode(line);
    const next = document.createRange();
    next.setStartAfter(line);
    next.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(next);
    return;
  }
  document.execCommand('insertHTML', false, '<br>');
}

function useRichState() {
  const hostRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string | undefined>(undefined);
  const savedRangeRef = useRef<Range | undefined>(undefined);
  const [bubble, setBubble] = useState<Bubble | undefined>(undefined);
  const [position, setPosition] = useState<BubblePosition | undefined>(undefined);
  const [states, setStates] = useState<FormatState>({});
  const [linkMode, setLinkMode] = useState(false);
  const [chipMenu, setChipMenu] = useState<ChipMenu | undefined>(undefined);
  const [linkUrl, setLinkUrl] = useState('');

  const caretRef = useRef<Range | undefined>(undefined);
  return {
    hostRef,
    bubbleRef,
    lastEmittedRef,
    savedRangeRef,
    caretRef,
    bubble,
    setBubble,
    pos: position,
    setPos: setPosition,
    states,
    setStates,
    linkMode,
    setLinkMode,
    chipMenu,
    setChipMenu,
    linkUrl,
    setLinkUrl,
  };
}

type RichState = ReturnType<typeof useRichState>;
function useRichSync(nodes: readonly InlineNode[], state: RichState) {
  const { hostRef, lastEmittedRef } = state;
  const html = nodesToHtml(nodes, isChippable);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    if (html === lastEmittedRef.current) {
      return;
    }
    const focused = element.ownerDocument.activeElement === element;
    if (focused && sameWords(html, lastEmittedRef.current ?? '')) {
      lastEmittedRef.current = html;
      return;
    }
    const caret = focused ? caretOffset(element) : undefined;
    const before = element.textContent ?? '';
    element.innerHTML = html;
    lastEmittedRef.current = html;
    if (caret !== undefined) {
      placeCaret(element, caretAfterChange(before, element.textContent ?? '', caret));
    }
  }, [html, hostRef, lastEmittedRef]);
}

export function sameWords(left: string, right: string): boolean {
  const words = (html: string) =>
    html
      .replace(/<br data-rich-caret="">/g, '')
      .replace(/&nbsp;|\u00A0/g, ' ')
      .replace(/(?:<br>\s*)+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  return words(left) === words(right);
}

export function caretAfterChange(before: string, after: string, caret: number): number {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }
  if (caret < prefix || before === after) {
    return caret;
  }
  const behind = before.length - caret;
  return behind < suffix ? after.length - behind : after.length - suffix;
}

function caretOffset(element: HTMLElement): number | undefined {
  const selection = element.ownerDocument.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.getRangeAt(0).endContainer)) {
    return undefined;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
}

function placeCaret(element: HTMLElement, offset: number): void {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      element.ownerDocument.getSelection()?.collapse(node, left);
      return;
    }
    left -= length;
  }
  element.ownerDocument.getSelection()?.collapse(element, element.childNodes.length);
}
function richEmit(state: RichState, onChange: RichContentProps['onChange']): void {
  const { hostRef, lastEmittedRef } = state;
  const element = hostRef.current;
  if (!element) {
    return;
  }
  const next = withoutTrailingBreaks(richContentNodes(element));
  lastEmittedRef.current = nodesToHtml(next, isChippable);
  onChange(next);
}
function useRichCaret(state: RichState): void {
  const { hostRef, caretRef } = state;

  useEffect(() => {
    const onSelectionChange = () => {
      const element = hostRef.current;
      const selection = window.getSelection();
      if (!element || !selection?.rangeCount) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (element.contains(range.commonAncestorContainer)) {
        caretRef.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [hostRef, caretRef]);
}
function useRichInsertion(insertRef: RichContentProps['insertRef'], state: RichState, emit: () => void) {
  const { hostRef, caretRef } = state;
  useEffect(() => {
    if (!insertRef) {
      return undefined;
    }
    insertRef.current = {
      insert(path: string) {
        const element = hostRef.current;
        if (!element) {
          return;
        }
        element.focus();
        const chip = element.ownerDocument.createElement('span');
        chip.className = 'expr-chip';
        chip.setAttribute('contenteditable', 'false');
        chip.setAttribute('data-expr', `{${path}}`);
        chip.textContent = path;
        insertAtRange(element, caretRef.current, chip);
        emit();
      },
    };
    return () => {
      insertRef.current = undefined;
    };
  });
}
function useRichSelection(state: RichState): void {
  const { linkMode, hostRef, savedRangeRef, setBubble, setStates } = state;
  useEffect(() => {
    const onSelectionChange = () => {
      if (linkMode) {
        return;
      }
      const element = hostRef.current;
      const selection = window.getSelection();
      if (
        !element ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !element.contains(selection.anchorNode) ||
        !element.contains(selection.focusNode)
      ) {
        setBubble(undefined);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setBubble(undefined);
        return;
      }
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      setBubble({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
      setStates(richReadStates(hostRef.current ?? undefined));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [hostRef, savedRangeRef, linkMode, setBubble, setStates]);
}
function useRichPosition(state: RichState): void {
  const { bubbleRef, bubble, linkMode, setPos: setPosition } = state;
  React.useLayoutEffect(() => {
    const element = bubbleRef.current;
    if (!bubble || !element) {
      setPosition(undefined);
      return;
    }
    setPosition(richBubblePlace(bubble, element));
  }, [bubble, linkMode, bubbleRef, setPosition]);
}
const richTarget = (state: RichState): RichTarget => ({
  host: state.hostRef.current ?? undefined,
  savedRange: state.savedRangeRef,
});
function richSettle(state: RichState, emit: () => void): void {
  emit();
  state.setStates(richReadStates(state.hostRef.current ?? undefined));
}
function richApplyLinkField(state: RichState, emit: () => void): void {
  const { linkUrl, setLinkMode, setLinkUrl } = state;
  setLinkMode(false);
  setLinkUrl('');
  if (richApplyLink(richTarget(state), linkUrl)) {
    richSettle(state, emit);
  }
}
function richChipActions(state: RichState, emit: () => void) {
  const { chipMenu, setChipMenu } = state;
  const onChipMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const ElementType = event.currentTarget.ownerDocument.defaultView?.Element;
    const chip = ElementType && event.target instanceof ElementType ? event.target.closest('.expr-chip') : undefined;
    if (!chip) {
      return;
    }
    event.preventDefault();
    const rect = chip.getBoundingClientRect();
    setChipMenu({
      chip,
      ...dataPickerPosition(rect),
      current: (chip.getAttribute('data-expr') || '').replace(/^\{|\}$/g, ''),
    });
  };

  const pickExpr = (insert: string) => {
    const chip = chipMenu?.chip;
    setChipMenu(undefined);
    if (!chip) {
      return;
    }
    chip.setAttribute('data-expr', '{' + insert + '}');
    chip.textContent = insert;
    emit();
  };

  return { onChipMouseDown, pickExpr };
}
function RichChipMenu({
  state,
  bindContext,
  pickExpr,
}: {
  readonly state: RichState;
  readonly bindContext: RichContext | undefined;
  readonly pickExpr: (path: string) => void;
}) {
  const { chipMenu } = state;
  if (!chipMenu) {
    return undefined;
  }
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={() => state.setChipMenu(undefined)}
      className="dd-popup bind-menu"
      style={{ left: chipMenu.left, top: chipMenu.top, width: chipMenu.width }}
    >
      <DataPicker
        tree={dataTree(bindContext || {})}
        current={chipMenu.current}
        entries={bindContext?.entryNav ?? undefined}
        {...(bindContext?.onStepItem ? { onStepItem: bindContext.onStepItem } : {})}
        onPick={(path, need) => pickExpr(resolvePick(path, need, bindContext ?? undefined))}
        onExpand={(node, index) => node.query && bindContext?.onNeedSample?.(node.query.collection, index)}
        origin={bindContext?.origin}
        footer={false}
        propSettings={bindContext?.newProp?.propSettings}
      />
    </Popup>
  );
}
function RichBubble({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  const { bubble, bubbleRef, pos: position, linkMode } = state;
  if (!bubble) {
    return undefined;
  }
  const style: React.CSSProperties = {
    left: position ? position.left : bubble.x,
    top: position ? position.top : bubble.top - 10,
    visibility: position ? 'visible' : 'hidden',
  };
  return (
    <div ref={bubbleRef} className={`rich-bubble ${position?.below ? 'below' : ''}`} style={style} onMouseDown={(event) => event.stopPropagation()}>
      {linkMode ? <RichLinkInput state={state} emit={emit} /> : <RichButtons state={state} emit={emit} />}
    </div>
  );
}
function RichLinkInput({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  const { linkUrl, setLinkUrl, setLinkMode } = state;
  return (
    <RichLinkField
      value={linkUrl}
      onChange={setLinkUrl}
      onApply={() => richApplyLinkField(state, emit)}
      onCancel={() => {
        setLinkMode(false);
        setLinkUrl('');
      }}
    />
  );
}
function RichButtons({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  return (
    <RichFormatButtons
      states={state.states}
      onExec={(command) => {
        richExec(richTarget(state), command);
        richSettle(state, emit);
      }}
      onWrap={(tag) => {
        if (richWrapTag(richTarget(state), tag)) {
          richSettle(state, emit);
        }
      }}
      onLink={() => state.setLinkMode(true)}
    />
  );
}
function useRichBlur(state: RichState): () => void {
  const { linkMode, setBubble } = state;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  return () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setBubble((bubble) => (linkMode ? bubble : undefined));
    }, 150);
  };
}

export function plainPasteHTML(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = escaped.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  assert(!/<(?!br>)/.test(html), 'Pasted markup holds only line breaks');
  return html === '' ? '' : `<span ${LITERAL_ATTRIBUTE}="">${html}</span>`;
}
