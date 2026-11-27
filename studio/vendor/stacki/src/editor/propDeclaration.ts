
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import { assert } from '../../shared/core/assert';
import { indentUnitOf, withIndentUnit } from '../../shared/core/indent';
import { LIMITS } from '../../shared/core/limits';
import { err, ok, type Result } from '../../shared/core/result';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';
import { destructureEnd, freeLocal, propNamed, propsInterfaceBody, propsInterfaceEnd, propsPattern, readPropsDestructure } from './loopProps';
import { NUMBER_DECIMALS_MAX, type NumberSettings } from './propDocumentation';
import type { ItemFieldDeclaration } from './itemFields';
import { isListType, listDefaultCode, listFieldsOfType, listSettingsProblem, listTypeText, type ListSettings } from './listPropType';
import { IMAGE_TYPE, imageDefaultChoice, imageDefaultOf, imageTypeText, type ImageDefault } from './imagePropDefault';
import { astroTypesTag } from './htmlAttributes';

export type NewPropKind = 'string' | 'number' | 'boolean' | 'option' | 'attributes' | 'list' | 'image';

export interface AttributeDefault {
  readonly name: string;
  readonly value: string;
}

export interface PropDeclaration {
  readonly key: string;
  readonly tooltip: string;
  readonly kind: NewPropKind;
  readonly defaultText: string;
  readonly options: readonly string[];
  readonly number: NumberSettings;
  readonly attributes: readonly AttributeDefault[];
  readonly tag: string;
  readonly list: ListSettings;
  readonly image: string;
  readonly typing?: PropTyping | undefined;
  readonly defaultExpression?: string | undefined;
  readonly local?: string | undefined;
}

export interface PropTyping {
  readonly required: boolean;
  readonly readonly: boolean;
  readonly codeType: string;
}

export interface PropImport {
  readonly name: string;
  readonly path: string;
  readonly named: boolean;
  readonly typeOnly: boolean;
}

export interface DeclaredProp {
  readonly frontmatter: string;
  readonly local: string;
  readonly imports: readonly PropImport[];
}

export interface ExistingImport {
  readonly name: string;
  readonly path: string;
  readonly named?: boolean | undefined;
}

export interface RestBinding {
  readonly local: string;
  readonly span: { readonly from: number; readonly to: number };
}

export const DECLARATION_LIMITS = {
  tooltipCharsMax: 500,
  optionsMax: 64,
  optionCharsMax: 256,
  attributesMax: LIMITS.attrsPerNodeMax,
} as const satisfies Record<string, number>;

