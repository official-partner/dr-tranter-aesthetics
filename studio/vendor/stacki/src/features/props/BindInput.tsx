import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Part, TemplateHole } from '../../editor/bindings';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { deleteChipAtCaret } from './chipKeys';
import { insertAtRange } from './fieldFocus';
import { commitEditableInPlace } from '../../ui/commitInPlace';


const esc = (text: string | undefined) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chipHtml = (path: string, full?: string) =>
  `<span class="expr-chip" contenteditable="false" data-expr="${esc(path)}"${full && full !== path ? ` data-full="${esc(full)}"` : ''}>${esc(path)}</span>`;

function chipNode(document: Document, path: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'expr-chip';
  chip.setAttribute('contenteditable', 'false');
  chip.setAttribute('data-expr', path);
  chip.textContent = path;
  assert(chip.getAttribute('data-expr') === path, 'BindInput: a chip writes the path it was given');
  return chip;
}

const partsToHtml = (parts: readonly Part[] | undefined): string => {
  assert((parts?.length ?? 0) <= LIMITS.treeNodesMax, 'BindInput: part limit exceeded');
  let last: string | undefined;
  let afterQuestion = false;
  return (parts || [])
    .map((part) => {
      if (part.expr === undefined) {
        afterQuestion = last !== undefined && part.text === '?';
        return esc(part.text);
      }
      const full = afterQuestion && part.expr.startsWith('.') ? last + part.expr : part.expr;
      last = full;
      afterQuestion = false;
      return chipHtml(part.expr, full);
    })
    .join('');
};

function readParts(host: HTMLElement): Part[] {
  assert(host.childNodes.length <= LIMITS.treeNodesMax, 'BindInput: child limit exceeded');
  const out: Part[] = [];
  for (const node of host.childNodes) {
    if (node.nodeType === 3) {
      if (node.nodeValue) {
        out.push({ text: node.nodeValue });
      }
    } else if (isChip(node)) {
      out.push({ expr: node.getAttribute('data-expr') || node.textContent || '' });
    } else if (node.nodeName === 'BR') {
    } else if (node.textContent) {
      out.push({ text: node.textContent });
    }
  }
  return out;
}

export interface BindInputHandle {
  readonly insert: (path: string) => void;
  readonly replace: (chip: Element | TemplateHole | undefined, path: string) => void;
  readonly focus: () => void;
}
interface BindInputProps {
  readonly parts?: readonly Part[] | undefined;
  readonly placeholder?: string;
  readonly onChange?: (parts: Part[]) => void;
  readonly onChipClick?: (chip: Element) => void;
  readonly onFocus?: React.FocusEventHandler<HTMLDivElement>;
  readonly onBlur?: React.FocusEventHandler<HTMLDivElement>;
}
const BindInput = forwardRef<BindInputHandle, BindInputProps>(function BindInput(props, ref) {
  const { placeholder, onChipClick, onFocus, onBlur } = props;
  const state = useBindInput(props);
  const { hostRef, saveRange, emit } = state;
  useImperativeHandle(ref, () => bindHandle(state));
  return (
    <div
      ref={hostRef}
      className="bind-input"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      data-placeholder={placeholder || ''}
      onInput={emit}
      onKeyUp={saveRange}
      onMouseUp={saveRange}
      onFocus={onFocus}
      onBlur={(event) => {
        saveRange();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (hostRef.current) {
            commitEditableInPlace(hostRef.current);
          }
          return;
        }
        if (deleteChipAtCaret(hostRef.current ?? undefined, event)) {
          event.preventDefault();
          emit();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
        document.execCommand('insertText', false, text);
      }}
      onMouseDown={(event) => {
        const ElementType = event.currentTarget.ownerDocument.defaultView?.Element;
        const chip = ElementType && event.target instanceof ElementType ? event.target.closest('.expr-chip') : undefined;
        if (!chip) {
          return;
        }
        event.preventDefault();
        onChipClick?.(chip);
      }}
    />
  );
});

export default BindInput;

function useBindInput({ parts, onChange }: BindInputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef('');
  const rangeRef = useRef<Range | undefined>(undefined);

  const emit = () => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    lastHtmlRef.current = host.innerHTML;
    onChange?.(readParts(host));
  };

  const saveRange = () => {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection?.rangeCount) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) {
      rangeRef.current = range.cloneRange();
    }
  };

  const initialParts = useRef(parts);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const html = partsToHtml(initialParts.current);
    lastHtmlRef.current = html;
    host.innerHTML = html;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || document.activeElement === host) {
      return;
    }
    const html = partsToHtml(parts);
    if (html !== lastHtmlRef.current) {
      lastHtmlRef.current = html;
      host.innerHTML = html;
    }
  });

  return { hostRef, rangeRef, emit, saveRange };
}

type BindState = ReturnType<typeof useBindInput>;
function bindHandle(state: BindState): BindInputHandle {
  const { hostRef, rangeRef, saveRange, emit } = state;
  return {
    insert(path: string) {
      const host = hostRef.current;
      if (!host) {
        return;
      }
      host.focus();
      insertAtRange(host, rangeRef.current, chipNode(host.ownerDocument, path));
      saveRange();
      emit();
    },
    replace: (chip, path) => bindReplace(chip, path, emit),
    focus() {
      hostRef.current?.focus();
    },
  };
}

function bindReplace(chip: Element | TemplateHole | undefined, path: string, emit: () => void): void {
  if (!chip || !('getAttribute' in chip)) {
    return;
  }
  const chipElement = chip;
  const full = chipElement.getAttribute('data-full');
  if (full) {
    const base = full.slice(0, full.length - (chipElement.getAttribute('data-expr') || '').length);
    if (path.startsWith(`${base}.`)) {
      const tail = path.slice(base.length);
      chipElement.setAttribute('data-expr', tail);
      chipElement.setAttribute('data-full', path);
      chipElement.textContent = tail;
      emit();
      return;
    }
    const punct = chipElement.previousSibling;
    const baseChip = punct?.previousSibling ?? undefined;
    if (punct?.nodeType === 3 && (punct.nodeValue || '').trim() === '?' && isChip(baseChip)) {
      punct.remove();
      baseChip.remove();
    }
  }
  chipElement.removeAttribute('data-full');
  chipElement.setAttribute('data-expr', path);
  chipElement.textContent = path;
  emit();
}

function isChip(node: Node | undefined): node is Element {
  const ElementType = node?.ownerDocument?.defaultView?.Element;
  return !!ElementType && node instanceof ElementType && node.classList.contains('expr-chip');
}
