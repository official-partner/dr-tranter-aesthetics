
import { assert } from '../../../../shared/core/assert';
import { isGlobalRegion } from './projectResources';
import { selectorKey, selectorsMatch, type MatchedSelector } from './resolved';
import { canonicalCompound } from './selectorParse';
import { selectorSpecificity } from './selectors';
import type { StyleRegion } from './styleTypes';
import type { EmbedSource } from './webflow';

export const INSTANCE_CLASSES_MAX = 32;

const ASTRO_SCOPE_CLASS = /^astro-[a-z0-9]+$/i;

export type InstanceStyleDocument = {
  readonly source: Pick<EmbedSource, 'key' | 'origin'>;
  readonly regions: readonly StyleRegion[];
};

export function instanceClassesOf(element: { readonly authored: readonly string[]; readonly rendered: readonly string[] }): string[] {
  const authored = new Set(element.authored);
  const found: string[] = [];
  for (const name of element.rendered) {
    if (found.length < INSTANCE_CLASSES_MAX) {
      if (name.length > 0 && !authored.has(name) && !found.includes(name) && !ASTRO_SCOPE_CLASS.test(name)) {
        found.push(name);
      }
    } else {
      break;
    }
  }
  assert(found.length <= INSTANCE_CLASSES_MAX, 'instanceClassesOf: bounded by INSTANCE_CLASSES_MAX');
  assert(
    found.every((name) => !authored.has(name)),
    'instanceClassesOf: a class the component names is never the instance’s',
  );
  return found;
}

export function namesInstanceClass(selector: string, instanceClasses: readonly string[]): boolean {
  if (selector.trim().length === 0) {
    return false;
  }
  if (instanceClasses.length === 0) {
    return false;
  }
  const tokens = canonicalCompound(selector).tokens;
  return instanceClasses.some((name) => tokens.includes(`class:${name}`));
}

export function withInstanceChips(list: readonly MatchedSelector[], instanceClasses: readonly string[]): MatchedSelector[] {
  assert(instanceClasses.length <= INSTANCE_CLASSES_MAX, 'withInstanceChips: instance classes are capped');
  if (instanceClasses.length === 0) {
    return [...list];
  }
  const marked = list.map((chip) => (namesInstanceClass(chip.text, instanceClasses) ? { ...chip, fromInstance: true } : chip));
  const added: MatchedSelector[] = [];
  for (const name of instanceClasses) {
    const text = `.${name}`;
    if (!marked.some((chip) => selectorsMatch(chip.text, text))) {
      added.push({
        text,
        specificity: selectorSpecificity(text),
        state: '',
        simple: true,
        key: selectorKey(text),
        pending: true,
        inContext: true,
        fromComponent: false,
        fromInstance: true,
      });
    }
  }
  const out = [...marked, ...added];
  assert(out.length === list.length + added.length, 'withInstanceChips: every chip is kept');
  assert(added.length <= instanceClasses.length, 'withInstanceChips: at most one chip per instance class');
  return out;
}

export function writableRegion<Region extends StyleRegion>(regions: readonly Region[]): Region | undefined {
  const global = regions.find((region) => region.root !== undefined && isGlobalRegion(region));
  if (global !== undefined) {
    assert(isGlobalRegion(global), 'writableRegion: the chosen block is global');
    return global;
  }
  return regions[0];
}

export function instanceStyleSource(documents: readonly InstanceStyleDocument[], contextPagePath: string | undefined): string | undefined {
  if (contextPagePath !== undefined) {
    const page = documents.find((document) => document.source.origin.kind === 'astro' && document.source.origin.path === contextPagePath);
    if (page !== undefined) {
      const region = writableRegion(page.regions);
      if (region !== undefined && region.root !== undefined && isGlobalRegion(region)) {
        return page.source.key;
      }
    }
  }
  const sheet = documents.find((document) => document.source.origin.kind === 'file');
  return sheet?.source.key;
}

export function instanceSourceKey(input: {
  readonly activeSelector: string;
  readonly instanceClasses: readonly string[];
  readonly documents: readonly InstanceStyleDocument[];
  readonly contextPagePath: string | undefined;
  readonly homeEmbedKey: string | undefined;
}): string | undefined {
  if (!namesInstanceClass(input.activeSelector, input.instanceClasses)) {
    return undefined;
  }
  const key = input.homeEmbedKey ?? instanceStyleSource(input.documents, input.contextPagePath);
  assert(key === undefined || key.length > 0, 'instanceSourceKey: a source key is never empty');
  return key;
}