export const ATTRIBUTES_TYPE = { name: 'HTMLAttributes', path: 'astro/types' } as const;
export const GLOBAL_ATTRIBUTES_TYPE = 'astroHTML.JSX.HTMLAttributes';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const TAG_NAME = /^[a-z][a-z0-9-]*$/;
const typescript = parser.configure({ dialect: 'ts' });
const ATTRIBUTE_NAME = /^[A-Za-z_:@][\w:.@-]*$/;
const RESERVED = new Set([
  'Astro',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

export function readRestBinding(frontmatter: string): RestBinding | undefined {
  const pattern = propsPattern(frontmatter);
  let child = pattern?.firstChild ?? undefined;
  for (let count = 0; child !== undefined && count < LIMITS.propSchemaFieldsMax; count++) {
    const local = child.name === 'PatternProperty' && child.getChild('Spread') !== null ? (child.getChild('VariableDefinition') ?? undefined) : undefined;
    if (local !== undefined) {
      return { local: frontmatter.slice(local.from, local.to), span: { from: child.from, to: child.to } };
    }
    child = child.nextSibling ?? undefined;
  }
  return undefined;
}

export function attributesTag(frontmatter: string): string | undefined {
  const typing = propsTypingText(frontmatter);
  const match = typing === undefined ? undefined : (/\bHTMLAttributes\s*<\s*["']([a-z][a-z0-9-]*)["']\s*>/.exec(typing) ?? undefined);
  return match?.[1];
}

export function attributesTyped(frontmatter: string): boolean {
  const typing = propsTypingText(frontmatter);
  return typing !== undefined && /\bHTMLAttributes\b/.test(typing);
}

export function attributesBase(tag: string): string {
  assert(TAG_NAME.test(tag), 'attributesBase: an HTML tag');
  const out = astroTypesTag(tag) ? `${ATTRIBUTES_TYPE.name}<${JSON.stringify(tag)}>` : GLOBAL_ATTRIBUTES_TYPE;
  assert(out.endsWith(ATTRIBUTES_TYPE.name) || out.includes(`"${tag}"`), 'attributesBase: the base names the tag or none');
  return out;
}

export function restTooltip(frontmatter: string): string {
  const comment = interfaceComment(frontmatter);
  const tagged = comment === undefined ? undefined : (/@attributes[ \t]+(.*?)\s*(?:\*\/|\n|$)/.exec(comment.text) ?? undefined);
  return (tagged?.[1] ?? '').trim();
}

export function withRestTooltip(frontmatter: string, tooltip: string, translate: Translator = ENGLISH_TRANSLATE): Result<string, string> {
  const head = interfaceHead(frontmatter);
  if (head === undefined) {
    return err(translate('editor.propDeclaration.noInterface'));
  }
  const text = tooltipText(tooltip);
  const comment = interfaceComment(frontmatter);
  let out: string;
  if (comment !== undefined && /@attributes\b/.test(comment.text)) {
    const replaced = text === '' ? '' : `/** @attributes ${text} */`;
    const tail = text === '' ? lineEnd(frontmatter, comment.to) : comment.to;
    out = `${frontmatter.slice(0, comment.from)}${replaced}${frontmatter.slice(tail)}`;
  } else if (text !== '') {
    out = `${frontmatter.slice(0, head.statement)}/** @attributes ${text} */\n${frontmatter.slice(head.statement)}`;
  } else {
    out = frontmatter;
  }
  assert(restTooltip(out) === text, 'withRestTooltip: the tooltip reads back');
  return ok(out);
}

export function restReleased(frontmatter: string, local: string): string | undefined {
  assert(IDENTIFIER.test(local), 'restReleased: a rest binding is an identifier');
  const rest = readRestBinding(frontmatter);
  if (rest?.local !== local || hasSyntaxError(frontmatter)) {
    return undefined;
  }
  const word = new RegExp(`(?<![\\w$])${local.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  const reads = [...frontmatter.matchAll(word)].length;
  assert(reads >= 1, 'restReleased: the rest binding is read where it is declared');
  if (reads > 1) {
    return undefined;
  }
  const untyped = withoutAttributesTyping(withoutRestEntry(frontmatter, rest));
  const tooltip = withRestTooltip(untyped, '');
  const out = tooltip.ok ? tooltip.value : untyped;
  assert(readRestBinding(out) === undefined, 'restReleased: the rest binding is gone');
  assert(!attributesTyped(out), 'restReleased: Props no longer takes HTMLAttributes');
  return out;
}

function withoutRestEntry(frontmatter: string, rest: RestBinding): string {
  const others = readPropsDestructure(frontmatter)?.entries.length ?? 0;
  const statement = propsPattern(frontmatter)?.parent ?? undefined;
  if (others === 0 && statement !== undefined) {
    return `${frontmatter.slice(0, statement.from)}${frontmatter.slice(lineEnd(frontmatter, statement.to))}`;
  }
  const head = frontmatter.slice(0, rest.span.from).replace(/,\s*$/, '');
  return `${head}${frontmatter.slice(rest.span.to)}`;
}

function withoutAttributesTyping(frontmatter: string): string {
  const isAttributes = (part: string): boolean => /^(astroHTML\.JSX\.)?HTMLAttributes\b/.test(part.trim());
  const alias = propsAlias(frontmatter);
  if (alias !== undefined) {
    const kept = splitTopLevel(frontmatter.slice(alias.from, alias.to), '&').filter((part) => !isAttributes(part));
    const text = kept.length === 0 ? '{}' : kept.map((part) => part.trim()).join(' & ');
    return `${frontmatter.slice(0, alias.from)}${text}${frontmatter.slice(alias.to)}`;
  }
  const head = interfaceHead(frontmatter);
  const list = head === undefined ? undefined : (/^(\s*extends\s+)([\s\S]*?)(\s*)$/.exec(head.text) ?? undefined);
  if (head === undefined || list === undefined) {
    return frontmatter;
  }
  const kept = splitTopLevel(list[2] ?? '', ',').filter((part) => !isAttributes(part));
  const text = kept.length === 0 ? ' ' : `${list[1] ?? ' extends '}${kept.map((part) => part.trim()).join(', ')}${list[3] ?? ' '}`;
  return `${frontmatter.slice(0, head.from)}${text}${frontmatter.slice(head.from + head.text.length)}`;
}

function splitTopLevel(text: string, separator: ',' | '&'): readonly string[] {
  assert(text.length <= PROPERTY_LIMITS.sourceCharsMax, 'splitTopLevel: the text is bounded');
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? '';
    if ('<([{'.includes(character)) {
      depth++;
    } else if ('>)]}'.includes(character) && text[index - 1] !== '=') {
      depth = Math.max(0, depth - 1);
    } else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  assert(parts.length >= 1, 'splitTopLevel: there is always one part');
  return parts.filter((part) => part.trim() !== '');
}

export function defaultCode(
  declaration: Pick<PropDeclaration, 'kind' | 'defaultText' | 'options' | 'number' | 'list' | 'image' | 'defaultExpression'>,
  translate: Translator = ENGLISH_TRANSLATE,
): Result<string | undefined, string> {
  const expression = declaration.defaultExpression?.trim() ?? '';
  assert(expression.length <= PROPERTY_LIMITS.textCharsMax, 'defaultCode: a default expression is bounded');
  if (expression !== '') {
    return ok(expression);
  }
  if (declaration.kind === 'list') {
    const problem = listSettingsProblem(declaration.list, translate);
    return problem === undefined ? ok(listDefaultCode(declaration.list)) : err(problem);
  }
  if (declaration.kind === 'image') {
    const image = imageDefaultChoice(declaration.image, translate);
    if (!image.ok) {
      return image;
    }
    return ok(image.value === undefined ? undefined : imageDefaultCode(image.value, image.value.kind === 'asset' ? image.value.base : ''));
  }
  const text = declaration.defaultText.trim();
  assert(text.length <= PROPERTY_LIMITS.textCharsMax, 'defaultCode: default text is bounded');
  if (text === '') {
    return ok(undefined);
  }
  switch (declaration.kind) {
    case 'string':
      return ok(JSON.stringify(declaration.defaultText));
    case 'number':
      return numberDefault(text, declaration.number, translate);
    case 'boolean':
      if (text === 'true') {
        return ok('true');
      }
      if (text === 'false') {
        return ok('false');
      }
      return err(translate('editor.propDeclaration.default.onOrOff'));
    case 'option':
      if (declaration.options.includes(declaration.defaultText)) {
        return ok(JSON.stringify(declaration.defaultText));
      }
      return err(translate('editor.propDeclaration.default.oneOfOptions'));
    case 'attributes':
      return ok(undefined);
    default: {
      const exhaustive: never = declaration.kind;
      return exhaustive;
    }
  }
}

function imageDefaultCode(image: ImageDefault, local: string): string {
  switch (image.kind) {
    case 'asset':
      assert(/^[A-Za-z_$][\w$]*$/.test(local), 'imageDefaultCode: an import is read by an identifier');
      return local;
    case 'url':
      return JSON.stringify(image.url);
    default: {
      const exhaustive: never = image;
      return exhaustive;
    }
  }
}

function numberDefault(text: string, settings: NumberSettings, translate: Translator): Result<string, string> {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return err(translate('editor.propDeclaration.default.notNumber'));
  }
  const { min, max, decimals } = settings;
  if (min !== undefined && value < min) {
    return err(translate('editor.propDeclaration.default.atLeast', { min }));
  }
  if (max !== undefined && value > max) {
    return err(translate('editor.propDeclaration.default.atMost', { max }));
  }
  if (decimals !== undefined && Number(value.toFixed(decimals)) !== value) {
    return err(decimals === 0 ? translate('editor.propDeclaration.default.whole') : translate('editor.propDeclaration.default.decimals', { count: decimals }));
  }
  return ok(String(value));
}

export function typeText(
  declaration: Pick<PropDeclaration, 'kind' | 'options' | 'list' | 'image'>,
  frontmatter = '',
  translate: Translator = ENGLISH_TRANSLATE,
): Result<string, string> {
  switch (declaration.kind) {
    case 'string':
    case 'number':
    case 'boolean':
      return ok(declaration.kind);
    case 'option': {
      const problem = optionsProblem(declaration.options, translate);
      return problem === undefined ? ok(declaration.options.map((option) => JSON.stringify(option)).join(' | ')) : err(problem);
    }
    case 'attributes':
      return ok(ATTRIBUTES_TYPE.name);
    case 'list': {
      const problem = listSettingsProblem(declaration.list, translate);
      return problem === undefined ? ok(listTypeText(frontmatter, declaration.list.fields)) : err(problem);
    }
    case 'image': {
      const image = imageDefaultChoice(declaration.image, translate);
      if (!image.ok) {
        return image;
      }
      return ok(image.value === undefined ? 'string' : imageTypeText(image.value));
    }
    default: {
      const exhaustive: never = declaration.kind;
      return exhaustive;
    }
  }
}

export function optionsProblem(options: readonly string[], translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (options.length === 0) {
    return translate('editor.propDeclaration.options.none');
  }
  if (options.length > DECLARATION_LIMITS.optionsMax) {
    return translate('editor.propDeclaration.options.tooMany');
  }
  if (options.some((option) => option.trim() === '')) {
    return translate('editor.propDeclaration.options.empty');
  }
  if (options.some((option) => option.length > DECLARATION_LIMITS.optionCharsMax)) {
    return translate('editor.propDeclaration.options.tooLong');
  }
  return new Set(options).size === options.length ? undefined : translate('editor.propDeclaration.options.duplicate');
}

export function numberSettingsProblem(settings: NumberSettings, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const { min, max, decimals } = settings;
  if (min !== undefined && !Number.isFinite(min)) {
    return translate('editor.propDeclaration.number.minNotNumber');
  }
  if (max !== undefined && !Number.isFinite(max)) {
    return translate('editor.propDeclaration.number.maxNotNumber');
  }
  if (min !== undefined && max !== undefined && min > max) {
    return translate('editor.propDeclaration.number.minAboveMax');
  }
  if (decimals !== undefined) {
    if (!Number.isSafeInteger(decimals)) {
      return translate('editor.propDeclaration.number.decimalsNotWhole');
    }
    if (decimals < 0 || decimals > NUMBER_DECIMALS_MAX) {
      return translate('editor.propDeclaration.number.decimalsRange', { max: NUMBER_DECIMALS_MAX });
    }
  }
  return undefined;
}

export function attributeDefaultsProblem(defaults: readonly AttributeDefault[], translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (defaults.length > DECLARATION_LIMITS.attributesMax) {
    return translate('editor.propDeclaration.attributes.tooMany');
  }
  for (const entry of defaults) {
    if (!ATTRIBUTE_NAME.test(entry.name)) {
      return entry.name === ''
        ? translate('editor.propDeclaration.attributes.nameEmpty')
        : translate('editor.propDeclaration.attributes.nameInvalid', { name: entry.name });
    }
    if (entry.value.length > LIMITS.attrCharsMax) {
      return translate('editor.propDeclaration.attributes.valueTooLong', { name: entry.name });
    }
  }
  const names = defaults.map((entry) => entry.name);
  return new Set(names).size === names.length ? undefined : translate('editor.propDeclaration.attributes.nameDuplicate');
}

export function declaredProp(
  frontmatter: string,
  declaration: PropDeclaration,
  taken: ReadonlySet<string>,
  existing: readonly ExistingImport[] = [],
  translate: Translator = ENGLISH_TRANSLATE,
): Result<DeclaredProp, string> {
  assert(IDENTIFIER.test(declaration.key), 'declaredProp: a new prop is named by an identifier');
  assert(declaration.key.length <= PROPERTY_LIMITS.nameCharsMax, 'declaredProp: a prop name is bounded');
  const refused = declarationProblem(frontmatter, declaration, translate);
  if (refused !== undefined) {
    return err(refused);
  }
  const codeType = declaration.typing?.codeType.trim() ?? '';
  const type = codeType === '' ? typeText(declaration, frontmatter, translate) : ok(codeType);
  if (!type.ok) {
    return type;
  }
  const local = localOf(declaration, taken);
  const needed = neededImports(frontmatter, declaration, new Set([...taken, local]), existing);
  const fallback = needed.defaultCode === undefined ? defaultCode(declaration, translate) : ok(needed.defaultCode);
  if (!fallback.ok) {
    return fallback;
  }
  const entry = entryText(declaration, local, fallback.value);
  const restBefore = readRestBinding(frontmatter) !== undefined;
  const typing =
    declaration.kind === 'attributes'
      ? attributesEdits(frontmatter, declaration)
      : interfaceEdits(frontmatter, memberText(declaration, type.value), { restBefore });
  const edits = [...destructureEdits(frontmatter, entry, declaration.kind), ...typing];
  const ordered = [...edits].sort((left, right) => right.at - left.at || right.order - left.order);
  let out = frontmatter;
  for (const edit of ordered) {
    out = `${out.slice(0, edit.at)}${edit.text}${out.slice(edit.at)}`;
  }
  assertDeclared(out, declaration, local);
  return ok({ frontmatter: out, local, imports: needed.imports });
}

function localOf(declaration: Pick<PropDeclaration, 'key' | 'local'>, taken: ReadonlySet<string>): string {
  const wanted = declaration.local;
  if (wanted !== undefined && IDENTIFIER.test(wanted) && !taken.has(wanted) && !RESERVED.has(wanted)) {
    return wanted;
  }
  const out = taken.has(declaration.key) || RESERVED.has(declaration.key) ? freeLocal(declaration.key, taken) : declaration.key;
  assert(!RESERVED.has(out), 'localOf: a prop is never read by a reserved word');
  return out;
}

const IMPORT_SUFFIX_MAX = 100;

function neededImports(
  frontmatter: string,
  declaration: PropDeclaration,
  taken: ReadonlySet<string>,
  existing: readonly ExistingImport[],
): { readonly imports: readonly PropImport[]; readonly defaultCode: string | undefined } {
  if (declaration.kind === 'attributes') {
    const imported = astroTypesTag(declaration.tag) && !attributesTyped(frontmatter);
    return {
      imports: imported ? [{ name: ATTRIBUTES_TYPE.name, path: ATTRIBUTES_TYPE.path, named: true, typeOnly: true }] : [],
      defaultCode: undefined,
    };
  }
  if (declaration.kind !== 'image') {
    return { imports: [], defaultCode: undefined };
  }
  const image = imageDefaultOf(declaration.image);
  if (!image.ok || image.value.kind !== 'asset') {
    return { imports: [], defaultCode: undefined };
  }
  const { specifier, base } = image.value;
  const type: PropImport = { name: IMAGE_TYPE.name, path: IMAGE_TYPE.path, named: true, typeOnly: true };
  const reused = existing.find((entry) => entry.path === specifier && entry.named !== true);
  if (reused !== undefined) {
    return { imports: [type], defaultCode: reused.name };
  }
  let name = base;
  for (let suffix = 2; taken.has(name) || RESERVED.has(name); suffix++) {
    assert(suffix <= IMPORT_SUFFIX_MAX, 'neededImports: a free import name is found within the suffix bound');
    name = `${base}${suffix}`;
  }
  assert(!taken.has(name), 'neededImports: the import name is free');
  return { imports: [type, { name, path: specifier, named: false, typeOnly: false }], defaultCode: name };
}

function declarationProblem(frontmatter: string, declaration: PropDeclaration, translate: Translator): string | undefined {
  if (frontmatter.length > PROPERTY_LIMITS.sourceCharsMax) {
    return translate('editor.propDeclaration.frontmatter.tooLong');
  }
  if (declaration.kind !== 'attributes' && /\btype\s+Props\s*=/.test(frontmatter)) {
    return translate('editor.propDeclaration.frontmatter.typeProps');
  }
  if (declaration.kind === 'attributes' && hasSyntaxError(frontmatter)) {
    return translate('editor.propDeclaration.attributes.syntaxError');
  }
  const codeType = declaration.typing?.codeType ?? '';
  if (codeType.length > PROPERTY_LIMITS.textCharsMax) {
    return translate('editor.propDeclaration.codeType.tooLong');
  }
  if (/[;\n]/.test(codeType)) {
    return translate('editor.propDeclaration.codeType.multiline');
  }
  const rest = readRestBinding(frontmatter);
  const kindProblem = kindSettingsProblem(declaration, rest, translate);
  if (kindProblem !== undefined) {
    return kindProblem;
  }
  const destructured = readPropsDestructure(frontmatter)?.entries.some((entry) => entry.key === declaration.key) ?? false;
  if (destructured || hasMember(frontmatter, declaration.key) || rest?.local === declaration.key) {
    return translate('editor.propDeclaration.frontmatter.exists', { name: declaration.key });
  }
  return undefined;
}

function kindSettingsProblem(declaration: PropDeclaration, rest: RestBinding | undefined, translate: Translator): string | undefined {
  switch (declaration.kind) {
    case 'attributes':
      if (rest !== undefined) {
        return translate('editor.propDeclaration.attributes.restTaken', { name: rest.local });
      }
      if (!TAG_NAME.test(declaration.tag)) {
        return translate('editor.propDeclaration.attributes.htmlOnly');
      }
      return attributeDefaultsProblem(declaration.attributes, translate);
    case 'number':
      return numberSettingsProblem(declaration.number, translate);
    case 'list':
      return listSettingsProblem(declaration.list, translate);
    case 'image': {
      const image = imageDefaultChoice(declaration.image, translate);
      return image.ok ? undefined : image.error;
    }
    case 'boolean':
    case 'string':
    case 'option':
      return undefined;
    default: {
      const exhaustive: never = declaration.kind;
      return exhaustive;
    }
  }
}

interface TextEdit {
  readonly at: number;
  readonly text: string;
  readonly order: number;
}

function entryText(declaration: PropDeclaration, local: string, fallback: string | undefined): string {
  if (declaration.kind === 'attributes') {
    return `...${local}`;
  }
  const named = local === declaration.key ? local : `${declaration.key}: ${local}`;
  return fallback === undefined ? named : `${named} = ${fallback}`;
}

function memberText(declaration: PropDeclaration, type: string): string {
  const lines = [tooltipText(declaration.tooltip), ...settingTags(declaration)].filter((line) => line !== '');
  const comment = lines.length === 0 ? '' : `\t/** ${lines.join('\n\t * ')} */\n`;
  const modifier = declaration.typing?.readonly === true ? 'readonly ' : '';
  const optional = declaration.typing?.required === true ? '' : '?';
  return `${comment}\t${modifier}${declaration.key}${optional}: ${type};\n`;
}

function settingTags(declaration: PropDeclaration): readonly string[] {
  if (declaration.kind === 'number') {
    const { min, max, decimals } = declaration.number;
    return [min === undefined ? '' : `@min ${min}`, max === undefined ? '' : `@max ${max}`, decimals === undefined ? '' : `@decimals ${decimals}`];
  }
  return [];
}

function destructureEdits(frontmatter: string, entry: string, kind: NewPropKind): readonly TextEdit[] {
  const destructure = readPropsDestructure(frontmatter);
  const pattern = propsPattern(frontmatter);
  if (destructure === undefined || pattern === undefined) {
    const end = propsInterfaceBody(frontmatter)?.to ?? propsAlias(frontmatter)?.to;
    const at = end === undefined ? 0 : lineEnd(frontmatter, end);
    const lead = at > 0 && frontmatter.charAt(at - 1) !== '\n' ? '\n' : '';
    return [{ at, text: `${lead}const { ${entry} } = Astro.props;\n`, order: 1 }];
  }
  const inside = frontmatter.slice(pattern.from, pattern.to);
  const oneLine = !inside.includes('\n');
  const rest = readRestBinding(frontmatter);
  if (rest !== undefined) {
    assert(kind !== 'attributes', 'A destructure takes one rest binding');
    return [{ at: rest.span.from, text: oneLine ? `${entry}, ` : `${entry},\n  `, order: 1 }];
  }
  if (inside.slice(1, -1).trim() === '') {
    return [{ at: pattern.from + 1, text: ` ${entry} `, order: 1 }];
  }
  return [{ at: destructureEnd(frontmatter, destructure), text: oneLine ? `, ${entry}` : `,\n  ${entry}`, order: 1 }];
}

function interfaceEdits(frontmatter: string, member: string, options: { readonly restBefore: boolean }): readonly TextEdit[] {
  const unit = indentUnitOf(frontmatter);
  const end = propsInterfaceEnd(frontmatter);
  if (end !== undefined) {
    const lineBreak = frontmatter.slice(0, end).trimEnd().length === end ? '\n' : '';
    return [{ at: end, text: `${lineBreak}${withIndentUnit(member, unit)}`, order: 0 }];
  }
  const restMember = options.restBefore ? ['\t[attribute: string]: unknown;\n'] : [];
  return [{ at: 0, text: withIndentUnit(`interface Props {\n${[...existingMembers(frontmatter), ...restMember].join('')}${member}}\n`, unit), order: 0 }];
}

function attributesEdits(frontmatter: string, declaration: PropDeclaration): readonly TextEdit[] {
  const tooltip = tooltipText(declaration.tooltip);
  const comment = tooltip === '' ? '' : `/** @attributes ${tooltip} */\n`;
  const base = attributesBase(declaration.tag);
  const alias = propsAlias(frontmatter);
  if (alias !== undefined) {
    const edits: TextEdit[] = [];
    if (attributesTyped(frontmatter)) {
      return edits;
    }
    const wrapped = alias.kind === 'UnionType' || alias.kind === 'ConditionalType' || alias.kind === 'FunctionSignature';
    return [...edits, ...(wrapped ? [{ at: alias.from, text: '(', order: 0 }] : []), { at: alias.to, text: `${wrapped ? ')' : ''} & ${base}`, order: 0 }];
  }
  const head = interfaceHead(frontmatter);
  if (head === undefined) {
    const text = `${comment}interface Props extends ${base} {\n${existingMembers(frontmatter).join('')}}\n`;
    return [{ at: 0, text: withIndentUnit(text, indentUnitOf(frontmatter)), order: 0 }];
  }
  const edits: TextEdit[] = comment === '' ? [] : [{ at: head.statement, text: comment, order: 0 }];
  if (/\bHTMLAttributes\b/.test(head.text)) {
    return edits;
  }
  const extended = /\bextends\b/.test(head.text);
  const at = head.from + head.text.trimEnd().length;
  return [...edits, { at, text: extended ? `, ${base}` : ` extends ${base}`, order: 0 }];
}

function propsAlias(frontmatter: string): { readonly statement: number; readonly from: number; readonly to: number; readonly kind: string } | undefined {
  const tree = typescript.parse(frontmatter);
  for (let statement = tree.topNode.firstChild, count = 0; statement !== null && count <= frontmatter.length; statement = statement.nextSibling, count++) {
    const declaration = statement.name === 'ExportDeclaration' ? statement.getChild('TypeAliasDeclaration') : statement;
    const name = declaration?.name === 'TypeAliasDeclaration' ? (declaration.getChild('TypeDefinition') ?? undefined) : undefined;
    const type = name === undefined ? undefined : (declaration?.getChild('Equals')?.nextSibling ?? undefined);
    if (name !== undefined && type !== undefined && frontmatter.slice(name.from, name.to) === 'Props') {
      assert(type.from < type.to, 'propsAlias: the type has text');
      return { statement: statement.from, from: type.from, to: type.to, kind: type.name };
    }
  }
  return undefined;
}

function propsTypingText(frontmatter: string): string | undefined {
  const alias = propsAlias(frontmatter);
  if (alias !== undefined) {
    return frontmatter.slice(alias.from, alias.to);
  }
  return interfaceHead(frontmatter)?.text;
}

function hasSyntaxError(frontmatter: string): boolean {
  const cursor = typescript.parse(frontmatter).cursor();
  for (let count = 0; count <= frontmatter.length + 1; count++) {
    if (cursor.type.isError) {
      return true;
    }
    if (!cursor.next()) {
      return false;
    }
  }
  assert(false, 'hasSyntaxError: the walk ends within the node bound');
}

function existingMembers(frontmatter: string): readonly string[] {
  return (readPropsDestructure(frontmatter)?.entries ?? []).map((entry) => {
    const value = entry.defaultValue === undefined ? '' : frontmatter.slice(entry.defaultValue.from, entry.defaultValue.to);
    return `\t${entry.key}?: ${literalType(value)};\n`;
  });
}

function literalType(value: string): string {
  const trimmed = value.trim();
  if (/^(["'`]).*\1$/s.test(trimmed)) {
    return 'string';
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return 'boolean';
  }
  return 'unknown';
}

function tooltipText(tooltip: string): string {
  return tooltip.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim().replace(/^@+/, '').slice(0, DECLARATION_LIMITS.tooltipCharsMax);
}

export function memberTypes(frontmatter: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const body = propsInterfaceBody(frontmatter);
  let child = body?.firstChild ?? undefined;
  for (let count = 0; child !== undefined && count < LIMITS.propSchemaFieldsMax; count++) {
    const name = child.name === 'PropertyType' ? (child.getChild('PropertyDefinition') ?? undefined) : undefined;
    const type = child.getChild('TypeAnnotation')?.lastChild ?? undefined;
    if (name !== undefined && type !== undefined) {
      out.set(frontmatter.slice(name.from, name.to), frontmatter.slice(type.from, type.to).trim());
    }
    child = child.nextSibling ?? undefined;
  }
  assert(out.size <= LIMITS.propSchemaFieldsMax, 'memberTypes: the members are bounded');
  return out;
}

export interface ListPropReading {
  readonly key: string;
  readonly fields: readonly ItemFieldDeclaration[] | undefined;
}

export function listPropOf(frontmatter: string, local: string): ListPropReading | undefined {
  const entry = propNamed(frontmatter, local);
  if (entry === undefined) {
    return undefined;
  }
  const type = memberTypes(frontmatter).get(entry.key);
  if (type !== undefined) {
    return isListType(type) ? { key: entry.key, fields: listFieldsOfType(type, frontmatter) } : undefined;
  }
  const span = entry.defaultValue;
  return span !== undefined && frontmatter.slice(span.from, span.to).startsWith('[') ? { key: entry.key, fields: undefined } : undefined;
}

function hasMember(frontmatter: string, key: string): boolean {
  const body = propsInterfaceBody(frontmatter);
  let child = body?.firstChild ?? undefined;
  for (let count = 0; child !== undefined && count < LIMITS.propSchemaFieldsMax; count++) {
    const name = child.name === 'PropertyType' ? (child.getChild('PropertyDefinition') ?? undefined) : undefined;
    if (name !== undefined && frontmatter.slice(name.from, name.to) === key) {
      return true;
    }
    child = child.nextSibling ?? undefined;
  }
  return false;
}

function interfaceHead(frontmatter: string): { readonly statement: number; readonly from: number; readonly text: string } | undefined {
  const body = propsInterfaceBody(frontmatter);
  const declaration = body?.parent ?? undefined;
  const name = declaration?.getChild('TypeDefinition') ?? undefined;
  if (body === undefined || declaration === undefined || name === undefined) {
    return undefined;
  }
  return { statement: statementOf(declaration).from, from: name.to, text: frontmatter.slice(name.to, body.from) };
}

function interfaceComment(frontmatter: string): { readonly from: number; readonly to: number; readonly text: string } | undefined {
  const body = propsInterfaceBody(frontmatter);
  const declaration = body?.parent ?? undefined;
  if (declaration === undefined) {
    return undefined;
  }
  const statement = statementOf(declaration);
  const previous = statement.prevSibling ?? undefined;
  if (previous?.name !== 'BlockComment') {
    return undefined;
  }
  const between = frontmatter.slice(previous.to, statement.from);
  return between.trim() === '' ? { from: previous.from, to: previous.to, text: frontmatter.slice(previous.from, previous.to) } : undefined;
}

function statementOf(declaration: SyntaxNode): SyntaxNode {
  const parent = declaration.parent ?? undefined;
  return parent?.name === 'ExportDeclaration' ? parent : declaration;
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline === -1 ? text.length : newline + 1;
}

function assertDeclared(out: string, declaration: PropDeclaration, local: string): void {
  if (declaration.kind === 'attributes') {
    assert(readRestBinding(out)?.local === local, 'declaredProp: the rest binding reads back');
    assert(attributesTyped(out), 'declaredProp: Props takes HTMLAttributes');
    return;
  }
  const entries = readPropsDestructure(out)?.entries ?? [];
  assert(
    entries.some((entry) => entry.key === declaration.key && entry.local === local),
    'declaredProp: the entry reads back',
  );
  assert(hasMember(out, declaration.key), 'declaredProp: the member reads back');
}
