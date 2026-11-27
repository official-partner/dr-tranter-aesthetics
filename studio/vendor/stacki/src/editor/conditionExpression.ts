
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { CONDITIONAL_LIMITS, isReferencePath, quoteOf, type GroupMatch, type Quote } from './conditionalValue';
import { needsParentheses } from './conditionCodeScan';

export const CONDITION_EXPRESSION_LIMITS = {
  groupsMax: CONDITIONAL_LIMITS.groupsMax,
  conditionsPerGroupMax: CONDITIONAL_LIMITS.conditionsPerGroupMax,
  tokensMax: CONDITIONAL_LIMITS.tokensMax,
  parenthesesDepthMax: CONDITIONAL_LIMITS.parenthesesDepthMax,
  subjectCharsMax: CONDITIONAL_LIMITS.referenceCharsMax,
  stringCharsMax: 200,
  richCodeCharsMax: 16_384,
} as const satisfies Record<string, number>;

export type ExpressionLiteral =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean };

export const VALUELESS_OPERATORS = ['isTrue', 'isFalse', 'isSet', 'isNotSet', 'isEmpty', 'isNotEmpty'] as const;
export type ValuelessOperator = (typeof VALUELESS_OPERATORS)[number];

export const VALUED_OPERATORS = [
  'equals',
  'notEquals',
  'greaterThan',
  'lessThan',
  'atLeast',
  'atMost',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'lengthEquals',
  'lengthGreaterThan',
] as const;
export type ValuedOperator = (typeof VALUED_OPERATORS)[number];

export type ExpressionOperator = ValuelessOperator | ValuedOperator | 'isAnyOf' | 'isNoneOf';

export const EXPRESSION_OPERATORS: readonly ExpressionOperator[] = [...VALUELESS_OPERATORS, ...VALUED_OPERATORS, 'isAnyOf', 'isNoneOf'];

export function takesValues(operator: ExpressionOperator): operator is ListOperator {
  return operator === 'isAnyOf' || operator === 'isNoneOf';
}

export const LIST_OPERATORS = ['isAnyOf', 'isNoneOf'] as const;
export type ListOperator = (typeof LIST_OPERATORS)[number];

export type SubjectCondition =
  | { readonly subject: string; readonly operator: ValuelessOperator }
  | { readonly subject: string; readonly operator: ValuedOperator; readonly value: ExpressionLiteral }
  | { readonly subject: string; readonly operator: ListOperator; readonly values: readonly ExpressionLiteral[] };

export interface CodeCondition {
  readonly kind: 'code';
  readonly code: string;
}

export type ExpressionCondition = SubjectCondition | CodeCondition;

export function isCodeCondition(condition: ExpressionCondition): condition is CodeCondition {
  return 'kind' in condition;
}

export interface ExpressionGroup {
  readonly match: GroupMatch;
  readonly conditions: readonly ExpressionCondition[];
}

export interface ConditionExpression {
  readonly groups: readonly ExpressionGroup[];
  readonly leading?: string;
}

export function takesValue(operator: ExpressionOperator): operator is ValuedOperator {
  return VALUED_OPERATORS.some((candidate) => candidate === operator);
}

export function ordersValues(operator: ExpressionOperator): boolean {
  return operator === 'greaterThan' || operator === 'lessThan' || operator === 'atLeast' || operator === 'atMost';
}


export function isConditionSubject(text: string): boolean {
  if (text.length === 0 || text.length > CONDITION_EXPRESSION_LIMITS.subjectCharsMax) {
    return false;
  }
  const tokens = tokenize(text);
  if (tokens === undefined) {
    return false;
  }
  const reader = new TokenReader(text, tokens);
  const path = reader.readPath();
  return path !== undefined && reader.done() && path.start === 0 && path.end === text.length;
}

export function isOptionalChainSubject(text: string): boolean {
  if (!text.includes('?.') || text.length > CONDITION_EXPRESSION_LIMITS.subjectCharsMax) {
    return false;
  }
  const plain = text.replace(/\?\.\[/g, '[').replace(/\?\./g, '.');
  return !plain.includes('?') && isConditionSubject(plain);
}


type Token =
  | { readonly kind: 'name'; readonly text: string; readonly start: number; readonly end: number }
  | { readonly kind: 'string'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: 'number'; readonly value: number; readonly start: number; readonly end: number }
  | { readonly kind: 'punctuator'; readonly text: string; readonly start: number; readonly end: number };

const PUNCTUATORS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '(', ')', '[', ']', '.', '!', '-'] as const;

