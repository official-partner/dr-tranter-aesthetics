import { assert } from '../core/assert';
import { err, ok, type Result } from '../core/result';
import { toRecord } from '../core/record';

export const CUSTOM_AUDIT_LIMITS = {
  auditsMax: 50,
  idCharsMax: 40,
  nameCharsMax: 60,
  categoryCharsMax: 40,
  messageCharsMax: 240,
  patternCharsMax: 300,
  repeatsUnboundedMax: 3,
} as const satisfies Record<string, number>;

export const CUSTOM_AUDIT_SCOPES = ['declaration', 'css', 'markup', 'rendered'] as const;
export type CustomAuditScope = (typeof CUSTOM_AUDIT_SCOPES)[number];

export const CUSTOM_AUDIT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type CustomAuditSeverity = (typeof CUSTOM_AUDIT_SEVERITIES)[number];

export const CUSTOM_AUDIT_BUILTIN_CATEGORIES = ['accessibility', 'seo', 'content', 'tokens', 'performance'] as const;
export type CustomAuditBuiltinCategory = (typeof CUSTOM_AUDIT_BUILTIN_CATEGORIES)[number];

export const CUSTOM_AUDIT_ICONS = [
  'droplet',
  'text',
  'ruler',
  'variable',
  'layers',
  'tag',
  'braces',
  'image',
  'link',
  'globe',
  'hash',
  'heading',
  'contrast',
  'form',
  'accessibility',
  'placeholder',
  'star',
  'chart',
  'gauge',
  'block',
  'file',
  'hide',
  'clock',
  'target',
] as const;
export type CustomAuditIcon = (typeof CUSTOM_AUDIT_ICONS)[number];

export type CustomAuditMatch =
  | {
      readonly scope: 'declaration';
      readonly property: string;
      readonly valueMustMatch: string | undefined;
      readonly valueMustNotMatch: string | undefined;
    }
  | { readonly scope: Exclude<CustomAuditScope, 'declaration'>; readonly pattern: string };

export interface CustomAudit {
  readonly id: string;
  readonly name: string;
  readonly icon: CustomAuditIcon;
  readonly category: string;
  readonly severity: CustomAuditSeverity;
  readonly match: CustomAuditMatch;
  readonly exclude: string | undefined;
  readonly message: string | undefined;
  readonly enabled: boolean;
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isCustomAuditId(id: string): boolean {
  return id.length <= CUSTOM_AUDIT_LIMITS.idCharsMax && ID_PATTERN.test(id);
}


export function parseCustomAudits(input: unknown): readonly CustomAudit[] {
  if (!Array.isArray(input)) {
    throw new Error('Audit settings.customAudits: expected an array');
  }
  if (input.length > CUSTOM_AUDIT_LIMITS.auditsMax) {
    throw new Error(`Audit settings.customAudits: more than ${CUSTOM_AUDIT_LIMITS.auditsMax} audits`);
  }
  const audits = input.map((entry: unknown, index) => parseCustomAudit(entry, `Audit settings.customAudits[${index}]`));
  if (new Set(audits.map((audit) => audit.id)).size !== audits.length) {
    throw new Error('Audit settings.customAudits: an id is listed twice');
  }
  assert(audits.length <= CUSTOM_AUDIT_LIMITS.auditsMax, 'parseCustomAudits: the list is bounded');
  return audits;
}

export function parseCustomAudit(input: unknown, where: string): CustomAudit {
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error(`${where}: expected an object`);
  }
  const id = value['id'];
  if (typeof id !== 'string' || !isCustomAuditId(id)) {
    throw new Error(`${where}.id: expected lowercase letters, digits and hyphens, at most ${CUSTOM_AUDIT_LIMITS.idCharsMax} characters`);
  }
  const icon = CUSTOM_AUDIT_ICONS.find((known) => known === value['icon']);
  if (icon === undefined) {
    throw new Error(`${where}.icon: expected one of ${CUSTOM_AUDIT_ICONS.join(', ')}`);
  }
  const severityRaw = value['severity'] ?? 'medium';
  const severity = CUSTOM_AUDIT_SEVERITIES.find((known) => known === severityRaw);
  if (severity === undefined) {
    throw new Error(`${where}.severity: expected high, medium or low`);
  }
  const enabled = value['enabled'] ?? true;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${where}.enabled: expected a boolean`);
  }
  return {
    id,
    name: boundedText(value['name'], `${where}.name`, CUSTOM_AUDIT_LIMITS.nameCharsMax),
    icon,
    category: boundedText(value['category'], `${where}.category`, CUSTOM_AUDIT_LIMITS.categoryCharsMax),
    severity,
    match: parseMatch(value['scope'], value['match'], where),
    exclude: optionalPattern(value['exclude'], `${where}.exclude`),
    message: value['message'] === undefined ? undefined : boundedText(value['message'], `${where}.message`, CUSTOM_AUDIT_LIMITS.messageCharsMax),
    enabled,
  };
}

function parseMatch(scopeRaw: unknown, input: unknown, where: string): CustomAuditMatch {
  const scope = CUSTOM_AUDIT_SCOPES.find((known) => known === scopeRaw);
  if (scope === undefined) {
    throw new Error(`${where}.scope: expected one of ${CUSTOM_AUDIT_SCOPES.join(', ')}`);
  }
  const match = toRecord(input);
  if (match === undefined) {
    throw new Error(`${where}.match: expected an object`);
  }
  if (scope === 'declaration') {
    return {
      scope,
      property: requiredPattern(match['property'], `${where}.match.property`),
      valueMustMatch: optionalPattern(match['valueMustMatch'], `${where}.match.valueMustMatch`),
      valueMustNotMatch: optionalPattern(match['valueMustNotMatch'], `${where}.match.valueMustNotMatch`),
    };
  }
  return { scope, pattern: requiredPattern(match['pattern'], `${where}.match.pattern`) };
}

function boundedText(input: unknown, where: string, charsMax: number): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${where}: expected a non-empty string`);
  }
  if (input.length > charsMax) {
    throw new Error(`${where}: longer than ${charsMax} characters`);
  }
  return input.trim();
}

