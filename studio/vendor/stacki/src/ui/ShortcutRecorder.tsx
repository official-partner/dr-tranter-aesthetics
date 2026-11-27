import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { assert } from '../../shared/core/assert';
import { shortcutOfPress, type AppKeyPress } from '../../shared/properties/appShortcuts';
import { ResetIcon } from './Icons';
import './shortcutRecorder.css';
import { useTranslate } from '../lib/i18n/useTranslate';

export type ShortcutPlatform = 'mac' | 'other';

export interface ShortcutRules {
  readonly hint: string;
  readonly accepts: (shortcut: string) => boolean;
  readonly conflict: (shortcut: string) => string | undefined;
}

export interface ShortcutRecorderProps extends ShortcutRules {
  readonly ariaLabel: string;
  readonly value: string | undefined;
  readonly emptyLabel: string;
  readonly platform: ShortcutPlatform;
  readonly format: (shortcut: string) => string;
  readonly reset: { readonly label: string; readonly onReset: () => void } | undefined;
  readonly onClear: () => void;
  readonly onChange: (shortcut: string) => void;
}

export type RecorderStep =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'pass' }
  | { readonly kind: 'refuse'; readonly hint: string }
  | { readonly kind: 'record'; readonly shortcut: string };

type RecorderState = { readonly kind: 'idle' } | { readonly kind: 'recording'; readonly hint: string | undefined };

const MODIFIER_KEYS: readonly string[] = ['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'OS'];
const RECORDING_ATTRIBUTE = 'data-shortcut-recording';

export function isShortcutRecorderTarget(target: unknown): boolean {
  if (target instanceof Element) {
    return target.closest(`[${RECORDING_ATTRIBUTE}="true"]`) !== null;
  }
  return false;
}

export function recorderStep(press: AppKeyPress, platform: ShortcutPlatform, rules: ShortcutRules): RecorderStep {
  assert(rules.hint.length > 0, 'A recorder has a hint to show');
  if (MODIFIER_KEYS.includes(press.key)) {
    return { kind: 'wait' };
  }
  const modified = press.metaKey || press.ctrlKey || press.altKey || press.shiftKey;
  if (!modified) {
    if (press.key === 'Escape') {
      return { kind: 'cancel' };
    }
    if (press.key === 'Backspace' || press.key === 'Delete') {
      return { kind: 'clear' };
    }
    if (press.key === 'Tab') {
      return { kind: 'pass' };
    }
  }
  if (platform === 'mac') {
    if (press.ctrlKey) {
      return { kind: 'refuse', hint: rules.hint };
    }
  } else {
    if (press.metaKey) {
      return { kind: 'refuse', hint: rules.hint };
    }
  }
  const shortcut = shortcutOfPress(press);
  if (shortcut === undefined) {
    return { kind: 'refuse', hint: rules.hint };
  }
  if (!rules.accepts(shortcut)) {
    return { kind: 'refuse', hint: rules.hint };
  }
  const conflict = rules.conflict(shortcut);
  if (conflict !== undefined) {
    assert(conflict.length > 0, 'A conflict says what holds the key');
    return { kind: 'refuse', hint: conflict };
  }
  return { kind: 'record', shortcut };
}

export function ShortcutRecorder(props: ShortcutRecorderProps) {
  const translate = useTranslate();
  assert(props.ariaLabel.length > 0, 'A shortcut field is labelled');
  assert(props.emptyLabel.length > 0, 'A shortcut field says what having no key means');
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const recording = state.kind === 'recording';
  const hint = state.kind === 'recording' ? state.hint : undefined;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (state.kind === 'idle') {
      return;
    }
    const step = recorderStep(event.nativeEvent, props.platform, props);
    if (step.kind === 'pass') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (step.kind) {
      case 'wait':
        return;
      case 'cancel':
        setState({ kind: 'idle' });
        return;
      case 'clear':
        setState({ kind: 'idle' });
        props.onClear();
        return;
      case 'refuse':
        setState({ kind: 'recording', hint: step.hint });
        return;
      case 'record':
        setState({ kind: 'idle' });
        props.onChange(step.shortcut);
        return;
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
  };
  return (
    <span className="shortcut-recorder">
      <span className="shortcut-recorder-controls">
        <button
          type="button"
          className="shortcut-recorder-field"
          aria-label={props.ariaLabel}
          data-shortcut-recording={recording ? 'true' : 'false'}
          data-empty={props.value === undefined ? 'true' : undefined}
          onClick={() => setState({ kind: 'recording', hint: undefined })}
          onBlur={() => setState({ kind: 'idle' })}
          onKeyDown={onKeyDown}
        >
          {recording ? translate('ui.shortcutRecorder.pressKeys') : props.value === undefined ? props.emptyLabel : props.format(props.value)}
        </button>
        {props.reset !== undefined && (
          <button
            type="button"
            className="shortcut-recorder-reset"
            aria-label={props.reset.label}
            title={props.reset.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={props.reset.onReset}
          >
            <ResetIcon size={12} />
          </button>
        )}
      </span>
      {hint !== undefined && (
        <span className="shortcut-recorder-hint" role="status">
          {hint}
        </span>
      )}
    </span>
  );
}
