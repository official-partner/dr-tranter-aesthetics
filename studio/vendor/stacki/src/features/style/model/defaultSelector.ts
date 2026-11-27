
import { assert } from '../../../../shared/core/assert';

export function isUtilityClassName(name: string): boolean {
  return name.startsWith('u-');
}

function isModifierClassName(name: string): boolean {
  return name.includes('--') || name.includes('__');
}

const PLAIN_CLASS = /^\.([\w-]+)$/;
const WHERE_CLASS = /^:where\(\.([\w-]+)\)$/;

interface DefaultInput {
  readonly styled: readonly string[];
  readonly classes: readonly string[];
  readonly tag: string | undefined;
}

export function defaultSelectorPick(input: DefaultInput): string | undefined {
  const { styled, classes, tag } = input;
  assert(styled.length >= 0, 'defaultSelectorPick: a list of selectors');
  const regular = classes.filter((name) => !isUtilityClassName(name));
  for (const name of regular) {
    const found = styled.find((text) => PLAIN_CLASS.exec(text)?.[1] === name);
    if (found !== undefined) {
      return found;
    }
  }
  const ranked = regular
    .map((name, index) => ({ name, index, modifier: isModifierClassName(name) }))
    .sort((left, right) => Number(left.modifier) - Number(right.modifier) || left.index - right.index);
  for (const entry of ranked) {
    const found = styled.find((text) => WHERE_CLASS.exec(text)?.[1] === entry.name);
    if (found !== undefined) {
      return found;
    }
  }
  if (tag !== undefined) {
    return styled.find((text) => text === tag);
  }
  return undefined;
}
