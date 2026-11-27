import { createHash } from 'node:crypto';
import { assert } from '../../shared/core/assert';
import { described, englishText, messageRef, type Described, type MessageKey, type MessageRef } from '../../shared/properties/i18n/messageRef';
import { toDigest } from '../../shared/core/brand';
import { keepMatcher, stylesheetLockMatcher, type StyleKeepList } from '../../shared/properties/styleKeepList';
import {
  SELECTOR_USAGE_LIMITS,
  selectorEntryId,
  type SelectorEntry,
  type SelectorFileDigest,
  type SelectorNote,
  type SelectorReport,
  type SelectorVerdict,
} from '../../shared/properties/selectorUsage';
import {
  asksAbout,
  assembledPiece,
  emptyHits,
  interestIsEmpty,
  mentionInterest,
  mergeHits,
  remainingInterest,
  scanMentions,
  type MentionHits,
  type MentionInterest,
} from './selectorMentions';
import { linkedSites } from './selectorFlow';
import { cssFileRegion, readRegionRules, type AstroSheet, type RuleSelector, type StyleRegion } from './selectorSheets';

export interface ProjectText {
  readonly rel: string;
  readonly text: string;
}

export type PackageScan =
  | { readonly kind: 'complete'; readonly hits: MentionHits }
  | { readonly kind: 'pending'; readonly hits: MentionHits; readonly unanswered: MentionInterest }
  | { readonly kind: 'incomplete'; readonly reason: string; readonly reasonRef?: MessageRef | undefined };

export interface UsageInput {
  readonly stylesheets: readonly ProjectText[];
  readonly astro: readonly AstroSheet[];
  readonly others: readonly ProjectText[];
  readonly keepList: StyleKeepList;
  readonly unreadable: readonly SelectorNote[];
}

export interface UsageAnalysis {
  readonly report: SelectorReport;
  readonly selectors: ReadonlyMap<string, RuleSelector>;
  readonly sources: ReadonlyMap<string, string>;
}

export async function analyzeSelectorUsage(input: UsageInput, scanPackages: (interest: MentionInterest) => Promise<PackageScan>): Promise<UsageAnalysis> {
  const notes: SelectorNote[] = [...input.unreadable];
  const sources = new Map<string, string>();
  const regions: StyleRegion[] = [];
  for (const sheet of input.stylesheets) {
    sources.set(sheet.rel, sheet.text);
    regions.push(cssFileRegion(sheet.rel, sheet.text));
  }
  const astroByRel = new Map<string, AstroSheet>();
  for (const sheet of input.astro) {
    astroByRel.set(sheet.rel, sheet);
    if (sheet.unreadable !== undefined) {
      notes.push({ rel: sheet.rel, message: `Its styles were not checked: ${sheet.unreadable.message}`, messageRef: sheet.unreadable.messageRef });
    }
    regions.push(...sheet.regions);
  }
  const rules = readRules(regions, notes);
  const interest = mentionInterest(new Set(rules.flatMap((rule) => rule.names)));
  const scans = scanProject(input, interest);
  const packages = interestIsEmpty(remainingInterest(interest, scans.foreign))
    ? ({ kind: 'complete', hits: emptyHits() } as const)
    : await scanPackages(remainingInterest(interest, scans.foreign));
  const taint = taintOf(input, packages);
  const keep = keepMatcher(input.keepList);
  const locked = stylesheetLockMatcher(input.keepList);
  const entries: SelectorEntry[] = [];
  const selectors = new Map<string, RuleSelector>();
  const hitsByScope = new Map<string, MentionHits>();
  for (const rule of rules) {
    const sheet = astroByRel.get(rule.region.rel);
    const scopeKey = rule.region.scope === 'global' || sheet?.dynamicClass === true ? '' : rule.region.rel;
    const hits = hitsByScope.get(scopeKey) ?? hitsFor(rule.region, sheet, scans, packages);
    hitsByScope.set(scopeKey, hits);
    const unanswered = packages.kind === 'pending' ? packages.unanswered : undefined;
    const verdict = lockedVerdict(verdictOf(rule, hits, taintFor(rule.region, sheet, taint), unanswered, keep), {
      locked: locked(rule.region.rel),
      names: rule.names,
    });
    const id = selectorEntryId({ rel: rule.region.rel, block: rule.region.block, offset: rule.ruleStart, index: rule.index });
    assert(!selectors.has(id), 'analyzeSelectorUsage: entry ids are unique');
    selectors.set(id, rule);
    entries.push({
      id,
      rel: rule.region.rel,
      line: rule.line,
      selector: rule.text.slice(0, SELECTOR_USAGE_LIMITS.selectorCharsMax),
      scope: rule.region.scope,
      verdict,
    });
  }
  for (const sheet of input.astro) {
    if (sheet.regions.length > 0) {
      sources.set(sheet.rel, sheet.source);
    }
  }
  const files: SelectorFileDigest[] = [...sources].map(([rel, text]) => ({ rel, digest: digestOf(text) }));
  assert(entries.length === selectors.size, 'analyzeSelectorUsage: one entry per selector');
  return { report: { entries, notes: notes.slice(0, SELECTOR_USAGE_LIMITS.notesMax), files }, selectors, sources };
}

