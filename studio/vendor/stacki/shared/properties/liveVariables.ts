
export const LIVE_VARIABLE_MESSAGE = 'avb:live-variable';

export const LIVE_VARIABLE_LIMITS = {
  entriesMax: 64,
  selectorCharsMax: 1_000,
  contextMax: 8,
  nameCharsMax: 200,
  valueCharsMax: 2_000,
  settleFramesMax: 180,
} as const satisfies Record<string, number>;

export interface LiveVariable {
  readonly selector: string;
  readonly context: readonly string[];
  readonly name: string;
  readonly value: string;
}

export type LiveVariableMessage =
  | { readonly type: typeof LIVE_VARIABLE_MESSAGE; readonly op: 'set'; readonly variable: LiveVariable }
  | { readonly type: typeof LIVE_VARIABLE_MESSAGE; readonly op: 'drop'; readonly variable: LiveVariable; readonly until?: string | undefined }
  | { readonly type: typeof LIVE_VARIABLE_MESSAGE; readonly op: 'clear' };

export function liveVariableKey(variable: Pick<LiveVariable, 'selector' | 'context' | 'name'>): string {
  return [...variable.context, variable.selector, variable.name].join('\n');
}

const CSS_BREAKOUT = /[{};!<\\]/;
const VARIABLE_NAME = /^--[\w-]+$/;

function cssFragment(input: unknown, charsMax: number): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > charsMax) {
    return undefined;
  }
  if (CSS_BREAKOUT.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function contextOf(input: unknown): readonly string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const values: readonly unknown[] = input;
  if (values.length > LIVE_VARIABLE_LIMITS.contextMax) {
    return undefined;
  }
  const context: string[] = [];
  for (const value of values) {
    const part = cssFragment(value, LIVE_VARIABLE_LIMITS.selectorCharsMax);
    if (part === undefined) {
      return undefined;
    }
    context.push(part);
  }
  return context;
}

export function parseLiveVariable(input: unknown): LiveVariable | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const selector = 'selector' in input ? cssFragment(input.selector, LIVE_VARIABLE_LIMITS.selectorCharsMax) : undefined;
  const context = 'context' in input ? contextOf(input.context) : undefined;
  const name = 'name' in input ? cssFragment(input.name, LIVE_VARIABLE_LIMITS.nameCharsMax) : undefined;
  const value = 'value' in input ? cssFragment(input.value, LIVE_VARIABLE_LIMITS.valueCharsMax) : undefined;
  if (selector === undefined || context === undefined || name === undefined || value === undefined) {
    return undefined;
  }
  if (!VARIABLE_NAME.test(name)) {
    return undefined;
  }
  return { selector, context, name, value };
}

export function parseLiveVariableMessage(input: unknown): LiveVariableMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('type' in input) || input.type !== LIVE_VARIABLE_MESSAGE || !('op' in input)) {
    return undefined;
  }
  if (input.op === 'clear') {
    return { type: LIVE_VARIABLE_MESSAGE, op: 'clear' };
  }
  const variable = 'variable' in input ? parseLiveVariable(input.variable) : undefined;
  if (variable === undefined) {
    return undefined;
  }
  if (input.op === 'set') {
    return { type: LIVE_VARIABLE_MESSAGE, op: 'set', variable };
  }
  if (input.op !== 'drop') {
    return undefined;
  }
  if (!('until' in input) || input.until === undefined) {
    return { type: LIVE_VARIABLE_MESSAGE, op: 'drop', variable };
  }
  const until = cssFragment(input.until, LIVE_VARIABLE_LIMITS.valueCharsMax);
  return until === undefined ? undefined : { type: LIVE_VARIABLE_MESSAGE, op: 'drop', variable, until };
}

export function liveVariablesCss(variables: Iterable<LiveVariable>): string {
  const blocks: string[] = [];
  for (const variable of variables) {
    let block = `${variable.selector} { ${variable.name}: ${variable.value} !important; }`;
    for (let index = variable.context.length - 1; index >= 0; index -= 1) {
      block = `${variable.context[index] ?? ''} { ${block} }`;
    }
    blocks.push(block);
  }
  return blocks.join('\n');
}
