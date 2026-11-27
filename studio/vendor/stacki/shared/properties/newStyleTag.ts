import { assert } from '../core/assert';
import { record, text } from '../core/boundary';

export const NEW_STYLE_TAG_RULES_TOKEN = '/* stacki:rules */';

const TOKEN_COMMENT_BODY = 'stacki:rules';

const WRAPPER_AT_RULES: ReadonlySet<string> = new Set(['layer', 'media', 'supports', 'container', 'scope']);

export type StyleTagScope = 'global' | 'scoped';

export interface StyleTagAttribute {
  readonly name: string;
  readonly value: string | undefined;
}

export interface NewStyleTagSettings {
  readonly attributes: readonly StyleTagAttribute[];
  readonly content: string;
}

const IS_GLOBAL: StyleTagAttribute = { name: 'is:global', value: undefined };

export const DEFAULT_NEW_STYLE_TAG: NewStyleTagSettings = { attributes: [IS_GLOBAL], content: '' };

export function styleTagScopeOf(attributes: readonly StyleTagAttribute[]): StyleTagScope {
  return attributes.some((attribute) => attribute.name === IS_GLOBAL.name) ? 'global' : 'scoped';
}

export type AttributeErrorCode = 'syntax' | 'duplicate' | 'expression';

export type AttributesResult =
  | { readonly ok: true; readonly attributes: readonly StyleTagAttribute[] }
  | { readonly ok: false; readonly error: { readonly code: AttributeErrorCode; readonly message: string } };

const ATTRIBUTE_MESSAGES: Record<AttributeErrorCode, string> = {
  syntax: 'The attributes are not written as name or name="value".',
  duplicate: 'An attribute is written twice.',
  expression: 'A new style tag takes plain attributes, not {expressions}.',
};

const ATTRIBUTE_NAME = /^[A-Za-z_@][\w:.@-]*/;

export function parseStyleTagAttributes(input: string): AttributesResult {
  const attributes: StyleTagAttribute[] = [];
  const fail = (code: AttributeErrorCode): AttributesResult => ({ ok: false, error: { code, message: ATTRIBUTE_MESSAGES[code] } });
  let index = 0;
  while (index < input.length) {
    const rest = input.slice(index);
    const space = /^\s+/.exec(rest);
    if (space !== null) {
      index += space[0].length;
      continue;
    }
    if (rest.startsWith('{')) {
      return fail('expression');
    }
    const name = ATTRIBUTE_NAME.exec(rest);
    if (name === null) {
      return fail('syntax');
    }
    index += name[0].length;
    let value: string | undefined = undefined;
    if (input.charAt(index) === '=') {
      const quote = input.charAt(index + 1);
      if (quote === '{') {
        return fail('expression');
      }
      if (quote !== '"' && quote !== "'") {
        return fail('syntax');
      }
      const end = input.indexOf(quote, index + 2);
      if (end < 0) {
        return fail('syntax');
      }
      value = input.slice(index + 2, end);
      index = end + 1;
      if (index < input.length && !/\s/.test(input.charAt(index))) {
        return fail('syntax');
      }
    } else if (index < input.length && !/\s/.test(input.charAt(index))) {
      return fail('syntax');
    }
    if (attributes.some((attribute) => attribute.name === name[0])) {
      return fail('duplicate');
    }
    attributes.push({ name: name[0], value });
  }
  assert(attributes.length <= input.length, 'parseStyleTagAttributes: each attribute takes at least one character');
  return { ok: true, attributes };
}

export function styleTagAttributesText(attributes: readonly StyleTagAttribute[]): string {
  const written = attributes.map((attribute) => {
    if (attribute.value === undefined) {
      return ` ${attribute.name}`;
    }
    const quote = attribute.value.includes('"') ? "'" : '"';
    return ` ${attribute.name}=${quote}${attribute.value}${quote}`;
  });
  return written.join('');
}

export interface TemplateWrapper {
  readonly name: string;
  readonly params: string;
}

export interface TemplateFrame {
  readonly wrappers: readonly TemplateWrapper[];
  readonly skeleton: string;
}

