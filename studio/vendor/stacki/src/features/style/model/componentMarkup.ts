
import { assert } from '../../../../shared/core/assert';
import { compileSelectorList, type AttrCond, type CompiledSelector, type Compound } from './selectorParse';

export const COMPONENT_MARKUP_ATTRIBUTES_MAX = 256;

export const COMPONENT_MARKUP_RELATED_MAX = 1024;

export type ComponentMarkup = {
  readonly classes: readonly string[];
  readonly attributes: ReadonlyMap<string, string | undefined>;
  readonly parent?: ComponentMarkup | undefined;
  readonly previous?: ComponentMarkup | undefined;
};

export function writtenInMarkup(selector: string, markup: ComponentMarkup | undefined): boolean {
  if (markup === undefined) {
    return false;
  }
  assert(markup.attributes.size <= COMPONENT_MARKUP_ATTRIBUTES_MAX, 'writtenInMarkup: the markup attributes are capped');
  const members = compileSelectorList(selector);
  if (members.length === 0) {
    return false;
  }
  const written = members.every((member) => memberWritten(member, markup));
  assert(!written || members.length > 0, 'writtenInMarkup: a written selector has a member');
  return written;
}

export function componentMarkupOf(input: {
  readonly classes: readonly string[];
  readonly props: Readonly<Record<string, { readonly type: string; readonly value?: string }>> | undefined;
  readonly parent?: ComponentMarkup | undefined;
  readonly previous?: ComponentMarkup | undefined;
}): ComponentMarkup {
  const attributes = new Map<string, string | undefined>();
  for (const [name, attribute] of Object.entries(input.props ?? {})) {
    if (attributes.size < COMPONENT_MARKUP_ATTRIBUTES_MAX) {
      if (name !== 'class' && !name.includes(':')) {
        attributes.set(name.toLowerCase(), attribute.type === 'string' ? String(attribute.value ?? '') : undefined);
      }
    } else {
      break;
    }
  }
  assert(attributes.size <= COMPONENT_MARKUP_ATTRIBUTES_MAX, 'componentMarkupOf: bounded by COMPONENT_MARKUP_ATTRIBUTES_MAX');
  assert(!attributes.has('class'), 'componentMarkupOf: classes are kept apart from attributes');
  return { classes: [...input.classes], attributes, parent: input.parent, previous: input.previous };
}

export const INSTANCE_RENDERED_CLASSES_MAX = 256;

type MarkupProp = { readonly type: string; readonly value?: string };

export function instanceMarkupOf(input: {
  readonly props: Readonly<Record<string, MarkupProp>> | undefined;
  readonly passed: readonly string[];
  readonly rendered: readonly string[];
  readonly root: { readonly classes: readonly string[]; readonly props: Readonly<Record<string, MarkupProp>> | undefined } | undefined;
}): ComponentMarkup | undefined {
  const rendered = input.rendered.slice(0, INSTANCE_RENDERED_CLASSES_MAX);
  const props = Object.entries(input.props ?? {}).slice(0, COMPONENT_MARKUP_ATTRIBUTES_MAX);
  const passed = new Set(input.passed);
  for (const [name, prop] of props) {
    if (prop.type === 'string' && !name.includes(':')) {
      for (const token of String(prop.value ?? '').split(/\s+/)) {
        if (token.length > 0 && rendered.includes(token)) {
          passed.add(token);
        }
      }
    }
  }
  const unknown = props.some(([name, prop]) => prop.type === 'expr' && name.toLowerCase().includes('class') && !literalOnly(String(prop.value ?? '')));
  const rootProps = Object.fromEntries(Object.entries(input.root?.props ?? {}).filter(([name]) => input.props?.[name] === undefined));
  if (rendered.length > 0 && !unknown) {
    const classes = [...new Set(rendered.filter((name) => name.length > 0 && !passed.has(name)))];
    assert(
      classes.every((name) => !passed.has(name)),
      'instanceMarkupOf: a class the instance passed is never inside',
    );
    return componentMarkupOf({ classes, props: rootProps });
  }
  if (input.root === undefined) {
    return undefined;
  }
  const classes = input.root.classes.filter((name) => !passed.has(name));
  assert(classes.length <= input.root.classes.length, 'instanceMarkupOf: a filter never adds');
  return componentMarkupOf({ classes, props: rootProps });
}

