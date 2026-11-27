
import fs from 'node:fs';
import { assert } from '../../shared/core/assert';
import { CMS_REMOTE_LIMITS, type RemoteFieldGroup } from '../../shared/properties/cmsRemote';
import {
  REMOTE_SCHEMA_LIMITS,
  type RemoteOption,
  type RemoteReadOnly,
  type RemoteRowPreview,
  type RemoteRule,
  type RemoteScalarKind,
  type RemoteSchemaField,
  type RemoteType,
} from '../../shared/properties/cmsRemoteSchema';
import { rulesOf } from './sanityRules';
import { projectSourceFiles } from './sanityStructure';
import { closing, entries, entryObject, ownBracketed, ownKey, ownSource, ownString } from './sanitySource';

export interface SanitySchemaField {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly required: boolean;
  readonly rules: readonly RemoteRule[];
  readonly type: RemoteType | undefined;
  readonly groups: readonly string[];
  readonly readOnly?: RemoteReadOnly;
}

export interface SanityPreview {
  readonly title: string | undefined;
  readonly media: string | undefined;
  readonly parts: readonly { readonly key: string; readonly path: string }[];
}

export interface SanityDocumentSchema {
  readonly preview: SanityPreview | undefined;
  readonly fields: readonly SanitySchemaField[];
  readonly hidden: ReadonlySet<string>;
  readonly fieldGroups: readonly RemoteFieldGroup[] | undefined;
}

const TYPES_PER_FILE_MAX = 64;
const SCALARS: readonly RemoteScalarKind[] = ['string', 'text', 'url', 'email', 'number', 'boolean', 'date', 'datetime', 'slug'];

export function sanityNamedTypes(projectRoot: string): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  for (const file of projectSourceFiles(projectRoot, (text) => text.includes('defineType('))) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [name, body] of definedTypes(text)) {
      if (!named.has(name)) {
        named.set(name, body);
      }
    }
  }
  return named;
}

export function sanityTypeIcons(projectRoot: string): ReadonlyMap<string, string> {
  const icons = new Map<string, string>();
  for (const file of projectSourceFiles(projectRoot, (text) => text.includes('defineType('))) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [name, body] of definedTypes(text)) {
      const symbol = iconSymbol(text, body);
      if (symbol !== undefined && !icons.has(name)) {
        icons.set(name, symbol);
      }
    }
  }
  return icons;
}