export function digestOf(text: string) {
  return toDigest(createHash('sha256').update(text).digest('hex'));
}

interface ProjectScans {
  readonly all: MentionHits;
  readonly foreign: MentionHits;
  readonly own: ReadonlyMap<string, MentionHits>;
}

function scanProject(input: UsageInput, interest: MentionInterest): ProjectScans {
  const all = emptyHits();
  const foreign = emptyHits();
  const own = new Map<string, MentionHits>();
  for (const other of input.others) {
    scanMentions(other.text, interest, foreign);
  }
  mergeHits(all, foreign);
  for (const sheet of input.astro) {
    const hits = emptyHits();
    scanMentions(sheet.ownText, interest, hits);
    own.set(sheet.rel, hits);
    mergeHits(all, hits);
    scanMentions(sheet.foreignText, interest, foreign);
  }
  assert(foreign.words.size <= all.words.size, 'scanProject: foreign mentions are a subset of all mentions');
  return { all, foreign, own };
}

function hitsFor(region: StyleRegion, sheet: AstroSheet | undefined, scans: ProjectScans, packages: PackageScan): MentionHits {
  const hits = emptyHits();
  if (region.scope === 'global') {
    mergeHits(hits, scans.all);
  } else {
    assert(sheet !== undefined, 'hitsFor: a scoped region belongs to an .astro file');
    if (sheet.dynamicClass) {
      mergeHits(hits, scans.all);
    } else {
      mergeHits(hits, scans.foreign);
      const own = scans.own.get(sheet.rel);
      assert(own !== undefined, 'hitsFor: every .astro file was scanned');
      mergeHits(hits, own);
    }
  }
  if (packages.kind !== 'incomplete') {
    mergeHits(hits, packages.hits);
  }
  return hits;
}