const NAME = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^(?:0|[1-9]\d*)(?:\.\d+)?(?![\w$.])/;
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function readConditionExpression(code: string): ConditionExpression | undefined {
  if (code.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  if (code.trim() === '') {
    return { groups: [] };
  }
  const tokens = tokenize(code);
  if (tokens === undefined) {
    return undefined;
  }
  const reader = new TokenReader(code, tokens);
  const node = reader.readOr(0);
  if (node === undefined || !reader.done()) {
    return undefined;
  }
  const model = modelOf(node);
  if (model === undefined) {
    return undefined;
  }
  for (const group of model.groups) {
    for (const condition of group.conditions) {
      assert(!isCodeCondition(condition), 'readConditionExpression: the strict reading keeps no code');
      assert(isCodeCondition(condition) || isConditionSubject(condition.subject), 'readConditionExpression: a subject read is a subject');
    }
  }
  return model;
}

function tokenize(code: string): readonly Token[] | undefined {
  const tokens: Token[] = [];
  let index = 0;
  while (index < code.length) {
    if (tokens.length >= CONDITION_EXPRESSION_LIMITS.tokensMax) {
      return undefined;
    }
    const character = code.charAt(index);
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const step = readToken(code, index);
    if (step === undefined) {
      return undefined;
    }
    assert(step.end > index, 'tokenize: every token moves forward');
    tokens.push(step);
    index = step.end;
  }
  assert(index === code.length, 'tokenize: the whole code is read');
  return tokens;
}

function readToken(code: string, start: number): Token | undefined {
  const rest = code.slice(start);
  const name = NAME.exec(rest);
  if (name !== null) {
    return { kind: 'name', text: name[0], start, end: start + name[0].length };
  }
  const number = NUMBER.exec(rest);
  if (number !== null) {
    const value = Number(number[0]);
    return Number.isFinite(value) && PLAIN_NUMBER.test(String(value)) ? { kind: 'number', value, start, end: start + number[0].length } : undefined;
  }
  const quote = code.charAt(start);
  if (quote === "'" || quote === '"') {
    return readString(code, start, quote);
  }
  const punctuator = PUNCTUATORS.find((candidate) => rest.startsWith(candidate));
  if (punctuator !== undefined) {
    return { kind: 'punctuator', text: punctuator, start, end: start + punctuator.length };
  }
  return undefined;
}

function readString(code: string, start: number, quote: string): Token | undefined {
  const close = code.indexOf(quote, start + 1);
  if (close < 0) {
    return undefined;
  }
  const value = code.slice(start + 1, close);
  if (value.length > CONDITION_EXPRESSION_LIMITS.stringCharsMax || hasUnwritableCharacter(value)) {
    return undefined;
  }
  return { kind: 'string', value, start, end: close + 1 };
}

const UNWRITABLE_CHARACTER_CODES: ReadonlySet<number> = new Set([92, 10, 13, 0x2028, 0x2029]);

function hasUnwritableCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (UNWRITABLE_CHARACTER_CODES.has(text.charCodeAt(index))) {
      return true;
    }
  }
  return false;
}

type Node =
  | { readonly kind: 'condition'; readonly condition: ExpressionCondition }
  | { readonly kind: 'and'; readonly conditions: readonly ExpressionCondition[] }
  | { readonly kind: 'or'; readonly operands: readonly (Node & { readonly kind: 'condition' | 'and' })[] };

interface PathRead {
  readonly start: number;
  readonly end: number;
  readonly stepEnds: readonly number[];
  readonly lastName: string | undefined;
}

const METHOD_OPERATORS: ReadonlyMap<string, ValuedOperator> = new Map([
  ['includes', 'contains'],
  ['startsWith', 'startsWith'],
  ['endsWith', 'endsWith'],
]);

const COMPARATORS: ReadonlySet<string> = new Set(['===', '!==', '==', '!=', '>', '<', '>=', '<=']);

class TokenReader {
  private index = 0;

  constructor(
    private readonly code: string,
    private readonly tokens: readonly Token[],
  ) {
    assert(tokens.length <= CONDITION_EXPRESSION_LIMITS.tokensMax, 'TokenReader: the tokens are bounded');
  }

  done(): boolean {
    return this.index === this.tokens.length;
  }

