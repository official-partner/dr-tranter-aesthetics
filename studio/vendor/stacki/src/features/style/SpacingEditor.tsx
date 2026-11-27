import { centralIcon } from '../../ui/central/CentralIcon';
import { more as centralMore } from '../../ui/central/centralGeometry';
import Popup from '../../ui/Popup';

const MoreGlyph = centralIcon(centralMore, 12);

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import useScrub from './components/useScrub';
import { handleArrowStep } from './model/numberStep';
import { isNonNegative } from './model/cssProperties';
import { hasOwnedPopup, inOwnedPopup } from '../../ui/popupOwnership';
import ProvenanceList from './ProvenanceList';
import VariableConnect from './VariableConnect';
import { settleCaretAfterChips } from './TokenField';
import { type ResolvedProp } from './model/resolved';
import { useDebouncedLive } from './model/fieldHooks';
import { parseImportant } from './model/styleDisplay';
import { type SetProp, type ClearProp, type LiveSetProp, type Read, type SelectSelector, type Side, displayOf } from './spacingTypes';
import { affectedSides, siblingProps } from './SpacingFill';
import { withImportant } from './spacingValue';
import { humanLabel } from './SpacingLabel';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { useStyleHint } from './model/computedStyle';

export function SpacingEditor(props: SpacingEditorProps) {
  const { prop, placeholder, read, onSelectSelector, onClose } = props;
  const translate = useTranslate();
  const editor = useSpacingEditor(props);
  const computed = useStyleHint(read(prop) === undefined ? prop : '');
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={editor.close}
      onEscape={editor.abandon}
      className="embed-editor_spacing-popover"
      ref={editor.rootRef}
      onMouseDown={(event) => {
        const target = event.target;
        if (target === editor.inputRef.current) {
          return;
        }
        if (target instanceof Element && target.closest('.embed-editor_varconnect')) {
          return;
        }
        event.preventDefault();
      }}
      onKeyDownCapture={editor.keyDownCapture}
    >
      <div className="embed-editor_spacing-popover-row">
        <span className="embed-editor_spacing-popover-label" {...editor.scrub.label}>
          {humanLabel(prop, translate)}
        </span>
        <VariableConnect
          code
          {...(isNonNegative(prop) ? { stepMin: 0 } : {})}
          ariaLabel={translate('style.spacingEditor.connect', { name: humanLabel(prop, translate) })}
          disabled={false}
          prop={prop}
          canvasProperty={prop}
          onPick={editor.pick}
        >
          <input
            {...editor.scrub.input}
            ref={editor.inputRef}
            className={`u-input embed-editor_spacing-editor`}
            value={editor.draft}
            placeholder={computed || placeholder}
            onChange={(event) => editor.change(event.target.value)}
            onBlur={editor.blur}
            onKeyDown={editor.keyDown}
            spellCheck={false}
            aria-label={prop}
          />
        </VariableConnect>
      </div>
      {}
      <ProvenanceList
        contributors={read(prop)?.contributors ?? []}
        prop={prop}
        onSelect={(selector, selectorProp) => {
          onSelectSelector(selector, selectorProp);
          onClose();
        }}
      />
      <SpacingResetButton onReset={editor.reset} />
    </Popup>
  );
}

export type SpacingEditorProps = {
  prop: string;
  side: Side;
  placeholder: string;
  read: Read;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
  onSelectSelector: SelectSelector;
  onClose: () => void;
  onSameLabelPress: () => void;
  registerCommit: (commit: (() => void) | undefined) => void;
};

export function SpacingResetButton({ onReset }: { onReset: () => void }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className="u-field-label-menu-item embed-editor_spacing-reset"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        onReset();
      }}
    >
      <MoreGlyph className="u-field-label-menu-icon" />
      <span>{translate('ui.reset')}</span>
      <span className="u-field-label-menu-shortcut">{translate('style.spacingEditor.optionClick')}</span>
    </button>
  );
}

export function useSpacingEditor({ prop, side, read, setProp, clearProp, liveSetProp, onClose, registerCommit }: SpacingEditorProps) {
  const external = spacingExternal(read(prop));
  const { draft, draftRef, setDraftValue } = useEditorDraft(external);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEditorFocus(rootRef, inputRef);
  const { cancelLive, liveNow, scheduleLive } = useDebouncedLive((value, important) => liveSetProp(prop, value, important));
  const commit = useSpacingCommit({ prop, side, external, draftRef, setProp, clearProp });
  const close = () => {
    if (commit.close()) {
      cancelLive();
      onClose();
    }
  };
  const abandon = () => {
    cancelLive();
    commit.abandon();
    onClose();
  };
  useRegisteredCommit({ commit, cancelLive }, registerCommit);
  const scrub = useScrub({
    value: draft,
    onPreview: setDraftValue,
    onInput: liveNow,
    onCommit: setDraftValue,
  });
  const handlers = spacingEditorHandlers({
    prop,
    commit,
    rootRef,
    setDraftValue,
    scheduleLive,
    cancelLive,
    close,
    abandon,
    setProp,
    clearProp,
    onClose,
  });
  return { draft, rootRef, inputRef, scrub, close, abandon, ...handlers };
}