function requiredPattern(input: unknown, where: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error(`${where}: expected a regular expression`);
  }
  if (input.length > CUSTOM_AUDIT_LIMITS.patternCharsMax) {
    throw new Error(`${where}: longer than ${CUSTOM_AUDIT_LIMITS.patternCharsMax} characters`);
  }
  return input;
}

function optionalPattern(input: unknown, where: string): string | undefined {
  return input === undefined ? undefined : requiredPattern(input, where);
}

export function serializedCustomAudits(audits: readonly CustomAudit[]): readonly Record<string, unknown>[] {
  assert(audits.length <= CUSTOM_AUDIT_LIMITS.auditsMax, 'serializedCustomAudits: the list is bounded');
  return audits.map((audit) => {
    const match =
      audit.match.scope === 'declaration'
        ? {
            property: audit.match.property,
            ...(audit.match.valueMustMatch === undefined ? {} : { valueMustMatch: audit.match.valueMustMatch }),
            ...(audit.match.valueMustNotMatch === undefined ? {} : { valueMustNotMatch: audit.match.valueMustNotMatch }),
          }
        : { pattern: audit.match.pattern };
    return {
      id: audit.id,
      name: audit.name,
      icon: audit.icon,
      category: audit.category,
      ...(audit.severity === 'medium' ? {} : { severity: audit.severity }),
      scope: audit.match.scope,
      match,
      ...(audit.exclude === undefined ? {} : { exclude: audit.exclude }),
      ...(audit.message === undefined ? {} : { message: audit.message }),
      enabled: audit.enabled,
    };
  });
}


export function withCustomAudit(audits: readonly CustomAudit[], audit: CustomAudit): readonly CustomAudit[] {
  assert(isCustomAuditId(audit.id), 'withCustomAudit: a custom audit id');
  const index = audits.findIndex((existing) => existing.id === audit.id);
  if (index === -1 && audits.length >= CUSTOM_AUDIT_LIMITS.auditsMax) {
    throw new Error(`A project has at most ${CUSTOM_AUDIT_LIMITS.auditsMax} custom audits`);
  }
  const next = index === -1 ? [...audits, audit] : audits.map((existing) => (existing.id === audit.id ? audit : existing));
  assert(next.length <= audits.length + 1, 'withCustomAudit: adds at most one audit');
  return next;
}

