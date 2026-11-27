
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode, BranchNode, ParseBail, ParsedTemplate } from './astroParserTypes';
import { makeId, required, type tagFields } from './astroAttrs';
import { findMatchingParen } from './astroScan';

export function makeBranch(name: 'then' | 'else', children: ParserNode[], raw: string, base: number | undefined): BranchNode {
  const branch: BranchNode = { id: makeId(), kind: 'branch', name, children };
  if (base !== undefined) {
    const start = base + (raw.length - raw.trimStart().length);
    branch.start = start;
    branch.end = Math.max(start, base + raw.trimEnd().length);
  }
  return branch;
}

export const branchIsMarkup = (kids: readonly ParserNode[] | undefined) => (kids || []).some((kid) => kid.kind !== 'expr' && kid.kind !== 'text');

export function exprBranch(raw: string, base: number | undefined = undefined): ParserNode[] | undefined {
  const text = String(raw);
  let expression = text.trimStart();
  let at = base === undefined ? undefined : base + (text.length - expression.length);
  expression = expression.trimEnd();
  while (expression.startsWith('(') && findMatchingParen(expression, 0) === expression.length - 1) {
    const inner = expression.slice(1, -1);
    const trimmed = inner.trimStart();
    if (at !== undefined) {
      at += 1 + (inner.length - trimmed.length);
    }
    expression = trimmed.trimEnd();
  }
  if (!expression || expression.startsWith('<')) {
    return undefined;
  }
  const node: ParserNode = { id: makeId(), kind: 'expr', value: `{${expression}}` };
  if (at !== undefined) {
    node.start = at;
    node.end = at + expression.length;
  }
  return [node];
}

export const parseState: {
  lastBail: ParseBail | undefined;
  depth: number;
  nodes: number;
  conditions: number;
} = {
  lastBail: undefined,
  depth: 0,
  nodes: 0,
  conditions: 0,
};
export function bail(nodes: ParserNode[], template: string, at: number, what: string): ParsedTemplate {
  if (!parseState.lastBail) {
    parseState.lastBail = { what, near: template.slice(at, at + 60) };
  }
  return { nodes, clean: false };
}

export function resetParseBail(): void {
  parseState.lastBail = undefined;
}

export type TemplateTagResult =
  | { readonly kind: 'tag'; readonly node: ParserNode; readonly end: number }
  | { readonly kind: 'bail'; readonly what: string }
  | { readonly kind: 'child-bail' };

export function parseTemplateAt(node: ParserNode, base: number | undefined, from: number, to: number): ParserNode {
  if (base === undefined) {
    return node;
  }
  return { ...node, start: base + from, end: base + to };
}

export interface TemplateTagOpen {
  readonly template: string;
  readonly lt: number;
  readonly base: number | undefined;
  readonly name: string;
  readonly attrs: string;
  readonly fields: ReturnType<typeof tagFields>['fields'];
  readonly afterOpen: number;
  readonly shorthand: boolean;
  readonly kind: 'component' | 'element';
}

export function parseTemplateWithinBounds(nodes: readonly ParserNode[]): boolean {
  if (nodes.length > LIMITS.treeNodesMax) {
    return false;
  }
  const pending = nodes.map((node) => ({ node, depth: 0 }));
  for (let index = 0; index < pending.length; index++) {
    const entry = required(pending[index], 'Template traversal index is in bounds');
    if (entry.depth > LIMITS.treeDepthMax) {
      return false;
    }
    if (entry.node.children) {
      if (pending.length + entry.node.children.length > LIMITS.treeNodesMax) {
        return false;
      }
      for (const node of entry.node.children) {
        pending.push({ node, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}
