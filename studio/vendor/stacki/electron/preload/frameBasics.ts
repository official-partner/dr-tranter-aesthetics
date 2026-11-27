
export type Box = { left: number; top: number; right: number; bottom: number };
export type Rect = { x: number; y: number; w: number; h: number; hidden?: true };
export type TaggedPlace = { el: Element; rect: Rect };
export type GapBand = { axis: 'column' | 'row'; x: number; y: number; w: number; h: number };
export type ThinTarget = { path: string; el: Element; box: DOMRect };
export type Spacing = {
  padding: Record<string, number>;
  margin: Record<string, number>;
  collapse?: { top?: { partner: 'previous' | 'next' | 'parent'; margin: number }; bottom?: { partner: 'previous' | 'next' | 'parent'; margin: number } };
  gaps: GapBand[];
  units: Record<string, number>;
};
export type GapRow = { top: number; bottom: number; items: DOMRect[] };


export const PRELOAD_LIMITS = { domDepthMax: 512, cssRuleDepthMax: 64 } as const;

export const PROBE_ATTR = 'data-avb-probe';

export const isElement = (node: Node): node is Element => node.nodeType === 1;
export const isComment = (node: Node): node is Comment => node.nodeType === 8;
export const isText = (node: Node): node is Text => node.nodeType === 3;
export const isChildNode = (node: Node): node is ChildNode => 'remove' in node && typeof node['remove'] === 'function';
