
import postcss from 'postcss';
import type { Rule as PostcssRule, Root } from 'postcss';
import path from 'path';
import { assert } from '../../shared/core/assert';
import { runSync, type SlicedWork } from '../lib/slicedWork';
import { described, type Described, type MessageRef } from '../../shared/properties/i18n/messageRef';
import { readAstroSheet, type StyleBlockWriting, type StyleRegion } from '../documents/astroStyleBlocks';
import { CSS_VARIABLE_LIMITS, SKIPPED_DIRECTORIES, readDeclarations, toPosix, type Rule } from './cssVarRead';
import { variableFiles as fs } from './variableWorkspace';

export type VariableReach = 'page' | 'rendered' | 'scoped';

export interface VariableScope {
  readonly reach: VariableReach;
  readonly written: Exclude<StyleBlockWriting, 'stylesheet'>;
}

export interface CssSection {
  readonly start: number;
  readonly end: number;
  readonly view: string;
  readonly written: StyleBlockWriting;
}

export const isAstroFile = (file: string): boolean => /\.astro$/i.test(file);

const DECLARATION = /--[^\s:;{}()'"\\,]+\s*:/;

export function* astroSourcesSliced(projectPath: string): SlicedWork<string[]> {
  const found: string[] = [];
  function* walk(directory: string, depth: number): SlicedWork<void> {
    if (depth > CSS_VARIABLE_LIMITS.stylesheetDepthMax) {
      return;
    }
    let entries: ReturnType<typeof fs.readdirSync>;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* walk(full, depth + 1);
      } else if (isAstroFile(entry.name)) {
        found.push(full);
      }
    }
    yield;
  }
  yield* walk(path.join(projectPath, 'src'), 0);
  return [...new Set(found)].sort();
}

export function findAstroSources(projectPath: string): string[] {
  return runSync(astroSourcesSliced(projectPath));
}

function unconditionalRegions(rel: string, text: string): { readonly regions: readonly StyleRegion[]; readonly unreadable: Described | undefined } {
  const sheet = readAstroSheet(rel, text);
  return { regions: sheet.regions.filter((region) => !region.conditional), unreadable: sheet.unreadable };
}

function blankOutside(text: string, start: number, end: number): string {
  assert(start >= 0, 'blankOutside: the section starts inside the file');
  assert(end <= text.length, 'blankOutside: the section ends inside the file');
  const blank = (part: string): string => part.replace(/[^\n]/g, ' ');
  const view = blank(text.slice(0, start)) + text.slice(start, end) + blank(text.slice(end));
  assert(view.length === text.length, 'blankOutside: blanking keeps the length');
  return view;
}

export function cssSections(file: string, text: string): readonly CssSection[] {
  if (!isAstroFile(file)) {
    return [{ start: 0, end: text.length, view: text, written: 'stylesheet' }];
  }
  return unconditionalRegions(file, text).regions.map((region) => {
    const end = region.start + region.text.length;
    return { start: region.start, end, view: blankOutside(text, region.start, end), written: region.written };
  });
}

export type FoundRule =
  | { readonly ok: true; readonly rule: PostcssRule; readonly root: Root; readonly section: number }
  | { readonly ok: false; readonly error: string; readonly errorRef?: MessageRef | undefined };

const STYLE_TAG = '<style>';

interface RuleQuery {
  readonly file: string;
  readonly selector: string;
  readonly declares?: string | undefined;
  readonly section?: number | undefined;
}

function rulesIn(root: Root, selector: string): PostcssRule[] {
  const matches: PostcssRule[] = [];
  root.walkRules((candidate) => {
    if (candidate.selector === selector) {
      matches.push(candidate);
    }
  });
  return matches;
}

const declaresName = (rule: PostcssRule, name: string): boolean => (rule.nodes ?? []).some((node) => node.type === 'decl' && node.prop === name);