const ICON_IMPORT = /import\s*\{([^}]{1,2000})\}\s*from\s*["'](@sanity\/icons(?:\/[A-Za-z]+)?)["']/g;

export function iconSymbol(text: string, body: string): string | undefined {
  const local = ownSource(body, 'icon')?.trim();
  if (local === undefined || !/^[A-Za-z_$][\w$]{0,63}$/.test(local)) {
    return undefined;
  }
  for (const match of text.matchAll(ICON_IMPORT)) {
    for (const specifier of (match[1] ?? '').split(',')) {
      const [imported = '', alias] = specifier.trim().split(/\s+as\s+/);
      if ((alias ?? imported) === local && /^[A-Z][A-Za-z0-9]{0,60}Icon$/.test(imported)) {
        const symbol = imported
          .slice(0, -'Icon'.length)
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .toLowerCase();
        assert(/^[a-z][a-z0-9-]*$/.test(symbol), 'An icon symbol is kebab case');
        return symbol;
      }
    }
  }
  return undefined;
}

export function sanityDocumentSchema(
  named: ReadonlyMap<string, string>,
  type: string,
  lists: ReadonlyMap<string, readonly string[]> = new Map(),
): SanityDocumentSchema | undefined {
  const body = named.get(type);
  if (body === undefined) {
    return undefined;
  }
  const hidden = new Set<string>();
  const fields = fieldsOf(body, { named, lists, depth: 0, hidden });
  assert(fields.length <= REMOTE_SCHEMA_LIMITS.fieldsMax, 'A schema stays within its field bound');
  return { preview: previewOf(body), fields, hidden, fieldGroups: fieldGroupsOf(body, fields) };
}

function fieldGroupsOf(body: string, fields: readonly SanitySchemaField[]): RemoteFieldGroup[] | undefined {
  const list = ownBracketed(body, 'groups', '[');
  if (list === undefined) {
    return undefined;
  }
  const declared = entries(list)
    .slice(0, CMS_REMOTE_LIMITS.fieldGroupsMax)
    .flatMap((entry): RemoteFieldGroup[] => {
      const own = entryObject(entry);
      const name = ownString(own, 'name');
      if (name === undefined || !GROUP_NAME.test(name) || literalTrue(own, 'hidden')) {
        return [];
      }
      const title = ownString(own, 'title') ?? '';
      return [{ name, title: title === '' ? name : title }];
    });
  const used = new Set(fields.flatMap((field) => field.groups));
  const groups = declared.filter((group, index) => used.has(group.name) && declared.findIndex((other) => other.name === group.name) === index);
  if (groups.length === 0) {
    return undefined;
  }
  assert(groups.length <= CMS_REMOTE_LIMITS.fieldGroupsMax, 'A type has few field groups');
  assert(
    groups.every((group) => used.has(group.name)),
    'Every tab holds a field',
  );
  return groups;
}

const GROUP_NAME = /^[A-Za-z_][\w-]{0,63}$/;

function groupsOf(own: string): string[] {
  const one = ownString(own, 'group');
  const many = one === undefined ? ownBracketed(own, 'group', '[') : undefined;
  const names = one !== undefined ? [one] : many === undefined ? [] : entries(many).map((entry) => /^\s*["'`]([^"'`]{1,64})["'`]\s*$/.exec(entry)?.[1]);
  return names.filter((name): name is string => name !== undefined && GROUP_NAME.test(name)).slice(0, CMS_REMOTE_LIMITS.fieldGroupsMax);
}

export function definedTypes(text: string): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  let from = 0;
  for (let count = 0; count < TYPES_PER_FILE_MAX; count++) {
    const call = text.indexOf('defineType(', from);
    if (call === -1) {
      break;
    }
    from = call + 1;
    const open = text.indexOf('{', call);
    const close = open === -1 ? undefined : closing(text, open);
    const body = close === undefined ? undefined : inlineHelpers(text.slice(open + 1, close), text);
    const name = body === undefined ? undefined : ownString(body, 'name');
    if (body !== undefined && name !== undefined) {
      out.push([name, body]);
    }
  }
  return out;
}

const PREVIEW_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/;
const PREVIEW_OTHERS_MAX = 6;

function previewOf(body: string): SanityPreview | undefined {
  const preview = ownBracketed(body, 'preview', '{');
  const select = preview === undefined ? undefined : ownBracketed(preview, 'select', '{');
  if (preview === undefined || select === undefined) {
    return undefined;
  }
  const paths = entries(select).flatMap((entry) => {
    const match = /^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*["'`]([^"'`]+)["'`]\s*$/.exec(entry);
    const key = match?.[1];
    const path = match?.[2];
    return key !== undefined && path !== undefined && PREVIEW_PATH.test(path) ? [{ key, path }] : [];
  });
  const find = (key: string) => paths.find((entry) => entry.key === key)?.path;
  const parts = subtitleParts(preview, paths).slice(0, PREVIEW_OTHERS_MAX);
  assert(
    parts.every((entry) => PREVIEW_PATH.test(entry.path)),
    'Preview paths are plain',
  );
  return { title: find('title'), media: find('media'), parts };
}

function columnsOf(own: string): { readonly columns?: number } {
  const options = ownBracketed(own, 'options', '{');
  const columns = Number(/^\s*(\d)\b/.exec(options === undefined ? '' : (ownSource(options, 'columns') ?? ''))?.[1]);
  return columns >= 2 && columns <= 4 ? { columns } : {};
}

function rowPreview(own: string): { readonly preview?: RemoteRowPreview } {
  const preview = previewOf(own);
  if (preview === undefined) {
    return {};
  }
  return { preview: { title: preview.title, parts: preview.parts.map((part) => part.path) } };
}

function subtitleParts(
  preview: string,
  paths: readonly { readonly key: string; readonly path: string }[],
): Array<{ readonly key: string; readonly path: string }> {
  const candidates = paths.filter((entry) => !['title', 'media'].includes(entry.key));
  const prepare = ownSource(preview, 'prepare');
  const built = prepare === undefined ? undefined : /\bsubtitle\s*:([^\n]*)/.exec(prepare)?.[1];
  if (built !== undefined) {
    return candidates
      .map((entry) => ({ entry, at: built.search(new RegExp(`\\b${entry.key}\\b`)) }))
      .filter((found) => found.at !== -1)
      .sort((left, right) => left.at - right.at)
      .map((found) => found.entry);
  }
  const subtitle = candidates.filter((entry) => entry.key === 'subtitle');
  return subtitle.length > 0 ? subtitle : candidates;
}

const HELPERS_MAX = 16;
const HELPER = new RegExp(String.raw`\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^()]{0,200})\)` + String.raw`\s*(?::[^=]{0,80})?=>\s*defineField\(\s*\{`, 'g');

function inlineHelpers(body: string, text: string): string {
  let out = body;
  const helpers = [...text.matchAll(HELPER)].slice(0, HELPERS_MAX);
  for (const helper of helpers) {
    const name = helper[1] ?? '';
    const params = (helper[2] ?? '')
      .split(',')
      .map((param) => param.replace(/[:=].*$/s, '').trim())
      .filter((param) => param !== '');
    const open = (helper.index ?? 0) + helper[0].length - 1;
    const close = closing(text, open);
    if (close === undefined || !out.includes(`${name}(`)) {
      continue;
    }
    const keys = text.slice(open + 1, close);
    out = out.replace(new RegExp(`(\\.\\.\\.\\s*)?\\b${name}\\(([^()]{0,400})\\)`, 'g'), (call: string, spread: string | undefined, args: string) => {
      const values = entries(args).map((arg) => /^\s*(["'`])([^"'`]*)\1\s*$/.exec(arg)?.[2]);
      if (values.length !== params.length || values.some((value) => value === undefined)) {
        return call;
      }
      const filled = withArguments(keys, params, values);
      return spread === undefined ? `{${filled}}` : filled;
    });
  }
  return out;
}

function withArguments(keys: string, params: readonly string[], values: readonly (string | undefined)[]): string {
  let out = keys;
  params.forEach((param, index) => {
    const literal = JSON.stringify(values[index] ?? '');
    out = out
      .replace(new RegExp(`(:\\s*)${param}\\b`, 'g'), `$1${literal}`)
      .replace(new RegExp(`(^|[{,\\s])${param}(\\s*(?:,|}|$))`, 'g'), `$1${param}: ${literal}$2`);
  });
  return out;
}

interface Resolving {
  readonly named: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
  readonly depth: number;
  readonly hidden: Set<string> | undefined;
}

function fieldsOf(body: string, context: Resolving): SanitySchemaField[] {
  const list = ownBracketed(body, 'fields', '[');
  if (list === undefined) {
    return [];
  }
  const out: SanitySchemaField[] = [];
  for (const entry of entries(list).slice(0, REMOTE_SCHEMA_LIMITS.fieldsMax)) {
    const own = entryObject(entry);
    const spreadRank = /\.\.\.\s*orderRankField\(/.test(own) || /^\s*orderRankField\(/.test(entry);
    const name = ownString(own, 'name') ?? (spreadRank ? 'orderRank' : undefined);
    if (name === undefined || !/^[A-Za-z_][\w]{0,63}$/.test(name)) {
      continue;
    }
    if (literalTrue(own, 'hidden') || spreadRank) {
      context.hidden?.add(name);
      continue;
    }
    out.push({
      name,
      title: ownString(own, 'title') ?? '',
      description: ownString(own, 'description') ?? '',
      required: /\.required\(\)/.test(ownSource(own, 'validation') ?? ''),
      rules: rulesOf(ownSource(own, 'validation')),
      type: typeOf(own, { ...context, hidden: undefined }),
      groups: context.depth === 0 ? groupsOf(own) : [],
      ...readOnlyOf(own),
    });
  }
  return out;
}

function typeOf(own: string, context: Resolving): RemoteType | undefined {
  if (context.depth > REMOTE_SCHEMA_LIMITS.typeDepthMax) {
    return undefined;
  }
  const name = ownString(own, 'type');
  const inner: Resolving = { ...context, depth: context.depth + 1 };
  const scalar = SCALARS.find((candidate) => candidate === name);
  if (scalar !== undefined) {
    return { kind: scalar, options: optionsOf(own, context.lists) };
  }
  switch (name) {
    case 'geopoint':
    case 'file':
      return { kind: name };
    case 'block':
      return { kind: 'richText' };
    case 'image':
      return { kind: 'image', fields: settled(fieldsOf(own, inner)) };
    case 'object':
    case 'document':
      return {
        kind: 'object',
        name: ownString(own, 'name') ?? 'object',
        fields: settled(fieldsOf(own, inner)),
        ...rowPreview(own),
        ...columnsOf(own),
      };
    case 'reference':
      return { kind: 'reference', to: referenceTargets(own) };
    case 'array':
      return arrayOf(own, inner);
    case undefined:
      return undefined;
    default: {
      const definition = context.named.get(name);
      return definition === undefined ? undefined : typeOf(definition, inner);
    }
  }
}

function arrayOf(own: string, context: Resolving): RemoteType | undefined {
  const list = ownBracketed(own, 'of', '[') ?? '';
  const members = entries(list)
    .slice(0, REMOTE_SCHEMA_LIMITS.membersMax)
    .map((entry) => typeOf(entryObject(entry), context));
  if (members.some((member) => member?.kind === 'richText')) {
    return { kind: 'richText' };
  }
  const choices = optionsOf(own, context.lists);
  const of = members
    .filter((member): member is RemoteType => member !== undefined)
    .map((member) => (member.kind === 'string' && member.options.length === 0 && choices.length > 0 ? { ...member, options: choices } : member));
  return of.length === 0 ? undefined : { kind: 'array', of };
}

function referenceTargets(own: string): string[] {
  const list = ownBracketed(own, 'to', '[') ?? '';
  return entries(list)
    .map((entry) => ownString(entryObject(entry), 'type'))
    .filter((target): target is string => target !== undefined)
    .slice(0, REMOTE_SCHEMA_LIMITS.membersMax);
}

function optionsOf(own: string, lists: ReadonlyMap<string, readonly string[]>): RemoteOption[] {
  const options = ownBracketed(own, 'options', '{');
  if (options === undefined) {
    return [];
  }
  const named = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(ownSource(options, 'list') ?? '')?.[1];
  const list = ownBracketed(options, 'list', '[');
  const items = named !== undefined ? [`...${named}`] : list === undefined ? [] : entries(list);
  const out = items.flatMap((entry): RemoteOption[] => {
    const spread = /^\s*\.\.\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(entry)?.[1];
    if (spread !== undefined) {
      return (lists.get(spread) ?? []).map((value) => ({ title: value, value }));
    }
    const literal = /^\s*["'`]([^"'`]{0,200})["'`]\s*$/.exec(entry)?.[1];
    if (literal !== undefined) {
      return [{ title: literal, value: literal }];
    }
    const value = ownString(entryObject(entry), 'value');
    const title = ownString(entryObject(entry), 'title') ?? value;
    return value === undefined || title === undefined ? [] : [{ title, value }];
  });
  return out.slice(0, REMOTE_SCHEMA_LIMITS.optionsMax);
}

export function sanityConstantLists(projectRoot: string): ReadonlyMap<string, readonly string[]> {
  const lists = new Map<string, readonly string[]>();
  const declaration = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=\s*\[/g;
  for (const file of projectSourceFiles(projectRoot, (text) => /\bconst\s+\w+\s*=\s*\[/.test(text))) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(declaration)) {
      const name = match[1] ?? '';
      const open = (match.index ?? 0) + match[0].length - 1;
      const close = closing(text, open);
      const values = close === undefined ? [] : stringItems(text.slice(open + 1, close));
      if (values !== undefined && values.length > 0 && !lists.has(name)) {
        lists.set(name, values);
      }
      if (lists.size >= CONSTANT_LISTS_MAX) {
        return lists;
      }
    }
  }
  return lists;
}

const CONSTANT_LISTS_MAX = 500;

function stringItems(list: string): string[] | undefined {
  const values: string[] = [];
  for (const entry of entries(list).slice(0, REMOTE_SCHEMA_LIMITS.optionsMax)) {
    const literal = /^\s*["'`]([^"'`$]{0,200})["'`]\s*$/.exec(entry)?.[1];
    if (literal === undefined) {
      return undefined;
    }
    values.push(literal);
  }
  assert(values.length <= REMOTE_SCHEMA_LIMITS.optionsMax, 'A constant list fits a dropdown');
  return values;
}

function settled(fields: readonly SanitySchemaField[]): RemoteSchemaField[] {
  return fields.map(({ groups: _groups, ...field }) => ({ ...field, type: field.type ?? { kind: 'string', options: [] } }));
}

const LOCKED_WHEN_SET = /^\s*\(\s*\{\s*value\s*\}\s*\)\s*=>\s*(?:value\s*!==?\s*(?:undefined|null)|!!\s*value|Boolean\(\s*value\s*\))\s*$/;

function readOnlyOf(own: string): { readonly readOnly?: RemoteReadOnly } {
  if (literalTrue(own, 'readOnly')) {
    return { readOnly: 'always' };
  }
  const source = ownSource(own, 'readOnly');
  if (source !== undefined && LOCKED_WHEN_SET.test(source)) {
    return { readOnly: 'when-set' };
  }
  return {};
}

function literalTrue(own: string, key: string): boolean {
  const at = ownKey(own, key);
  return at !== undefined && /^\s*true\b/.test(own.slice(at));
}
