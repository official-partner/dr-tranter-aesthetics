
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../shared/properties/i18n/messageRef';
import { issue, spoken, type Issue } from './issue';
import { assert } from '../../shared/core/assert';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';
import { parseExpression, type Js } from './loopSyntax';
import { freeLocal, readPropsDestructure, withProp } from './loopProps';
import { settingEntry, type LoopSetting, type OptionsHome } from './optionsQuery';

export type BindingChange =
  | {
      readonly kind: 'bind';
      readonly setting: LoopSetting;
      readonly key: string;
      readonly description?: string | undefined;
      readonly defaultCode?: string | undefined;
    }
  | { readonly kind: 'connect'; readonly setting: LoopSetting; readonly key: string }
  | { readonly kind: 'unbind'; readonly setting: LoopSetting };

export type BindingResult = { readonly ok: true; readonly frontmatter: string } | ({ readonly ok: false } & Issue);

export const SETTING_TITLE_KEYS: Readonly<Record<LoopSetting, MessageKey>> = {
  filter: 'editor.optionsBinding.setting.filter',
  sort: 'editor.optionsBinding.setting.sort',
  limit: 'editor.optionsBinding.setting.limit',
  offset: 'editor.optionsBinding.setting.offset',
  curated: 'editor.optionsBinding.setting.curated',
};

export function settingTitle(setting: LoopSetting, translate: Translator = ENGLISH_TRANSLATE): string {
  return translate(SETTING_TITLE_KEYS[setting]);
}

export const SETTING_TITLES: Readonly<Record<LoopSetting, string>> = {
  filter: settingTitle('filter'),
  sort: settingTitle('sort'),
  limit: settingTitle('limit'),
  offset: settingTitle('offset'),
  curated: settingTitle('curated'),
};

const CANNOT_HOLD_KEYS: Readonly<Record<LoopSetting, MessageKey>> = {
  filter: 'editor.optionsBinding.cannotHold.filter',
  sort: 'editor.optionsBinding.cannotHold.sort',
  limit: 'editor.optionsBinding.cannotHold.limit',
  offset: 'editor.optionsBinding.cannotHold.offset',
  curated: 'editor.optionsBinding.cannotHold.curated',
};

export const SETTING_PROP_NAMES: Readonly<Record<LoopSetting, string>> = { filter: 'filters', sort: 'sort', limit: 'limit', offset: 'skip', curated: 'items' };

const EMPTY_VALUES: Readonly<Record<LoopSetting, string>> = {
  filter: '{"filterFor": "ALL", "fields": []}',
  sort: '[]',
  limit: '0',
  offset: '0',
  curated: '{"itemIds": []}',
};
export const SETTING_PROP_TYPES: Readonly<Record<LoopSetting, string>> = {
  filter: '{ filterFor: "ALL" | "ANY"; fields: { fieldPath: string; operatorName: string; value?: unknown }[] }',
  sort: '{ field: string; direction: "asc" | "desc" }[]',
  limit: 'number',
  offset: 'number',
  curated: '{ itemIds: string[] }',
};
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function propNameProblem(frontmatter: string, key: string, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const problem = propNameIssue(frontmatter, key);
  return problem === undefined ? undefined : spoken(problem, translate);
}

export function propNameIssue(frontmatter: string, key: string): Issue | undefined {
  if (!IDENTIFIER.test(key)) {
    return issue('editor.optionsBinding.name.invalid');
  }
  if (key.length > PROPERTY_LIMITS.nameCharsMax) {
    return issue('editor.optionsBinding.name.tooLong');
  }
  const taken = readPropsDestructure(frontmatter)?.entries.some((entry) => entry.key === key) ?? false;
  return taken ? issue('editor.optionsBinding.name.exists', { name: key }) : undefined;
}

