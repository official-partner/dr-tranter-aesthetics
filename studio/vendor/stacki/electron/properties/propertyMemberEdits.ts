
import ts from 'typescript';
import { assert } from '../../shared/core/assert';
import type { ComponentProperty } from '../../shared/properties/propertyEditing';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';
import { defaultExpression, propertyNameText } from './propertySyntax';
import type { SourceEdit } from './propertySyntax';

export interface MemberComment {
  readonly start: number;
  readonly end: number;
  readonly kind: 'jsdoc' | 'lines';
  readonly description: string;
}

export type DeclaredFields = Pick<ComponentProperty, 'name' | 'type' | 'required' | 'readonly' | 'description'>;

const MEMBER_COMMENTS_MAX = 256;

export function sameProperty(left: ComponentProperty, right: ComponentProperty): boolean {
  return sameDeclaration(left, right) && left.defaultValue.trim() === right.defaultValue.trim();
}

export function sameDeclaration(left: DeclaredFields, right: DeclaredFields): boolean {
  if (left.name !== right.name) {
    return false;
  }
  if (left.type !== right.type) {
    return false;
  }
  if (left.required !== right.required) {
    return false;
  }
  if (left.readonly !== right.readonly) {
    return false;
  }
  return left.description === right.description;
}

export function memberComment(frontmatter: string, member: ts.PropertySignature): MemberComment | undefined {
  const ranges = [
    ...(ts.getTrailingCommentRanges(frontmatter, member.getFullStart()) ?? []),
    ...(ts.getLeadingCommentRanges(frontmatter, member.getFullStart()) ?? []),
  ];
  assert(ranges.length <= MEMBER_COMMENTS_MAX, 'memberComment: the comments above a member are bounded');
  const last = ranges.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const lastText = frontmatter.slice(last.pos, last.end);
  if (last.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
    const trailsPrevious = !ownLine(frontmatter, last.pos) && frontmatter.slice(last.end, member.getStart()).includes('\n');
    if (trailsPrevious) {
      return undefined;
    }
    return lastText.startsWith('/**') && lastText.length >= 5 ? { start: last.pos, end: last.end, kind: 'jsdoc', description: jsdocText(lastText) } : undefined;
  }
  let first = ranges.length - 1;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    assert(range !== undefined, 'memberComment: a comment range exists');
    if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia || !ownLine(frontmatter, range.pos)) {
      break;
    }
    const next = ranges[index + 1];
    if (next !== undefined && /\n[^\S\n]*\n/.test(frontmatter.slice(range.end, next.pos))) {
      break;
    }
    first = index;
  }
  const opening = ranges[first];
  assert(opening !== undefined, 'memberComment: the first comment exists');
  if (opening.kind !== ts.SyntaxKind.SingleLineCommentTrivia || !ownLine(frontmatter, opening.pos)) {
    return undefined;
  }
  const lines = ranges.slice(first).map((range) =>
    frontmatter
      .slice(range.pos + 2, range.end)
      .replace(/^ /, '')
      .trimEnd(),
  );
  return { start: opening.pos, end: last.end, kind: 'lines', description: lines.join('\n').trim() };
}

export function memberEdits(
  frontmatter: string,
  member: ts.PropertySignature,
  previous: DeclaredFields,
  property: DeclaredFields,
  typeTarget: ts.TypeNode | undefined = member.type,
): readonly SourceEdit[] {
  assert(property.name.length > 0, 'memberEdits: the saved property has a name');
  assert(property.description.length <= PROPERTY_LIMITS.textCharsMax, 'memberEdits: the tooltip is bounded');
  const edits: SourceEdit[] = [];
  const head = headEdit(frontmatter, member, previous, property);
  if (head !== undefined) {
    edits.push(head);
  }
  if (property.type !== previous.type && typeTarget !== undefined) {
    assert(member.type !== undefined, 'memberEdits: a type target belongs to a typed member');
    edits.push({ start: typeTarget.getStart(), end: typeTarget.end, text: property.type });
  }
  return edits;
}

