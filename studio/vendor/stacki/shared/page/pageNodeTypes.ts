
import type { NodeId, Utf16Offset } from '../core/brand';
import { type ImportSlot } from './frontmatter';
import { type Utf16Span } from '../core/span';

export type Attr =
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'expr'; readonly value: string }
  | { readonly type: 'bare' }
  | { readonly type: 'spread'; readonly value: string };

export interface PairedNode {
  readonly kind: 'component' | 'element';
  readonly id: NodeId;
  readonly name: string;
  readonly children: readonly PageNode[] | undefined;
  readonly props?: Readonly<Record<string, Attr>>;
  readonly attrOrder?: readonly string[];
  readonly attrSource?: string;
  readonly tightClose?: boolean;
  readonly openVoid?: boolean;
  readonly shorthand?: boolean;
  readonly source?: string;
  readonly blankBefore?: number;
  readonly blankAfter?: number;
  readonly closeSource?: string;
  readonly dynamicTag?: boolean;
  readonly astroAsset?: boolean;
}

export interface RawNode {
  readonly kind: 'raw';
  readonly id: NodeId;
  readonly name: string;
  readonly inner: string;
  readonly props?: Readonly<Record<string, Attr>>;
  readonly attrOrder?: readonly string[];
  readonly attrSource?: string;
}

export interface ValueNode {
  readonly kind: 'text' | 'expr' | 'raw-line';
  readonly id: NodeId;
  readonly value: string;
}

export interface CommentNode {
  readonly kind: 'comment';
  readonly id: NodeId;
  readonly value: string;
  readonly jsx?: boolean;
}

export interface MapNode {
  readonly kind: 'map';
  readonly id: NodeId;
  readonly head: string;
  readonly children: readonly PageNode[];
  readonly headSource?: string;
  readonly bare?: boolean;
  readonly body?: readonly string[];
  readonly bodyParts?: readonly string[];
  readonly source?: string;
  readonly fragment?: LoopFragment;
}

export type LoopFragment = '<>' | 'Fragment';

export interface CondNode {
  readonly kind: 'cond';
  readonly id: NodeId;
  readonly op: '?' | '&&';
  readonly test: string;
  readonly children: readonly BranchNode[];
}

export interface BranchNode {
  readonly kind: 'branch';
  readonly id: NodeId;
  readonly name: 'then' | 'else';
  readonly children: readonly PageNode[];
}

export interface ChunkGroupNode {
  readonly kind: 'chunk-group';
  readonly id: NodeId;
  readonly name: string;
  readonly chunkFile: string;
  readonly children: readonly PageNode[];
}

export interface MarkdownNodeMetadata {
  readonly mdBlanksBefore?: number;
  readonly mdIndent?: string;
  readonly mdFence?: string;
  readonly mdInfo?: string;
  readonly mdUnclosed?: boolean;
  readonly mdRaw?: string;
  readonly mdGap?: string;
  readonly mdTrail?: string;
  readonly mdSetext?: string;
  readonly mdImage?: boolean;
  readonly mdNumbers?: readonly number[];
  readonly mdLoose?: boolean;
  readonly mdMarker?: string;
  readonly mdSource?: string;
  readonly mdEsm?: boolean;
}

export type AttrSpan =
  | {
      readonly type: 'string' | 'expr';
      readonly name: string;
      readonly span: Utf16Span;
      readonly nameSpan: Utf16Span;
      readonly valueSpan: Utf16Span;
    }
  | {
      readonly type: 'bare';
      readonly name: string;
      readonly span: Utf16Span;
      readonly nameSpan: Utf16Span;
    }
  | {
      readonly type: 'spread';
      readonly name: string;
      readonly span: Utf16Span;
      readonly valueSpan: Utf16Span;
    }
  | {
      readonly type: 'markdown';
      readonly name: string;
      readonly span: Utf16Span;
      readonly valueSpan: Utf16Span;
    };

export interface SourceNodeMetadata {
  readonly start?: Utf16Offset;
  readonly end?: Utf16Offset;
  readonly attrSpans?: readonly AttrSpan[];
}

export type PageNode = (PairedNode | RawNode | ValueNode | CommentNode | MapNode | CondNode | BranchNode | ChunkGroupNode) &
  MarkdownNodeMetadata &
  SourceNodeMetadata;

export type PageNodeList = readonly PageNode[] & { readonly mdTrailingBlanks?: number };

export interface ImportDecl {
  readonly name: string;
  readonly path: string;
  readonly quote: string;
  readonly named?: boolean;
  readonly imported?: string;
  readonly typeOnly?: boolean;
  readonly at?: number;
}

export interface PageModel {
  readonly imports: readonly ImportDecl[];
  readonly frontmatterLead: string;
  readonly extraFrontmatter: string;
  readonly extraFrontmatterSpaced: boolean;
  readonly frontmatterLayout: {
    readonly extra: string;
    readonly slots: readonly ImportSlot[];
  };
  readonly hadFrontmatter: boolean;
  readonly trailingBlank: number;
  readonly eol?: '\n' | '\r\n';
  readonly nodes: PageNodeList;
  readonly bodyStart?: number;
  readonly format?: 'md' | 'mdx';
  readonly frontmatterLang?: 'yaml';
  readonly layoutPath?: string | undefined;
  readonly mdEol?: string;
  readonly mdEndsWithNewline?: boolean;
  readonly mdHasFrontmatter?: boolean;
}

export type ParsePageResult =
  | {
      readonly editable: false;
      readonly reason: string;
      readonly bail: { readonly what: string; readonly near: string } | undefined;
    }
  | { readonly editable: true; readonly model: PageModel };