export function reboundOptions(
  frontmatter: string,
  read: {
    readonly home: OptionsHome;
    readonly options: Extract<Js, { readonly kind: 'object' }>;
    readonly statementFrom: number;
    readonly taken: ReadonlySet<string>;
  },
  change: BindingChange,
): BindingResult {
  assert(read.options.from === read.home.options.from, 'The options rebound are the ones read');
  assert(read.statementFrom <= read.options.from, 'The options sit inside their declaration');
  const settingHome = read.home.settings[change.setting];
  const entry = settingEntry(read.options.entries, change.setting);
  if (change.kind === 'unbind') {
    if (settingHome.kind !== 'prop' || entry === undefined) {
      return { ok: false, ...issue('editor.optionsBinding.notLinked') };
    }
    const value = frontmatter.slice(settingHome.literal.from, settingHome.literal.to);
    return { ok: true, frontmatter: spliced(frontmatter, entry.value, value) };
  }
  if (change.kind === 'connect') {
    const prop = readPropsDestructure(frontmatter)?.entries.find((candidate) => candidate.key === change.key);
    if (prop === undefined || !connectableProps(frontmatter, change.setting).includes(change.key)) {
      return { ok: false, ...issue(CANNOT_HOLD_KEYS[change.setting], { name: change.key }) };
    }
    return { ok: true, frontmatter: named(frontmatter, read.options, change.setting, prop.local) };
  }
  const problem = propNameIssue(frontmatter, change.key);
  if (problem !== undefined) {
    return { ok: false, ...problem };
  }
  const local = freeLocal(change.key, read.taken);
  const current = settingHome.kind === 'prop' ? settingHome.literal : entry?.value;
  const defaultCode = change.defaultCode ?? (current === undefined ? EMPTY_VALUES[change.setting] : frontmatter.slice(current.from, current.to));
  if (parseExpression(defaultCode) === undefined) {
    return { ok: false, ...issue('editor.optionsBinding.defaultUnreadable') };
  }
  const options = named(frontmatter, read.options, change.setting, local);
  const out = withProp(
    options,
    {
      key: change.key,
      local,
      defaultCode,
      type: SETTING_PROP_TYPES[change.setting],
      description: tooltipText(change.description) ?? SETTING_TITLES[change.setting],
    },
    read.statementFrom,
  );
  assert(out.includes(local), 'A bound setting names its prop');
  return { ok: true, frontmatter: out };
}

export function connectableProps(frontmatter: string, setting: LoopSetting): readonly string[] {
  const entries = readPropsDestructure(frontmatter)?.entries ?? [];
  const out: string[] = [];
  for (const entry of entries) {
    const value = entry.defaultValue === undefined ? undefined : parseExpression(frontmatter.slice(entry.defaultValue.from, entry.defaultValue.to))?.expression;
    if (value !== undefined && holds(setting, value)) {
      out.push(entry.key);
    }
  }
  assert(out.length <= entries.length, 'Connectable props are some of the props');
  return out;
}

function holds(setting: LoopSetting, value: Js): boolean {
  switch (setting) {
    case 'filter':
      return value.kind === 'object' && value.entries.some((entry) => entry.key === 'fields' || entry.key === 'filterFor');
    case 'sort':
      return value.kind === 'array' && value.items.every((item) => item.kind === 'object' && item.entries.some((entry) => entry.key === 'field'));
    case 'limit':
    case 'offset':
      return value.kind === 'number' && Number.isSafeInteger(value.value) && value.value >= 0;
    case 'curated':
      return value.kind === 'object' && value.entries.some((entry) => entry.key === 'itemIds');
    default: {
      const exhaustive: never = setting;
      return exhaustive;
    }
  }
}

function named(frontmatter: string, options: Extract<Js, { readonly kind: 'object' }>, setting: LoopSetting, local: string): string {
  const entry = settingEntry(options.entries, setting);
  if (entry !== undefined) {
    return spliced(frontmatter, entry.value, local);
  }
  const separator = options.entries.length === 0 ? '' : ', ';
  return spliced(frontmatter, { from: options.to - 1, to: options.to - 1 }, `${separator}${JSON.stringify(setting)}: ${local}`);
}

const TOOLTIP_CHARS_MAX = 500;
function tooltipText(description: string | undefined): string | undefined {
  const text = description?.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim().slice(0, TOOLTIP_CHARS_MAX);
  return text === undefined || text === '' ? undefined : text;
}

function spliced(text: string, span: { readonly from: number; readonly to: number }, replacement: string): string {
  assert(span.from <= span.to, 'A span is ordered');
  assert(span.to <= text.length, 'A span is inside its text');
  return `${text.slice(0, span.from)}${replacement}${text.slice(span.to)}`;
}
