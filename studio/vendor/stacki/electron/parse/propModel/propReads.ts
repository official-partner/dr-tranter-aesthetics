
import ts from 'typescript';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { PropDefault } from '../../../shared/properties/propSchema';
import { isAstroProps, syntaxNodes } from '../astroSyntax';
import type { PropsPattern } from './propDeclarations';
import { memberKey } from './propTypes';

export interface PropEntry {
  readonly name: string;
  readonly fallback: EntryFallback;
}

export type EntryFallback =
  | { readonly kind: 'none' }
  | { readonly kind: 'literal'; readonly value: PropDefault }
  | { readonly kind: 'expression'; readonly code: string; readonly shape: 'array' | 'object' | 'function' | 'other' };

export interface PropReads {
  readonly patterns: readonly PropsPattern[];
  readonly entries: readonly PropEntry[];
  readonly direct: readonly string[];
  readonly escapes: boolean;
}

const READS_MAX = 512;

export function readProps(frontmatter: ts.SourceFile, template: string): PropReads {
  const nodes = [...syntaxNodes(frontmatter)].sort((first, second) => first.pos - second.pos || second.end - first.end);
  const holders = new Set<string>();
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isAstroProps(node.initializer)) {
      holders.add(node.name.text);
    }
  }
  const patterns: PropsPattern[] = [];
  const direct: string[] = [];
  let escapes = false;
  for (const node of nodes) {
    const use = propsUse(node, holders);
    if (use === undefined) {
      continue;
    }
    const outer = unwrapped(node);
    const parent = outer.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
      pushBounded(direct, parent.name.text);
    } else if (ts.isElementAccessExpression(parent) && parent.expression === outer && ts.isStringLiteralLike(parent.argumentExpression)) {
      pushBounded(direct, parent.argumentExpression.text);
    } else if (ts.isVariableDeclaration(parent) && parent.initializer === outer && ts.isObjectBindingPattern(parent.name)) {
      patterns.push({ pattern: parent.name, annotation: parent.type });
      escapes ||= parent.name.elements.some((element) => element.dotDotDotToken !== undefined);
    } else if (ts.isVariableDeclaration(parent) && parent.initializer === outer && ts.isIdentifier(parent.name) && use === 'astro') {
    } else {
      escapes = true;
    }
  }
  const templateUse = templateReads(template, holders);
  const entries = destructureEntries(patterns, frontmatter);
  assert(entries.length <= LIMITS.propSchemaFieldsMax, 'readProps: entries are bounded');
  return { patterns, entries, direct: [...direct, ...templateUse.direct].slice(0, READS_MAX), escapes: escapes || templateUse.escapes };
}

function pushBounded(out: string[], name: string): void {
  if (out.length < READS_MAX && name !== '') {
    out.push(name);
  }
}

function propsUse(node: ts.Node, holders: ReadonlySet<string>): 'astro' | 'holder' | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Astro' && node.name.text === 'props') {
    return 'astro';
  }
  if (!ts.isIdentifier(node) || !holders.has(node.text)) {
    return undefined;
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.name === node) {
    return undefined;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return undefined;
  }
  if (ts.isBindingElement(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) {
    return undefined;
  }
  return 'holder';
}

const WRAPPERS_MAX = 16;
function unwrapped(node: ts.Node): ts.Node {
  let current = node;
  for (let step = 0; step < WRAPPERS_MAX; step++) {
    const parent = current.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)) {
      current = parent;
    } else {
      break;
    }
  }
  return current;
}

function destructureEntries(patterns: readonly PropsPattern[], file: ts.SourceFile): readonly PropEntry[] {
  const entries = new Map<string, PropEntry>();
  for (const { pattern } of patterns) {
    for (const element of pattern.elements) {
      if (element.dotDotDotToken !== undefined || entries.size >= LIMITS.propSchemaFieldsMax) {
        continue;
      }
      const name = memberKey(element.propertyName ?? element.name);
      if (name === undefined || entries.has(name)) {
        continue;
      }
      entries.set(name, { name, fallback: element.initializer === undefined ? { kind: 'none' } : entryFallback(element.initializer, file) });
    }
  }
  return [...entries.values()];
}

export function entryFallback(initializer: ts.Expression, file: ts.SourceFile): EntryFallback {
  const literal = literalValue(initializer);
  if (literal !== undefined) {
    return { kind: 'literal', value: literal };
  }
  const code = initializer.getText(file);
  const inner = ts.isParenthesizedExpression(initializer) ? initializer.expression : initializer;
  if (ts.isArrayLiteralExpression(inner)) {
    return { kind: 'expression', code, shape: 'array' };
  }
  if (ts.isObjectLiteralExpression(inner)) {
    return { kind: 'expression', code, shape: 'object' };
  }
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
    return { kind: 'expression', code, shape: 'function' };
  }
  return { kind: 'expression', code, shape: 'other' };
}

export function literalValue(node: ts.Expression): PropDefault | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    const value = -Number(node.operand.text);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function templateReads(template: string, holders: ReadonlySet<string>): { readonly direct: readonly string[]; readonly escapes: boolean } {
  const direct: string[] = [];
  let escapes = false;
  const owners = ['Astro\\.props', ...[...holders].map((name) => name.replace(/\$/g, '\\$'))];
  const mention = new RegExp(
    String.raw`(?<![\w$])(?<![^.]\.)(?:${owners.join('|')})(?![\w$])(\s*\.\s*([A-Za-z_$][\w$]*)|\s*\[\s*(?:"([^"\n]+)"|'([^'\n]+)')\s*\])?`,
    'g',
  );
  let reads = 0;
  for (const match of template.matchAll(mention)) {
    reads++;
    if (reads > READS_MAX) {
      break;
    }
    const name = match[2] ?? match[3] ?? match[4];
    if (name === undefined) {
      escapes = true;
    } else {
      pushBounded(direct, name);
    }
  }
  return { direct, escapes };
}

export function nullishFallbacks(frontmatter: ts.SourceFile): ReadonlyMap<string, PropDefault> {
  const out = new Map<string, PropDefault>();
  const declarations = syntaxNodes(frontmatter)
    .filter(ts.isVariableDeclaration)
    .sort((first, second) => first.pos - second.pos);
  for (const declaration of declarations) {
    const initializer = declaration.initializer;
    if (!ts.isIdentifier(declaration.name) || (declaration.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0 || out.has(declaration.name.text)) {
      continue;
    }
    if (initializer === undefined || !ts.isBinaryExpression(initializer) || initializer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) {
      continue;
    }
    const value = isNameChain(initializer.left) ? literalValue(initializer.right) : undefined;
    if (value !== undefined) {
      out.set(declaration.name.text, value);
    }
  }
  assert(out.size <= declarations.length, 'nullishFallbacks: one fallback per declaration at most');
  return out;
}

const CHAIN_DEPTH_MAX = 8;
function isNameChain(node: ts.Expression): boolean {
  let current = node;
  for (let depth = 0; depth < CHAIN_DEPTH_MAX; depth++) {
    if (ts.isIdentifier(current)) {
      return true;
    }
    if (!ts.isPropertyAccessExpression(current)) {
      return false;
    }
    current = current.expression;
  }
  return false;
}
