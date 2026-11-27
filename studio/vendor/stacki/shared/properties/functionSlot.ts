
import { assert } from '../core/assert';

export type ValueClass = 'angle' | 'color' | 'keyword' | 'length' | 'none' | 'number' | 'percentage' | 'time' | 'unknown';

export interface FunctionSlotRule {
  readonly classes: ReadonlySet<ValueClass>;
}

export type VariableResolver = (customProperty: string) => string | undefined;

export const FUNCTION_SLOT_LIMITS = {
  scanCharsMax: 8_192,
  depthMax: 32,
  termsMax: 64,
} as const;

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const DIMENSION = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]+)$/i;
const LENGTH_UNITS = new Set([
  'px', 'rem', 'em', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh', 'vw', 'vh', 'vmin', 'vmax', 'vi', 'vb', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax', 'cm', 'mm', 'q', 'in', 'pt', 'pc',
]); // prettier-ignore
const ANGLE_UNITS = new Set(['deg', 'rad', 'grad', 'turn']);
const TIME_UNITS = new Set(['s', 'ms']);
const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark']);
const MATH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp', '']);

const COLOR_SLOT: ReadonlySet<ValueClass> = new Set<ValueClass>(['color']);
const PERCENTAGE_SLOT: ReadonlySet<ValueClass> = new Set<ValueClass>(['percentage']);
const NUMBER_SLOT: ReadonlySet<ValueClass> = new Set<ValueClass>(['number']);
const COLOR_OR_PERCENTAGE: ReadonlySet<ValueClass> = new Set<ValueClass>(['color', 'percentage']);
const NO_SLOT: ReadonlySet<ValueClass> = new Set<ValueClass>();
const NUMERIC: ReadonlySet<ValueClass> = new Set<ValueClass>(['number', 'length', 'percentage', 'angle', 'time']);
const COMPONENT: ReadonlySet<ValueClass> = new Set<ValueClass>(['number', 'percentage', 'none']);
const HUE: ReadonlySet<ValueClass> = new Set<ValueClass>(['number', 'angle', 'none']);

export function valueClassOf(value: string | undefined, typeHint?: string): ValueClass {
  if (value === undefined) {
    return typeHint === 'Color' ? 'color' : 'unknown';
  }
  const text = value.trim().toLowerCase();
  if (text === '') {
    return 'unknown';
  }
  if (NUMBER.test(text)) {
    return 'number';
  }
  const dimension = DIMENSION.exec(text);
  if (dimension !== null) {
    return dimensionClass(dimension[2] ?? '');
  }
  if (text === 'none') {
    return 'none';
  }
  if (text.startsWith('#')) {
    return 'color';
  }
  const call = /^([a-z-]+)\(/.exec(text);
  if (call !== null) {
    return callClass(call[1] ?? '', text, typeHint);
  }
  if (text === 'transparent' || text === 'currentcolor' || typeHint === 'Color') {
    return 'color';
  }
  return 'keyword';
}

function dimensionClass(unit: string): ValueClass {
  if (unit === '%') {
    return 'percentage';
  }
  if (LENGTH_UNITS.has(unit)) {
    return 'length';
  }
  if (ANGLE_UNITS.has(unit)) {
    return 'angle';
  }
  return TIME_UNITS.has(unit) ? 'time' : 'unknown';
}

function callClass(name: string, text: string, typeHint: string | undefined): ValueClass {
  if (COLOR_FUNCTIONS.has(name)) {
    return 'color';
  }
  if (name === 'calc' || name === 'min' || name === 'max' || name === 'clamp') {
    return mathClass(text);
  }
  return typeHint === 'Color' ? 'color' : 'unknown';
}

function mathClass(text: string): ValueClass {
  let sawPercentage = false;
  let sawAngle = false;
  let sawNumber = false;
  for (const term of text.matchAll(/(?<![\w-])[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?([a-z%]*)/gi)) {
    const unit = (term[1] ?? '').toLowerCase();
    if (unit === '') {
      sawNumber = true;
    } else if (unit === '%') {
      sawPercentage = true;
    } else if (LENGTH_UNITS.has(unit)) {
      return 'length';
    } else if (ANGLE_UNITS.has(unit)) {
      sawAngle = true;
    }
  }
  if (text.includes('var(')) {
    return 'unknown';
  }
  if (sawPercentage) {
    return 'percentage';
  }
  if (sawAngle) {
    return 'angle';
  }
  return sawNumber ? 'number' : 'unknown';
}

interface Frame {
  readonly name: string;
  readonly start: number;
  readonly args: string[];
  current: string;
}

export function functionSlotAt(before: string, resolve: VariableResolver): FunctionSlotRule | undefined {
  const text = before.length > FUNCTION_SLOT_LIMITS.scanCharsMax ? before.slice(before.length - FUNCTION_SLOT_LIMITS.scanCharsMax) : before;
  const frames = openFrames(text);
  if (frames === undefined) {
    return undefined;
  }
  const frame = frames[frames.length - 1];
  if (frame === undefined) {
    return undefined;
  }
  assert(frames.length <= FUNCTION_SLOT_LIMITS.depthMax, 'functionSlotAt: the brackets followed are bounded');
  if (frame.name === 'color-mix') {
    return colorMixRule(frame, resolve);
  }
  if (COLOR_COMPONENTS.has(frame.name)) {
    return componentRule(frame);
  }
  if (MATH_FUNCTIONS.has(frame.name)) {
    return operatorRule(frame, resolve);
  }
  return undefined;
}

function openFrames(text: string): Frame[] | undefined {
  const frames: Frame[] = [];
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index] ?? '';
    const top = frames[frames.length - 1];
    if (quote !== undefined) {
      if (top !== undefined) {
        top.current += ch;
      }
      if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      if (top !== undefined) {
        top.current += ch;
      }
    } else if (ch === '(') {
      if (frames.length >= FUNCTION_SLOT_LIMITS.depthMax) {
        return undefined;
      }
      const owner = top === undefined ? text.slice(0, index) : top.current;
      const name = (/(?:^|[^\w-])([a-z][\w-]*)$/i.exec(owner)?.[1] ?? '').toLowerCase();
      if (top !== undefined) {
        top.current = top.current.slice(0, top.current.length - name.length);
      }
      frames.push({ name, start: index - name.length, args: [], current: '' });
    } else if (ch === ')') {
      const closed = frames.pop();
      const parent = frames[frames.length - 1];
      if (closed !== undefined && parent !== undefined) {
        parent.current += `${text.slice(closed.start, index + 1)}`;
      }
    } else if (ch === ',' && top !== undefined) {
      top.args.push(top.current);
      top.current = '';
    } else if (top !== undefined) {
      top.current += ch;
    }
  }
  return frames;
}