  readOr(depth: number): Node | undefined {
    const operands: (Node & { readonly kind: 'condition' | 'and' })[] = [];
    for (let round = 0; round <= this.tokens.length; round += 1) {
      const operand = this.readAnd(depth);
      if (operand === undefined) {
        return undefined;
      }
      if (operand.kind === 'or') {
        operands.push(...operand.operands);
      } else {
        operands.push(operand);
      }
      if (!this.take('||')) {
        const [only] = operands;
        return operands.length === 1 && only !== undefined ? only : { kind: 'or', operands };
      }
    }
    return undefined;
  }

  private readAnd(depth: number): Node | undefined {
    const conditions: ExpressionCondition[] = [];
    let wholeOr: Node | undefined;
    let units = 0;
    for (let round = 0; round <= this.tokens.length; round += 1) {
      const unit = this.readUnit(depth);
      if (unit === undefined) {
        return undefined;
      }
      units += 1;
      if (unit.kind === 'or') {
        wholeOr = unit;
      } else if (unit.kind === 'condition') {
        conditions.push(unit.condition);
      } else {
        conditions.push(...unit.conditions);
      }
      if (!this.take('&&')) {
        if (wholeOr !== undefined) {
          return units === 1 ? wholeOr : undefined;
        }
        const [only] = conditions;
        return conditions.length === 1 && only !== undefined ? { kind: 'condition', condition: only } : { kind: 'and', conditions };
      }
    }
    return undefined;
  }

  private readUnit(depth: number): Node | undefined {
    if (this.take('(')) {
      if (depth + 1 > CONDITION_EXPRESSION_LIMITS.parenthesesDepthMax) {
        return undefined;
      }
      const inner = this.readOr(depth + 1);
      return inner !== undefined && this.take(')') ? inner : undefined;
    }
    const condition = this.readCondition();
    return condition === undefined ? undefined : { kind: 'condition', condition };
  }

  private readCondition(): ExpressionCondition | undefined {
    const negated = this.take('!');
    const path = this.readPath();
    if (path === undefined) {
      return undefined;
    }
    if (path.lastName !== undefined && METHOD_OPERATORS.has(path.lastName) && this.isPunctuator('(')) {
      return this.readMethod(path, { negated });
    }
    const comparator = this.comparator();
    if (comparator === undefined) {
      const subject = this.text(path.start, path.end);
      return { subject, operator: negated ? 'isFalse' : 'isTrue' };
    }
    if (negated) {
      return undefined;
    }
    return this.readComparison(path, comparator);
  }

  private readMethod(path: PathRead, options: { readonly negated: boolean }): ExpressionCondition | undefined {
    const before = path.stepEnds[path.stepEnds.length - 2];
    if (before === undefined || path.stepEnds.length < 2 || path.lastName === undefined) {
      return undefined;
    }
    const operator = METHOD_OPERATORS.get(path.lastName);
    if (operator === undefined) {
      return undefined;
    }
    this.take('(');
    const value = this.readLiteral();
    if (value === undefined || !this.take(')')) {
      return undefined;
    }
    if (operator !== 'contains' && (options.negated || value.kind !== 'string')) {
      return undefined;
    }
    const named = operator === 'contains' && options.negated ? 'notContains' : operator;
    return { subject: this.text(path.start, before), operator: named, value };
  }

  private readComparison(path: PathRead, comparator: string): ExpressionCondition | undefined {
    const subject = this.text(path.start, path.end);
    if (comparator === '==' || comparator === '!=') {
      const word = this.tokens[this.index];
      if (word === undefined || word.kind !== 'name' || word.text !== 'null') {
        return undefined;
      }
      this.index += 1;
      return { subject, operator: comparator === '!=' ? 'isSet' : 'isNotSet' };
    }
    const value = this.readLiteral();
    if (value === undefined) {
      return undefined;
    }
    const operator = valuedOperatorOf(comparator);
    if (operator === undefined) {
      return undefined;
    }
    if (ordersValues(operator) && value.kind === 'boolean') {
      return undefined;
    }
    const lengthSubject = this.lengthSubject(path);
    if (lengthSubject !== undefined && value.kind === 'number' && Number.isInteger(value.value) && value.value >= 0) {
      if (operator === 'equals') {
        return value.value === 0 ? { subject: lengthSubject, operator: 'isEmpty' } : { subject: lengthSubject, operator: 'lengthEquals', value };
      }
      if (operator === 'greaterThan') {
        return value.value === 0 ? { subject: lengthSubject, operator: 'isNotEmpty' } : { subject: lengthSubject, operator: 'lengthGreaterThan', value };
      }
    }
    return { subject, operator, value };
  }

