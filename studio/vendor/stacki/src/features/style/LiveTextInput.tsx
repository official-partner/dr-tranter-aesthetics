
import { useEffect, useRef, useState } from 'react';
import useScrub from './components/useScrub';
import { handleArrowStep } from './model/numberStep';
import { followWhileRendering } from './model/fieldHooks';
import VariableConnect from './VariableConnect';
import { commitInPlace } from './model/commitStyleInPlace';
import { parseImportant } from './model/styleDisplay';
import { useStyleHint } from './model/computedStyle';
import { useTranslate } from '../../lib/i18n/useTranslate';


export function LiveInput({
  value,
  busy,
  placeholder,
  ariaLabel,
  className,
  dataProp,
  prop,
  inputRef,
  autoFocus,
  onCommit,
  onLiveCommit,
  onClear,
}: LiveInputProps) {
  const translate = useTranslate();
  const field = useLiveInputEditing({ value, busy, onCommit, onLiveCommit, onClear });
  const canvasProperty = prop ?? dataProp;
  const computed = useStyleHint(value.trim() ? '' : (prop ?? ''));
  return (
    <VariableConnect
      code
      ariaLabel={translate('style.liveTextInput.connect', { name: ariaLabel || translate('style.liveTextInput.value') })}
      disabled={busy}
      {...(prop === undefined ? {} : { prop })}
      {...(canvasProperty === undefined ? {} : { canvasProperty })}
      onPick={(binding) => onCommit(binding, false)}
    >
      <input
        {...field.scrub.input}
        ref={inputRef}
        className={className}
        data-prop={dataProp}
        value={field.draft}
        onChange={(event) => field.change(event.target.value)}
        onFocus={field.focus}
        onBlur={field.blur}
        onKeyDown={field.keyDown}
        disabled={busy}
        spellCheck={false}
        placeholder={computed || placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </VariableConnect>
  );
}

export type LiveInputProps = {
  value: string;
  busy: boolean;
  placeholder?: string;
  ariaLabel: string;
  className: string;
  dataProp?: string;
  prop?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
  autoFocus?: boolean;
  onCommit: (value: string, important: boolean) => void;
  onLiveCommit?: (value: string, important: boolean) => void;
  onClear: () => void;
};

export function useLiveInputEditing({
  value,
  busy,
  onCommit,
  onLiveCommit,
  onClear,
}: Pick<LiveInputProps, 'value' | 'busy' | 'onCommit' | 'onClear'> & {
  onLiveCommit: LiveInputProps['onLiveCommit'] | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  followWhileRendering(useState(value), value, () => {
    if (!focused.current) {
      setDraft(value);
    }
  });
  const wrote = useRef(false);
  const edited = useRef(false);
  const trackedLive =
    onLiveCommit === undefined
      ? undefined
      : (...written: Parameters<NonNullable<LiveInputProps['onLiveCommit']>>): void => {
          wrote.current = true;
          onLiveCommit(...written);
        };
  const { cancelLive, liveNow, scheduleLive } = useDebouncedLive(trackedLive);
  const commit = (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) {
      onClear();
      return;
    }
    const parsed = parseImportant(trimmed);
    onCommit(parsed.value, parsed.important);
  };
  const settle = (): void => {
    wrote.current = false;
    edited.current = false;
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: liveNow,
    onCommit: (text) => {
      setDraft(text);
      settle();
      commit(text);
    },
  });
  return {
    draft,
    scrub,
    change: (text: string) => {
      setDraft(text);
      edited.current = true;
      scheduleLive(text);
    },
    focus: () => {
      focused.current = true;
    },
    blur: () => {
      focused.current = false;
      cancelLive();
      if (!edited.current && !wrote.current) {
        return;
      }
      settle();
      commit();
    },
    keyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      const stepped = stepLiveKey(event);
      if (stepped !== undefined) {
        edited.current = true;
        setDraft(stepped);
        scheduleLive(stepped);
      }
    },
  };
}

export function useDebouncedLive(write: ((value: string, important: boolean) => void) | undefined) {
  const liveTimer = useRef<number | undefined>(undefined);
  const cancelLive = () => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
  };
  useEffect(() => cancelLive, []);
  const liveNow = (text: string) => {
    if (!write) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const parsed = parseImportant(trimmed);
    write(parsed.value, parsed.important);
  };
  const scheduleLive = (text: string) => {
    if (!write) {
      return;
    }
    cancelLive();
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      liveNow(text);
    }, 100);
  };
  return { cancelLive, liveNow, scheduleLive };
}

export function stepLiveKey(event: React.KeyboardEvent<HTMLInputElement>): string | undefined {
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
