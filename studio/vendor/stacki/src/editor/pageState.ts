import { assert } from '../../shared/core/assert';
import type { Digest } from '../../shared/core/brand';
import { LIMITS } from '../../shared/core/limits';
import type { ParsePageResult } from '../../shared/page/pageNode';
import { carryHandles, randomSeed, seedOf } from './nodeHandles';
import type { PageOrigin } from './pageEdits';
import type { EditorModel, EditorNode } from './pageView';
import { saveStateClean, type SaveState } from './saveState';

export type OpenKind = 'page' | 'component';
export interface OpenFile {
  readonly kind: OpenKind;
  readonly path: string;
  readonly name: string;
  readonly route?: string;
  readonly focusPath?: string | undefined;
  readonly focusOcc?: number;
  readonly focusWhole?: boolean;
  readonly hostKey?: string | undefined;
  readonly hostOcc?: number | undefined;
}

export interface OpenRoute {
  readonly kind: 'route';
  readonly name: string;
  readonly route: string;
  readonly from: string | undefined;
  readonly path?: undefined;
}

export type CurrentPage = OpenFile | OpenRoute;

interface PageStateBase {
  readonly source: string;
  readonly save: SaveState;
}

export interface EditablePageState extends PageStateBase {
  readonly editable: true;
  readonly model: EditorModel;
  readonly parsedFrom: string;
  readonly origin: PageOrigin | undefined;
}

export interface RawPageState extends PageStateBase {
  readonly editable: false;
  readonly reason: string;
  readonly bail: { readonly what: string; readonly near: string } | undefined;
}

export type EditorPageState = EditablePageState | RawPageState;

export interface PageStateSnapshot {
  readonly currentPage: CurrentPage | undefined;
  readonly pageState: EditorPageState | undefined;
}

export type TrailingSlash = 'always' | 'never' | 'ignore';

export function findEditorNodeById(nodes: readonly EditorNode[] | undefined, id: string): EditorNode | undefined {
  const pending = [...(nodes ?? [])];
  let visited = 0;
  while (pending.length > 0) {
    visited += 1;
    if (visited > LIMITS.treeNodesMax) {
      throw new Error('Editor node lookup exceeds limit');
    }
    const node = pending.shift();
    if (!node) {
      continue;
    }
    if (node.id === id) {
      return node;
    }
    if ('children' in node && node.children !== undefined) {
      pending.unshift(...node.children);
    }
  }
  return undefined;
}

export function findEditorParentList(model: EditorModel, id: string): { readonly list: readonly EditorNode[]; readonly index: number } | undefined {
  const pending: (readonly EditorNode[])[] = [model.nodes];
  let visited = 0;
  while (pending.length > 0) {
    visited += 1;
    if (visited > LIMITS.treeNodesMax) {
      throw new Error('Editor parent lookup exceeds limit');
    }
    const list = pending.shift();
    if (!list) {
      continue;
    }
    const index = list.findIndex((node) => node.id === id);
    if (index >= 0) {
      return { list, index };
    }
    for (const node of list) {
      if ('children' in node && Array.isArray(node.children)) {
        pending.push(node.children);
      }
    }
  }
  return undefined;
}

export function toEditorPageState(input: ParsePageResult & { readonly source: string; readonly checksum: Digest }): EditorPageState {
  const save = saveStateClean(input.checksum);
  const source = input.source;
  if (!input.editable) {
    return { editable: false, reason: input.reason, bail: input.bail, source, save };
  }
  const model: EditorModel = input.model;
  const origin = { checksum: input.checksum, source, model: input.model };
  return { editable: true, model, source, parsedFrom: source, save, origin };
}

export function carriedParse<Parsed extends ParsePageResult & { readonly source: string }>(
  local: EditorPageState | undefined,
  parsed: Parsed & { readonly checksum?: Digest },
): Parsed {
  if (!isEditableState(local) || !parsed.editable) {
    return parsed;
  }
  const before = { source: local.parsedFrom, model: local.model };
  const checksum = parsed.checksum;
  const seed = checksum === undefined ? randomSeed() : seedOf(checksum);
  const after = { source: parsed.source, seed, model: parsed.model };
  const model = carryHandles({ before, after, own: undefined, predicted: undefined });
  return { ...parsed, model };
}

export function canvasPageOf(stack: readonly OpenFile[]): string | undefined {
  const open = stack.at(-1);
  const bottom = stack[0];
  if (open === undefined || bottom === undefined) {
    return undefined;
  }
  if (open.kind === 'component') {
    if (bottom.kind === 'page') {
      assert(bottom.path !== open.path, 'canvasPageOf: a component is not the page it is shown on');
      return bottom.path;
    }
    return undefined;
  }
  return undefined;
}

export function isOpenFile(page: CurrentPage | undefined): page is OpenFile {
  return page?.kind === 'page' || page?.kind === 'component';
}

export function isEditableState(state: EditorPageState | undefined): state is EditablePageState {
  return state?.editable === true;
}
