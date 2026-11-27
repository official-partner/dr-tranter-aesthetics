
import { assert } from '../../../../shared/core/assert';
import { clampCaret } from '../../../lib/chipCaret';

export type ChipPart = { readonly kind: 'class'; readonly name: string } | { readonly kind: 'attribute'; readonly name: string } | { readonly kind: 'other' };

export type CaretKey = 'Backspace' | 'Delete';

export type PressWatchTarget = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;

export interface PressWatch {
  readonly whenPressEnds: (work: () => void) => void;
  readonly cancel: () => void;
  readonly dispose: () => void;
}

const PRESSABLE = [
  'button',
  'a[href]',
  'label',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ');

interface Press {
  readonly control: HTMLElement;
  readonly box: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
}

interface Release {
  readonly target: Node | undefined;
  readonly x: number;
  readonly y: number;
}

export function createPressWatch(target: PressWatchTarget): PressWatch {
  let pressed = false;
  let press: Press | undefined;
  let release: Release | undefined;
  let work: (() => void) | undefined;
  let timer: number | undefined;
  const flush = (): void => {
    timer = undefined;
    const held = work;
    const missed = press;
    const landed = release;
    work = undefined;
    press = undefined;
    release = undefined;
    if (held === undefined) {
      return;
    }
    if (missed !== undefined) {
      if (landed !== undefined) {
        deliverMissedClick(missed, landed);
      }
    }
    held();
  };
  const onPress = (event: MouseEvent): void => {
    pressed = true;
    release = undefined;
    press = event.button === 0 && event.target instanceof Element ? pressedControl(event.target) : undefined;
  };
  const settle = (): void => {
    pressed = false;
    if (work !== undefined) {
      target.clearTimeout(timer);
      timer = target.setTimeout(flush, 0);
    } else {
      press = undefined;
    }
  };
  const onMouseUp = (event: MouseEvent): void => {
    release = { target: event.target instanceof Node ? event.target : undefined, x: event.clientX, y: event.clientY };
    settle();
  };
  const onDragEnd = (): void => {
    press = undefined;
    settle();
  };
  const onWindowBlur = (event: Event): void => {
    if (!(event.target instanceof Node)) {
      press = undefined;
      settle();
    }
  };
  const cancel = (): void => {
    work = undefined;
    press = undefined;
    release = undefined;
    target.clearTimeout(timer);
    timer = undefined;
  };
  const options = { capture: true } as const;
  target.addEventListener('mousedown', onPress, options);
  target.addEventListener('mouseup', onMouseUp, options);
  target.addEventListener('dragend', onDragEnd, options);
  target.addEventListener('blur', onWindowBlur, options);
  return {
    whenPressEnds: (next) => {
      if (pressed) {
        work = next;
      } else {
        next();
      }
    },
    cancel,
    dispose: () => {
      cancel();
      target.removeEventListener('mousedown', onPress, options);
      target.removeEventListener('mouseup', onMouseUp, options);
      target.removeEventListener('dragend', onDragEnd, options);
      target.removeEventListener('blur', onWindowBlur, options);
    },
  };
}

function pressedControl(pressTarget: Element): Press | undefined {
  const control = pressTarget.closest(PRESSABLE);
  if (!(control instanceof HTMLElement)) {
    return undefined;
  }
  const rect = control.getBoundingClientRect();
  assert(rect.left <= rect.right, 'pressedControl: a box has its left edge before its right');
  return { control, box: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
}

function deliverMissedClick(missed: Press, landed: Release): void {
  assert(Number.isFinite(landed.x), 'deliverMissedClick: a mouse up has a position');
  assert(Number.isFinite(landed.y), 'deliverMissedClick: a mouse up has a position');
  if (landed.target !== undefined) {
    if (missed.control.contains(landed.target)) {
      return;
    }
  }
  if (!missed.control.isConnected) {
    return;
  }
  if (boxHolds(missed.box, landed.x, landed.y)) {
    missed.control.click();
  }
}

function boxHolds(box: Press['box'], x: number, y: number): boolean {
  if (x < box.left) {
    return false;
  }
  if (x > box.right) {
    return false;
  }
  if (y < box.top) {
    return false;
  }
  return y <= box.bottom;
}

export function chipAtCaret(caret: number, chipCount: number, key: CaretKey): number | undefined {
  const gap = clampCaret(caret, chipCount);
  const index = key === 'Backspace' ? gap - 1 : gap;
  if (index < 0) {
    return undefined;
  }
  if (index < chipCount) {
    return index;
  }
  return undefined;
}

export function chipPart(selectorText: string, loneClass: string | undefined): ChipPart {
  if (loneClass !== undefined) {
    assert(loneClass.length > 0, 'chipPart: a lone class has a name');
    return { kind: 'class', name: loneClass };
  }
  const name = attributeChipName(selectorText);
  return name === undefined ? { kind: 'other' } : { kind: 'attribute', name };
}

const ATTRIBUTE_CHIP = /^\[\s*([A-Za-z_][\w:.-]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\]\s"']+)\s*(?:[is]\s*)?)?\]$/;

export function attributeChipName(selectorText: string): string | undefined {
  const match = ATTRIBUTE_CHIP.exec(selectorText.trim());
  return match?.[1];
}
