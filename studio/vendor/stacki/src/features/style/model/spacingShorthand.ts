
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { assert } from '../../../../shared/core/assert';
import { splitTopLevelSpaces } from './background';

type Declared = { readonly value: string; readonly important: boolean };

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

type Shorthand = { readonly box: 'margin' | 'padding'; readonly sides: readonly Side[] };

const SHORTHANDS: ReadonlyMap<string, Shorthand> = new Map<string, Shorthand>([
  ['margin', { box: 'margin', sides: SIDES }],
  ['padding', { box: 'padding', sides: SIDES }],
  ['padding-block', { box: 'padding', sides: ['top', 'bottom'] }],
  ['padding-inline', { box: 'padding', sides: ['left', 'right'] }],
  ['padding-top', { box: 'padding', sides: ['top'] }],
  ['padding-right', { box: 'padding', sides: ['right'] }],
  ['padding-bottom', { box: 'padding', sides: ['bottom'] }],
  ['padding-left', { box: 'padding', sides: ['left'] }],
]);

const LOGICAL: ReadonlyMap<string, Shorthand> = new Map<string, Shorthand>(
  (['margin', 'padding'] as const).flatMap((box): Array<[string, Shorthand]> => [
    [`${box}-block`, { box, sides: ['top', 'bottom'] }],
    [`${box}-inline`, { box, sides: ['left', 'right'] }],
    [`${box}-block-start`, { box, sides: ['top'] }],
    [`${box}-block-end`, { box, sides: ['bottom'] }],
    [`${box}-inline-start`, { box, sides: ['left'] }],
    [`${box}-inline-end`, { box, sides: ['right'] }],
  ]),
);

const NO_SIDES: ReadonlyMap<string, string> = new Map<string, string>();

export function spacingSides(prop: string, value: string): ReadonlyMap<string, string> {
  const shorthand = SHORTHANDS.get(prop) ?? LOGICAL.get(prop);
  if (shorthand === undefined) {
    return NO_SIDES;
  }
  const parts = splitTopLevelSpaces(value);
  const first = parts[0];
  if (first === undefined) {
    return NO_SIDES;
  }
  if (parts.length > shorthand.sides.length) {
    return NO_SIDES;
  }
  const sides = new Map(shorthand.sides.map((side, index) => [`${shorthand.box}-${side}`, parts[index] ?? parts[index - 2] ?? first]));
  assert(sides.size === shorthand.sides.length, 'spacingSides: one value per side');
  return sides;
}

export function isPaddingProperty(prop: string): boolean {
  return SHORTHANDS.get(prop.trim().toLowerCase())?.box === 'padding';
}

export function setPaddingDeclaration(node: Rule | AtRule, prop: string, declared: Declared): void {
  const key = prop.trim().toLowerCase();
  assert(isPaddingProperty(key), 'setPaddingDeclaration: the property is a padding property');
  const paddingFirst = paddingDeclarations(node).length === 0;
  const last = paddingDeclarations(node).at(-1);
  if (last !== undefined && last.prop.toLowerCase() === key) {
    last.assign({ value: declared.value, important: declared.important });
    node.assign({ raws: { ...node.raws, semicolon: true } });
    assert(paddingDeclarations(node).at(-1) === last, 'setPaddingDeclaration: the edited padding stays the last');
    compactPadding(node);
    return;
  }
  for (const declaration of paddingDeclarations(node)) {
    if (declaration.prop.toLowerCase() === key) {
      declaration.remove();
    }
  }
  const added = postcss.decl({ prop: key, value: declared.value, important: declared.important });
  const firstNested = node.nodes?.find((child) => child.type === 'rule' || child.type === 'atrule');
  if (firstNested) {
    node.insertBefore(firstNested, added);
  } else {
    node.append(added);
    if (paddingFirst) {
      fillTrailingBlankLine(node);
    }
  }
  node.assign({ raws: { ...node.raws, semicolon: true } });
  assert(paddingDeclarations(node).includes(added), 'setPaddingDeclaration: the edit is written');
  compactPadding(node);
}

export function fillTrailingBlankLine(node: Rule | AtRule): void {
  const after = node.raws.after;
  if (after === undefined) {
    return;
  }
  const filled = after.replace(/^[ \t]*(\r?\n)[ \t]*\r?\n/, '$1');
  assert(filled.length <= after.length, 'fillTrailingBlankLine: whitespace is only removed');
  node.assign({ raws: { ...node.raws, after: filled } });
}

export function clearPaddingSides(node: Rule | AtRule, props: readonly string[]): boolean {
  const cleared = new Set(props.filter((prop) => SHORTHANDS.get(prop)?.sides.length === 1));
  if (cleared.size === 0) {
    return false;
  }
  let changed = false;
  for (const declaration of paddingDeclarations(node)) {
    const sides = spacingSides(declaration.prop.toLowerCase(), declaration.value);
    const kept = [...sides].filter(([prop]) => !cleared.has(prop));
    if (kept.length === sides.size) {
      continue;
    }
    if (isOpaque(declaration)) {
      continue;
    }
    for (const [prop, value] of kept) {
      node.insertBefore(declaration, declaration.clone({ prop, value }));
    }
    declaration.remove();
    changed = true;
  }
  if (changed) {
    compactPadding(node);
  }
  return changed;
}