export function withoutCustomAudit(audits: readonly CustomAudit[], id: string): readonly CustomAudit[] {
  const next = audits.filter((audit) => audit.id !== id);
  assert(next.length >= audits.length - 1, 'withoutCustomAudit: removes at most one audit');
  return next;
}

export function customAuditIdFor(name: string, taken: readonly string[]): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const room = CUSTOM_AUDIT_LIMITS.idCharsMax - 4;
  const cut = words.length <= room ? words : words.slice(0, words.lastIndexOf('-', room) > 0 ? words.lastIndexOf('-', room) : room);
  const base = (cut.length === 0 ? 'custom-audit' : cut).replace(/-+$/, '');
  const stem = base.length === 0 ? 'custom-audit' : base;
  const used = new Set(taken);
  if (!used.has(stem)) {
    return stem;
  }
  for (let suffix = 2; suffix <= CUSTOM_AUDIT_LIMITS.auditsMax + 2; suffix++) {
    const candidate = `${stem}-${suffix}`;
    if (!used.has(candidate)) {
      assert(isCustomAuditId(candidate), 'customAuditIdFor: the id is well formed');
      return candidate;
    }
  }
  throw new Error('customAuditIdFor: no free id within the list bound');
}

export function customAuditCategoryOf(typed: string): string {
  const trimmed = typed.trim();
  const builtin = CUSTOM_AUDIT_BUILTIN_CATEGORIES.find((id) => id === trimmed.toLowerCase());
  assert(trimmed.length <= CUSTOM_AUDIT_LIMITS.categoryCharsMax || builtin === undefined, 'customAuditCategoryOf: a built-in id is short');
  return builtin ?? trimmed;
}

export function builtinCategoryOf(category: string): CustomAuditBuiltinCategory | undefined {
  return CUSTOM_AUDIT_BUILTIN_CATEGORIES.find((id) => id === category);
}


export interface CustomAuditProblem {
  readonly code: 'empty' | 'too-long' | 'invalid' | 'backreference' | 'nested-repeat' | 'too-many-repeats' | 'matches-empty';
  readonly field: CustomAuditPatternField;
  readonly message: string;
}

export type CustomAuditPatternField = 'property' | 'valueMustMatch' | 'valueMustNotMatch' | 'pattern' | 'exclude';

type PatternRole = 'finds' | 'filters';

export function checkPattern(pattern: string, field: CustomAuditPatternField): Result<RegExp, CustomAuditProblem> {
  const role: PatternRole = field === 'valueMustNotMatch' || field === 'exclude' ? 'filters' : 'finds';
  const refuse = (code: CustomAuditProblem['code'], message: string): Result<never, CustomAuditProblem> =>
    err({ code, field, message: `${field}: ${message}` });
  if (pattern.length === 0) {
    return refuse('empty', 'write a regular expression.');
  }
  if (pattern.length > CUSTOM_AUDIT_LIMITS.patternCharsMax) {
    return refuse('too-long', `at most ${CUSTOM_AUDIT_LIMITS.patternCharsMax} characters.`);
  }
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern, 'i');
  } catch (error: unknown) {
    return refuse('invalid', `not a regular expression (${error instanceof Error ? error.message : String(error)}).`);
  }
  const shape = patternShape(pattern);
  if (shape.backreference) {
    return refuse('backreference', 'backreferences such as \\1 can take very long to run; match the text itself instead.');
  }
  if (shape.nestedRepeat) {
    return refuse('nested-repeat', 'a repeat inside a repeated group, such as (a+)+, can take very long to run; repeat only once.');
  }
  if (shape.unboundedRepeats > CUSTOM_AUDIT_LIMITS.repeatsUnboundedMax) {
    return refuse('too-many-repeats', `at most ${CUSTOM_AUDIT_LIMITS.repeatsUnboundedMax} open-ended repeats (*, + or {n,}).`);
  }
  if (role === 'finds' && compiled.test('')) {
    return refuse('matches-empty', 'it matches empty text, so it would flag every place; make it ask for at least one character.');
  }
  return ok(compiled);
}

interface PatternShape {
  readonly backreference: boolean;
  readonly nestedRepeat: boolean;
  readonly unboundedRepeats: number;
}

