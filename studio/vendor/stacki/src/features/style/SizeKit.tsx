
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import FieldLabel from './components/FieldLabel';
import { PropTip, ProvenanceLabel } from './components/CssPropertyTip';
import useScrub, { type ScrubHandlers } from './components/useScrub';
import { handleArrowStep } from './model/numberStep';
import { useFieldDraft } from './model/fieldDraft';
import ProvenanceList from './ProvenanceList';
import VariableConnect from './VariableConnect';
import type { Contributor, ResolvedProp } from './model/resolved';
import { commitInPlace } from './model/commitStyleInPlace';
import { followWhileRendering, useDebouncedLive } from './model/fieldHooks';
import { displayOf, displayText, keepImportant, parseImportant, withImportant, type Display } from './model/styleDisplay';
import { useStyleHint } from './model/computedStyle';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';

export type SetProp = (prop: string, value: string, important: boolean) => void;
export type ClearProp = (prop: string | string[]) => void;
export type LiveSetProp = (prop: string, value: string | undefined, important: boolean) => void;
export type Read = (prop: string) => ResolvedProp | undefined;

export type Props = {
  read: Read;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
};

export function SizeLabel({
  label,
  prop,
  display,
  contributors,
  busy,
  scrubProps,
  onClear,
  onProvenance,
  onSelectSelector,
}: {
  label: string;
  prop: string;
  display: Display;
  contributors: Contributor[];
  busy: boolean;
  scrubProps?: ScrubHandlers;
  onClear: () => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  if (display.present && !display.isSelected) {
    return <ProvenanceLabel label={label} props={[prop]} busy={busy} onProvenance={onProvenance} />;
  }
  return (
    <FieldLabel
      className={`embed-editor_size-label ${display.overridden ? 'is-overridden' : ''}`}
      active={display.isSelected}
      {...(display.present ? {} : { inheritedProp: prop })}
      disabled={busy}
      onReset={onClear}
      resetLabel={translate('style.sizeKit.clear')}
      tooltip={<PropTip props={[prop]} />}
      {...(display.overridden ? { title: translate('style.sizeKit.overriddenBy', { selector: display.winnerSelector }) } : {})}
      menuNote={(close) => (
        <ProvenanceList
          contributors={contributors}
          prop={prop}
          onSelect={(selector, selectorProp) => {
            onSelectSelector(selector, selectorProp);
            close();
          }}
        />
      )}
      {...(scrubProps === undefined ? {} : { scrubProps })}
    >
      {label}
    </FieldLabel>
  );
}


export function LivePropField({
  prop,
  label,
  placeholder,
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: {
  prop: string;
  label: string;
  placeholder: string;
} & Props) {
  const translate = useTranslate();
  const display = displayOf(read(prop));
  const field = useLivePropEditing({ prop, display, busy, setProp, clearProp, liveSetProp });
  const computed = useStyleHint(display.present ? '' : prop);
  return (
    <>
      <SizeLabel
        label={label}
        prop={prop}
        display={display}
        contributors={read(prop)?.contributors ?? []}
        busy={busy}
        scrubProps={field.scrub.label}
        onClear={field.clear}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <VariableConnect
        code
        ariaLabel={translate('style.sizeKit.connect', { name: label })}
        disabled={busy}
        prop={prop}
        canvasProperty={prop}
        onPick={(binding) => {
          const kept = keepImportant(binding, display);
          setProp(prop, kept.value, kept.important);
        }}
      >
        <input
          {...field.scrub.input}
          className="u-input embed-editor_size-input"
          data-prop={prop}
          value={field.draft}
          onChange={(event) => field.change(event.target.value)}
          onFocus={field.focus}
          onBlur={field.blur}
          onKeyDown={field.keyDown}
          disabled={busy}
          spellCheck={false}
          placeholder={prop === 'width' || prop === 'height' ? 'auto' : computed || placeholder}
          aria-label={label}
        />
      </VariableConnect>
    </>
  );
}

export function useLivePropEditing({
  prop,
  display,
  busy,
  setProp,
  clearProp,
  liveSetProp,
}: {
  prop: string;
  display: Display;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
}) {
  const external = displayText(display);
  const { draft, setDraft, focused, cleared } = useFieldDraft(external, { busy });
  const { cancelLive, liveNow, scheduleLive } = useDebouncedLive((value, important) => liveSetProp(prop, value, important));
  const commit = (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) {
      clearProp(prop);
      return;
    }
    const parsed = parseImportant(trimmed);
    setProp(prop, parsed.value, parsed.important);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: liveNow,
    onCommit: (text) => {
      setDraft(text);
      commit(text);
    },
  });
  return {
    draft,
    scrub,
    clear: () => {
      cleared();
      clearProp(prop);
    },
    change: (text: string) => {
      setDraft(text);
      scheduleLive(text);
    },
    focus: () => {
      focused.current = true;
    },
    blur: () => {
      focused.current = false;
      cancelLive();
      commit();
    },
    keyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const stepped = stepSizeKey(event);
      if (stepped !== undefined) {
        setDraft(stepped);
        scheduleLive(stepped);
      }
    },
  };
}


export { withImportant };

export function useFollowingDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  followWhileRendering(useState(value), value, () => {
    if (!focused.current) {
      setDraft(value);
    }
  });
  return { draft, setDraft, focused };
}

export function stepSizeKey(event: ReactKeyboardEvent<HTMLInputElement>): string | undefined {
  if (event.key === 'Enter') {
    commitInPlace(event.currentTarget);
    return undefined;
  }
  const stepped = handleArrowStep(event);
  if (!stepped) {
    return undefined;
  }
  event.preventDefault();
  const input = event.currentTarget;
  input.value = stepped.text;
  input.setSelectionRange(stepped.caret, stepped.caret);
  return stepped.text;
}

export const LENGTH_FIELDS: ReadonlyArray<{ prop: string; labelKey: MessageKey; placeholder: string }> = [
  { prop: 'width', labelKey: 'style.sizeKit.width', placeholder: 'Auto' },
  { prop: 'height', labelKey: 'style.sizeKit.height', placeholder: 'Auto' },
  { prop: 'min-width', labelKey: 'style.sizeKit.minWidth', placeholder: '0px' },
  { prop: 'min-height', labelKey: 'style.sizeKit.minHeight', placeholder: '0px' },
  { prop: 'max-width', labelKey: 'style.sizeKit.maxWidth', placeholder: 'None' },
  { prop: 'max-height', labelKey: 'style.sizeKit.maxHeight', placeholder: 'None' },
];
