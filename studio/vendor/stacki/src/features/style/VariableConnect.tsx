import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactElement, ReactNode, RefObject } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { flushSync } from 'react-dom';
import { type ProjectVariable } from './model/webflow';
import { SLOT_MARK, slotOfMarked, type ValueSlot } from '../../../shared/properties/valueSlot';
import { selectionOffsets, setCaretOffset } from './model/cssCode';
import CustomValue, { doesNotFit } from './CustomValueEditor';
import { insertBindingAt, type ValueSelection } from './model/insertBinding';
import { completeTypedVariable, fieldOffsetOf, replaceVariableAt, typedVariableAt, type TypedVariable } from './model/typedVariable';
import type { PickerNavigation, PreviewEndTiming } from './VariablePicker';
import { PlusIcon } from './VariableIcons';
import { useExitRestore } from './pickerExit';
import { varTypeAllowed, useSharedVars } from './sharedVars';
import { VariablePicker } from './VariablePicker';
import VariableHint from './VariableHint';
import { useDeclaredValue } from './model/computedStyle';
import { customValueSeed, customValueWrites, type CustomValueSeed } from './model/customValueSeed';
import { type Chip, CHIP_MARK, fieldText, type PressedChip, pressedChip, serializeTokens, TokenField } from './TokenField';
import { VARIABLE_REFERENCE_PATTERN } from './tokenFieldClipboard';
import './embedEditor.css';
import {
  childValue,
  childPlaceholder,
  bindingName,
  nativeVariableNames,
  setInputValue,
  type FieldRefValue,
  type ChildFieldProps,
  updateChildRef,
  useFieldPreview,
} from './connectFieldHelpers';

export { buildTokenHtml, serializeTokens } from './TokenField';

export { VariablePicker } from './VariablePicker';

export { useSharedVars } from './sharedVars';

type VariableConnectProps = {
  onPick: (binding: string) => void;
  onDraft?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  prop?: string;
  code?: boolean;
  stepMin?: number;
  expanded?: boolean;
  initialChip?: PressedChip;
  trigger?: DOMRect;
  canvasProperty?: string;
  children: ReactNode;
};

export function connectCustomField(
  field: ReactElement,
  prop: string | undefined,
  openChip: PressedChip | undefined,
  trigger: DOMRect | undefined,
  onDraft: (value: string) => void,
): ReactNode {
  return (
    <VariableConnect
      className="is-multiline"
      code
      onDraft={onDraft}
      onPick={onDraft}
      {...(prop === undefined ? {} : { prop })}
      {...(openChip === undefined ? {} : { initialChip: openChip })}
      {...(trigger === undefined ? {} : { trigger })}
    >
      {field}
    </VariableConnect>
  );
}

