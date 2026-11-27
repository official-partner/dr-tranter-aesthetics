import { textValueCanonical } from '../../../shared/page/htmlText';
import { assert } from '../../../shared/core/assert';
import { CANVAS_TARGET_LIMIT, CANVAS_TEXT_LIMIT, type CanvasTextTarget } from '../../../shared/properties/canvasText';
import { canvasTextBinding } from './canvasTextBinding';
import type { BoundTextBlockReason } from '../../editor/boundText';
import type { CanvasFormatAction, CanvasFormatState } from './canvasTextSelection';

export interface CanvasSourceNode {
  readonly id?: string;
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly start?: number;
  readonly end?: number;
  readonly head?: string;
  readonly children?: readonly CanvasSourceNode[] | undefined;
}
export interface CanvasTextPlan {
  readonly target: CanvasTextTarget;
  readonly start: number;
  readonly end: number;
  readonly encoding: 'html' | 'string';
}

export function canvasTextPlans(source: string, nodes: readonly CanvasSourceNode[], pathFor: (id: string) => string | undefined): readonly CanvasTextPlan[] {
  const plans = canvasTextNodes(nodes).flatMap(({ node, parent, scoped }) => {
    if (!parent || !['element', 'component'].includes(parent.kind)) {
      return [];
    }
    if (scoped && node.kind === 'expr') {
      return [];
    }
    const plan = textPlan(source, node, parent, pathFor);
    return plan ? [plan] : [];
  });
  return plans.length <= CANVAS_TARGET_LIMIT ? plans : [];
}

export function canvasTextNodes(nodes: readonly CanvasSourceNode[]) {
  const queue: {
    readonly node: CanvasSourceNode;
    readonly scoped: boolean;
    readonly parent: CanvasSourceNode | undefined;
  }[] = nodes.map((node) => ({ node, parent: undefined, scoped: false }));
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 10_000) {
      return [];
    }
    const entry = queue[index];
    assert(entry !== undefined, 'Canvas text traversal has an entry');
    const scoped = entry.scoped || ['map', 'expr', 'branch'].includes(entry.node.kind);
    for (const child of entry.node.children ?? []) {
      queue.push({ node: child, parent: entry.node, scoped });
    }
  }
  return queue;
}

function textPlan(source: string, node: CanvasSourceNode, parent: CanvasSourceNode, pathFor: (id: string) => string | undefined): CanvasTextPlan | undefined {
  const path = node.id ? pathFor(node.id) : undefined;
  const parentPath = parent.id ? pathFor(parent.id) : undefined;
  if (!path || !parentPath || node.start === undefined || node.end === undefined) {
    return undefined;
  }
  if (['script', 'style', 'textarea', 'select', 'option'].includes(parent.name ?? '')) {
    return undefined;
  }
  const literal = node.kind === 'text';
  const binding = node.kind === 'expr' ? canvasTextBinding(source, node) : undefined;
  const value = literal ? node.value : binding?.value;
  if (!value?.trim() || value.length > CANVAS_TEXT_LIMIT) {
    return undefined;
  }
  const start = binding?.start ?? node.start;
  const end = binding?.end ?? node.end;
  if (start < 0 || end < start || end > source.length) {
    return undefined;
  }
  const target = canvasTextTarget(node, parent, value, binding ? 'Shared variable · changes other uses too' : 'Edit text', pathFor);
  if (!target) {
    return undefined;
  }
  return { start, end, encoding: literal ? 'html' : 'string', target: literal ? { ...target, literal: true } : target };
}

export function canvasTextTarget(
  node: CanvasSourceNode,
  parent: CanvasSourceNode,
  value: string,
  label: string,
  pathFor: (id: string) => string | undefined,
): CanvasTextTarget | undefined {
  if (parent.kind !== 'element' && parent.kind !== 'component') {
    return undefined;
  }
  const path = node.id ? pathFor(node.id) : undefined;
  const parentPath = parent.id ? pathFor(parent.id) : undefined;
  if (!path || !parentPath || !value.trim() || value.length > CANVAS_TEXT_LIMIT) {
    return undefined;
  }
  const siblings = (parent.children ?? [])
    .filter((child) => child.kind !== 'text' && child.kind !== 'expr' && child.kind !== 'comment')
    .map((child) => (child.id ? pathFor(child.id) : undefined));
  if (siblings.length > 100 || siblings.some((path) => !path)) {
    return undefined;
  }
  return {
    kind: parent.kind,
    key: path,
    path,
    parent: parentPath,
    value,
    label,
    tag: parent.name ?? '',
    siblings: siblings.filter((path): path is string => path !== undefined),
    nested: ['span', 'a', 'strong', 'em', 'b', 'i', 'small', 'mark', 'sup', 'sub'].includes(parent.name ?? ''),
    ...(parent.kind === 'component' ? { from: 'slot', scope: parentPath } : {}),
  };
}

export function applyCanvasText(source: string, plan: CanvasTextPlan, value: string): string {
  assert(plan.start >= 0, 'Canvas text starts inside source');
  assert(plan.end <= source.length, 'Canvas text ends inside source');
  if (value.length > CANVAS_TEXT_LIMIT) {
    throw new Error('Text exceeds the editing limit');
  }
  const replacement = plan.encoding === 'string' ? JSON.stringify(value) : escapeCanvasText(value);
  return source.slice(0, plan.start) + replacement + source.slice(plan.end);
}

export function applyCanvasTexts(source: string, edits: readonly { readonly plan: CanvasTextPlan; readonly value: string }[]): string {
  assert(edits.length > 0, 'A combined text edit has edits');
  const ordered = [...edits].sort((left, right) => right.plan.start - left.plan.start);
  ordered.slice(1).forEach((edit, index) => {
    const later = ordered[index];
    assert(later !== undefined, 'Each text has a later neighbour');
    assert(edit.plan.end <= later.plan.start, 'Combined text edits do not overlap');
  });
  return ordered.reduce((next, edit) => applyCanvasText(next, edit.plan, edit.value), source);
}

function escapeCanvasText(value: string): string {
  return textValueCanonical(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

export interface CanvasTextEdit {
  readonly target: CanvasTextTarget;
  readonly apply: (value: string) => Promise<void>;
  readonly plan?: CanvasTextPlan;
  readonly prop?: {
    readonly nodeID: string;
    readonly name: string;
    readonly value: (typed: string) => string;
  };
  readonly format?: CanvasEditFormat;
  readonly bound?: CanvasBoundText;
}

export type CanvasBoundText =
  | { readonly kind: 'source'; readonly expression: string; readonly file: string; readonly uses: number }
  | {
      readonly kind: 'blocked';
      readonly expression: string;
      readonly file: string;
      readonly reason: BoundTextBlockReason;
      readonly line?: number;
      readonly name?: string;
    };

export interface CanvasEditFormat {
  readonly states: () => CanvasFormatState | undefined;
  readonly apply: (selection: { readonly start: number; readonly end: number; readonly value: string }, action: CanvasFormatAction) => boolean;
}