export function bindingEdits(
  binding: ts.BindingElement,
  previous: Pick<ComponentProperty, 'name' | 'defaultValue'>,
  property: ComponentProperty,
): readonly SourceEdit[] {
  assert(binding.dotDotDotToken === undefined, 'bindingEdits: a rest binding has no key or default');
  const edits: SourceEdit[] = [];
  const local = binding.name.getText();
  if (property.name !== previous.name) {
    if (binding.propertyName !== undefined) {
      edits.push(
        property.name === local
          ? { start: binding.propertyName.getStart(), end: binding.name.getStart(), text: '' }
          : { start: binding.propertyName.getStart(), end: binding.propertyName.end, text: propertyNameText(property.name) },
      );
    } else {
      edits.push({ start: binding.name.getStart(), end: binding.name.getStart(), text: `${propertyNameText(property.name)}: ` });
    }
  }
  const fallback = property.defaultValue.trim();
  if (fallback !== previous.defaultValue.trim()) {
    if (binding.initializer === undefined) {
      edits.push({ start: binding.name.end, end: binding.name.end, text: ` = ${defaultExpression(fallback)}` });
    } else if (fallback === '') {
      edits.push({ start: binding.name.end, end: binding.initializer.end, text: '' });
    } else {
      edits.push({ start: binding.initializer.getStart(), end: binding.initializer.end, text: defaultExpression(fallback) });
    }
  }
  assert(edits.length <= 2, 'bindingEdits: at most the key and the default change');
  return edits;
}

function headEdit(frontmatter: string, member: ts.PropertySignature, previous: DeclaredFields, property: DeclaredFields): SourceEdit | undefined {
  const comment = memberComment(frontmatter, member);
  const tokenStart = member.getStart();
  const nameStart = member.name.getStart();
  const headEnd = member.questionToken?.end ?? member.name.end;
  const start = comment?.start ?? tokenStart;
  const leading = frontmatter.slice(start, tokenStart);
  const commentPart = property.description === previous.description ? leading : commentText(frontmatter, member, comment, property.description);
  const modifiers = frontmatter.slice(tokenStart, nameStart);
  const modifierText =
    property.readonly === previous.readonly ? modifiers : property.readonly ? `${modifiers}readonly ` : modifiers.replace(/\breadonly\s+/, '');
  const nameText =
    property.name === previous.name && property.required === previous.required
      ? frontmatter.slice(nameStart, headEnd)
      : `${propertyNameText(property.name)}${property.required ? '' : '?'}`;
  const typeText = member.type === undefined && property.type !== previous.type ? `: ${property.type}` : '';
  const text = `${commentPart}${modifierText}${nameText}${typeText}`;
  if (text === frontmatter.slice(start, headEnd)) {
    return undefined;
  }
  return { start, end: headEnd, text };
}

function commentText(frontmatter: string, member: ts.PropertySignature, comment: MemberComment | undefined, description: string): string {
  const tokenStart = member.getStart();
  const trimmed = description.trim();
  if (comment !== undefined) {
    if (trimmed === '') {
      return '';
    }
    const multiline = comment.kind === 'jsdoc' ? frontmatter.slice(comment.start, comment.end).includes('\n') : comment.description.includes('\n');
    return renderComment(trimmed, lineIndent(frontmatter, comment.start), { multiline }) + frontmatter.slice(comment.end, tokenStart);
  }
  if (trimmed === '') {
    return '';
  }
  const indent = lineIndent(frontmatter, tokenStart);
  const separator = ownLine(frontmatter, tokenStart) ? `\n${indent}` : ' ';
  return renderComment(trimmed, indent, { multiline: false }) + separator;
}

export function renderComment(description: string, indent: string, layout: { readonly multiline: boolean }): string {
  const lines = description.replace(/\*\//g, '* /').split('\n');
  if (!layout.multiline && lines.length === 1) {
    return `/** ${lines[0] ?? ''} */`;
  }
  return `/**\n${lines.map((line) => `${indent} *${line.trim() === '' ? '' : ` ${line.trimEnd()}`}`).join('\n')}\n${indent} */`;
}

function jsdocText(text: string): string {
  return text
    .slice(3, -2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, ''))
    .join('\n')
    .trim();
}

function ownLine(text: string, position: number): boolean {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return text.slice(lineStart, position).trim() === '';
}

function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[^\S\n]*/.exec(text.slice(lineStart, position))?.[0] ?? '';
}
