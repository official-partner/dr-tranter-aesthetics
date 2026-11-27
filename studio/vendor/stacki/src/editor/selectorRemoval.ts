
import type { Attr } from '../../shared/page/pageNode';
import { assert } from '../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import {
  removeClassFromExpression,
  type ClassExpressionContext,
  type ClassExpressionRemoval,
  type ClassExpressionSnippet,
} from '../../shared/engine/classExpressionRemoval';
import { namesIn } from './classAttr';

type ElementProps = Readonly<Record<string, Attr>>;

export interface RemovalCodeSite {
  readonly attribute: string;
  readonly snippet: ClassExpressionSnippet;
}

export type PropRemoval =
  | { readonly tag: 'edit'; readonly patch: Readonly<Record<string, Attr | undefined>> }
  | { readonly tag: 'refused'; readonly reason: string; readonly site: RemovalCodeSite | undefined };

const ATTRIBUTES_NOT_REMOVABLE: ReadonlySet<string> = new Set(['class', 'class:list', 'style']);

export const REMOVAL_SNIPPET_CHARS_MAX = 48;

export function classRemoval(props: ElementProps | undefined, name: string, translate: Translator = ENGLISH_TRANSLATE): PropRemoval {
  assert(name.length > 0, 'classRemoval: a class name is given');
  assert(!/\s/.test(name), 'classRemoval: one class, no whitespace');
  const outcomes = [classAttributeRemoval(props?.['class'], name), listAttributeRemoval(props?.['class:list'], name)];
  const unreadable = outcomes.find((outcome) => outcome.tag === 'unreadable');
  if (unreadable !== undefined && unreadable.tag === 'unreadable') {
    const code = unreadable.code;
    return refused(translate('editor.selectorRemoval.unreadable', { name, code: quoted(code) }), {
      attribute: unreadable.attribute,
      snippet: { code, from: 0, to: code.length },
    });
  }
  const patch: Record<string, Attr | undefined> = {};
  for (const outcome of outcomes) {
    if (outcome.tag === 'edited') {
      patch[outcome.attribute] = outcome.value;
    }
  }
  if (Object.keys(patch).length > 0) {
    assert(
      Object.keys(patch).every((key) => key === 'class' || key === 'class:list'),
      'classRemoval: only class attributes are written',
    );
    return { tag: 'edit', patch };
  }
  const computed = outcomes.find((outcome) => outcome.tag === 'computed');
  if (computed !== undefined && computed.tag === 'computed') {
    return refused(translate('editor.selectorRemoval.computed', { name, code: quoted(computed.snippet.code), attribute: computed.attribute }), {
      attribute: computed.attribute,
      snippet: computed.snippet,
    });
  }
  return refused(notWritten(name, props, translate), undefined);
}

export function attributeRemoval(props: ElementProps | undefined, name: string, translate: Translator = ENGLISH_TRANSLATE): PropRemoval {
  assert(name.length > 0, 'attributeRemoval: an attribute name is given');
  if (ATTRIBUTES_NOT_REMOVABLE.has(name)) {
    return refused(translate('editor.selectorRemoval.notOneThing', { name }), undefined);
  }
  const prop = props?.[name];
  if (prop === undefined) {
    return refused(notWritten(name, props, translate), undefined);
  }
  switch (prop.type) {
    case 'string':
    case 'bare':
      return { tag: 'edit', patch: { [name]: undefined } };
    case 'expr':
      return refused(translate('editor.selectorRemoval.bound', { name, code: `{${prop.value}}` }), {
        attribute: name,
        snippet: { code: prop.value, from: 0, to: prop.value.length },
      });
    case 'spread':
      return refused(notWritten(name, props, translate), undefined);
    default: {
      const exhaustive: never = prop;
      return exhaustive;
    }
  }
}

export function quoted(code: string): string {
  const flat = code.replace(/\s+/g, ' ').trim();
  if (flat.length <= REMOVAL_SNIPPET_CHARS_MAX) {
    return flat;
  }
  return `${flat.slice(0, REMOVAL_SNIPPET_CHARS_MAX - 1)}…`;
}

type AttributeOutcome =
  | { readonly tag: 'absent' }
  | { readonly tag: 'edited'; readonly attribute: string; readonly value: Attr | undefined }
  | { readonly tag: 'computed'; readonly attribute: string; readonly snippet: ClassExpressionSnippet }
  | { readonly tag: 'unreadable'; readonly attribute: string; readonly code: string };

function classAttributeRemoval(prop: Attr | undefined, name: string): AttributeOutcome {
  if (prop === undefined) {
    return { tag: 'absent' };
  }
  switch (prop.type) {
    case 'string':
      return wordRemoval('class', prop.value, name);
    case 'expr':
      return expressionOutcome('class', prop.value, removeClassFromExpression(prop.value, name, 'string'));
    case 'bare':
    case 'spread':
      return { tag: 'absent' };
    default: {
      const exhaustive: never = prop;
      return exhaustive;
    }
  }
}

function listAttributeRemoval(prop: Attr | undefined, name: string): AttributeOutcome {
  if (prop === undefined) {
    return { tag: 'absent' };
  }
  switch (prop.type) {
    case 'string':
      return wordRemoval('class:list', prop.value, name);
    case 'expr': {
      const context: ClassExpressionContext = 'list';
      return expressionOutcome('class:list', prop.value, removeClassFromExpression(prop.value, name, context));
    }
    case 'bare':
    case 'spread':
      return { tag: 'absent' };
    default: {
      const exhaustive: never = prop;
      return exhaustive;
    }
  }
}

function wordRemoval(attribute: string, value: string, name: string): AttributeOutcome {
  const words = namesIn({ type: 'string', value });
  if (!words.includes(name)) {
    return { tag: 'absent' };
  }
  const remaining = words.filter((word) => word !== name);
  assert(remaining.length < words.length, 'wordRemoval: the class was taken out');
  return { tag: 'edited', attribute, value: remaining.length === 0 ? undefined : { type: 'string', value: remaining.join(' ') } };
}

function expressionOutcome(attribute: string, code: string, removal: ClassExpressionRemoval): AttributeOutcome {
  switch (removal.tag) {
    case 'edited':
      return { tag: 'edited', attribute, value: removal.code === undefined ? undefined : { type: 'expr', value: removal.code } };
    case 'absent':
      return { tag: 'absent' };
    case 'computed': {
      const snippet = removal.snippets[0];
      assert(snippet !== undefined, 'expressionOutcome: computed code names where it is');
      return { tag: 'computed', attribute, snippet };
    }
    case 'unreadable':
      return { tag: 'unreadable', attribute, code };
    default: {
      const exhaustive: never = removal;
      return exhaustive;
    }
  }
}

function refused(reason: string, site: RemovalCodeSite | undefined): PropRemoval {
  assert(reason.length > 0, 'refused: a refusal says why');
  return { tag: 'refused', reason, site };
}

function notWritten(name: string, props: ElementProps | undefined, translate: Translator): string {
  const spread = Object.values(props ?? {}).some((prop) => prop.type === 'spread');
  return spread ? translate('editor.selectorRemoval.notWrittenSpread', { name }) : translate('editor.selectorRemoval.notWritten', { name });
}
