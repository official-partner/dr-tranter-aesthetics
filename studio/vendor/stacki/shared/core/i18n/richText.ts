import { assert } from '../assert';
import { err, ok, type Result } from '../result';
import { pluralTemplate, type MessageValue, type TranslatorOptions } from './catalog';
import type { Locale } from './locales';

export const RICH_LIMITS = {
  tagDepthMax: 4,
  tagsMax: 16,
  slotsMax: 16,
} as const satisfies Record<string, number>;

export type RichPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'slot'; readonly name: string }
  | { readonly kind: 'tag'; readonly name: string; readonly children: readonly RichPart[] };

export interface RichRequest {
  readonly count?: number;
  readonly slots: readonly string[];
  readonly tags: readonly string[];
}

export type RichTranslate<K extends string> = (key: K, request: RichRequest) => readonly RichPart[];

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const TAG_PATTERN = /<(\/?)([a-z][A-Za-z0-9]*)>/y;

interface Frame {
  readonly name: string | undefined;
  readonly children: RichPart[];
}

export function parseRichTemplate(template: string): Result<readonly RichPart[]> {
  assert(typeof template === 'string', 'parseRichTemplate: the template is a string');
  const frames: Frame[] = [{ name: undefined, children: [] }];
  let text = '';
  let index = 0;
  let tagCount = 0;
  let slotCount = 0;
  while (index < template.length) {
    const character = template.charAt(index);
    const next = template.charAt(index + 1);
    const top = frames[frames.length - 1];
    assert(top !== undefined, 'parseRichTemplate: the frame stack is never empty');
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
      if (!NAME_PATTERN.test(name)) {
        return err({ code: 'bad-placeholder', message: `Bad slot "{${name}}"` });
      }
      slotCount += 1;
      if (slotCount > RICH_LIMITS.slotsMax) {
        return err({ code: 'too-many-slots', message: 'Message exceeds the slot limit' });
      }
      text = flushText(top, text);
      top.children.push({ kind: 'slot', name });
      index = close + 1;
    } else if (character === '<') {
      TAG_PATTERN.lastIndex = index;
      const match = TAG_PATTERN.exec(template);
      if (match === null) {
        text += character;
        index += 1;
      } else {
        const closing = match[1] === '/';
        const name = match[2];
        assert(name !== undefined, 'parseRichTemplate: the tag pattern captures a name');
        text = flushText(top, text);
        if (closing) {
          if (top.name !== name) {
            return err({ code: 'bad-tag', message: `Closing </${name}> does not match ${top.name === undefined ? 'an open tag' : `<${top.name}>`}` });
          }
          frames.pop();
          const parent = frames[frames.length - 1];
          assert(parent !== undefined, 'parseRichTemplate: a closed tag has a parent');
          parent.children.push({ kind: 'tag', name, children: top.children });
        } else {
          tagCount += 1;
          if (tagCount > RICH_LIMITS.tagsMax) {
            return err({ code: 'too-many-tags', message: 'Message exceeds the tag limit' });
          }
          if (frames.length > RICH_LIMITS.tagDepthMax) {
            return err({ code: 'tags-too-deep', message: 'Message nests tags too deeply' });
          }
          frames.push({ name, children: [] });
        }
        index += match[0].length;
      }
    } else {
      text += character;
      index += 1;
    }
  }
  const root = frames[0];
  assert(root !== undefined, 'parseRichTemplate: the root frame exists');
  if (frames.length > 1) {
    return err({ code: 'bad-tag', message: `Unclosed <${frames[frames.length - 1]?.name ?? '?'}>` });
  }
  flushText(root, text);
  return ok(root.children);
}

function flushText(frame: Frame, text: string): string {
  if (text.length > 0) {
    frame.children.push({ kind: 'text', text });
  }
  return '';
}

export function richNamesOf(parts: readonly RichPart[]): { readonly slots: readonly string[]; readonly tags: readonly string[] } {
  const slots = new Set<string>();
  const tags = new Set<string>();
  const pending: RichPart[] = [...parts];
  let steps = 0;
  while (pending.length > 0 && steps < 4_096) {
    steps += 1;
    const part = pending.pop();
    assert(part !== undefined, 'richNamesOf: pending is not empty');
    if (part.kind === 'slot') {
      slots.add(part.name);
    } else if (part.kind === 'tag') {
      tags.add(part.name);
      pending.push(...part.children);
    }
  }
  return { slots: [...slots].sort(), tags: [...tags].sort() };
}

export function richNamesOfTemplate(template: string): Result<{ readonly slots: readonly string[]; readonly tags: readonly string[] }> {
  const parsed = parseRichTemplate(template);
  return parsed.ok ? ok(richNamesOf(parsed.value)) : parsed;
}

export function createRichTranslator<K extends string>(options: TranslatorOptions<K>): RichTranslate<K> {
  assert(Object.keys(options.fallback).length > 0, 'createRichTranslator: the English catalog is not empty');
  return (key, request) => {
    const english = options.fallback[key];
    assert(english !== undefined, `translateRich: "${key}" is not an English message`);
    const params = request.count === undefined ? {} : { count: request.count };
    const translated = Object.hasOwn(options.catalog, key) ? options.catalog[key] : undefined;
    if (translated !== undefined && options.locale !== 'en') {
      const parts = richPartsFor(options.locale, translated, params, request);
      if (parts.ok) {
        return parts.value;
      }
      options.onIssue({ kind: 'bad-message', locale: options.locale, key, reason: parts.error.message });
    } else if (options.locale !== 'en') {
      options.onIssue({ kind: 'missing-key', locale: options.locale, key });
    }
    const fallbackParts = richPartsFor('en', english, params, request);
    assert(fallbackParts.ok, `translateRich: English "${key}" fits the slots and tags the call site passed`);
    return fallbackParts.value;
  };
}

function richPartsFor(locale: Locale, value: MessageValue, params: { readonly count?: number }, request: RichRequest): Result<readonly RichPart[]> {
  const template = pluralTemplate(locale, value, params);
  if (!template.ok) {
    return template;
  }
  const parsed = parseRichTemplate(template.value);
  if (!parsed.ok) {
    return parsed;
  }
  const names = richNamesOf(parsed.value);
  for (const slot of names.slots) {
    if (!request.slots.includes(slot)) {
      return err({ code: 'unknown-slot', message: `The call site offers no slot {${slot}}` });
    }
  }
  for (const tag of names.tags) {
    if (!request.tags.includes(tag)) {
      return err({ code: 'unknown-tag', message: `The call site offers no tag <${tag}>` });
    }
  }
  return ok(parsed.value);
}
