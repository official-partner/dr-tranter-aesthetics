import { Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { assert } from '../../../shared/core/assert';
import { findTrigger } from './chipModel';

export interface ActiveTrigger {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly anchor: { readonly left: number; readonly top: number; readonly bottom: number } | undefined;
}

export interface ChipTriggerOptions {
  readonly trigger: string;
  readonly onChange: (trigger: ActiveTrigger | undefined) => void;
}

export function chipTrigger(options: ChipTriggerOptions): Extension {
  assert(options.trigger.length === 1, 'chipTrigger: the trigger is one character');
  return ViewPlugin.fromClass(
    class {
      private reported: { readonly from: number; readonly to: number; readonly query: string } | undefined;

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet && !update.focusChanged) {
          return;
        }
        const match = this.find(update.view);
        if (match === undefined) {
          update.view.requestMeasure({ key: this, read: () => undefined, write: () => undefined });
          this.report(undefined);
          return;
        }
        const unchanged = this.reported?.from === match.from && this.reported.to === match.to && this.reported.query === match.query;
        if (unchanged) {
          return;
        }
        update.view.requestMeasure({
          key: this,
          read: (view) => view.coordsAtPos(match.from) ?? undefined,
          write: (coordinates) => {
            this.report({
              ...match,
              anchor: coordinates === undefined ? undefined : { left: coordinates.left, top: coordinates.top, bottom: coordinates.bottom },
            });
          },
        });
      }

      destroy(): void {
        this.report(undefined);
      }

      private find(view: EditorView): Omit<ActiveTrigger, 'anchor'> | undefined {
        const selection = view.state.selection.main;
        if (!selection.empty || view.composing || !view.hasFocus) {
          return undefined;
        }
        const line = view.state.doc.lineAt(selection.head);
        const match = findTrigger(line.text.slice(0, selection.head - line.from), options.trigger);
        if (match === undefined) {
          return undefined;
        }
        return { from: line.from + match.offset, to: selection.head, query: match.query };
      }

      private report(next: ActiveTrigger | undefined): void {
        const previous = this.reported;
        if (previous === undefined && next === undefined) {
          return;
        }
        this.reported = next === undefined ? undefined : { from: next.from, to: next.to, query: next.query };
        options.onChange(next);
      }
    },
  );
}

export type PickerKey = 'up' | 'down' | 'choose' | 'close' | 'previousTab' | 'nextTab';

export interface PickerKeymapOptions {
  readonly isOpen: () => boolean;
  readonly onKey: (key: PickerKey) => boolean;
}

export function pickerKeymap(options: PickerKeymapOptions): Extension {
  const route =
    (key: PickerKey) =>
    (view: EditorView): boolean =>
      options.isOpen() && !view.composing && options.onKey(key);
  return Prec.highest(
    keymap.of([
      { key: 'ArrowDown', run: route('down') },
      { key: 'ArrowUp', run: route('up') },
      { key: 'Enter', run: route('choose') },
      { key: 'Tab', run: route('choose') },
      { key: 'Escape', run: route('close') },
      { key: 'Mod-[', run: route('previousTab') },
      { key: 'Mod-]', run: route('nextTab') },
    ]),
  );
}
