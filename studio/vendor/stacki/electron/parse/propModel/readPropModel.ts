
import ts from 'typescript';
import { assert } from '../../../shared/core/assert';
import {
  PROP_MODEL_LIMITS,
  parsePropModel,
  type ComponentPropModel,
  type PropControl,
  type PropFallback,
  type PropModel,
  type PropUsage,
  type Recognition,
} from '../../../shared/properties/propModel';
import type { PropDefault } from '../../../shared/properties/propSchema';
import { readPropTags } from '../../../shared/properties/propTags';
import { memberDocumentation, readPropsType, splitFallbacks } from './propDeclarations';
import { numberRules, sharedDocumentation, statedDefault } from './propProse';
import { nullishFallbacks, readProps, type EntryFallback } from './propReads';
import {
  TOP_WALK,
  boundedText,
  controlOfParts,
  flattenParts,
  isNever,
  isNull,
  memberKey,
  partText,
  referencedDeclaration,
  typeScope,
  type FiledSignature,
  type TypePart,
  type TypeScope,
} from './propTypes';

export function readPropModel(source: string, prelude = ''): ComponentPropModel {
  const { frontmatter, template } = splitComponent(source);
  const frontmatterFile = ts.createSourceFile('component.ts', frontmatter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const preludeFile = ts.createSourceFile('prelude.ts', prelude, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const scope = typeScope([frontmatterFile, preludeFile]);
  const reads = readProps(frontmatterFile, template);
  const type = readPropsType(frontmatterFile, preludeFile, scope, reads.patterns);
  const shared = sharedDocumentation(type.unions.flatMap((union) => union.branches.map((branch) => branch.docs)));
  const drafts = declaredDrafts(type.blocks, scope, shared);
  for (const entry of reads.entries) {
    const draft = drafts.get(entry.name) ?? undeclaredDraft(entry.name);
    drafts.set(entry.name, withEntryFallback(draft, entry.fallback));
  }
  if (type.declaration === 'none') {
    for (const name of reads.direct) {
      if (!drafts.has(name) && drafts.size < PROP_MODEL_LIMITS.propsMax) {
        drafts.set(name, undeclaredDraft(name));
      }
    }
  }
  const split = splitFallbacks(type.unions);
  const nullish = nullishFallbacks(frontmatterFile);
  const readNames = new Set([...reads.entries.map((entry) => entry.name), ...reads.direct]);
  const props = [...drafts.values()].slice(0, PROP_MODEL_LIMITS.propsMax).map((draft) => {
    const fallback = draft.fallback.kind === 'none' ? statedFallback(draft, nullish, split) : { draft, fallback: draft.fallback };
    const usage: PropUsage = readNames.has(draft.name) ? 'read' : reads.escapes ? 'unknown' : 'unread';
    return finishedProp(fallback.draft, fallback.fallback, usage);
  });
  const model = parsePropModel({ declaration: type.declaration, props, unions: type.unions });
  assert(model.props.length === props.length, 'readPropModel: the model keeps every prop it read');
  assert(
    model.props.every((prop) => prop.declared || prop.usage === 'read'),
    'readPropModel: an undeclared prop is one the code reads',
  );
  return model;
}

interface Draft {
  readonly name: string;
  readonly declared: boolean;
  readonly typeText: string;
  readonly control: PropControl;
  readonly presence: 'required' | 'optional';
  readonly nullable: boolean;
  readonly documentation: string;
  readonly fallback: PropFallback;
  readonly recognition: Recognition;
}

function undeclaredDraft(name: string): Draft {
  return {
    name,
    declared: false,
    typeText: '',
    control: { kind: 'code', reason: 'untyped' },
    presence: 'optional',
    nullable: false,
    documentation: '',
    fallback: { kind: 'none' },
    recognition: { source: 'fallback' },
  };
}

function splitComponent(source: string): { readonly frontmatter: string; readonly template: string } {
  const match = /^(?:﻿)?---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---/.exec(source) ?? undefined;
  if (match === undefined) {
    return { frontmatter: '', template: source };
  }
  const frontmatter = match[1] ?? '';
  assert(frontmatter.length < source.length, 'splitComponent: the frontmatter is part of the source');
  return { frontmatter, template: source.slice(match[0].length) };
}


interface Accumulated {
  readonly name: string;
  readonly parts: readonly TypePart[];
  readonly texts: readonly string[];
  readonly optional: boolean;
  readonly hasNull: boolean;
  readonly hasUndefined: boolean;
  readonly noted: string;
}

function declaredDrafts(blocks: readonly (readonly FiledSignature[])[], scope: TypeScope, shared: ReadonlyMap<string, string>): Map<string, Draft> {
  const gathered = new Map<string, Accumulated>();
  for (const signature of blocks.flat()) {
    const name = memberKey(signature.member.name);
    if (name === undefined) {
      continue;
    }
    const previous = gathered.get(name) ?? { name, parts: [], texts: [], optional: false, hasNull: false, hasUndefined: false, noted: '' };
    const entry = accumulateMember(previous, signature, scope);
    gathered.set(name, entry.noted === '' ? { ...entry, noted: memberDocumentation(signature).slice(0, PROP_MODEL_LIMITS.docCharsMax) } : entry);
  }
  const drafts = new Map<string, Draft>();
  for (const entry of gathered.values()) {
    const documentation = shared.get(entry.name) ?? entry.noted;
    const presence = entry.optional ? 'optional' : 'required';
    drafts.set(entry.name, {
      name: entry.name,
      declared: true,
      typeText: boundedText(entry.texts.join(' | ')),
      control: documentedControl(controlOfParts(entry.parts, scope, TOP_WALK), entry.noted),
      presence,
      nullable: entry.hasNull || (presence === 'required' && entry.hasUndefined),
      documentation,
      fallback: { kind: 'none' },
      recognition: { source: 'type' },
    });
  }
  assert(drafts.size === gathered.size, 'declaredDrafts: one draft per declared name');
  return drafts;
}

function accumulateMember(entry: Accumulated, signature: FiledSignature, scope: TypeScope): Accumulated {
  const { member, file } = signature;
  const type = member.type;
  const optional = entry.optional || (member.questionToken !== undefined && type?.kind !== ts.SyntaxKind.NeverKeyword);
  if (type === undefined) {
    return { ...entry, optional };
  }
  const declaration = referencedDeclaration(type, scope);
  const read: readonly { readonly part: TypePart; readonly text: string }[] =
    declaration?.kind === 'interface'
      ? [{ part: { kind: 'type', node: type, file, aliases: [] }, text: interfaceBody(declaration.node, declaration.file) }]
      : flattenParts(declaration?.kind === 'alias' ? declaration.node.type : type, declaration?.file ?? file, scope).map((part) => ({
          part,
          text: partText(part),
        }));
  const parts = [...entry.parts];
  const texts = [...entry.texts];
  for (const { part, text } of read) {
    if (!isNever(part) && !texts.includes(text)) {
      parts.push(part);
      texts.push(text);
    }
  }
  assert(parts.length === texts.length, 'accumulateMember: every part has its text');
  return {
    ...entry,
    parts,
    texts,
    optional,
    hasNull: entry.hasNull || read.some(({ part }) => isNull(part)),
    hasUndefined: entry.hasUndefined || read.some(({ part }) => part.kind === 'type' && part.node.kind === ts.SyntaxKind.UndefinedKeyword),
  };
}

function interfaceBody(declaration: ts.InterfaceDeclaration, file: ts.SourceFile): string {
  const text = declaration.getText(file);
  const open = text.indexOf('{');
  return open === -1 ? text : text.slice(open);
}

function documentedControl(control: PropControl, noted: string): PropControl {
  if (control.kind === 'number') {
    const rules = numberRules(noted);
    const tags = readPropTags(noted);
    return {
      kind: 'number',
      min: rules.min,
      max: rules.max,
      minExclusive: rules.minExclusive ?? false,
      maxExclusive: rules.maxExclusive ?? false,
      step: rules.step,
      decimals: tags.decimals,
    };
  }
  return control;
}


function refinable(control: PropControl): boolean {
  return control.kind === 'code' && (control.reason === 'untyped' || control.reason === 'unrecognized');
}

function literalControl(value: PropDefault): PropControl {
  if (typeof value === 'string') {
    return { kind: 'text' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'switch' };
  }
  return { kind: 'number', min: undefined, max: undefined, minExclusive: false, maxExclusive: false, step: undefined, decimals: undefined };
}

function withEntryFallback(draft: Draft, entry: EntryFallback): Draft {
  if (entry.kind === 'none') {
    return draft;
  }
  if (entry.kind === 'literal') {
    const fallback: PropFallback = boundedLiteral(entry.value, 'destructure');
    if (!refinable(draft.control) || fallback.kind === 'none') {
      return { ...draft, fallback };
    }
    return { ...draft, fallback, control: literalControl(entry.value), recognition: { source: 'usage', evidence: 'its default value' } };
  }
  if (entry.code.length > PROP_MODEL_LIMITS.textCharsMax) {
    return draft;
  }
  const fallback: PropFallback = { kind: 'expression', code: entry.code };
  if (!refinable(draft.control)) {
    return { ...draft, fallback };
  }
  const evidence: Recognition = { source: 'usage', evidence: 'its default value' };
  switch (entry.shape) {
    case 'array':
      return { ...draft, fallback, control: { kind: 'list', item: { kind: 'code', reason: 'untyped' } }, recognition: evidence };
    case 'object':
      return { ...draft, fallback, control: { kind: 'attributes', tag: undefined }, recognition: evidence };
    case 'function':
      return { ...draft, fallback, control: { kind: 'callback', signature: '' }, recognition: evidence };
    case 'other':
      return { ...draft, fallback };
    default: {
      const exhaustive: never = entry.shape;
      return exhaustive;
    }
  }
}

function boundedLiteral(value: PropDefault, source: 'destructure' | 'nullish' | 'doc'): PropFallback {
  if (typeof value === 'string' && value.length > PROP_MODEL_LIMITS.textCharsMax) {
    return { kind: 'none' };
  }
  return { kind: 'literal', value, source };
}

function statedFallback(
  draft: Draft,
  nullishes: ReadonlyMap<string, PropDefault>,
  split: ReadonlySet<string>,
): { readonly draft: Draft; readonly fallback: PropFallback } {
  const nullish = nullishes.get(draft.name);
  if (nullish !== undefined) {
    const fallback = boundedLiteral(nullish, 'nullish');
    if (refinable(draft.control) && fallback.kind !== 'none') {
      return { draft: { ...draft, control: literalControl(nullish), recognition: { source: 'usage', evidence: 'its ?? fallback' } }, fallback };
    }
    return { draft, fallback };
  }
  if (split.has(draft.name)) {
    return { draft, fallback: { kind: 'none' } };
  }
  const said = statedDefault(draft.documentation);
  if (said.value !== undefined) {
    const value = draft.control.kind === 'switch' && (said.value === 'true' || said.value === 'false') ? said.value === 'true' : said.value;
    return { draft, fallback: boundedLiteral(value, 'doc') };
  }
  if (said.hint) {
    return { draft, fallback: { kind: 'hint', hint: said.hint.slice(0, PROP_MODEL_LIMITS.textCharsMax) } };
  }
  const phrase = draft.documentation.match(
    /\b(?:is|are)\s+(inferred|automatic|calculated)\b|\b(inferred|automatic)\s+from\b|\b([A-Z][\w ]{0,24}?picks[\w ]{0,20}?)\s+by default\b|\bdefaults?\s*(?:to|:)\s*([^.]+)/i,
  );
  if (phrase) {
    const text = (phrase[1] || phrase[2] || phrase[3] || phrase[4] || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= HINT_CHARS_MAX) {
      return { draft, fallback: { kind: 'hint', hint: text } };
    }
  }
  return { draft, fallback: { kind: 'none' } };
}

const HINT_CHARS_MAX = 48;

function finishedProp(draft: Draft, fallback: PropFallback, usage: PropUsage): PropModel {
  const tags = readPropTags(draft.documentation);
  return {
    name: draft.name,
    typeText: draft.typeText,
    control: draft.control,
    presence: draft.presence,
    nullable: draft.nullable,
    fallback,
    documentation: draft.documentation,
    tooltip: tags.tooltip,
    group: tags.group,
    deprecated: tags.deprecated,
    format: tags.format,
    recognition: draft.recognition,
    usage,
    declared: draft.declared,
  };
}
