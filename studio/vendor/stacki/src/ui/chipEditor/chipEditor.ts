import { invertedEffects } from '@codemirror/commands';
import { Annotation, EditorState, MapMode, StateEffect, StateField } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { assert } from '../../../shared/core/assert';
import { CHIP_CHARACTER, CHIP_COUNT_MAX, documentToSegments, segmentsToDocument } from './chipModel';
import type { Segment } from './chipModel';

export interface ChipLook {
  readonly label: string;
  readonly title?: string;
  readonly kind?: string;
}

export interface ChipEditorOptions<Chip> {
  readonly describe: (chip: Chip) => ChipLook;
  readonly onChipClick?: (chip: Chip, element: HTMLElement) => void;
  readonly decorate?: (chip: Chip, element: HTMLElement) => void;
  readonly orphans?: (remaining: readonly Chip[]) => readonly number[];
}

export interface ChipEditor<Chip> {
  readonly extension: Extension;
  readonly insertChip: (state: EditorState, chip: Chip, options?: InsertOptions) => TransactionSpec | undefined;
  readonly readSegments: (state: EditorState) => readonly Segment<Chip>[];
  readonly createState: (segments: readonly Segment<Chip>[], extensions?: readonly Extension[]) => EditorState;
  readonly replaceSegments: (state: EditorState, segments: readonly Segment<Chip>[]) => TransactionSpec;
  readonly chipCount: (state: EditorState) => number;
  readonly chipRanges: (state: EditorState) => readonly { readonly from: number; readonly chip: Chip }[];
  readonly redraw: (state: EditorState) => TransactionSpec;
}

export interface InsertOptions {
  readonly from?: number;
  readonly to?: number;
  readonly trailing?: string;
  readonly leading?: string;
  readonly caret?: 'after' | 'keep';
}

const chipInsertion = Annotation.define<boolean>();

class ChipWidget<Chip> extends WidgetType {
  constructor(
    readonly chip: Chip,
    private readonly look: ChipLook,
    private readonly options: ChipEditorOptions<Chip>,
  ) {
    super();
  }

