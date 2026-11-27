import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import VariableConnect from '../VariableConnect';
import { handleArrowStep } from '../model/numberStep';
import { commitInPlace } from '../model/commitStyleInPlace';
import useScrub from './useScrub';


type LiveInputProps = {
  value: string;
  busy: boolean;
  readOnly?: boolean;
  ariaLabel: string;
  placeholder?: string;
  prop: string;
  suffix?: ReactNode;
  min?: number;
  wrapClassName?: string;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
  onVariablePick?: (binding: string) => void;
};

export default function LiveInput({
  value,
  busy,
  readOnly = false,
  ariaLabel,
  placeholder,
  prop,
  suffix,
  min,
  wrapClassName = 'embed-editor_field',
  onLive,
  onCommit,
  onVariablePick,
}: LiveInputProps) {
  const translate = useTranslate();
  const { draft, setDraft, focused, cancelLive, scheduleLive, settleLive } = useLiveDraft(value, onLive);
  const commitScrub = (text: string) => {
    setDraft(text);
    settleLive();
    onCommit(text);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy || readOnly,
    onPreview: setDraft,
    onInput: onLive,
    onCommit: commitScrub,
  });
  return (
    <div className={wrapClassName}>
      <VariableConnect
        code
        className="is-fill"
        ariaLabel={translate('styleModel.shared.connectVariable', { label: ariaLabel })}
        disabled={busy}
        prop={prop}
        canvasProperty={prop}
        onPick={(binding) => {
          cancelLive();
          settleLive();
          setDraft(binding);
          (onVariablePick ?? onCommit)(binding);
        }}
      >
        <input
          {...scrub.input}
          className="u-input embed-editor_size-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            scheduleLive(event.target.value);
          }}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            cancelLive();
            settleLive();
            onCommit(draft);
          }}
          onKeyDown={(event) => {
            const stepped = keyDownStep(event, min);
            if (stepped !== undefined) {
              setDraft(stepped);
              scheduleLive(stepped);
            }
          }}
          disabled={busy}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={placeholder ?? '0'}
          aria-label={ariaLabel}
        />
      </VariableConnect>
      {suffixSpan(suffix)}
    </div>
  );
}

function suffixSpan(suffix: ReactNode): ReactNode {
  const shown = suffix ?? undefined;
  return shown !== undefined ? <span className="embed-editor_field-suffix">{shown}</span> : undefined;
}

function keyDownStep(event: KeyboardEvent<HTMLInputElement>, min: number | undefined): string | undefined {
  if (event.key === 'Enter') {
    commitInPlace(event.currentTarget);
    return undefined;
  }
  const stepped = handleArrowStep(event, min);
  if (!stepped) {
    return undefined;
  }
  event.preventDefault();
  const element = event.currentTarget;
  element.value = stepped.text;
  element.setSelectionRange(stepped.caret, stepped.caret);
  return stepped.text;
}

function useLiveDraft(value: string, onLive: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const liveTimer = useRef<number | undefined>(undefined);
  const pendingText = useRef<string | undefined>(undefined);
  const liveSent = useRef<string | undefined>(undefined);
  const latest = useRef({ value, onLive });
  latest.current = { value, onLive };
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  const cancelLive = useCallback(() => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
    pendingText.current = undefined;
  }, []);
  useEffect(
    () => () => {
      const text = pendingText.current;
      const settled = text !== undefined && text === latest.current.value;
      cancelLive();
      if (settled) {
        latest.current.onLive(text);
      } else if (liveSent.current !== undefined && liveSent.current !== latest.current.value) {
        latest.current.onLive(latest.current.value);
      }
      liveSent.current = undefined;
    },
    [cancelLive],
  );
  const settleLive = useCallback(() => {
    liveSent.current = undefined;
  }, []);
  const scheduleLive = (text: string) => {
    cancelLive();
    pendingText.current = text;
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      pendingText.current = undefined;
      liveSent.current = text;
      onLive(text);
    }, 100);
  };
  return { draft, setDraft, focused, cancelLive, scheduleLive, settleLive };
}