type SideValue = Declared & { readonly opaque: boolean };

function paddingDeclarations(node: Rule | AtRule): Declaration[] {
  return (node.nodes ?? []).filter((child): child is Declaration => child.type === 'decl' && isPaddingProperty(child.prop));
}

function isOpaque(declaration: Declaration): boolean {
  const shorthand = SHORTHANDS.get(declaration.prop.toLowerCase());
  assert(shorthand !== undefined, 'isOpaque: the declaration is a padding declaration');
  if (shorthand.sides.length === 1) {
    return false;
  }
  return splitTopLevelSpaces(declaration.value).some(isSubstitution);
}

const isSubstitution = (part: string): boolean => /^(var|env)\(/i.test(part);

const isWideKeyword = (part: string): boolean => /^(inherit|initial|unset|revert|revert-layer)$/i.test(part);

function paddingSideValues(declarations: readonly Declaration[]): ReadonlyMap<string, SideValue> | undefined {
  const values = new Map<string, SideValue>();
  for (const declaration of declarations) {
    const sides = spacingSides(declaration.prop.toLowerCase(), declaration.value);
    if (sides.size === 0) {
      return undefined;
    }
    const important = declaration.important;
    const opaque = isOpaque(declaration);
    for (const [prop, value] of sides) {
      const earlier = values.get(prop);
      if (earlier?.important === true && !important) {
        continue;
      }
      values.set(prop, { value, important, opaque });
    }
  }
  return values;
}

type Compact = Declared & { readonly prop: string };

function compactForm(values: ReadonlyMap<string, SideValue>): readonly Compact[] {
  const equal = (first: Side, second: Side): boolean => {
    const one = values.get(`padding-${first}`);
    const other = values.get(`padding-${second}`);
    if (one === undefined || other === undefined) {
      return false;
    }
    if (isSubstitution(one.value)) {
      return false;
    }
    return one.value === other.value && one.important === other.important;
  };
  const written = (prop: string, side: Side): readonly Compact[] => {
    const entry = values.get(`padding-${side}`);
    return entry ? [{ prop, value: entry.value, important: entry.important }] : [];
  };
  if (SIDES.every((side) => equal('top', side))) {
    return written('padding', 'top');
  }
  const whole = shorthandOf(values);
  if (whole !== undefined) {
    return [whole];
  }
  const block = equal('top', 'bottom') ? written('padding-block', 'top') : [...written('padding-top', 'top'), ...written('padding-bottom', 'bottom')];
  const inline = equal('left', 'right') ? written('padding-inline', 'left') : [...written('padding-right', 'right'), ...written('padding-left', 'left')];
  return [...block, ...inline];
}

function shorthandOf(values: ReadonlyMap<string, SideValue>): Compact | undefined {
  const sides = SIDES.map((side) => values.get(`padding-${side}`));
  const [top, right, bottom, left] = sides;
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
    return undefined;
  }
  const important = top.important === true;
  if (sides.some((side) => side === undefined || (side.important === true) !== important || isSubstitution(side.value))) {
    return undefined;
  }
  const parts = [top.value, right.value, bottom.value, left.value];
  if (parts.some(isWideKeyword)) {
    return parts.every((part) => part === top.value) ? { prop: 'padding', value: top.value, important } : undefined;
  }
  if (right.value === left.value) {
    parts.pop();
    if (top.value === bottom.value) {
      parts.pop();
    }
  }
  assert(parts.length >= 2, 'A shorthand of unequal sides names at least two');
  return { prop: 'padding', value: parts.join(' '), important };
}

function compactPadding(node: Rule | AtRule): void {
  const declarations = paddingDeclarations(node);
  const anchor = declarations[0];
  if (anchor === undefined) {
    return;
  }
  const values = paddingSideValues(declarations);
  if (values === undefined) {
    return;
  }
  if ([...values.values()].some((entry) => entry.opaque)) {
    return;
  }
  const compact = compactForm(values);
  assert(compact.length > 0, 'compactPadding: a padding declaration sets a side');
  assert(compact.length <= SIDES.length, 'compactPadding: at most one declaration per side');
  for (const entry of compact) {
    node.insertBefore(anchor, anchor.clone(entry));
  }
  for (const declaration of declarations) {
    declaration.remove();
  }
  const rewritten = paddingSideValues(paddingDeclarations(node));
  assert(rewritten !== undefined, 'compactPadding: the compact form reads side by side');
  assert(rewritten.size === values.size, 'compactPadding: the same sides stay set');
  for (const [prop, entry] of values) {
    assert(rewritten.get(prop)?.value === entry.value, `compactPadding: ${prop} keeps its value`);
  }
}
