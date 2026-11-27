import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import Popup from '../../ui/Popup';
import { popupBox } from '../../ui/Dropdown';
import { usePopupScrollLock } from '../../ui/popupScrollLock';


export const PICKER_RESTORE_EVENT = 'stacki:picker-restore';

const LONG_VALUE = 34;
const isLong = (value: string) => String(value).length > LONG_VALUE || String(value).includes('\n');

function doesNotFit(container: Element, value: string) {
  if (value === '') {
    return false;
  }
  const field = container.querySelector('.embed-editor_varconnect-editor') || container.querySelector('.var-input') || container.querySelector('input');
  if (!field || !field.clientWidth) {
    return isLong(value);
  }
  return field.scrollWidth > field.clientWidth + 1 || isLong(value);
}
let closeOpenCustom: (() => void) | undefined;

interface CustomValueProps {
  readonly value: string;
  readonly label?: string;
  readonly prop?: string | undefined;
  readonly anchor?: DOMRect | undefined;
  readonly anchorEl?: HTMLElement | undefined;
  readonly onCancel: () => void;
  readonly onSave: (value: string) => void;
  readonly connectField: (
    field: ReactElement,
    prop: string | undefined,
    openChip: { readonly index: number; readonly binding: string } | undefined,
    trigger: DOMRect | undefined,
    onDraft: (value: string) => void,
  ) => ReactNode;
  readonly openChip?: { readonly index: number; readonly binding: string };
}
function CustomValue(props: CustomValueProps) {
  const state = useCustomValue(props);
  const translate = useTranslate();
  const { label } = props;
  return (
    <Popup
      mode="popover"
      anchor={props.anchorEl}
      onClose={() => props.onSave(state.commit())}
      onEscape={props.onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          props.onSave(state.commit());
        }
      }}
      ref={state.boxRef}
      className="var-custom"
      style={{
        left: state.position?.left ?? -9999,
        top: state.position?.top,
        bottom: state.position?.bottom,
        maxHeight: state.position?.maxHeight,
      }}
    >
      <div className="var-custom-head">
        <span>{translate('style.customValueEditor.customValue')}</span>
        <span className="var-custom-name">{label}</span>
      </div>
      {props.connectField(
        <textarea
          ref={state.fieldRef}
          className="var-custom-input"
          value={state.draft}
          spellCheck={false}
          rows={4}
          onChange={(event) => state.setDraft(event.target.value)}
        />,
        props.prop,
        props.openChip,
        props.anchor,
        state.setDraft,
      )}
      <div className="var-custom-foot">
        <span>{translate('style.customValueEditor.hint')}</span>
      </div>
    </Popup>
  );
}

function useCustomValue({ value, anchor, onSave }: CustomValueProps) {
  const [draft, setDraftState] = useState(value);
  const boxRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setDraft = useCallback((next: string): void => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const position = useCustomPosition(boxRef, anchor);
  const commit = useCallback((): string => {
    const rich = boxRef.current?.querySelector<HTMLElement>('.embed-editor_varconnect-editor');
    if (rich && (rich === document.activeElement || rich.contains(document.activeElement))) {
      rich.blur();
    }
    return draftRef.current;
  }, []);
  useCustomClose(boxRef, commit, onSave);
  useOutsidePressWithChooser(boxRef, commit, onSave);
  useCustomFocus(boxRef, fieldRef);
  return { draft, setDraft, boxRef, fieldRef, position, commit };
}

function useCustomPosition(boxRef: RefObject<HTMLDivElement>, anchor: DOMRect | undefined) {
  const [position, setPosition] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!anchor) {
      return;
    }
    const wanted = boxRef.current?.offsetHeight || 190;
    const box = popupBox(anchor, wanted, window.innerHeight);
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 460)),
      top: box.top,
      bottom: box.bottom,
      maxHeight: box.maxHeight,
    });
  }, [anchor, boxRef]);
  return position;
}

function useCustomClose(boxRef: RefObject<HTMLDivElement>, commit: () => string, onSave: (value: string) => void): void {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    const close = (): void => saveRef.current(commit());
    closeOpenCustom?.();
    closeOpenCustom = close;
    return () => {
      if (closeOpenCustom === close) {
        closeOpenCustom = undefined;
      }
    };
  }, [commit]);
  usePopupScrollLock(boxRef);
}

function useOutsidePressWithChooser(boxRef: RefObject<HTMLDivElement>, commit: () => string, onSave: (value: string) => void): void {
  const latest = useRef({ commit, onSave });
  latest.current = { commit, onSave };
  useEffect(() => {
    const press = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || boxRef.current === null || boxRef.current.contains(target)) {
        return;
      }
      const chooser = document.querySelector('.embed-editor_varpicker');
      if (chooser === null || chooser.contains(target)) {
        return;
      }
      chooser.dispatchEvent(new window.Event(PICKER_RESTORE_EVENT));
      latest.current.onSave(latest.current.commit());
    };
    document.addEventListener('mousedown', press, true);
    return () => document.removeEventListener('mousedown', press, true);
  }, [boxRef]);
}

function useCustomFocus(boxRef: RefObject<HTMLDivElement>, fieldRef: RefObject<HTMLTextAreaElement>) {
  useEffect(() => {
    const settled = (): boolean => !!boxRef.current?.contains(document.activeElement) || !!document.activeElement?.closest('.embed-editor_varpicker');
    if (settled()) {
      return;
    }
    const timer = setTimeout(() => {
      if (settled()) {
        return;
      }
      const rich = boxRef.current?.querySelector<HTMLElement>('.embed-editor_varconnect-editor');
      if (!rich) {
        fieldRef.current?.select();
        return;
      }
      rich.focus();
      const range = document.createRange();
      range.selectNodeContents(rich);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, 0);
    return () => clearTimeout(timer);
  });
}

function withBinding(value: string, binding: string) {
  const existing = String(value).match(/var\(\s*--[A-Za-z0-9_-]+[^)]*\)/i);
  return existing ? value.replace(existing[0], binding) : binding;
}
export { CustomValue, isLong, doesNotFit, withBinding };
export default CustomValue;
