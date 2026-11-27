import type { InsertDragChoice } from './insertDragData';

export type Drag =
  | { readonly kind: 'component'; readonly name: string; readonly path?: string }
  | { readonly kind: 'insert'; readonly choice: InsertDragChoice; readonly label: string }
  | {
      readonly kind: 'node';
      readonly id: string;
      readonly nodeKind: string;
      readonly tag?: string;
    };

let current: Drag | undefined;

export function setDrag(info: Drag | undefined): void {
  current = info;
}

export function clearDrag(): void {
  current = undefined;
}

export function getDrag(): Drag | undefined {
  return current;
}

export function allowDragEffect(transfer: DataTransfer, effect: 'move' | 'copy'): void {
  // eslint-disable-next-line no-param-reassign -- The drag API is an assignment on DataTransfer.
  transfer.effectAllowed = effect;
}