function literalOnly(expression: string): boolean {
  const stripped = expression.replace(/(["'])[^"'`]*\1/g, '').replace(/`[^`$]*`/g, '');
  assert(stripped.length <= expression.length, 'literalOnly: stripping never adds');
  return /^[\s[\],]*$/.test(stripped);
}

const NO_MARKUP: ComponentMarkup = { classes: [], attributes: new Map() };

function memberWritten(member: CompiledSelector, markup: ComponentMarkup): boolean {
  const subject = member.compounds[member.compounds.length - 1];
  if (subject === undefined) {
    return false;
  }
  const own = compoundNeeds(subject, markup);
  if (own === 'missing') {
    return false;
  }
  let inside = own === 'written';
  let candidates: readonly ComponentMarkup[] = [markup];
  assert(member.combinators.length === member.compounds.length - 1, 'memberWritten: one combinator between each two compounds');
  for (let index = member.compounds.length - 2; index >= 0; index -= 1) {
    const compound = member.compounds[index];
    assert(compound !== undefined, 'memberWritten: the compound is in range');
    const reached = relatedMarkup(candidates, member.combinators[index] ?? ' ');
    if (compoundNeeds(compound, NO_MARKUP) === 'missing') {
      const matched = reached.filter((candidate) => compoundNeeds(compound, candidate) === 'written');
      if (matched.length === 0) {
        return false;
      }
      inside = true;
      candidates = matched;
    } else {
      candidates = reached;
    }
  }
  assert(candidates.length <= COMPONENT_MARKUP_RELATED_MAX, 'memberWritten: the candidates are capped');
  return inside;
}

function relatedMarkup(from: readonly ComponentMarkup[], combinator: string): ComponentMarkup[] {
  const reached = new Set<ComponentMarkup>();
  const step = combinator === '+' || combinator === '~' ? 'previous' : 'parent';
  const repeat = combinator === ' ' || combinator === '~';
  for (const start of from) {
    let next = start[step];
    while (next !== undefined && reached.size < COMPONENT_MARKUP_RELATED_MAX) {
      reached.add(next);
      next = repeat ? next[step] : undefined;
    }
  }
  assert(reached.size <= COMPONENT_MARKUP_RELATED_MAX, 'relatedMarkup: bounded by COMPONENT_MARKUP_RELATED_MAX');
  assert(!reached.has(NO_MARKUP), 'relatedMarkup: the empty markup is never related');
  return [...reached];
}

type Needs = 'nothing' | 'written' | 'missing';

function compoundNeeds(compound: Compound, markup: ComponentMarkup): Needs {
  const own = namesNeeds(compound, markup);
  if (own === 'missing') {
    return 'missing';
  }
  let named = own === 'written';
  for (const group of compound.requireAny) {
    const answers = group.map((alternative): Needs => {
      const subject = alternative.compounds[alternative.compounds.length - 1];
      if (subject === undefined) {
        return 'missing';
      }
      return subject.requireAny.length === 0 ? namesNeeds(subject, markup) : 'missing';
    });
    if (answers.includes('written')) {
      named = true;
    } else if (!answers.includes('nothing')) {
      return 'missing';
    }
  }
  assert(compound.requireAny.length > 0 || named === (own === 'written'), 'compoundNeeds: without groups the names decide');
  return named ? 'written' : 'nothing';
}

function namesNeeds(compound: Compound, markup: ComponentMarkup): Needs {
  const valued = compound.attrs.filter((attribute) => attribute.operator !== undefined && attribute.value !== undefined);
  const named = compound.classes.length + valued.length + (compound.id === undefined ? 0 : 1);
  if (!compound.classes.every((name) => markup.classes.includes(name))) {
    return 'missing';
  }
  if (!valued.every((attribute) => attributeWritten(attribute, markup))) {
    return 'missing';
  }
  if (compound.id !== undefined) {
    if (markup.attributes.get('id') !== compound.id) {
      return 'missing';
    }
  }
  assert(named >= 0, 'namesNeeds: a count is never negative');
  return named > 0 ? 'written' : 'nothing';
}

function attributeWritten(attribute: AttrCond, markup: ComponentMarkup): boolean {
  const name = attribute.name.toLowerCase();
  const value = name === 'class' ? (markup.classes.length > 0 ? markup.classes.join(' ') : undefined) : markup.attributes.get(name);
  assert(attribute.operator !== undefined, 'attributeWritten: the attribute is compared');
  assert(attribute.value !== undefined, 'attributeWritten: the attribute has a value');
  if (value === undefined) {
    return false;
  }
  const actual = attribute.insensitive ? value.toLowerCase() : value;
  const wanted = attribute.insensitive ? attribute.value.toLowerCase() : attribute.value;
  switch (attribute.operator) {
    case '=':
      return actual === wanted;
    case '~=':
      return actual.split(/\s+/).includes(wanted);
    case '|=':
      return actual === wanted || actual.startsWith(`${wanted}-`);
    case '^=':
      return wanted.length > 0 && actual.startsWith(wanted);
    case '$=':
      return wanted.length > 0 && actual.endsWith(wanted);
    case '*=':
      return wanted.length > 0 && actual.includes(wanted);
    default:
      return false;
  }
}
