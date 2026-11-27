
import type { ClassToken } from '../components/ClassPicker';
import type { ElementSnapshot } from './styleTypes';
import { webflowClassToCss } from './webflow';
import { isInternalAttribute } from '../../../../shared/core/internalAttributes';

export function snapshotTokens(snapshot: ElementSnapshot | undefined): ClassToken[] {
  if (!snapshot) {
    return [];
  }
  const tokens: ClassToken[] = [];

  const tag = snapshot.tag;
  if (tag) {
    tokens.push({ name: `tag:${tag}`, label: tag, kind: 'tag' });
  }

  const seen = new Set<string>();
  snapshot.classes.forEach((cls) => {
    const compiled = webflowClassToCss(cls);
    if (!compiled || seen.has(compiled)) {
      return;
    }
    seen.add(compiled);
    tokens.push({ name: `class:${compiled}`, label: compiled, kind: 'class' });
  });

  Object.keys(snapshot.attributes)
    .filter((key) => key.startsWith('data-'))
    .filter((key) => !isAstroGeneratedAttribute(key))
    .filter((key) => !isInternalAttribute(key))
    .sort()
    .forEach((key) => tokens.push({ name: `attr:${key}`, label: key, kind: 'attribute' }));

  return tokens;
}

const ASTRO_GENERATED_ATTRIBUTE = /^data-astro-(?:cid-|source-|transition-scope$)/;

export function isAstroGeneratedAttribute(name: string): boolean {
  return ASTRO_GENERATED_ATTRIBUTE.test(name);
}

export function selectorToClassTokens(selectorText: string, tokens: ClassToken[]): string[] | undefined {
  const subject =
    selectorText
      .split(/\s+|[>+~]/)
      .filter(Boolean)
      .pop() ?? '';
  const wanted = new Set([...subject.matchAll(/\.([\w-]+)/g)].map((match) => (match[1] ?? '').toLowerCase()));
  if (!wanted.size) {
    return undefined;
  }
  const picked: string[] = [];
  const matched = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'class') {
      continue;
    }
    const compiled = webflowClassToCss(token.label ?? token.name.slice('class:'.length));
    if (wanted.has(compiled)) {
      picked.push(token.name);
      matched.add(compiled);
    }
  }
  return matched.size === wanted.size && picked.length ? picked : undefined;
}

export function defaultSelectorTokens(tokens: ClassToken[]): string[] {
  const classes = tokens.filter((token) => token.kind === 'class');
  if (classes.length) {
    return [classes[0]?.name ?? ''];
  }
  const attrs = tokens.filter((token) => token.kind === 'attribute');
  if (attrs.length) {
    return [attrs[attrs.length - 1]?.name ?? ''];
  }
  return tokens.length ? [tokens[0]?.name ?? ''] : [];
}

export function tokensToSelector(selectedNames: string[], tokens: ClassToken[]): string {
  let selector = '';
  for (const token of tokens) {
    if (!selectedNames.includes(token.name)) {
      continue;
    }
    const label = token.label ?? token.name;
    if (token.kind === 'tag') {
      selector += label;
    } else if (token.kind === 'attribute') {
      selector += `[${label}]`;
    } else {
      selector += `.${label}`;
    }
  }
  return selector;
}
