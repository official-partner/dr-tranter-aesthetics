
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';

export const INLINE_CODE_SELECTOR = 'element.style';

const BRANCH_DEPTH_MAX = 8;
const BRANCHES_MAX = 16;
const SOURCE_SCAN_CHARS_MAX = 1_000_000;

export interface InlineBranch {
  readonly when: string | undefined;
  readonly css: string;
}

export function readableStyleCode(expression: string): string {
  return styleBlock(styleBranches(expression));
}

export function readableStyleText(text: string): string {
  return styleBlock([{ when: undefined, css: text }]);
}

export function styleBranches(expression: string): readonly InlineBranch[] {
  assert(expression.length <= LIMITS.attrCharsMax, 'styleBranches: an attribute is inside its bound');
  const branches: InlineBranch[] = [];
  collectBranches(expression.trim(), [], branches, 0);
  assert(branches.length <= BRANCHES_MAX + 1, 'styleBranches: bounded');
  return branches;
}

export function styleExpressionInSource(code: string): string | undefined {
  return styleExpressionSpanInSource(code)?.expression;
}

export function styleExpressionSpanInSource(code: string): { readonly expression: string; readonly start: number; readonly end: number } | undefined {
  const text = code.length <= SOURCE_SCAN_CHARS_MAX ? code : code.slice(0, SOURCE_SCAN_CHARS_MAX);
  const template = afterFrontmatter(text);
  const pattern = /\sstyle\s*=\s*\{/g;
  pattern.lastIndex = template;
  const found = pattern.exec(text);
  if (found === null) {
    return undefined;
  }
  const open = found.index + found[0].length - 1;
  const close = matchingClose(text, open);
  if (close === undefined) {
    return undefined;
  }
  const raw = text.slice(open + 1, close);
  const expression = raw.trim();
  if (expression === '' || expression.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  const start = open + 1 + (raw.length - raw.trimStart().length);
  assert(text.slice(start, start + expression.length) === expression, 'styleExpressionSpanInSource: the span is the expression');
  return { expression, start, end: start + expression.length };
}

function collectBranches(expression: string, conditions: readonly string[], out: InlineBranch[], depth: number): void {
  assert(depth <= LIMITS.treeDepthMax, 'collectBranches: nesting is bounded');
  if (out.length >= BRANCHES_MAX) {
    return;
  }
  const inner = unwrapParens(expression);
  const ternary = depth < BRANCH_DEPTH_MAX ? splitTernary(inner) : undefined;
  if (ternary !== undefined) {
    collectBranches(ternary.then, [...conditions, whenSet(ternary.test)], out, depth + 1);
    collectBranches(ternary.otherwise, [...conditions, OTHERWISE], out, depth + 1);
    return;
  }
  const and = depth < BRANCH_DEPTH_MAX ? splitLastAnd(inner) : undefined;
  if (and !== undefined) {
    collectBranches(and.value, [...conditions, whenSet(and.test)], out, depth + 1);
    return;
  }
  const css = valueText(inner);
  if (css === undefined) {
    return;
  }
  out.push({ when: conditions.length === 0 ? undefined : conditionText(conditions), css });
}

function valueText(expression: string): string | undefined {
  if (expression === '' || expression === 'undefined' || expression === 'null' || expression === 'false') {
    return undefined;
  }
  const quote = expression.charAt(0);
  const closed = expression.length >= 2 && expression.charAt(expression.length - 1) === quote;
  if ((quote === '"' || quote === "'") && closed) {
    const text = expression.slice(1, -1).trim();
    return text === '' ? undefined : text;
  }
  if (quote === '`' && closed) {
    const text = templateText(expression.slice(1, -1)).trim();
    return text === '' ? undefined : text;
  }
  return `{${expression}}`;
}

function templateText(body: string): string {
  let out = '';
  let index = 0;
  while (index < body.length) {
    if (body.startsWith('${', index)) {
      const close = matchingClose(body, index + 1);
      if (close === undefined) {
        return out + body.slice(index);
      }
      out += `{${body.slice(index + 2, close).trim()}}`;
      index = close + 1;
    } else {
      out += body.charAt(index);
      index += 1;
    }
  }
  return out;
}

const OTHERWISE = 'otherwise';

function conditionText(conditions: readonly string[]): string {
  return conditions.map((condition) => (condition === OTHERWISE ? condition : `when ${condition}`)).join(', ');
}

export function plainTestName(test: string): string | undefined {
  const trimmed = test.trim();
  return /^[A-Za-z_$][\w$.]*$/.test(trimmed) ? trimmed : undefined;
}

export function whenSet(test: string): string {
  const name = plainTestName(test);
  return name === undefined ? test.trim() : `${name} is set`;
}

function styleBlock(branches: readonly InlineBranch[]): string {
  const lines = [`${INLINE_CODE_SELECTOR} {`];
  for (const branch of branches) {
    if (branch.when !== undefined) {
      lines.push(`  /* ${branch.when} */`);
    }
    for (const declaration of declarationLines(branch.css)) {
      lines.push(`  ${declaration}`);
    }
  }
  if (branches.length === 0) {
    lines.push('  /* renders no declarations */');
  }
  lines.push('}');
  return lines.join('\n');
}

function declarationLines(css: string): readonly string[] {
  const lines: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css.charAt(index);
    if (char === '{' || char === '(') {
      depth += 1;
    } else if (char === '}' || char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      lines.push(css.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest !== '') {
    lines.push(rest.endsWith('}') || rest.endsWith(';') ? rest : `${rest};`);
  }
  return lines.filter((line) => line !== '' && line !== ';');
}

export function unwrapParens(expression: string): string {
  let current = expression.trim();
  for (let round = 0; round < BRANCH_DEPTH_MAX && current.startsWith('('); round += 1) {
    if (matchingClose(current, 0) !== current.length - 1) {
      break;
    }
    current = current.slice(1, -1).trim();
  }
  return current;
}

export function splitTernary(expression: string): { readonly test: string; readonly then: string; readonly otherwise: string } | undefined {
  const at = ternaryIndices(expression);
  if (at === undefined) {
    return undefined;
  }
  return {
    test: expression.slice(0, at.question).trim(),
    then: expression.slice(at.question + 1, at.colon).trim(),
    otherwise: expression.slice(at.colon + 1).trim(),
  };
}

export function ternaryIndices(expression: string): { readonly question: number; readonly colon: number } | undefined {
  const question = topLevelIndex(expression, (text, index) => text.charAt(index) === '?' && !isOptionalOrNullish(text, index));
  if (question === undefined) {
    return undefined;
  }
  let pending = 0;
  const colon = topLevelIndex(expression, (text, index) => {
    if (index <= question) {
      return false;
    }
    const char = text.charAt(index);
    if (char === '?' && !isOptionalOrNullish(text, index)) {
      pending += 1;
      return false;
    }
    if (char !== ':') {
      return false;
    }
    if (pending > 0) {
      pending -= 1;
      return false;
    }
    return true;
  });
  return colon === undefined ? undefined : { question, colon };
}

function splitLastAnd(expression: string): { readonly test: string; readonly value: string } | undefined {
  let last: number | undefined;
  topLevelIndex(expression, (text, index) => {
    if (text.startsWith('&&', index)) {
      last = index;
    }
    return false;
  });
  if (last === undefined) {
    return undefined;
  }
  return { test: expression.slice(0, last).trim(), value: expression.slice(last + 2).trim() };
}

function isOptionalOrNullish(text: string, index: number): boolean {
  const next = text.charAt(index + 1);
  const previous = text.charAt(index - 1);
  return next === '?' || previous === '?' || (next === '.' && !/\d/.test(text.charAt(index + 2)));
}

export function topLevelIndex(text: string, hit: (text: string, index: number) => boolean): number | undefined {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(text, index);
      if (end === undefined) {
        return undefined;
      }
      index = end;
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    } else if (depth === 0 && hit(text, index)) {
      return index;
    }
  }
  return undefined;
}

export function matchingClose(text: string, open: number): number | undefined {
  const pairs: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let index = open; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(text, index);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      continue;
    }
    const closer = pairs[char];
    if (closer !== undefined) {
      stack.push(closer);
    } else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return undefined;
}

export function stringEnd(text: string, start: number): number | undefined {
  const quote = text.charAt(start);
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (quote === '`' && text.startsWith('${', index)) {
      const close = matchingClose(text, index + 1);
      if (close === undefined) {
        return undefined;
      }
      index = close;
    } else if (char === quote) {
      return index;
    }
  }
  return undefined;
}

function afterFrontmatter(text: string): number {
  const start = text.length - text.trimStart().length;
  if (!text.startsWith('---', start)) {
    return 0;
  }
  const end = text.indexOf('\n---', start + 3);
  return end === -1 ? text.length : end + '\n---'.length;
}