function patternShape(pattern: string): PatternShape {
  assert(pattern.length <= CUSTOM_AUDIT_LIMITS.patternCharsMax, 'patternShape: the pattern is bounded');
  const groups: { repeats: boolean }[] = [{ repeats: false }];
  let backreference = false;
  let nestedRepeat = false;
  let unboundedRepeats = 0;
  let lastGroupRepeats: boolean | undefined;
  let index = 0;
  for (let steps = 0; index < pattern.length && steps <= pattern.length; steps++) {
    const char = pattern[index] ?? '';
    const repeat = repeatAt(pattern, index);
    if (repeat !== undefined) {
      const top = groups[groups.length - 1];
      assert(top !== undefined, 'patternShape: a group is open');
      if (repeat.many) {
        if (lastGroupRepeats === true) {
          nestedRepeat = true;
        }
        top.repeats = true;
      }
      if (repeat.unbounded) {
        unboundedRepeats += 1;
      }
      lastGroupRepeats = undefined;
      index += repeat.length;
      continue;
    }
    lastGroupRepeats = undefined;
    if (char === '\\') {
      const next = pattern[index + 1] ?? '';
      if (/[1-9]/.test(next) || (next === 'k' && pattern[index + 2] === '<')) {
        backreference = true;
      }
      index += 2;
    } else if (char === '[') {
      index = classEnd(pattern, index);
    } else if (char === '(') {
      groups.push({ repeats: false });
      index += pattern[index + 1] === '?' ? groupPrefixLength(pattern, index) : 1;
    } else if (char === ')') {
      const closed = groups.pop();
      const parent = groups[groups.length - 1];
      assert(closed !== undefined, 'patternShape: a compiled pattern closes only groups it opened');
      assert(parent !== undefined, 'patternShape: the outermost level is never closed');
      parent.repeats = parent.repeats || closed.repeats;
      lastGroupRepeats = closed.repeats;
      index += 1;
    } else {
      index += 1;
    }
  }
  return { backreference, nestedRepeat, unboundedRepeats };
}

function repeatAt(pattern: string, index: number): { readonly length: number; readonly many: boolean; readonly unbounded: boolean } | undefined {
  const char = pattern[index];
  const lazy = (end: number): number => (pattern[end] === '?' ? 1 : 0);
  if (char === '*' || char === '+') {
    return { length: 1 + lazy(index + 1), many: true, unbounded: true };
  }
  if (char === '?') {
    return { length: 1 + lazy(index + 1), many: false, unbounded: false };
  }
  if (char === '{') {
    const braces = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index, index + 24));
    if (braces === null) {
      return undefined;
    }
    const low = Number(braces[1]);
    const open = braces[2] !== undefined && (braces[3] ?? '') === '';
    const high = open ? Number.POSITIVE_INFINITY : braces[2] === undefined ? low : Number(braces[3]);
    return { length: braces[0].length + lazy(index + braces[0].length), many: high > 1, unbounded: open };
  }
  return undefined;
}

function classEnd(pattern: string, index: number): number {
  let at = index + 1;
  if (pattern[at] === '^') {
    at += 1;
  }
  if (pattern[at] === ']') {
    at += 1;
  }
  for (; at < pattern.length; at++) {
    if (pattern[at] === '\\') {
      at += 1;
    } else if (pattern[at] === ']') {
      return at + 1;
    }
  }
  return pattern.length;
}