  private lengthSubject(path: PathRead): string | undefined {
    const before = path.stepEnds[path.stepEnds.length - 2];
    if (path.lastName !== 'length' || before === undefined) {
      return undefined;
    }
    return this.text(path.start, before);
  }

  private text(start: number, end: number): string {
    assert(start < end, 'TokenReader.text: a name is not empty');
    return this.code.slice(start, end);
  }

  readPath(): PathRead | undefined {
    const first = this.tokens[this.index];
    if (first === undefined || first.kind !== 'name' || !isReferencePath(first.text)) {
      return undefined;
    }
    this.index += 1;
    const stepEnds = [first.end];
    let lastName: string | undefined = first.text;
    let end = first.end;
    for (let round = 0; round <= this.tokens.length; round += 1) {
      const next = this.tokens[this.index];
      if (next === undefined || next.kind !== 'punctuator' || next.start !== end) {
        break;
      }
      if (next.text === '.') {
        const name = this.tokens[this.index + 1];
        if (name === undefined || name.kind !== 'name' || name.start !== next.end) {
          return undefined;
        }
        this.index += 2;
        end = name.end;
        lastName = name.text;
      } else if (next.text === '[') {
        const key = this.tokens[this.index + 1];
        const close = this.tokens[this.index + 2];
        const isKey = key !== undefined && (key.kind === 'string' || key.kind === 'number') && key.start === next.end;
        if (!isKey || close === undefined || close.kind !== 'punctuator' || close.text !== ']' || close.start !== key.end) {
          return undefined;
        }
        this.index += 3;
        end = close.end;
        lastName = undefined;
      } else {
        break;
      }
      stepEnds.push(end);
    }
    return { start: first.start, end, stepEnds, lastName };
  }

  private readLiteral(): ExpressionLiteral | undefined {
    const token = this.tokens[this.index];
    if (token === undefined) {
      return undefined;
    }
    if (token.kind === 'string') {
      this.index += 1;
      return { kind: 'string', value: token.value };
    }
    if (token.kind === 'number') {
      this.index += 1;
      return { kind: 'number', value: token.value };
    }
    if (token.kind === 'name' && (token.text === 'true' || token.text === 'false')) {
      this.index += 1;
      return { kind: 'boolean', value: token.text === 'true' };
    }
    const digits = this.tokens[this.index + 1];
    if (token.kind === 'punctuator' && token.text === '-' && digits !== undefined && digits.kind === 'number' && digits.start === token.end) {
      this.index += 2;
      return { kind: 'number', value: -digits.value };
    }
    return undefined;
  }

  private isPunctuator(text: string): boolean {
    const token = this.tokens[this.index];
    return token !== undefined && token.kind === 'punctuator' && token.text === text;
  }

  private comparator(): string | undefined {
    const token = this.tokens[this.index];
    if (token !== undefined && token.kind === 'punctuator' && COMPARATORS.has(token.text)) {
      this.index += 1;
      return token.text;
    }
    return undefined;
  }

  private take(text: string): boolean {
    if (this.isPunctuator(text)) {
      this.index += 1;
      return true;
    }
    return false;
  }
}

function valuedOperatorOf(comparator: string): ValuedOperator | undefined {
  switch (comparator) {
    case '===':
      return 'equals';
    case '!==':
      return 'notEquals';
    case '>':
      return 'greaterThan';
    case '<':
      return 'lessThan';
    case '>=':
      return 'atLeast';
    case '<=':
      return 'atMost';
    default:
      return undefined;
  }
}

function modelOf(node: Node): ConditionExpression | undefined {
  let groups: ExpressionGroup[];
  if (node.kind === 'condition') {
    groups = [{ match: 'all', conditions: [node.condition] }];
  } else if (node.kind === 'and') {
    groups = [{ match: 'all', conditions: node.conditions }];
  } else if (node.operands.every((operand) => operand.kind === 'condition')) {
    groups = [{ match: 'any', conditions: node.operands.flatMap((operand) => (operand.kind === 'condition' ? [operand.condition] : [])) }];
  } else {
    groups = node.operands.map((operand) => ({ match: 'all', conditions: operand.kind === 'condition' ? [operand.condition] : operand.conditions }));
  }
  if (groups.length > CONDITION_EXPRESSION_LIMITS.groupsMax) {
    return undefined;
  }
  if (groups.some((group) => group.conditions.length > CONDITION_EXPRESSION_LIMITS.conditionsPerGroupMax)) {
    return undefined;
  }
  return { groups };
}


export interface ExpressionWriteOptions {
  readonly quote: Quote;
}