function termsOf(argument: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let term = '';
  const flush = (): void => {
    if (term !== '') {
      terms.push(term);
      term = '';
    }
  };
  for (const ch of argument.slice(0, FUNCTION_SLOT_LIMITS.scanCharsMax)) {
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && /\s/.test(ch)) {
      flush();
    } else if (depth === 0 && ch === '/') {
      flush();
      terms.push('/');
    } else {
      term += ch;
    }
    if (terms.length >= FUNCTION_SLOT_LIMITS.termsMax) {
      break;
    }
  }
  flush();
  return terms;
}

function termClass(term: string, resolve: VariableResolver): ValueClass {
  const reference = /^var\(\s*(--[\w-]+)\s*(?:,.*)?\)$/i.exec(term);
  if (reference !== null) {
    return valueClassOf(resolve(reference[1] ?? ''));
  }
  return valueClassOf(term);
}

function colorMixRule(frame: Frame, resolve: VariableResolver): FunctionSlotRule | undefined {
  const argument = frame.args.length;
  if (argument === 0) {
    return { classes: NO_SLOT };
  }
  if (argument > 2) {
    return { classes: NO_SLOT };
  }
  const terms = termsOf(frame.current);
  if (terms.length === 0) {
    return { classes: COLOR_OR_PERCENTAGE };
  }
  if (terms.length > 1) {
    return { classes: NO_SLOT };
  }
  const first = termClass(terms[0] ?? '', resolve);
  if (first === 'percentage') {
    return { classes: COLOR_SLOT };
  }
  if (first === 'unknown') {
    return { classes: COLOR_OR_PERCENTAGE };
  }
  return { classes: PERCENTAGE_SLOT };
}

const COLOR_COMPONENTS: ReadonlyMap<string, ReadonlyArray<ReadonlySet<ValueClass>>> = new Map([
  ['rgb', [COMPONENT, COMPONENT, COMPONENT]],
  ['rgba', [COMPONENT, COMPONENT, COMPONENT]],
  ['hsl', [HUE, COMPONENT, COMPONENT]],
  ['hsla', [HUE, COMPONENT, COMPONENT]],
  ['hwb', [HUE, COMPONENT, COMPONENT]],
  ['lab', [COMPONENT, COMPONENT, COMPONENT]],
  ['oklab', [COMPONENT, COMPONENT, COMPONENT]],
  ['lch', [COMPONENT, COMPONENT, HUE]],
  ['oklch', [COMPONENT, COMPONENT, HUE]],
]);

function componentRule(frame: Frame): FunctionSlotRule | undefined {
  const positions = COLOR_COMPONENTS.get(frame.name);
  assert(positions !== undefined, 'componentRule: only called for a colour function');
  const terms = [...frame.args.flatMap(termsOf), ...termsOf(frame.current)];
  if (terms[0]?.toLowerCase() === 'from') {
    return undefined;
  }
  const slash = terms.indexOf('/');
  if (slash >= 0) {
    return terms.length === slash + 1 ? { classes: COMPONENT } : { classes: NO_SLOT };
  }
  const rule = positions[terms.length];
  return rule === undefined ? { classes: COMPONENT } : { classes: rule };
}

function operatorRule(frame: Frame, resolve: VariableResolver): FunctionSlotRule | undefined {
  const text = frame.current.trimEnd();
  const operator = text[text.length - 1];
  if (operator !== '*' && operator !== '/') {
    return undefined;
  }
  if (operator === '/') {
    return { classes: NUMBER_SLOT };
  }
  const left = termsOf(text.slice(0, -1));
  const previous = left[left.length - 1];
  if (previous === undefined) {
    return undefined;
  }
  const kind = termClass(previous, resolve);
  if (kind === 'number') {
    return { classes: NUMERIC };
  }
  if (kind === 'length' || kind === 'percentage' || kind === 'angle' || kind === 'time') {
    return { classes: NUMBER_SLOT };
  }
  return undefined;
}

export function ruleAccepts(rule: FunctionSlotRule, value: string | undefined, typeHint: string | undefined): boolean {
  return rule.classes.has(valueClassOf(value, typeHint));
}