function groupPrefixLength(pattern: string, index: number): number {
  const rest = pattern.slice(index, index + 40);
  const named = /^\(\?<[A-Za-z_$][\w$]*>/.exec(rest);
  if (named !== null) {
    return named[0].length;
  }
  return rest.startsWith('(?<=') || rest.startsWith('(?<!') ? 4 : 3;
}

export type CompiledCustomMatch =
  | {
      readonly scope: 'declaration';
      readonly property: RegExp;
      readonly valueMustMatch: RegExp | undefined;
      readonly valueMustNotMatch: RegExp | undefined;
      readonly exclude: RegExp | undefined;
    }
  | { readonly scope: Exclude<CustomAuditScope, 'declaration'>; readonly pattern: RegExp; readonly exclude: RegExp | undefined };

export function compileCustomAudit(audit: Pick<CustomAudit, 'match' | 'exclude'>): Result<CompiledCustomMatch, CustomAuditProblem> {
  const exclude = audit.exclude === undefined ? ok(undefined) : checkPattern(audit.exclude, 'exclude');
  if (!exclude.ok) {
    return exclude;
  }
  const match = audit.match;
  if (match.scope === 'declaration') {
    const property = checkPattern(match.property, 'property');
    const must = match.valueMustMatch === undefined ? ok(undefined) : checkPattern(match.valueMustMatch, 'valueMustMatch');
    const mustNot = match.valueMustNotMatch === undefined ? ok(undefined) : checkPattern(match.valueMustNotMatch, 'valueMustNotMatch');
    if (!property.ok) {
      return property;
    }
    if (!must.ok) {
      return must;
    }
    if (!mustNot.ok) {
      return mustNot;
    }
    return ok({ scope: 'declaration', property: property.value, valueMustMatch: must.value, valueMustNotMatch: mustNot.value, exclude: exclude.value });
  }
  const pattern = checkPattern(match.pattern, 'pattern');
  return pattern.ok ? ok({ scope: match.scope, pattern: pattern.value, exclude: exclude.value }) : pattern;
}


export interface CustomAuditPreset {
  readonly preset: string;
  readonly audit: Omit<CustomAudit, 'id' | 'enabled'>;
}

export const COLOR_PROPERTY_PATTERN =
  '^(color|background(-color)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|' +
  'text-decoration(-color)?|text-emphasis-color|column-rule(-color)?|caret-color|accent-color|fill|stroke|box-shadow|text-shadow|filter)$';

export const CUSTOM_AUDIT_PRESETS: readonly CustomAuditPreset[] = [
  {
    preset: 'hard-coded-text-align',
    audit: {
      name: 'Hard-coded text-align',
      icon: 'text',
      category: 'tokens',
      severity: 'low',
      match: { scope: 'declaration', property: '^text-align$', valueMustMatch: undefined, valueMustNotMatch: 'var\\(' },
      exclude: undefined,
      message: 'Alignment is written by hand; a variable keeps it in step across breakpoints and themes.',
    },
  },
  {
    preset: 'core-swatch-instead-of-theme',
    audit: {
      name: 'Core swatch instead of theme variable',
      icon: 'droplet',
      category: 'tokens',
      severity: 'medium',
      match: { scope: 'declaration', property: COLOR_PROPERTY_PATTERN, valueMustMatch: 'var\\(\\s*--swatch-', valueMustNotMatch: undefined },
      exclude: undefined,
      message: 'A core swatch does not follow the theme; use a theme variable such as var(--theme-text).',
    },
  },
  {
    preset: 'important',
    audit: {
      name: '!important',
      icon: 'block',
      category: 'tokens',
      severity: 'low',
      match: { scope: 'declaration', property: '^[a-z]', valueMustMatch: '!\\s*important', valueMustNotMatch: undefined },
      exclude: undefined,
      message: '!important overrides every layer and makes later changes hard.',
    },
  },
  {
    preset: 'hard-coded-z-index',
    audit: {
      name: 'Hard-coded z-index',
      icon: 'layers',
      category: 'tokens',
      severity: 'low',
      match: { scope: 'declaration', property: '^z-index$', valueMustMatch: undefined, valueMustNotMatch: 'var\\(' },
      exclude: undefined,
      message: 'Stacking order written by hand drifts; keep the levels in variables.',
    },
  },
  {
    preset: 'inline-style',
    audit: {
      name: 'Inline style attribute',
      icon: 'tag',
      category: 'content',
      severity: 'low',
      match: { scope: 'markup', pattern: '\\sstyle\\s*=' },
      exclude: undefined,
      message: 'Styles written on the element are hard to find and reuse; give it a class.',
    },
  },
  {
    preset: 'todo-comment',
    audit: {
      name: 'TODO left in markup',
      icon: 'placeholder',
      category: 'content',
      severity: 'medium',
      match: { scope: 'markup', pattern: '\\b(TODO|FIXME)\\b' },
      exclude: undefined,
      message: 'A note to finish something is still in the page.',
    },
  },
];

export function customAuditPreset(preset: string): CustomAuditPreset | undefined {
  return CUSTOM_AUDIT_PRESETS.find((entry) => entry.preset === preset);
}
