import type { Attr, PageModel, PageNode } from '../../shared/page/pageNode';
import { toNodeId, type NodeId } from '../../shared/core/brand';

interface EditorNodeCommon {
  readonly name?: string;
  readonly children?: readonly EditorNode[] | undefined;
  readonly props?: Readonly<Record<string, Attr>>;
  readonly attrOrder?: readonly string[];
  readonly value?: string;
  readonly chunkFile?: string;
  readonly dynamicTag?: boolean;
  readonly astroAsset?: boolean;
  readonly head?: string;
  readonly test?: string;
  readonly inner?: string;
  readonly source?: string;
}

export type EditorNode = PageNode & EditorNodeCommon;
export type EditorModel = Omit<PageModel, 'nodes'> & { readonly nodes: readonly EditorNode[] };

export function nodeId(value: string): NodeId {
  return toNodeId(value);
}