export function isWritableLiteral(literal: ExpressionLiteral): boolean {
  if (literal.kind === 'boolean') {
    return true;
  }
  if (literal.kind === 'number') {
    return Number.isFinite(literal.value) && PLAIN_NUMBER.test(String(literal.value));
  }
  const text = literal.value;
  if (text.length > CONDITION_EXPRESSION_LIMITS.stringCharsMax || hasUnwritableCharacter(text)) {
    return false;
  }
  return !(text.includes('"') && text.includes("'"));
}

export function emitConditionExpression(model: ConditionExpression, options: ExpressionWriteOptions): string {
  assert(model.groups.length <= CONDITION_EXPRESSION_LIMITS.groupsMax, 'emitConditionExpression: the groups are bounded');
  const alone = model.groups.length === 1;
  const parts = model.groups.map((group) => {
    assert(group.conditions.length > 0, 'emitConditionExpression: a group holds a condition');
    assert(group.conditions.length <= CONDITION_EXPRESSION_LIMITS.conditionsPerGroupMax, 'emitConditionExpression: the conditions are bounded');
    const joined = group.conditions.map((condition) => conditionCode(condition, options)).join(group.match === 'all' ? ' && ' : ' || ');
    return alone || group.conditions.length === 1 ? joined : `(${joined})`;
  });
  const joined = parts.join(' || ');
  return model.leading === undefined ? joined : `${model.leading} ${joined}`;
}

export function conditionCode(condition: ExpressionCondition, options: ExpressionWriteOptions): string {
  if (isCodeCondition(condition)) {
    assert(condition.code.trim().length > 0, 'conditionCode: locked code is not blank');
    return needsParentheses(condition.code) ? `(${condition.code})` : condition.code;
  }
  assert(condition.subject.length > 0, 'conditionCode: a condition names something');
  const { subject } = condition;
  switch (condition.operator) {
    case 'isAnyOf':
    case 'isNoneOf': {
      assert(condition.values.length > 0, 'conditionCode: a list holds a value');
      const list = `[${condition.values.map((value) => literalCode(value, options)).join(', ')}].includes(${subject})`;
      return condition.operator === 'isAnyOf' ? list : `!${list}`;
    }
    case 'isTrue':
      return subject;
    case 'isFalse':
      return `!${subject}`;
    case 'isSet':
      return `${subject} != null`;
    case 'isNotSet':
      return `${subject} == null`;
    case 'isEmpty':
      return `${subject}.length === 0`;
    case 'isNotEmpty':
      return `${subject}.length > 0`;
    case 'equals':
      return `${subject} === ${literalCode(condition.value, options)}`;
    case 'notEquals':
      return `${subject} !== ${literalCode(condition.value, options)}`;
    case 'greaterThan':
      return `${subject} > ${literalCode(condition.value, options)}`;
    case 'lessThan':
      return `${subject} < ${literalCode(condition.value, options)}`;
    case 'atLeast':
      return `${subject} >= ${literalCode(condition.value, options)}`;
    case 'atMost':
      return `${subject} <= ${literalCode(condition.value, options)}`;
    case 'contains':
      return `${subject}.includes(${literalCode(condition.value, options)})`;
    case 'notContains':
      return `!${subject}.includes(${literalCode(condition.value, options)})`;
    case 'startsWith':
      return `${subject}.startsWith(${literalCode(condition.value, options)})`;
    case 'endsWith':
      return `${subject}.endsWith(${literalCode(condition.value, options)})`;
    case 'lengthEquals':
      return `${subject}.length === ${literalCode(condition.value, options)}`;
    case 'lengthGreaterThan':
      return `${subject}.length > ${literalCode(condition.value, options)}`;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

function literalCode(literal: ExpressionLiteral, options: ExpressionWriteOptions): string {
  assert(isWritableLiteral(literal), 'literalCode: the literal can be written');
  switch (literal.kind) {
    case 'number':
      return String(literal.value);
    case 'boolean':
      return literal.value ? 'true' : 'false';
    case 'string': {
      const other = options.quote === '"' ? "'" : '"';
      const quote = literal.value.includes(options.quote) ? other : options.quote;
      return `${quote}${literal.value}${quote}`;
    }
    default: {
      const exhaustive: never = literal;
      return exhaustive;
    }
  }
}

export function expressionQuoteOf(...sources: readonly string[]): Quote {
  for (const source of sources) {
    const quote = quoteOf(source);
    if (quote !== undefined) {
      return quote;
    }
  }
  return '"';
}