export type TemplateErrorCode = 'unbalanced' | 'repeated-placeholder' | 'placeholder-in-rule';

export type TemplateResult =
  { readonly ok: true; readonly frame: TemplateFrame } | { readonly ok: false; readonly error: { readonly code: TemplateErrorCode; readonly message: string } };

const MESSAGES: Record<TemplateErrorCode, string> = {
  unbalanced: 'The template has an unclosed brace, comment or string.',
  'repeated-placeholder': `The template names the rules placeholder ${NEW_STYLE_TAG_RULES_TOKEN} more than once.`,
  'placeholder-in-rule': `The placeholder ${NEW_STYLE_TAG_RULES_TOKEN} must sit at the top level or inside at-rule blocks such as @layer, not inside a style rule.`,
};

const fail = (code: TemplateErrorCode): TemplateResult => ({ ok: false, error: { code, message: MESSAGES[code] } });

interface OpenBlock {
  readonly open: number;
  readonly preludeStart: number;
}

interface ClosedBlock {
  readonly open: number;
  readonly close: number;
  readonly prelude: string;
}

interface Scan {
  readonly balanced: boolean;
  readonly placeholders: ReadonlyArray<{ readonly start: number; readonly end: number; readonly chain: readonly string[] }>;
  readonly topLevel: readonly ClosedBlock[];
}

function scanTemplate(content: string): Scan {
  const stack: OpenBlock[] = [];
  const placeholders: Array<{ start: number; end: number; chain: string[] }> = [];
  const topLevel: ClosedBlock[] = [];
  let preludeStart = 0;
  let balanced = true;
  let index = 0;
  while (index < content.length && balanced) {
    const char = content.charAt(index);
    const next = content.charAt(index + 1);
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end < 0) {
        balanced = false;
      } else {
        if (content.slice(index + 2, end).trim() === TOKEN_COMMENT_BODY) {
          placeholders.push({ start: index, end: end + 2, chain: stack.map((block) => preludeOf(content, block)) });
        }
        index = end + 2;
      }
    } else if (char === '"' || char === "'") {
      const end = stringEnd(content, index);
      if (end < 0) {
        balanced = false;
      } else {
        index = end + 1;
      }
    } else if (char === '{') {
      stack.push({ open: index, preludeStart });
      preludeStart = index + 1;
      index += 1;
    } else if (char === '}') {
      const block = stack.pop();
      if (block === undefined) {
        balanced = false;
      } else {
        if (stack.length === 0) {
          topLevel.push({ open: block.open, close: index, prelude: preludeOf(content, block) });
        }
        preludeStart = index + 1;
        index += 1;
      }
    } else if (char === ';') {
      preludeStart = index + 1;
      index += 1;
    } else {
      index += 1;
    }
  }
  return { balanced: balanced && stack.length === 0, placeholders, topLevel };
}

function stringEnd(content: string, from: number): number {
  const quote = content.charAt(from);
  for (let index = from + 1; index < content.length; index += 1) {
    const char = content.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (char === quote) {
      return index;
    } else if (char === '\n') {
      return -1;
    }
  }
  return -1;
}

