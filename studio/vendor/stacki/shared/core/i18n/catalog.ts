import { assert } from '../assert';
import { err, ok, type Result } from '../result';
import type { Locale } from './locales';

export const CATALOG_LIMITS = {
  catalogMessagesMax: 20_000,
  messageCharsMax: 2_000,
  keyCharsMax: 120,
  placeholdersMax: 16,
  paramsMax: 16,
} as const satisfies Record<string, number>;

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export type PluralForms = { readonly other: string } & { readonly [Category in Exclude<PluralCategory, 'other'>]?: string };

export type MessageValue = string | PluralForms;

export type Catalog = Readonly<Record<string, MessageValue>>;

export type MessageParams = Readonly<Record<string, string | number>>;

export type CatalogOf<K extends string> = { readonly [Key in K]: MessageValue };

export type CatalogIssue =
  | { readonly kind: 'missing-key'; readonly locale: Locale; readonly key: string }
  | { readonly kind: 'bad-message'; readonly locale: Locale; readonly key: string; readonly reason: string };

const KEY_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

export function isMessageKey(key: string): boolean {
  return key.length > 0 && key.length <= CATALOG_LIMITS.keyCharsMax && KEY_PATTERN.test(key);
}

export function placeholdersOf(template: string): Result<readonly string[]> {
  assert(typeof template === 'string', 'placeholdersOf: the template is a string');
  const scanned = scanTemplate(template);
  if (!scanned.ok) {
    return scanned;
  }
  const names: string[] = [];
  for (const part of scanned.value) {
    if (part.kind === 'placeholder' && !names.includes(part.name)) {
      names.push(part.name);
    }
  }
  assert(names.length <= CATALOG_LIMITS.placeholdersMax, 'placeholdersOf: the bound was enforced while scanning');
  return ok(names);
}

export function formatTemplate(template: string, params: MessageParams): Result<string> {
  assert(Object.keys(params).length <= CATALOG_LIMITS.paramsMax, 'formatTemplate: at most paramsMax parameters');
  const scanned = scanTemplate(template);
  if (!scanned.ok) {
    return scanned;
  }
  let text = '';
  for (const part of scanned.value) {
    if (part.kind === 'text') {
      text += part.text;
    } else if (Object.hasOwn(params, part.name)) {
      text += String(params[part.name]);
    } else {
      return err({ code: 'missing-param', message: `Missing parameter {${part.name}}` });
    }
  }
  return ok(text);
}

export function pluralCategory(locale: Locale, count: number): PluralCategory {
  assert(Number.isFinite(count), 'pluralCategory: count is a finite number');
  const category = new Intl.PluralRules(locale).select(count);
  assert(PLURAL_CATEGORIES.includes(category), 'pluralCategory: Intl returned a known category');
  return category;
}

export function pluralTemplate(locale: Locale, value: MessageValue, params: MessageParams): Result<string> {
  if (typeof value === 'string') {
    return ok(value);
  }
  const count = Object.hasOwn(params, 'count') ? params['count'] : undefined;
  if (typeof count !== 'number') {
    return err({ code: 'missing-count', message: 'A plural message needs a numeric {count}' });
  }
  if (!Number.isFinite(count)) {
    return err({ code: 'bad-count', message: '{count} must be finite' });
  }
  const category = pluralCategory(locale, count);
  const form = category === 'other' ? value.other : (value[category] ?? value.other);
  assert(typeof form === 'string', 'pluralTemplate: every plural has an other form');
  return ok(form);
}

export function formatMessage(locale: Locale, value: MessageValue, params: MessageParams): Result<string> {
  const template = pluralTemplate(locale, value, params);
  return template.ok ? formatTemplate(template.value, params) : template;
}

export function templatesOf(value: MessageValue): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  const forms: string[] = [];
  for (const category of PLURAL_CATEGORIES) {
    const form = value[category];
    if (form !== undefined) {
      forms.push(form);
    }
  }
  assert(forms.length >= 1, 'templatesOf: a plural has at least its other form');
  return forms;
}

export function placeholderSet(value: MessageValue): Result<readonly string[]> {
  const names = new Set<string>();
  for (const template of templatesOf(value)) {
    const found = placeholdersOf(template);
    if (!found.ok) {
      return found;
    }
    for (const name of found.value) {
      names.add(name);
    }
  }
  return ok([...names].sort());
}