function useRegisteredCommit(
  editor: { readonly commit: ReturnType<typeof useSpacingCommit>; readonly cancelLive: () => void },
  registerCommit: SpacingEditorProps['registerCommit'],
): void {
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    const commitDraft = (): void => {
      if (editorRef.current.commit.close()) {
        editorRef.current.cancelLive();
      }
    };
    registerCommit(commitDraft);
    return () => registerCommit(undefined);
  }, [registerCommit]);
}

export function spacingEditorHandlers({
  prop,
  commit,
  rootRef,
  setDraftValue,
  scheduleLive,
  cancelLive,
  close,
  abandon,
  setProp,
  clearProp,
  onClose,
}: {
  prop: string;
  commit: ReturnType<typeof useSpacingCommit>;
  rootRef: React.RefObject<HTMLDivElement>;
  setDraftValue: (text: string) => void;
  scheduleLive: (text: string) => void;
  cancelLive: () => void;
  close: () => void;
  abandon: () => void;
  setProp: SetProp;
  clearProp: ClearProp;
  onClose: () => void;
}) {
  return {
    keyDownCapture: (event: ReactKeyboardEvent) => {
      const recorded = commit.recordKey(event);
      if (recorded === 'abandon') {
        abandon();
      } else if (recorded === 'commit' && event.target instanceof HTMLElement && event.target.isContentEditable) {
        event.preventDefault();
        event.stopPropagation();
        event.target.blur();
      }
    },
    keyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const recorded = commit.recordKey(event);
      if (recorded === 'commit') {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (recorded === 'abandon') {
        abandon();
        return;
      }
      const stepped = stepSpacingKey(event, prop);
      if (stepped !== undefined) {
        setDraftValue(stepped);
        scheduleLive(stepped);
      }
    },
    change: (text: string) => {
      setDraftValue(text);
      scheduleLive(text);
    },
    pick: (binding: string) => {
      setDraftValue(binding);
      commit.rebase(binding);
      const parsed = parseImportant(binding);
      setProp(prop, parsed.value, parsed.important);
    },
    blur: () => closeUnlessInPopup(rootRef, close),
    reset: () => {
      commit.abandon();
      cancelLive();
      clearProp(prop);
      onClose();
    },
  };
}

export function closeUnlessInPopup(rootRef: React.RefObject<HTMLDivElement>, close: () => void): void {
  window.setTimeout(() => {
    if (hasOwnedPopup(rootRef.current ?? undefined)) {
      return;
    }
    if (inOwnedPopup(document.activeElement ?? undefined, rootRef.current ?? undefined)) {
      return;
    }
    close();
  }, 0);
}

export function spacingExternal(resolved: ResolvedProp | undefined): string {
  const display = displayOf(resolved);
  return display.present ? withImportant(display) : '';
}

export function useEditorDraft(external: string) {
  const [draft, setDraft] = useState(external);
  const draftRef = useRef(draft);
  const setDraftValue = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };
  return { draft, draftRef, setDraftValue };
}

export function useSpacingCommit({
  prop,
  side,
  external,
  draftRef,
  setProp,
  clearProp,
}: {
  prop: string;
  side: Side;
  external: string;
  draftRef: React.MutableRefObject<string>;
  setProp: SetProp;
  clearProp: ClearProp;
}) {
  const closed = useRef(false);
  const originalRef = useRef(external);
  const commitRequested = useRef(false);
  const commitProps = useRef<string[]>([prop]);
  return {
    close: (): boolean => {
      if (closed.current) {
        return false;
      }
      closed.current = true;
      const trimmed = draftRef.current.trim();
      const changed = trimmed !== originalRef.current.trim();
      if (commitRequested.current || changed) {
        const props = commitProps.current;
        if (!trimmed) {
          clearProp(props);
        } else {
          const parsed = parseImportant(trimmed);
          props.forEach((target) => setProp(target, parsed.value, parsed.important));
        }
      }
      return true;
    },
    abandon: () => {
      closed.current = true;
    },
    rebase: (value: string) => {
      originalRef.current = value;
    },
    recordKey: (event: { key: string; shiftKey: boolean; altKey: boolean }): 'commit' | 'abandon' | 'none' => {
      if (event.key === 'Enter') {
        commitRequested.current = true;
        commitProps.current = siblingProps(prop, side, affectedSides(side, event));
        return 'commit';
      }
      if (event.key === 'Escape') {
        return 'abandon';
      }
      commitProps.current = [prop];
      return 'none';
    },
  };
}

export function useEditorFocus(rootRef: React.RefObject<HTMLDivElement>, inputRef: React.RefObject<HTMLInputElement>): void {
  useEffect(() => {
    const rich = rootRef.current?.querySelector<HTMLElement>('.embed-editor_varconnect-editor');
    if (rich) {
      rich.focus();
      if (settleCaretAfterChips(rich)) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(rich);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [rootRef, inputRef]);
}

export function stepSpacingKey(event: ReactKeyboardEvent<HTMLInputElement>, prop: string): string | undefined {
  const stepped = handleArrowStep(event, isNonNegative(prop) ? 0 : undefined);
  if (!stepped) {
    return undefined;
  }
  event.preventDefault();
  const input = event.currentTarget;
  input.value = stepped.text;
  input.setSelectionRange(stepped.caret, stepped.caret);
  return stepped.text;
}