export default function VariableConnect(props: VariableConnectProps) {
  const translate = useTranslate();
  const { onPick, disabled, ariaLabel = translate('style.variablePicker.connectToVariable'), prop } = props;
  const connect = useVariableConnect(props);
  const { open, setOpen, big, setBig, value, applied, showToken, field, wrapRef } = connect;
  const { editorRef, dotRef, chipText, liveValue, selectionRef, readCaret, hintValue } = connect;
  const { chipTarget, setChipTarget, suggest, setSuggest, navigationRef } = connect;
  const anchor = (showToken ? editorRef.current : dotRef.current) ?? undefined;
  const refreshSuggest = (change: { readonly key: string | undefined }): void => {
    if (disabled) {
      return;
    }
    if (change.key !== undefined && !CARET_KEYS.includes(change.key)) {
      return;
    }
    const next = typedAtSelection(liveValue(), selectionRef.current);
    setSuggest((current) => (sameTyped(current, next) ? current : next));
  };
  const { openedRef, bigChipRef, bigSeedRef, epochRef, setPreviewText } = connect;
  const canvas = useFieldPreview(props.canvasProperty);
  const pressAtRef = useRef<number | undefined>(undefined);
  const closedAtRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (big === undefined) {
      return undefined;
    }
    const note = (event: Event): void => {
      pressAtRef.current = event.timeStamp;
    };
    window.addEventListener('mousedown', note, true);
    return () => window.removeEventListener('mousedown', note, true);
  }, [big]);
  const closeBig = (): void => {
    closedAtRef.current = pressAtRef.current;
    pressAtRef.current = undefined;
    setBig(undefined);
  };
  const withChosen = (chosen: string): string => {
    const base = openedRef.current?.value ?? liveValue();
    if (chipTarget !== undefined) {
      return replaceVariableAt(base, chipTarget.index, chosen);
    }
    return insertBindingAt(base, chosen, selectionRef.current);
  };
  const draftTo = (next: string, kind: 'preview' | 'restore'): void => {
    if (kind === 'preview') {
      setPreviewText(next);
      canvas.show(next);
    } else {
      setPreviewText(undefined);
      canvas.takeBack();
    }
  };
  const openChooser = (): void => {
    openedRef.current = { value: liveValue(), previewed: false };
    setOpen(true);
  };
  const closeChooser = (): void => {
    restore({ when: 'batched' });
    openedRef.current = undefined;
    setChipTarget(undefined);
    setSuggest(undefined);
    setOpen(false);
  };
  const pick = (chosen: string): void => {
    const current = liveValue();
    if (suggest !== undefined) {
      const completed = completeTypedVariable(current, suggest, chosen);
      setSuggest(undefined);
      onPick(completed.value);
      placeCaretAfterPick(editorRef, field.inputRef, completed);
      return;
    }
    const next = withChosen(chosen);
    epochRef.current += 1;
    openedRef.current = undefined;
    canvas.handOver();
    setPreviewText(next);
    onPick(next);
    setChipTarget(undefined);
    setOpen(false);
  };
  const pickSlot = (): ValueSlot | undefined => {
    const base = openedRef.current?.value ?? liveValue();
    if (suggest !== undefined) {
      return slotOfMarked(completeTypedVariable(liveValue(), suggest, SLOT_MARK).value);
    }
    if (chipTarget !== undefined) {
      return slotOfMarked(replaceVariableAt(base, chipTarget.index, SLOT_MARK));
    }
    return slotOfMarked(insertBindingAt(base, SLOT_MARK, selectionRef.current));
  };
  const preview = (chosen: string, epoch: number): void => {
    const opened = openedRef.current;
    if (opened === undefined || epoch !== epochRef.current) {
      return;
    }
    openedRef.current = { ...opened, previewed: true };
    flushSync(() => draftTo(withChosen(chosen), 'preview'));
  };
  const restore = ({ when }: { readonly when: 'now' | 'batched' }): void => {
    epochRef.current += 1;
    const opened = openedRef.current;
    if (opened === undefined || !opened.previewed) {
      return;
    }
    openedRef.current = { ...opened, previewed: false };
    if (when === 'now') {
      flushSync(() => draftTo(opened.value, 'restore'));
    } else {
      draftTo(opened.value, 'restore');
    }
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => () => restoreRef.current({ when: 'batched' }), []);
  useExitRestore({ active: open || suggest !== undefined, restore: () => restoreRef.current({ when: 'now' }) });
  const openOnMountRef = useRef({ chip: props.initialChip, open: openChooser, disabled });
  openOnMountRef.current = { chip: props.initialChip, open: openChooser, disabled };
  useEffect(() => {
    const { chip, open: openNow, disabled: off } = openOnMountRef.current;
    if (chip !== undefined && off !== true) {
      setChipTarget(chip);
      openNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  const extraClassName = props.className ? ` ${props.className}` : '';
  const tokenClassName = showToken ? ' is-token' : '';
  return (
    <span
      ref={wrapRef}
      className={`embed-editor_varconnect${extraClassName}${tokenClassName}`}
      {...connectWrapperHandlers({ showToken, field, readCaret, onCaretMoved: refreshSuggest })}
      {...composeKeyDownCapture(
        bigEditorTriggers({
          disabled,
          big,
          expanded: props.expanded,
          open,
          wrapRef,
          liveValue,
          closedByThisPress: (press) => closedAtRef.current !== undefined && closedAtRef.current === press.timeStamp,
          onOpen: (rect, chip) => {
            bigChipRef.current = chip;
            bigSeedRef.current = customValueSeed({ own: liveValue(), declared: connect.declared });
            setBig(rect);
          },
        }),
        (event) => suggestKeyDown(event, { suggest, navigationRef, onDismiss: () => setSuggest(undefined) }),
      )}
      onInput={(event) => {
        readCaret();
        if (disabled || !(event.target instanceof Node) || !wrapRef.current?.contains(event.target)) {
          return;
        }
        setSuggest(typedAtSelection(liveValue(), selectionRef.current));
      }}
    >
      {field.prepared}
      {showToken ? (
        <ConnectTokenField
          connect={props}
          ariaLabel={ariaLabel}
          value={value}
          chips={applied.chips}
          chipOf={(reference) => referenceChip(reference, applied.vars)}
          chipText={chipText}
          hintValue={hintValue}
          field={field}
          editorRef={editorRef}
          setActive={connect.setActive}
          guard={{
            restoredValue: () => {
              const opened = openedRef.current;
              if (opened === undefined || !opened.previewed) {
                return undefined;
              }
              restore({ when: 'batched' });
              return opened.value;
            },
          }}
          onChip={(chip) => {
            if (open && chipTarget?.index === chip.index) {
              closeChooser();
              return;
            }
            setSuggest(undefined);
            setChipTarget(chip);
            if (!open) {
              openChooser();
            }
          }}
        />
      ) : undefined}
      {}
      {!applied.isVar || props.code === true ? (
        <ConnectDot
          dotRef={dotRef}
          disabled={disabled}
          ariaLabel={ariaLabel}
          open={open}
          onPress={readCaret}
          onToggle={() => {
            if (open) {
              closeChooser();
              return;
            }
            setChipTarget(undefined);
            setSuggest(undefined);
            openChooser();
          }}
        />
      ) : undefined}
      <ConnectPopups
        trigger={props.trigger}
        picker={pickerOf({ open, anchor, suggest, chipTarget, applied, navigationRef })}
        applied={applied}
        prop={prop}
        big={big}
        label={prop || ariaLabel}
        wrapRef={wrapRef}
        value={value}
        seed={bigSeedRef.current}
        onPick={pick}
        slot={open || suggest !== undefined ? pickSlot() : undefined}
        onPreview={preview}
        previewEpoch={() => epochRef.current}
        onPreviewEnd={(timing) => restore(timing)}
        onClosePicker={closeChooser}
        openChip={bigChipRef.current}
        onCloseBig={closeBig}
        onCancelBig={() => {
          setBig(undefined);
          editorRef.current?.focus();
        }}
        onSave={onPick}
      />
    </span>
  );
}

function useVariableConnect({ prop, code, canvasProperty, children }: VariableConnectProps) {
  const [open, setOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(false);
  const dotRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const ownValue = childValue(children);
  const declared = useDeclaredValue(canvasProperty !== undefined && ownValue === '' ? canvasProperty : '');
  const value = previewText ?? ownValue;
  useEffect(() => setPreviewText(undefined), [ownValue]);
  const placeholder = childPlaceholder(children);
  const hintValue = value === '' && /var\(/i.test(placeholder) ? placeholder : '';
  const applied = useAppliedVariable({ value: value || hintValue, open, focused: active, prop });
  const showToken = applied.isVar || active || !!code;
  const field = useWrappedField(children);
  const chipText = applied.binding ?? applied.varText;
  const liveValue = (): string => fieldLiveValue(editorRef, field.inputRef, chipText, value);
  const { selectionRef, readCaret } = useCaretTracker(editorRef, field.inputRef);
  const [chipTarget, setChipTarget] = useState<PressedChip | undefined>(undefined);
  const [suggest, setSuggest] = useState<TypedVariable | undefined>(undefined);
  const navigationRef = useRef<PickerNavigation | undefined>(undefined);
  const openedRef = useRef<{ readonly value: string; readonly previewed: boolean } | undefined>(undefined);
  const epochRef = useRef(0);
  const [big, setBig] = useState<DOMRect | undefined>(undefined);
  const bigChipRef = useRef<PressedChip | undefined>(undefined);
  const bigSeedRef = useRef<CustomValueSeed>({ text: '', source: 'none' });
  const wrapRef = useRef<HTMLSpanElement>(null);
  return {
    open,
    setOpen,
    setActive,
    dotRef,
    editorRef,
    value,
    applied,
    showToken,
    field,
    chipText,
    hintValue: applied.isVar ? hintValue : '',
    liveValue,
    selectionRef,
    readCaret,
    chipTarget,
    setChipTarget,
    suggest,
    setSuggest,
    navigationRef,
    openedRef,
    epochRef,
    setPreviewText,
    bigChipRef,
    bigSeedRef,
    declared,
    big,
    setBig,
    wrapRef,
  };
}

interface PreviewGuard {
  readonly restoredValue: () => string | undefined;
}

function ConnectTokenField({
  connect,
  ariaLabel,
  value,
  chips,
  chipOf,
  chipText,
  hintValue,
  field,
  editorRef,
  setActive,
  guard,
  onChip,
}: {
  connect: VariableConnectProps;
  chipOf: (reference: string) => Chip;
  guard: PreviewGuard;
  ariaLabel: string;
  value: string;
  chips: Chip[];
  chipText: string;
  hintValue: string;
  field: WrappedField;
  editorRef: RefObject<HTMLDivElement>;
  setActive: (active: boolean) => void;
  onChip: (chip: PressedChip) => void;
}) {
  const { disabled, code, stepMin } = connect;
  return (
    <>
      <TokenField
        value={value}
        chips={hintValue ? [] : chips}
        chipBare={chipText}
        chipVar={chipText}
        chipOf={chipOf}
        lineBreaks={isValidElement(connect.children) && connect.children.type === 'textarea' ? 'keep' : 'join'}
        onDraft={connect.onDraft ?? ((next) => pushDraft(field, next))}
        className={`${field.childClass} embed-editor_varconnect-editor`}
        ariaLabel={ariaLabel}
        placeholder={hintValue ? '' : childPlaceholder(connect.children)}
        {...(disabled === undefined ? {} : { disabled })}
        editorRef={editorRef}
        {...tokenFieldHandlers({ field, guard, setActive, disabled, onChip })}
        {...(code === undefined ? {} : { code })}
        {...(stepMin === undefined ? {} : { stepMin })}
      />
      {hintValue ? (
        <VariableHint
          value={hintValue}
          chips={chips}
          className={field.childClass}
          disabled={disabled ?? false}
          onPick={() => onChip({ index: 0, binding: chips[0]?.text ?? '' })}
        />
      ) : undefined}
    </>
  );
}

function ConnectPopups({
  picker,
  applied,
  prop,
  big,
  label,
  wrapRef,
  value,
  seed,
  onPick,
  slot,
  onPreview,
  previewEpoch,
  onPreviewEnd,
  onClosePicker,
  onCloseBig,
  onCancelBig,
  openChip,
  onSave,
  trigger,
}: {
  trigger: DOMRect | undefined;
  picker: PickerOpening | undefined;
  applied: ReturnType<typeof useAppliedVariable>;
  prop: string | undefined;
  big: DOMRect | undefined;
  label: string;
  wrapRef: RefObject<HTMLSpanElement>;
  value: string;
  seed: CustomValueSeed;
  onPick: (binding: string) => void;
  slot: ValueSlot | undefined;
  onPreview: (binding: string, epoch: number) => void;
  previewEpoch: () => number;
  onPreviewEnd: (timing: PreviewEndTiming) => void;
  onClosePicker: () => void;
  onCloseBig: () => void;
  onCancelBig: () => void;
  openChip: PressedChip | undefined;
  onSave: (value: string) => void;
}) {
  return (
    <>
      {picker ? (
        <VariablePicker
          anchor={picker.anchor}
          within={wrapRef.current ?? undefined}
          {...(trigger === undefined ? {} : { trigger })}
          vars={applied.vars}
          loading={applied.loading}
          {...(prop === undefined ? {} : { prop })}
          {...(picker.selectedBinding === undefined ? {} : { selectedBinding: picker.selectedBinding })}
          {...(picker.typing === undefined ? {} : { typing: picker.typing })}
          {...(slot === undefined ? {} : { slot })}
          onPreview={onPreview}
          previewEpoch={previewEpoch}
          onPreviewEnd={onPreviewEnd}
          onPick={onPick}
          onClose={onClosePicker}
        />
      ) : undefined}
      {big ? (
        <CustomValue
          connectField={connectCustomField}
          value={seed.text}
          label={label}
          prop={prop}
          anchor={big}
          anchorEl={wrapRef.current ?? undefined}
          onCancel={onCancelBig}
          {...(openChip === undefined ? {} : { openChip })}
          onSave={(next: string) => {
            onCloseBig();
            if (customValueWrites(seed, value, next)) {
              onSave(next);
            }
          }}
        />
      ) : undefined}
    </>
  );
}

function useAppliedVariable({ value, open, focused, prop }: { value: string; open: boolean; focused: boolean; prop: string | undefined }) {
  const raw = value.replace(/!\s*important\s*$/i, '').trim();
  const embedVar = raw.match(/var\(\s*--[A-Za-z0-9_-]+[^)]*\)/i)?.[0];
  const nativeNames = nativeVariableNames(raw);
  const nameLike = !embedVar && nativeNames.some((name) => name !== '' && /[A-Za-z]/.test(name) && !name.includes('(') && !/^[#.\d]/.test(name));
  const { vars, loading } = useSharedVars({ active: open || focused || !!embedVar || nameLike });
  const current = resolveVariable({ vars, embedVar, nameLike, nativeNames, prop });
  const isVar = !!embedVar || !!current;
  const binding = current?.binding ?? embedVar;
  const varText = embedVar ?? (current ? raw : '');
  const chips = valueChips({ raw, varText, vars, current, embedVar });
  return { vars, loading, isVar, binding, varText, chips };
}

function resolveVariable({
  vars,
  embedVar,
  nameLike,
  nativeNames,
  prop,
}: {
  vars: ProjectVariable[];
  embedVar: string | undefined;
  nameLike: boolean;
  nativeNames: string[];
  prop: string | undefined;
}): ProjectVariable | undefined {
  if (embedVar) {
    return vars.find((variable) => variable.binding === embedVar);
  }
  if (!nameLike) {
    return undefined;
  }
  const fullPath = (variable: ProjectVariable) => (variable.group ? `${variable.group}/${variable.name}` : variable.name);
  return vars.find((variable) => {
    if (!varTypeAllowed(prop, variable.type)) {
      return false;
    }
    const catalogNames = [...nativeVariableNames(variable.name), ...nativeVariableNames(fullPath(variable))];
    return nativeNames.some((name) => catalogNames.includes(name));
  });
}

export function referenceChip(reference: string, vars: readonly ProjectVariable[]): Chip {
  const known = vars.find((variable) => variable.binding === reference);
  return {
    text: reference,
    name: known?.name ?? bindingName(reference),
    type: known?.type ?? 'Size',
    ...(known === undefined ? {} : { value: known.value }),
  };
}

function valueChips({
  raw,
  varText,
  vars,
  current,
  embedVar,
}: {
  raw: string;
  varText: string;
  vars: ProjectVariable[];
  current: ProjectVariable | undefined;
  embedVar: string | undefined;
}): Chip[] {
  if (!varText) {
    return [];
  }
  const chips = [...raw.matchAll(VARIABLE_REFERENCE_PATTERN)].map((match) => referenceChip(match[0], vars));
  if (chips.length) {
    return chips;
  }
  const chipName = current?.name ?? (embedVar ? bindingName(embedVar) : raw);
  return [{ text: varText, name: chipName, type: current?.type ?? 'Size' }];
}

function useWrappedField(children: ReactNode) {
  const inputRef = useRef<FieldRefValue>(null);
  const child = isValidElement<ChildFieldProps>(children) ? children : undefined;
  const attachRef = (element: FieldRefValue) => {
    inputRef.current = element;
    if (child) {
      updateChildRef(child, element);
    }
  };
  const prepared = child ? cloneElement(child, { ref: attachRef }) : children;
  const childClass = child?.props.className ?? 'u-input';
  const childHandlers = child?.props;
  const childHandlersRef = useRef(childHandlers);
  childHandlersRef.current = childHandlers;
  const fakeEvent = () => ({
    preventDefault() {},
    stopPropagation() {},
    target: inputRef.current,
    currentTarget: inputRef.current,
  });
  return { inputRef, prepared, childClass, childHandlers, childHandlersRef, fakeEvent };
}

type WrappedField = ReturnType<typeof useWrappedField>;

function fieldLiveValue(editorRef: RefObject<HTMLDivElement>, inputRef: MutableRefObject<FieldRefValue>, chipText: string, value: string): string {
  const editor = editorRef.current;
  if (editor) {
    return serializeTokens(editor, chipText, chipText);
  }
  return inputRef.current?.value ?? value;
}

function pushDraft(field: WrappedField, next: string): void {
  const input = field.inputRef.current;
  if (!input) {
    return;
  }
  setInputValue(input, next);
  field.childHandlersRef.current?.onChange?.(field.fakeEvent());
}

function tokenFieldHandlers({
  field,
  guard,
  setActive,
  disabled,
  onChip,
}: {
  field: WrappedField;
  guard: PreviewGuard;
  setActive: (active: boolean) => void;
  disabled: boolean | undefined;
  onChip: (chip: PressedChip) => void;
}) {
  return {
    onFocusField: () => {
      setActive(true);
      field.childHandlers?.onFocus?.(field.fakeEvent());
    },
    onCommit: (shown: string) => {
      const final = guard.restoredValue() ?? shown;
      const input = field.inputRef.current;
      if (input) {
        if (input.value !== final) {
          flushSync(() => {
            setInputValue(input, final);
            field.childHandlersRef.current?.onChange?.(field.fakeEvent());
          });
        }
      }
      field.childHandlersRef.current?.onBlur?.(field.fakeEvent());
      setActive(false);
    },
    onChipClick: (chip: PressedChip) => {
      if (!disabled) {
        onChip(chip);
      }
    },
  };
}

function connectWrapperHandlers({
  showToken,
  field,
  readCaret,
  onCaretMoved,
}: {
  showToken: boolean;
  field: WrappedField;
  readCaret: () => void;
  onCaretMoved: (change: { readonly key: string | undefined }) => void;
}) {
  return {
    onMouseEnter: showToken ? (event: React.MouseEvent) => field.childHandlersRef.current?.onMouseEnter?.(event) : undefined,
    onMouseLeave: showToken ? (event: React.MouseEvent) => field.childHandlersRef.current?.onMouseLeave?.(event) : undefined,
    onKeyUp: (event: React.KeyboardEvent) => {
      readCaret();
      onCaretMoved({ key: event.key });
    },
    onMouseUp: () => {
      readCaret();
      onCaretMoved({ key: undefined });
    },
    onSelect: readCaret,
    onFocus: readCaret,
  };
}

function bigEditorTriggers({
  disabled,
  big,
  expanded,
  open,
  wrapRef,
  liveValue,
  closedByThisPress,
  onOpen,
}: {
  disabled: boolean | undefined;
  big: DOMRect | undefined;
  expanded: boolean | undefined;
  open: boolean;
  wrapRef: RefObject<HTMLSpanElement>;
  liveValue: () => string;
  closedByThisPress: (press: Event) => boolean;
  onOpen: (rect: DOMRect, chip: PressedChip | undefined) => void;
}) {
  const openBig = (chip?: PressedChip) => {
    const wrap = wrapRef.current;
    if (wrap) {
      onOpen(wrap.getBoundingClientRect(), chip);
    }
  };
  const chipAt = (target: EventTarget): PressedChip | undefined => {
    const field = wrapRef.current?.querySelector<HTMLElement>('.embed-editor_varconnect-editor');
    return field === null || field === undefined ? undefined : pressedChip(field, target);
  };
  return {
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      if (event.key === '=' && !disabled && !big && !expanded) {
        event.preventDefault();
        event.stopPropagation();
        openBig();
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && !disabled && !big && !expanded && !open) {
        const chip = chipAt(event.target);
        if (chip !== undefined && wrapRef.current !== null && doesNotFit(wrapRef.current, liveValue())) {
          event.preventDefault();
          event.stopPropagation();
          openBig(chip);
        }
      }
    },
    onMouseDownCapture: (event: React.MouseEvent) => {
      const target = event.target;
      if (closedByThisPress(event.nativeEvent)) {
        if (target instanceof Element && target.closest('.var-custom, .embed-editor_varpicker') === null) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (disabled || big || expanded || open) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest('.embed-editor_varconnect-dot, .embed-editor_varconnect-hint, ' + '.u-color-swatch, .embed-editor_varpicker, .var-custom')
      ) {
        return;
      }
      if (!wrapRef.current || !doesNotFit(wrapRef.current, liveValue())) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openBig(chipAt(event.target));
    },
  };
}

export function ConnectDot({
  dotRef,
  disabled,
  ariaLabel,
  open,
  onPress,
  onToggle,
}: {
  dotRef: React.RefObject<HTMLButtonElement>;
  disabled: boolean | undefined;
  ariaLabel: string;
  open: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      ref={dotRef}
      type="button"
      className="embed-editor_varconnect-dot"
      disabled={disabled}
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      onClick={onToggle}
    >
      <PlusIcon />
    </button>
  );
}

function useCaretTracker(editorRef: RefObject<HTMLDivElement>, inputRef: MutableRefObject<FieldRefValue>) {
  const selectionRef = useRef<ValueSelection | undefined>(undefined);
  const readCaret = () => {
    const editor = editorRef.current;
    if (!editor) {
      const input = inputRef.current;
      const start = input?.selectionStart;
      const end = input?.selectionEnd;
      selectionRef.current = typeof start === 'number' && typeof end === 'number' ? { start: Math.min(start, end), end: Math.max(start, end) } : undefined;
      return;
    }
    const selection = selectionOffsets(editor);
    if (selection === undefined) {
      return;
    }
    selectionRef.current = { start: serializedOffset(editor, selection.start), end: serializedOffset(editor, selection.end) };
  };
  return { selectionRef, readCaret };
}

const CARET_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete'];

function sameTyped(left: TypedVariable | undefined, right: TypedVariable | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.start === right.start && left.end === right.end && left.query === right.query;
}

const ZERO_WIDTH_SPACE = '\u200B';

function serializedOffset(editor: HTMLElement, at: number): number {
  const bindings = Array.from(editor.querySelectorAll<HTMLElement>('[data-chip]')).map((node) => node.dataset['binding'] ?? '');
  let length = 0;
  let chip = 0;
  for (const ch of fieldText(editor).slice(0, at)) {
    if (ch === CHIP_MARK) {
      length += (bindings[chip++] ?? '').length;
    } else if (ch !== ZERO_WIDTH_SPACE) {
      length += 1;
    }
  }
  return length;
}

interface PickerOpening {
  readonly anchor: HTMLElement;
  readonly selectedBinding: string | undefined;
  readonly typing: { readonly query: string; readonly navigationRef: MutableRefObject<PickerNavigation | undefined> } | undefined;
}

function pickerOf({
  open,
  anchor,
  suggest,
  chipTarget,
  applied,
  navigationRef,
}: {
  open: boolean;
  anchor: HTMLElement | undefined;
  suggest: TypedVariable | undefined;
  chipTarget: PressedChip | undefined;
  applied: ReturnType<typeof useAppliedVariable>;
  navigationRef: MutableRefObject<PickerNavigation | undefined>;
}): PickerOpening | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  if (suggest !== undefined) {
    return { anchor, selectedBinding: undefined, typing: { query: suggest.query, navigationRef } };
  }
  if (!open) {
    return undefined;
  }
  if (chipTarget !== undefined) {
    return { anchor, selectedBinding: chipTarget.binding || undefined, typing: undefined };
  }
  return { anchor, selectedBinding: applied.isVar ? applied.binding : undefined, typing: undefined };
}

function typedAtSelection(value: string, selection: ValueSelection | undefined): TypedVariable | undefined {
  if (selection === undefined) {
    return undefined;
  }
  if (selection.start !== selection.end) {
    return undefined;
  }
  if (selection.end > value.length) {
    return undefined;
  }
  return typedVariableAt(value, selection.end);
}

function suggestKeyDown(
  event: React.KeyboardEvent,
  {
    suggest,
    navigationRef,
    onDismiss,
  }: { suggest: TypedVariable | undefined; navigationRef: MutableRefObject<PickerNavigation | undefined>; onDismiss: () => void },
): void {
  if (suggest === undefined) {
    return;
  }
  const navigation = navigationRef.current;
  if (navigation === undefined) {
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    navigation.move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    if (navigation.pick()) {
      event.preventDefault();
      event.stopPropagation();
    } else {
      onDismiss();
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }
}

function composeKeyDownCapture<T extends { onKeyDownCapture: (event: React.KeyboardEvent) => void }>(
  handlers: T,
  first: (event: React.KeyboardEvent) => void,
): T {
  return {
    ...handlers,
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      first(event);
      if (!event.isPropagationStopped()) {
        handlers.onKeyDownCapture(event);
      }
    },
  };
}

function placeCaretAfterPick(
  editorRef: RefObject<HTMLDivElement>,
  inputRef: MutableRefObject<FieldRefValue>,
  completed: { readonly value: string; readonly caret: number },
): void {
  requestAnimationFrame(() => {
    const editor = editorRef.current;
    if (editor !== null && editor.isConnected) {
      editor.focus();
      setCaretOffset(editor, fieldOffsetOf(completed.value, completed.caret));
      return;
    }
    const input = inputRef.current;
    if (input !== null && 'setSelectionRange' in input && input.isConnected) {
      input.focus();
      input.setSelectionRange(completed.caret, completed.caret);
    }
  });
}
