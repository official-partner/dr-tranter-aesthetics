
import { assert } from '../../../../shared/core/assert';
import { described, type Described, type MessageKey, type TypedMessageRef } from '../../../../shared/properties/i18n/messageRef';
import { LIMITS } from '../../../../shared/core/limits';
import { editInlineStyle, readInlineStyle, type InlineDeclaration } from '../../../../shared/engine/inlineStyle';
import type { StyleDeclaration } from '../../../../shared/engine/intent';
import type { HostNode } from './host';
import { readableStyleCode, readableStyleText, styleExpressionSpanInSource } from './inlineCode';
import { alwaysBranchLabel, readStyleBranches, type StyleBranch } from './inlineBranches';

export type InlineStyle =
  | { readonly kind: 'none' }
  | { readonly kind: 'declarations'; readonly text: string; readonly declarations: readonly InlineDeclaration[] }
  | { readonly kind: 'branched'; readonly expression: string; readonly branches: readonly StyleBranch[]; readonly source: InlineSource }
  | { readonly kind: 'code'; readonly reason: InlineCodeReason; readonly message: string; readonly messageRef: TypedMessageRef; readonly code: string };

export type InlineSource =
  | { readonly kind: 'node' }
  | { readonly kind: 'component'; readonly path: string; readonly fileName: string; readonly text: string; readonly start: number; readonly end: number };

export type InlineCodeReason =
  | 'expression'
  | 'unreadable'
  | 'component';

export type InlineWrite = { readonly tag: 'write'; readonly next: string | undefined } | ({ readonly tag: 'refused' } & Described);

export const INLINE_STYLE_SELECTOR = '@inline-style';
export const INLINE_STYLE_LABEL = 'Inline styles';
export const INLINE_STYLE_LABEL_KEY: MessageKey = 'styleModel.inline.label';

export const INLINE_NONE: InlineStyle = { kind: 'none' };

const INLINE_WRITE_PROPERTIES_MAX = 64;

export function inlineStyleOf(node: Pick<HostNode, 'props'> | undefined): InlineStyle {
  const attribute = node?.props?.['style'];
  if (attribute === undefined) {
    return INLINE_NONE;
  }
  const value = attribute.value ?? '';
  if (value.trim() === '') {
    return INLINE_NONE;
  }
  if (attribute.type !== 'string') {
    return expressionStyle(value, { kind: 'node' });
  }
  if (value.length > LIMITS.attrCharsMax) {
    return {
      kind: 'code',
      reason: 'unreadable',
      ...described('styleModel.inline.reason.unreadable'),
      code: readableStyleText(value.slice(0, LIMITS.attrCharsMax)),
    };
  }
  const declarations = readInlineStyle(value);
  if (declarations === undefined) {
    return { kind: 'code', reason: 'unreadable', ...described('styleModel.inline.reason.unreadable'), code: readableStyleText(value) };
  }
  if (declarations.length === 0) {
    return INLINE_NONE;
  }
  return { kind: 'declarations', text: value, declarations };
}

export function expressionStyle(expression: string, source: InlineSource): InlineStyle {
  const read = readStyleBranches(expression);
  if (read.tag === 'unsupported') {
    return { kind: 'code', reason: 'expression', message: read.reason, messageRef: read.reasonRef, code: readableStyleCode(expression) };
  }
  assert(read.branches.length > 0, 'expressionStyle: an editable expression has a branch');
  return { kind: 'branched', expression, branches: read.branches, source };
}

export function selectedBranch(style: Extract<InlineStyle, { kind: 'branched' }>, key: string | undefined): StyleBranch {
  const first = style.branches[0];
  assert(first !== undefined, 'selectedBranch: an expression has a branch');
  return style.branches.find((branch) => branch.key === key) ?? first;
}

export function hasInlineChip(style: InlineStyle): boolean {
  return style.kind !== 'none';
}

export function chipInlineStyle(
  own: InlineStyle,
  rendered: {
    readonly instance: boolean;
    readonly style: string | undefined;
    readonly component: { readonly path: string; readonly text: string } | undefined;
  },
): InlineStyle {
  if (own.kind !== 'none') {
    return own;
  }
  if (!rendered.instance) {
    return own;
  }
  if (rendered.style === undefined) {
    return own;
  }
  if (rendered.style.trim() === '') {
    return own;
  }
  const component = rendered.component;
  const span = component === undefined ? undefined : styleExpressionSpanInSource(component.text);
  if (component === undefined || span === undefined) {
    return { kind: 'code', reason: 'component', ...described('styleModel.inline.reason.componentUnreadable'), code: readableStyleText(rendered.style) };
  }
  const fileName = component.path.split(/[\\/]/).pop() ?? component.path;
  return expressionStyle(span.expression, { kind: 'component', path: component.path, fileName, text: component.text, start: span.start, end: span.end });
}