export function findRule(text: string, { file, selector, declares, section }: RuleQuery): FoundRule {
  const sections = cssSections(file, text);
  const hits: Array<Extract<FoundRule, { ok: true }>> = [];
  for (const [index, candidate] of sections.entries()) {
    if (section !== undefined && section !== index) {
      continue;
    }
    const root = postcss.parse(candidate.view);
    const matches = rulesIn(root, selector);
    const rule = (declares === undefined ? undefined : matches.find((match) => declaresName(match, declares))) ?? matches[0];
    if (rule !== undefined) {
      hits.push({ ok: true, rule, root, section: index });
    }
  }
  const declaring = declares === undefined ? hits : hits.filter((hit) => declaresName(hit.rule, declares));
  const candidates = declaring.length > 0 ? declaring : hits;
  const first = candidates[0];
  if (first === undefined) {
    const gone = described('variables.error.ruleGone', { selector, file });
    return { ok: false, error: gone.message, errorRef: gone.messageRef };
  }
  if (candidates.length > 1) {
    const several = described('variables.error.ruleInSeveralBlocks', { selector, tag: STYLE_TAG, file });
    return { ok: false, error: several.message, errorRef: several.messageRef };
  }
  return first;
}

export function sectionAt(file: string, text: string, offset: number): number | undefined {
  const index = cssSections(file, text).findIndex((section) => section.start <= offset && offset <= section.end);
  return index === -1 ? undefined : index;
}

export function styleWriteProblem(file: string, text: string, next: string): Described | undefined {
  if (!isAstroFile(file)) {
    return undefined;
  }
  const outside = (source: string): string | undefined => {
    const { regions } = readAstroSheet(file, source);
    let cursor = 0;
    let kept = '';
    for (const region of regions) {
      kept += `${source.slice(cursor, region.start)}\u0000`;
      cursor = region.start + region.text.length;
    }
    return kept + source.slice(cursor);
  };
  return outside(text) === outside(next) ? undefined : described('variables.error.outsideStyleBlock', { tag: STYLE_TAG });
}

export type AstroVariables =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'rules'; readonly sections: ReadonlyArray<{ readonly scope: VariableScope; readonly rules: readonly Rule[] }> };

const UNSCOPED_SELECTOR = /^(?::root|html|body|:global\(.*\))$/i;

function reachOf(rule: Rule, rel: string, written: VariableScope['written']): VariableReach {
  const page = /^src\/pages\//.test(rel);
  if (written === 'scoped') {
    const nested = rule.context.some((part) => !part.startsWith('@'));
    const unhashed = rule.selectors.every((selector) => UNSCOPED_SELECTOR.test(selector.trim()));
    if (nested || !unhashed) {
      return 'scoped';
    }
  }
  return page ? 'page' : 'rendered';
}

export function readAstroVariables(rel: string, text: string): AstroVariables {
  if (!DECLARATION.test(text)) {
    return { kind: 'none' };
  }
  const { regions, unreadable } = unconditionalRegions(rel, text);
  const sections: Array<{ readonly scope: VariableScope; readonly rules: readonly Rule[] }> = [];
  for (const region of regions) {
    if (!DECLARATION.test(region.text)) {
      continue;
    }
    assert(region.written !== 'stylesheet', 'readAstroVariables: an Astro region is a block');
    const { written } = region;
    let rules: Rule[];
    try {
      rules = readDeclarations(blankOutside(text, region.start, region.start + region.text.length));
    } catch (error: unknown) {
      return {
        kind: 'error',
        ...described('variables.error.styleBlockLine', { tag: STYLE_TAG, line: region.line, detail: error instanceof Error ? error.message : String(error) }),
      };
    }
    for (const reach of ['page', 'rendered', 'scoped'] as const) {
      const members = rules.filter((rule) => reachOf(rule, rel, written) === reach);
      if (members.length > 0) {
        sections.push({ scope: { reach, written }, rules: members });
      }
    }
  }
  if (sections.length > 0) {
    return { kind: 'rules', sections };
  }
  return unreadable === undefined ? { kind: 'none' } : { kind: 'error', message: unreadable.message, messageRef: unreadable.messageRef };
}

export function astroDeclaredNames(rel: string, text: string): readonly string[] {
  const read = readAstroVariables(rel, text);
  if (read.kind !== 'rules') {
    return [];
  }
  return read.sections.flatMap((section) => section.rules.flatMap((rule) => rule.entries.flatMap((entry) => (entry.kind === 'var' ? [entry.name] : []))));
}

export const relativeTo = (projectPath: string, absolute: string): string => toPosix(path.relative(projectPath, absolute));
