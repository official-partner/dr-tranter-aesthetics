
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { propNamed } from '../../editor/loopProps';
import { textWithChip, type FieldFocus } from './fieldFocus';

export type TextPiece = { readonly kind: 'text'; readonly value: string } | { readonly kind: 'expr'; readonly value: string };

const PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

export function connectedPieces(value: string, focus: FieldFocus, path: string): readonly TextPiece[] {
  assert(PATH.test(path), 'connectedPieces: a picked chip is a path');
  const { before, after } = textWithChip(value, focus, path);
  const pieces: TextPiece[] = [];
  if (before.length > 0) {
    pieces.push({ kind: 'text', value: before });
  }
  pieces.push({ kind: 'expr', value: `{${path}}` });
  if (after.length > 0) {
    pieces.push({ kind: 'text', value: after });
  }
  assert(pieces.length <= 3, 'connectedPieces: words, a chip, words');
  return pieces;
}

export function connectedPath(expression: string): string | undefined {
  assert(expression.length <= LIMITS.nodeValueCharsMax, 'connectedPath: the expression is inside its bound');
  const match = /^\{\s*([^{}]*?)\s*\}$/.exec(expression);
  const path = match?.[1];
  if (path === undefined) {
    return undefined;
  }
  return PATH.test(path) ? path : undefined;
}

export function disconnectedText(path: string, frontmatter: string): string {
  assert(PATH.test(path), 'disconnectedText: a connection is a path');
  const local = path.split('.')[0] ?? path;
  const entry = propNamed(frontmatter, local);
  const span = entry?.defaultValue;
  const literal = span === undefined || path !== local ? undefined : stringLiteral(frontmatter.slice(span.from, span.to));
  const out = literal === undefined || literal.length === 0 ? path : literal;
  assert(out.length > 0, 'disconnectedText: a disconnected text has words');
  return out;
}

function stringLiteral(code: string): string | undefined {
  const text = code.trim();
  if (text.length < 2) {
    return undefined;
  }
  const quote = text.charAt(0);
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return undefined;
  }
  if (text.charAt(text.length - 1) !== quote) {
    return undefined;
  }
  const body = text.slice(1, -1);
  if (quote === '`' && body.includes('${')) {
    return undefined;
  }
  if (quote === '"') {
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return body.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
}