export function inlineChipShown(style: InlineStyle, host: { readonly writable: boolean; readonly pseudo: boolean }): boolean {
  if (host.pseudo) {
    return false;
  }
  switch (style.kind) {
    case 'none':
      return false;
    case 'code':
      return true;
    case 'branched':
      return true;
    case 'declarations':
      return host.writable;
    default: {
      const exhaustive: never = style;
      return exhaustive;
    }
  }
}

export function inlineDeclaration(value: string, flags: { readonly important: boolean }): StyleDeclaration {
  const trimmed = value.trim();
  assert(trimmed !== '', 'inlineDeclaration: a set has a value; an empty one is a removal');
  return { tag: 'set', value: flags.important ? `${trimmed} !important` : trimmed };
}

export function inlineStyleWrite(text: string, properties: readonly string[], declaration: StyleDeclaration): InlineWrite {
  assert(properties.length > 0, 'inlineStyleWrite: a write names a property');
  assert(properties.length <= INLINE_WRITE_PROPERTIES_MAX, 'inlineStyleWrite: a write names a handful of properties');
  if (text.length > LIMITS.attrCharsMax) {
    return { tag: 'refused', ...described('styleModel.inline.refusal.tooLongToEdit') };
  }
  let next = text;
  for (const property of properties) {
    assert(property.trim() === property, 'inlineStyleWrite: property names come trimmed');
    assert(property !== '', 'inlineStyleWrite: property names are not empty');
    const edited = editInlineStyle(next, property, declaration);
    if (edited.tag === 'ambiguous') {
      return { tag: 'refused', ...described('styleModel.inline.refusal.declaredTwice', { property }) };
    }
    if (edited.tag === 'unreadable') {
      return { tag: 'refused', ...described('styleModel.inline.refusal.notPlainList') };
    }
    next = edited.text;
  }
  if (next.length > LIMITS.attrCharsMax) {
    return { tag: 'refused', ...described('styleModel.inline.refusal.tooLong') };
  }
  const read = readInlineStyle(next);
  if (read === undefined) {
    return { tag: 'refused', ...described('styleModel.inline.refusal.valueBreaks') };
  }
  if (declaration.tag === 'set') {
    const alone = readInlineStyle(`x: ${declaration.value}`);
    if (alone?.length !== 1) {
      return { tag: 'refused', ...described('styleModel.inline.refusal.semicolon') };
    }
  }
  if (read.length === 0) {
    return { tag: 'write', next: undefined };
  }
  assert(next.trim() !== '', 'inlineStyleWrite: a list with declarations has text');
  return { tag: 'write', next };
}

export function plainStyleBranch(text: string): StyleBranch {
  assert(text.length <= LIMITS.attrCharsMax, 'plainStyleBranch: an attribute is inside its bound');
  return { key: '0', ...alwaysBranchLabel(), start: 0, end: text.length, form: { kind: 'string', quote: '"' }, body: text };
}

export function plainStyleCommit(body: string): InlineWrite {
  if (body.length > LIMITS.attrCharsMax) {
    return { tag: 'refused', ...described('styleModel.inline.refusal.tooLong') };
  }
  if (body.trim() === '') {
    return { tag: 'write', next: undefined };
  }
  if (readInlineStyle(body) === undefined) {
    return { tag: 'refused', ...described('styleModel.inline.refusal.notDeclarations') };
  }
  return { tag: 'write', next: body };
}

export interface HeldInlineWrite {
  readonly nodeId: string;
  readonly base: string | undefined;
  readonly next: string | undefined;
}

export function heldUntilTaken(held: HeldInlineWrite | undefined, hostTexts: readonly (string | undefined)[]): HeldInlineWrite | undefined {
  if (held === undefined) {
    return undefined;
  }
  if (hostTexts.includes(held.next)) {
    return undefined;
  }
  return held;
}

export function inlineEditBase(hostText: string | undefined, nodeId: string, held: HeldInlineWrite | undefined): string {
  if (held === undefined) {
    return hostText ?? '';
  }
  if (held.nodeId !== nodeId) {
    return hostText ?? '';
  }
  if (held.base === hostText) {
    return held.next ?? '';
  }
  return hostText ?? '';
}