  override eq(other: ChipWidget<Chip>): boolean {
    return other.chip === this.chip && other.look.label === this.look.label && other.look.title === this.look.title && other.look.kind === this.look.kind;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'chip-editor-chip';
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-label', this.look.title ?? this.look.label);
    if (this.look.title !== undefined) {
      element.title = this.look.title;
    }
    if (this.look.kind !== undefined) {
      element.dataset['chipKind'] = this.look.kind;
    }
    this.options.decorate?.(this.chip, element);
    const label = document.createElement('span');
    label.className = 'chip-editor-chip-label';
    label.textContent = this.look.label;
    element.append(label);
    const { onChipClick } = this.options;
    if (onChipClick !== undefined) {
      element.setAttribute('role', 'button');
      element.addEventListener('click', (event) => {
        event.preventDefault();
        onChipClick(this.chip, element);
      });
    }
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function createChipEditor<Chip>(options: ChipEditorOptions<Chip>): ChipEditor<Chip> {
  const addChip = StateEffect.define<{ readonly pos: number; readonly chip: Chip }>({
    map: (value, changes) => ({ pos: changes.mapPos(value.pos), chip: value.chip }),
  });
  const redrawChips = StateEffect.define<undefined>();
  const chipOfDecoration = new WeakMap<Decoration, Chip>();
  const decorationFor = (chip: Chip): Decoration => {
    const decoration = Decoration.replace({ widget: new ChipWidget(chip, options.describe(chip), options) });
    chipOfDecoration.set(decoration, chip);
    return decoration;
  };
  const chipField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, transaction) {
      let next = decorations.map(transaction.changes).update({
        filter: (from, to) => to - from === 1 && transaction.newDoc.sliceString(from, to) === CHIP_CHARACTER,
      });
      for (const effect of transaction.effects) {
        if (effect.is(addChip) && transaction.newDoc.sliceString(effect.value.pos, effect.value.pos + 1) === CHIP_CHARACTER) {
          const position = effect.value.pos;
          next = next.update({
            filter: (from) => from !== position,
            filterFrom: position,
            filterTo: position + 1,
            add: [decorationFor(effect.value.chip).range(position, position + 1)],
          });
        }
        if (effect.is(redrawChips)) {
          const ranges: ReturnType<Decoration['range']>[] = [];
          next.between(0, transaction.newDoc.length, (from, to, decoration) => {
            const chip = chipOfDecoration.get(decoration);
            if (chip !== undefined) {
              ranges.push(decorationFor(chip).range(from, to));
            }
          });
          assert(ranges.length <= CHIP_COUNT_MAX, 'chip editor: a redraw keeps the chip bound');
          next = Decoration.set(ranges);
        }
      }
      return next;
    },
    provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
  });

  const chipsOf = (state: EditorState): { readonly from: number; readonly chip: Chip }[] => {
    const found: { from: number; chip: Chip }[] = [];
    state.field(chipField).between(0, state.doc.length, (from, _to, decoration) => {
      if (chipOfDecoration.has(decoration)) {
        const chip = chipOfDecoration.get(decoration);
        assert(chip !== undefined, 'chip editor: a decoration without its chip');
        found.push({ from, chip });
      }
    });
    return found;
  };

  const refuseStrayPlaceholders = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.annotation(chipInsertion) === true) {
      return transaction;
    }
    if (transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) {
      return transaction;
    }
    let stray = false;
    transaction.changes.iterChanges((_replacedFrom, _replacedTo, _insertedFrom, _insertedTo, inserted) => {
      if (inserted.toString().includes(CHIP_CHARACTER)) {
        stray = true;
      }
    });
    return stray ? [] : transaction;
  });

  const removeOrphans = EditorState.transactionFilter.of((transaction) => {
    const { orphans } = options;
    if (orphans === undefined || !transaction.docChanged || transaction.annotation(chipInsertion) === true) {
      return transaction;
    }
    if (transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) {
      return transaction;
    }
    const before = chipsOf(transaction.startState);
    const remaining = before.filter(({ from }) => transaction.changes.mapPos(from, 1, MapMode.TrackAfter) !== null);
    if (remaining.length === before.length) {
      return transaction;
    }
    const dropped = orphans(remaining.map(({ chip }) => chip));
    if (dropped.length === 0) {
      return transaction;
    }
    const newDocument = transaction.newDoc;
    const changes = dropped.map((index) => {
      const entry = remaining[index];
      assert(entry !== undefined, 'chip editor: an orphan index names a remaining chip');
      const from = transaction.changes.mapPos(entry.from, 1);
      assert(newDocument.sliceString(from, from + 1) === CHIP_CHARACTER, 'chip editor: an orphan still sits on its placeholder');
      const to = newDocument.sliceString(from + 1, from + 2) === ' ' ? from + 2 : from + 1;
      return { from, to };
    });
    return [transaction, { changes, sequential: true }];
  });

  const restoreOnUndo = invertedEffects.of((transaction) => {
    const restored: StateEffect<{ readonly pos: number; readonly chip: Chip }>[] = [];
    for (const { from, chip } of chipsOf(transaction.startState)) {
      if (transaction.changes.mapPos(from, 1, MapMode.TrackAfter) === null) {
        restored.push(addChip.of({ pos: from, chip }));
      }
    }
    return restored;
  });

  const copyLabels = EditorView.clipboardOutputFilter.of((text, state) => {
    if (!text.includes(CHIP_CHARACTER)) {
      return text;
    }
    const selected = chipsOf(state).filter(({ from }) => state.selection.ranges.some((range) => range.from <= from && from < range.to));
    const pieces = text.split(CHIP_CHARACTER);
    if (pieces.length - 1 !== selected.length) {
      return pieces.join('');
    }
    return pieces.map((piece, index) => piece + (selected[index] === undefined ? '' : options.describe(selected[index].chip).label)).join('');
  });

  const readSegments = (state: EditorState): readonly Segment<Chip>[] => {
    const chips = chipsOf(state).map((entry) => entry.chip);
    const text = state.doc.toString();
    assert(text.split(CHIP_CHARACTER).length - 1 === chips.length, 'chip editor: every placeholder has a chip');
    return documentToSegments({ text, chips });
  };

  const extension: Extension = [chipField, refuseStrayPlaceholders, removeOrphans, restoreOnUndo, copyLabels];

  const createState = (segments: readonly Segment<Chip>[], extensions: readonly Extension[] = []): EditorState => {
    const draft = segmentsToDocument(segments);
    const base = EditorState.create({ doc: draft.text, extensions: [extension, ...extensions] });
    const effects: StateEffect<{ readonly pos: number; readonly chip: Chip }>[] = [];
    let chipIndex = 0;
    for (let position = 0; position < draft.text.length; position += 1) {
      if (draft.text.charAt(position) === CHIP_CHARACTER) {
        const chip = draft.chips[chipIndex];
        assert(chip !== undefined, 'chip editor: a chip for every placeholder');
        effects.push(addChip.of({ pos: position, chip }));
        chipIndex += 1;
      }
    }
    const placed = base.update({ effects, selection: { anchor: draft.text.length }, annotations: chipInsertion.of(true) }).state;
    assert(placed.selection.main.head === placed.doc.length, 'chip editor: a new state opens with the caret at the end');
    return placed;
  };

  return {
    extension,
    readSegments,
    createState,
    chipCount: (state) => chipsOf(state).length,
    chipRanges: (state) => chipsOf(state),
    redraw: () => ({ effects: redrawChips.of(undefined) }),
    insertChip: (state, chip, insertOptions = {}) => {
      if (chipsOf(state).length >= CHIP_COUNT_MAX) {
        return undefined;
      }
      const main = state.selection.main;
      const from = insertOptions.from ?? main.from;
      const to = insertOptions.to ?? main.to;
      assert(from <= to, 'insertChip: the range runs forward');
      assert(to <= state.doc.length, 'insertChip: the range is inside the document');
      const trailing = insertOptions.trailing ?? ' ';
      const leading = insertOptions.leading ?? '';
      assert(!leading.includes(CHIP_CHARACTER), 'insertChip: the leading text holds no placeholder');
      const chipAt = from + leading.length;
      const spec = {
        changes: { from, to, insert: leading + CHIP_CHARACTER + trailing },
        effects: addChip.of({ pos: chipAt, chip }),
        annotations: [chipInsertion.of(true)],
        userEvent: 'input',
      };
      return insertOptions.caret === 'keep' ? spec : { ...spec, selection: { anchor: chipAt + 1 + trailing.length }, scrollIntoView: true };
    },
    replaceSegments: (state, segments) => {
      const draft = segmentsToDocument(segments);
      const effects: StateEffect<{ readonly pos: number; readonly chip: Chip }>[] = [];
      let chipIndex = 0;
      for (let position = 0; position < draft.text.length; position += 1) {
        if (draft.text.charAt(position) === CHIP_CHARACTER) {
          const chip = draft.chips[chipIndex];
          assert(chip !== undefined, 'chip editor: a chip for every placeholder');
          effects.push(addChip.of({ pos: position, chip }));
          chipIndex += 1;
        }
      }
      return {
        changes: { from: 0, to: state.doc.length, insert: draft.text },
        effects,
        selection: { anchor: draft.text.length },
        annotations: [chipInsertion.of(true)],
      };
    },
  };
}