function lockedVerdict(verdict: SelectorVerdict, sheet: { readonly locked: boolean; readonly names: readonly string[] }): SelectorVerdict {
  if (!sheet.locked) {
    return verdict;
  }
  switch (verdict.kind) {
    case 'unused':
    case 'unknown':
    case 'checking':
      assert(verdict.names.length > 0, 'lockedVerdict: a protected selector names what is missing');
      return { kind: 'kept', names: verdict.names };
    case 'used':
      assert(sheet.names.length > 0, 'lockedVerdict: a used selector requires names');
      return { kind: 'kept', names: sheet.names, inUse: true };
    case 'kept':
    case 'untracked':
      return verdict;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function verdictOf(
  rule: RuleSelector,
  hits: MentionHits,
  taint: Weakness | undefined,
  unanswered: MentionInterest | undefined,
  keep: (name: string) => boolean,
): SelectorVerdict {
  if (rule.names.length === 0) {
    return { kind: 'untracked' };
  }
  const absent = rule.names.filter((name) => !hits.words.has(name));
  if (absent.length === 0) {
    return { kind: 'used' };
  }
  if (taint !== undefined) {
    return { kind: 'unknown', names: absent, reason: taint.reason, reasonRef: taint.reasonRef };
  }
  const waiting = unanswered === undefined ? [] : absent.filter((name) => asksAbout(unanswered, name));
  const dead = absent
    .filter((name) => !waiting.includes(name))
    .filter((name) => assembledPiece(name, hits) === undefined)
    .filter((name) => !keep(name));
  if (dead.length > 0) {
    if (rule.fixed !== undefined) {
      return { kind: 'unknown', names: dead, reason: rule.fixed.message, reasonRef: rule.fixed.messageRef };
    }
    return { kind: 'unused', names: dead };
  }
  if (waiting.length > 0) {
    return { kind: 'checking', names: waiting };
  }
  if (absent.some((name) => assembledPiece(name, hits) !== undefined)) {
    return { kind: 'used' };
  }
  assert(absent.every(keep), 'verdictOf: an absent name that is not dead or assembled is kept');
  return { kind: 'kept', names: absent };
}

interface Weakness {
  readonly reason: string;
  readonly reasonRef?: MessageRef | undefined;
}

interface ProjectTaint {
  readonly everything: Weakness | undefined;
  readonly injected: Weakness | undefined;
  readonly remote: Weakness | undefined;
}

function taintFor(region: StyleRegion, sheet: AstroSheet | undefined, taint: ProjectTaint): Weakness | undefined {
  if (taint.everything !== undefined) {
    return taint.everything;
  }
  if (region.scope === 'global') {
    return taint.injected ?? taint.remote;
  }
  if (sheet?.dynamicClass === true) {
    return taint.remote;
  }
  return undefined;
}

const SET_HTML = /\bset:html\b/;
const REMOTE_CHANNEL = /\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bcreateClient\s*\(/;
const FETCH = /\bfetch\s*\(\s*/g;

function loadsRemoteData(text: string): boolean {
  if (REMOTE_CHANNEL.test(text)) {
    return true;
  }
  FETCH.lastIndex = 0;
  for (let match = FETCH.exec(text); match !== null; match = FETCH.exec(text)) {
    const argument = text.slice(match.index + match[0].length, match.index + match[0].length + 4);
    if (!/^['"`](?:\/(?!\/)|\.\.?\/)/.test(argument)) {
      return true;
    }
  }
  return false;
}

const RUNNABLE = /\.(?:astro|[cm]?[jt]sx?|vue|svelte|mdx)$/i;

const SITE_PREFIXES = ['src/', 'public/', 'styles/'];

function runnable(text: ProjectText): boolean {
  if (!text.rel.includes('/')) {
  } else if (!SITE_PREFIXES.some((prefix) => text.rel.startsWith(prefix))) {
    return false;
  }
  if (/\.d\.[cm]?ts$/i.test(text.rel)) {
    return false;
  }
  if (/\.html?$/i.test(text.rel)) {
    return text.rel.startsWith('public/');
  }
  return RUNNABLE.test(text.rel);
}

function taintOf(input: UsageInput, packages: PackageScan): ProjectTaint {
  const texts: ProjectText[] = [...input.others.filter(runnable), ...input.astro.map((sheet) => ({ rel: sheet.rel, text: sheet.ownText }))];
  const weaknesses: Weakness[] = [];
  if (input.unreadable.length > 0) {
    const first = input.unreadable[0];
    assert(first !== undefined, 'taintOf: the list is not empty');
    const unreadable = described('selectors.reason.unreadable', { file: first.rel });
    weaknesses.push({ reason: unreadable.message, reasonRef: unreadable.messageRef });
  }
  if (packages.kind === 'incomplete') {
    weaknesses.push({ reason: packages.reason, reasonRef: packages.reasonRef });
  }
  const flowTexts = flowParts(input);
  const remotes = flowTexts.filter((text) => loadsRemoteData(text.text)).map((text) => text.rel);
  const loader = firstRemoteLoader(texts);
  const flowTo = (sites: readonly string[]): { readonly from: string; readonly to: string } | undefined => {
    const first = sites[0];
    if (loader !== undefined && first !== undefined) {
      return { from: loader, to: first };
    }
    return linkedSites(flowTexts, remotes, sites);
  };
  const injectFlow = flowTo(input.astro.filter((sheet) => SET_HTML.test(serverText(sheet.ownText))).map((sheet) => sheet.rel));
  const computedFlow = flowTo(input.astro.filter((sheet) => sheet.dynamicClass).map((sheet) => sheet.rel));
  return {
    everything: combined(weaknesses),
    injected: injectFlow === undefined ? undefined : weakness(described('selectors.reason.injectedHtml', { to: injectFlow.to, from: injectFlow.from })),
    remote: computedFlow === undefined ? undefined : weakness(described('selectors.reason.computedClasses', { to: computedFlow.to, from: computedFlow.from })),
  };
}

const CONTENT_CONFIG = /(?:^|\/)content\.config\.[cm]?[jt]s$|^src\/content\/config\.[cm]?[jt]s$/;
const LOCAL_LOADERS = new Set(['astro/loaders', 'astro/zod', 'zod']);

function firstRemoteLoader(texts: readonly ProjectText[]): string | undefined {
  for (const text of texts) {
    if (!CONTENT_CONFIG.test(text.rel)) {
      continue;
    }
    for (const match of text.text.matchAll(/^\s*import\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gm)) {
      const specifier = match[1] ?? match[2] ?? '';
      const bare = !specifier.startsWith('.') && !specifier.startsWith('/');
      if (bare && !specifier.startsWith('astro:') && !LOCAL_LOADERS.has(specifier)) {
        return text.rel;
      }
    }
  }
  return undefined;
}

function weakness(reason: Described): Weakness {
  return { reason: reason.message, reasonRef: reason.messageRef };
}

const WITH_UNREADABLE_FILE: Readonly<Record<string, MessageKey>> = {
  'selectors.reason.packagesMissing': 'selectors.reason.unreadableAndPackagesMissing',
  'selectors.reason.packageFile': 'selectors.reason.unreadableAndPackageFile',
  'selectors.reason.packagesUnreadable': 'selectors.reason.unreadableAndPackagesUnreadable',
  'selectors.reason.packagesDeep': 'selectors.reason.unreadableAndPackagesDeep',
  'selectors.reason.packagesMany': 'selectors.reason.unreadableAndPackagesMany',
};

function combined(weaknesses: readonly Weakness[]): Weakness | undefined {
  const first = weaknesses[0];
  if (first === undefined) {
    return undefined;
  }
  const second = weaknesses[1];
  if (second === undefined) {
    return first;
  }
  assert(weaknesses.length === 2, 'combined: an unreadable file and the package search are the only weaknesses');
  const joined = second.reasonRef === undefined ? undefined : WITH_UNREADABLE_FILE[second.reasonRef.key];
  if (first.reasonRef === undefined || joined === undefined) {
    return { reason: weaknesses.map((item) => item.reason).join('; and ') };
  }
  const reasonRef = messageRef(joined, { ...first.reasonRef.params, ...second.reasonRef?.params });
  return { reason: englishText(reasonRef), reasonRef };
}

const SCRIPT_BLOCK = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;

function serverText(text: string): string {
  return text.replace(SCRIPT_BLOCK, (_match, open: string, body: string, close: string) => open + body.replace(/[^\n]/g, ' ') + close);
}

function flowParts(input: UsageInput): readonly ProjectText[] {
  return [...input.others.filter(runnable), ...input.astro.map((sheet) => ({ rel: sheet.rel, text: serverText(sheet.ownText) }))];
}

function readRules(regions: readonly StyleRegion[], notes: SelectorNote[]): RuleSelector[] {
  const rules: RuleSelector[] = [];
  for (const region of regions) {
    const read = readRegionRules(region);
    if (read.kind === 'unreadable') {
      notes.push({ rel: region.rel, message: `Its styles were not checked: ${read.reason.message}`, messageRef: read.reason.messageRef });
      continue;
    }
    if (rules.length + read.selectors.length > SELECTOR_USAGE_LIMITS.entriesMax) {
      const tooMany = described('selectors.problem.tooManySelectors');
      notes.push({ rel: region.rel, message: `Its styles were not checked: ${tooMany.message}`, messageRef: tooMany.messageRef });
      continue;
    }
    rules.push(...read.selectors);
  }
  return rules;
}