function preludeOf(content: string, block: OpenBlock): string {
  return content
    .slice(block.preludeStart, block.open)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

function wrapperOf(prelude: string): TemplateWrapper | undefined {
  const match = /^@([A-Za-z][\w-]*)\s*([\s\S]*)$/.exec(prelude);
  if (match === null) {
    return undefined;
  }
  const name = (match[1] ?? '').toLowerCase();
  return { name, params: squash(match[2] ?? '') };
}

export function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function templateFrame(content: string): TemplateResult {
  const scan = scanTemplate(content);
  if (!scan.balanced) {
    return fail('unbalanced');
  }
  if (scan.placeholders.length > 1) {
    return fail('repeated-placeholder');
  }
  const placeholder = scan.placeholders[0];
  if (placeholder !== undefined) {
    return placedFrame(content, placeholder);
  }
  const last = scan.topLevel[scan.topLevel.length - 1];
  if (last !== undefined && /^[\s]*$/.test(content.slice(last.close + 1).replace(/\/\*[\s\S]*?\*\//g, ''))) {
    const wrapper = wrapperOf(last.prelude);
    if (wrapper !== undefined && WRAPPER_AT_RULES.has(wrapper.name)) {
      return { ok: true, frame: { wrappers: [wrapper], skeleton: content } };
    }
  }
  return { ok: true, frame: { wrappers: [], skeleton: content } };
}

function placedFrame(content: string, placeholder: { readonly start: number; readonly end: number; readonly chain: readonly string[] }): TemplateResult {
  const wrappers: TemplateWrapper[] = [];
  for (const prelude of placeholder.chain) {
    const wrapper = wrapperOf(prelude);
    if (wrapper === undefined) {
      return fail('placeholder-in-rule');
    }
    wrappers.push(wrapper);
  }
  const lineStart = content.lastIndexOf('\n', placeholder.start - 1) + 1;
  const lineEndAt = content.indexOf('\n', placeholder.end);
  const lineEnd = lineEndAt < 0 ? content.length : lineEndAt + 1;
  const alone = content.slice(lineStart, placeholder.start).trim() === '' && content.slice(placeholder.end, lineEnd).trim() === '';
  const skeleton = alone ? content.slice(0, lineStart) + content.slice(lineEnd) : content.slice(0, placeholder.start) + content.slice(placeholder.end);
  assert(!skeleton.includes(NEW_STYLE_TAG_RULES_TOKEN), 'templateFrame: the placeholder is gone from the skeleton');
  return { ok: true, frame: { wrappers, skeleton } };
}

export function parseNewStyleTag(input: unknown): NewStyleTagSettings {
  const value = record(input);
  const version = value['version'] ?? 1;
  if (version !== 1 && version !== 2) {
    throw new Error('Unsupported newStyleTag version');
  }
  const content = value['content'] === undefined ? '' : text(value['content']);
  const frame = templateFrame(content);
  if (!frame.ok) {
    throw new Error(`newStyleTag.content: ${frame.error.message}`);
  }
  if (version === 2 && value['isGlobal'] !== undefined) {
    throw new Error('newStyleTag.isGlobal: version 2 writes attributes (is:global) instead');
  }
  return { attributes: version === 1 ? attributesOfVersion1(value['isGlobal']) : attributesOfVersion2(value['attributes']), content };
}

function attributesOfVersion1(isGlobal: unknown): readonly StyleTagAttribute[] {
  if (isGlobal === undefined) {
    return DEFAULT_NEW_STYLE_TAG.attributes;
  }
  if (typeof isGlobal !== 'boolean') {
    throw new Error('newStyleTag.isGlobal: expected true or false');
  }
  return isGlobal ? [IS_GLOBAL] : [];
}

function attributesOfVersion2(attributes: unknown): readonly StyleTagAttribute[] {
  if (attributes === undefined) {
    return DEFAULT_NEW_STYLE_TAG.attributes;
  }
  const parsed = parseStyleTagAttributes(text(attributes));
  if (!parsed.ok) {
    throw new Error(`newStyleTag.attributes: ${parsed.error.message}`);
  }
  return parsed.attributes;
}

export function newStyleTagDocument(settings: NewStyleTagSettings): Record<string, unknown> {
  const frame = templateFrame(settings.content);
  assert(frame.ok, 'newStyleTagDocument: the template parses');
  const attributes = styleTagAttributesText(settings.attributes).trim();
  assert(parseStyleTagAttributes(attributes).ok, 'newStyleTagDocument: the attributes read back');
  return settings.content === '' ? { version: 2, attributes } : { version: 2, attributes, content: settings.content };
}

export function newStyleTagOpening(attributes: readonly StyleTagAttribute[]): string {
  return `<style${styleTagAttributesText(attributes)}>`;
}

export function sameNewStyleTag(left: NewStyleTagSettings, right: NewStyleTagSettings): boolean {
  return left.content === right.content && styleTagAttributesText(left.attributes) === styleTagAttributesText(right.attributes);
}
