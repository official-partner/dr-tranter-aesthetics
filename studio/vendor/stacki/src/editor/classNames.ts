import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

import type { Attr } from '../../shared/page/pageNode';
export interface ClassNode {
  readonly name?: string;
  readonly props?: Readonly<Record<string, Attr>>;
}


const QUOTED = /^(['"])(.*)\1$/s;

function topLevelParts(body: string): readonly string[] {
  assert(body.length <= LIMITS.nodeValueCharsMax, 'Class expression exceeds size limit');
  const parts = [];
  let depth = 0;
  let quote: string | undefined = undefined;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i);
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += body[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function fromExpression(expr: unknown): readonly string[] {
  const trimmed = String(expr || '').trim();
  const body = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  const out = [];
  for (const part of topLevelParts(body)) {
    const match = QUOTED.exec(part.trim());
    if (match?.[2] !== undefined) {
      out.push(...match[2].replace(/\\(.)/g, '$1').split(/\s+/).filter(Boolean));
    }
  }
  return out;
}

export function elementClasses(node: ClassNode | undefined): readonly string[] {
  const props = node?.props || {};
  const cls = props['class'];
  if (cls && cls.type === 'string') {
    return cls.value.trim().split(/\s+/).filter(Boolean);
  }
  const list = props['class:list'];
  if (list && list.type === 'expr') {
    return fromExpression(list.value);
  }
  if (cls && cls.type === 'expr') {
    return fromExpression(cls.value);
  }
  return [];
}

export function elementLabel(node: ClassNode | undefined): string {
  if (node?.name === 'slot') {
    const named = node.props?.['name'];
    if (named && named.type === 'string' && named.value.trim()) {
      return named.value.trim();
    }
  }
  const firstClass = elementClasses(node)[0];
  return firstClass ? classLabel(firstClass) : node?.name || '';
}

export function classLabel(name: string): string {
  assert(name !== '', 'classLabel: a class has a name');
  assert(!name.startsWith('.'), 'classLabel: the name has no dot yet');
  return `.${name}`;
}