export function parseMessage(input: unknown): Result<MessageValue> {
  if (typeof input === 'string') {
    return checkedTemplate(input);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err({ code: 'bad-message', message: 'A message is a string or plural forms' });
  }
  const forms: Record<string, string> = {};
  for (const [name, form] of Object.entries(input)) {
    if (!PLURAL_CATEGORIES.some((category) => category === name)) {
      return err({ code: 'bad-plural', message: `Unknown plural form "${name}"` });
    }
    if (typeof form !== 'string') {
      return err({ code: 'bad-plural', message: `Plural form "${name}" is not a string` });
    }
    const checked = checkedTemplate(form);
    if (!checked.ok) {
      return checked;
    }
    forms[name] = form;
  }
  const other = forms['other'];
  if (other === undefined) {
    return err({ code: 'bad-plural', message: 'Plural forms need "other"' });
  }
  return ok({ ...forms, other });
}

export function parseCatalog(input: unknown): Result<Catalog> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err({ code: 'bad-catalog', message: 'A catalog is an object' });
  }
  const entries = Object.entries(input);
  if (entries.length > CATALOG_LIMITS.catalogMessagesMax) {
    return err({ code: 'bad-catalog', message: 'Catalog exceeds the message limit' });
  }
  const catalog: Record<string, MessageValue> = {};
  for (const [key, raw] of entries) {
    if (!isMessageKey(key)) {
      return err({ code: 'bad-key', message: `Bad message key "${key}"` });
    }
    const message = parseMessage(raw);
    if (!message.ok) {
      return err({ code: message.error.code, message: `${key}: ${message.error.message}` });
    }
    catalog[key] = message.value;
  }
  return ok(catalog);
}

export type Translate<K extends string> = (key: K, params?: MessageParams) => string;

export interface TranslatorOptions<K extends string> {
  readonly locale: Locale;
  readonly catalog: Catalog;
  readonly fallback: CatalogOf<K>;
  readonly onIssue: (issue: CatalogIssue) => void;
}

export function createTranslator<K extends string>(options: TranslatorOptions<K>): Translate<K> {
  assert(Object.keys(options.fallback).length > 0, 'createTranslator: the English catalog is not empty');
  return (key, params = {}) => {
    const english = options.fallback[key];
    assert(english !== undefined, `t: "${key}" is not an English message`);
    const translated = Object.hasOwn(options.catalog, key) ? options.catalog[key] : undefined;
    if (translated !== undefined && options.locale !== 'en') {
      const text = formatMessage(options.locale, translated, params);
      if (text.ok) {
        return text.value;
      }
      options.onIssue({ kind: 'bad-message', locale: options.locale, key, reason: text.error.message });
    } else if (options.locale !== 'en') {
      options.onIssue({ kind: 'missing-key', locale: options.locale, key });
    }
    const fallbackText = formatMessage('en', english, params);
    assert(fallbackText.ok, `t: English "${key}" formats with the parameters the call site passed`);
    return fallbackText.value;
  };
}

type TemplatePart = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'placeholder'; readonly name: string };

function checkedTemplate(template: string): Result<string> {
  if (template.length > CATALOG_LIMITS.messageCharsMax) {
    return err({ code: 'too-long', message: 'Message exceeds the length limit' });
  }
  const scanned = scanTemplate(template);
  return scanned.ok ? ok(template) : scanned;
}

function scanTemplate(template: string): Result<readonly TemplatePart[]> {
  if (template.length > CATALOG_LIMITS.messageCharsMax) {
    return err({ code: 'too-long', message: 'Message exceeds the length limit' });
  }
  const parts: TemplatePart[] = [];
  let text = '';
  let index = 0;
  let placeholderCount = 0;
  while (index < template.length) {
    const character = template.charAt(index);
    const next = template.charAt(index + 1);
    if (character === '{' && next === '{') {
      text += '{';
      index += 2;
    } else if (character === '}' && next === '}') {
      text += '}';
      index += 2;
    } else if (character === '}') {
      return err({ code: 'bad-placeholder', message: `Stray "}" at ${index}` });
    } else if (character === '{') {
      const close = template.indexOf('}', index);
      if (close < 0) {
        return err({ code: 'bad-placeholder', message: `Unclosed "{" at ${index}` });
      }
      const name = template.slice(index + 1, close);
      if (!PLACEHOLDER_NAME_PATTERN.test(name)) {
        return err({ code: 'bad-placeholder', message: `Bad placeholder "{${name}}"` });
      }
      placeholderCount += 1;
      if (placeholderCount > CATALOG_LIMITS.placeholdersMax) {
        return err({ code: 'too-many-placeholders', message: 'Message exceeds the placeholder limit' });
      }
      if (text.length > 0) {
        parts.push({ kind: 'text', text });
        text = '';
      }
      parts.push({ kind: 'placeholder', name });
      index = close + 1;
    } else {
      text += character;
      index += 1;
    }
  }
  if (text.length > 0) {
    parts.push({ kind: 'text', text });
  }
  assert(index === template.length, 'scanTemplate: the whole template was read');
  return ok(parts);
}
