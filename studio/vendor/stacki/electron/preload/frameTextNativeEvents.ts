import type { createTextBuffer } from './frameTextBuffer';
import { CANVAS_LINE_END, type CanvasTextBreaks } from '../../shared/properties/canvasText';
import { runsSelection, selectRunsOffsets, type TextSpace } from './frameTextSelection';

interface NativeTextOptions {
  readonly root: HTMLElement;
  readonly space: TextSpace;
  readonly buffer: NonNullable<ReturnType<typeof createTextBuffer>>;
  readonly finish: (action: 'apply' | 'cancel') => void;
  readonly breaks: CanvasTextBreaks | undefined;
  readonly refused: () => void;
}

export function installNativeTextEvents(options: NativeTextOptions) {
  const controller = new AbortController();
  let pressed = false;
  const listener = { capture: true, signal: controller.signal };
  const composing = installCompositionEvents(options, listener);
  const owns = (event: Event) => event.target instanceof Node && options.root.contains(event.target);
  window.addEventListener(
    'mousedown',
    (event) => {
      pressed = owns(event);
    },
    listener,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (owns(event)) {
        nativeTextKey(options, event);
      }
    },
    listener,
  );
  window.addEventListener(
    'beforeinput',
    (event) => {
      if (!owns(event) || !(event instanceof InputEvent)) {
        return;
      }
      event.stopImmediatePropagation();
      if (composing.beforeInput()) {
        return;
      }
      event.preventDefault();
      nativeTextInput(options, event);
    },
    listener,
  );
  window.addEventListener('paste', (event) => nativeTextPaste(options, event), listener);
  window.addEventListener('cut', (event) => nativeTextCut(options, event), listener);
  options.root.addEventListener('blur', () => options.finish('apply'), listener);
  window.addEventListener('blur', () => options.finish('apply'), { signal: controller.signal });
  return {
    cleanup: () => controller.abort(),
    pressed: () => pressed,
  };
}

function installCompositionEvents(options: NativeTextOptions, listener: AddEventListenerOptions) {
  let composing = false;
  let nativePending = false;
  const owns = (event: Event) => event.target instanceof Node && options.root.contains(event.target);
  window.addEventListener(
    'input',
    (event) => {
      if (!owns(event)) {
        return;
      }
      event.stopImmediatePropagation();
      if (!composing || !options.buffer.composition()) {
        if (nativePending) {
          options.buffer.rollbackNative();
        }
        options.finish('cancel');
      }
      nativePending = false;
    },
    listener,
  );
  window.addEventListener(
    'compositionstart',
    (event) => {
      if (owns(event)) {
        const selection = runsSelection(options.space.runs);
        composing = !!selection && !options.buffer.crosses(selection) && options.buffer.intact();
        if (!composing) {
          options.finish('cancel');
        }
      }
    },
    listener,
  );
  window.addEventListener(
    'compositionend',
    (event) => {
      if (owns(event)) {
        composing = false;
        const selection = runsSelection(options.space.runs);
        if (selection && options.buffer.composition()) {
          options.buffer.remember(selection);
        } else {
          options.finish('cancel');
        }
      }
    },
    listener,
  );
  return {
    beforeInput: () => {
      nativePending = composing && !!runsSelection(options.space.runs) && options.buffer.intact();
      return nativePending;
    },
  };
}

function nativeTextKey(options: NativeTextOptions, event: KeyboardEvent): void {
  event.stopImmediatePropagation();
  if (event.isComposing) {
    return;
  }
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && key === 'a') {
    event.preventDefault();
    selectRunsOffsets(options.space.runs, options.buffer.primaryRange());
  } else if (modifier && (key === 'z' || key === 'y')) {
    event.preventDefault();
    options.buffer.history(event.shiftKey || key === 'y' ? 'redo' : 'undo');
  } else if (event.key === 'Enter' && options.breaks !== undefined) {
    event.preventDefault();
    if (modifier) {
      options.finish('apply');
    } else {
      typeLineBreak(options);
    }
  } else if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
    event.preventDefault();
    options.finish(event.key === 'Escape' ? 'cancel' : 'apply');
  }
}

function typeLineBreak(options: NativeTextOptions): void {
  const selection = runsSelection(options.space.runs);
  if (!selection) {
    options.refused();
    return;
  }
  if (options.buffer.crosses(selection)) {
    return;
  }
  const rest = options.buffer.after(selection.end);
  const endsLine = rest === undefined || /^[\t\n\f\r ]*$/.test(rest);
  options.buffer.replace(selection, endsLine ? '\n' + CANVAS_LINE_END : '\n');
}

function nativeTextInput(options: NativeTextOptions, event: InputEvent): void {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    options.buffer.history(event.inputType === 'historyUndo' ? 'undo' : 'redo');
    return;
  }
  const ranges = event.getTargetRanges();
  if (ranges.length > 1) {
    return;
  }
  const expands = event.inputType.startsWith('delete') || event.inputType === 'insertReplacementText';
  const range = runsSelection(options.space.runs, expands ? ranges[0] : undefined);
  if (!range) {
    options.refused();
    return;
  }
  const selected = runsSelection(options.space.runs);
  if (selected && !options.buffer.crosses(selected) && options.buffer.crosses(range)) {
    return;
  }
  if (event.inputType.startsWith('delete') && event.inputType !== 'deleteByDrag') {
    options.buffer.replace(range, '');
  } else if (['insertText', 'insertReplacementText'].includes(event.inputType)) {
    if (typeof event.data === 'string') {
      options.buffer.replace(range, event.data);
    }
  } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    options.buffer.replace(range, '\n');
  }
}

function nativeTextPaste(options: NativeTextOptions, event: ClipboardEvent): void {
  if (!(event.target instanceof Node) || !options.root.contains(event.target)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const selection = runsSelection(options.space.runs);
  const text = event.clipboardData?.getData('text/plain');
  if (!selection) {
    options.refused();
  } else if (text !== undefined) {
    options.buffer.replace(selection, text);
  }
}

function nativeTextCut(options: NativeTextOptions, event: ClipboardEvent): void {
  if (!(event.target instanceof Node) || !options.root.contains(event.target)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const selection = runsSelection(options.space.runs);
  if (!selection) {
    options.refused();
  } else if (event.clipboardData) {
    event.clipboardData.setData('text/plain', options.buffer.words(selection) ?? window.getSelection()?.toString() ?? '');
    options.buffer.replace(selection, '');
  }
}
