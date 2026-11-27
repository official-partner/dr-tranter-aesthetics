import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { DropdownOption } from '../../ui/Dropdown';
import { pageDisplayLabel } from '../../lib/pageName';
import { linkPageOptions, routeMatchesTemplate, type LinkPage } from './linkType';


export type LinkChoiceSource = 'page' | 'cms';
export type LinkChoice = DropdownOption<string> & { readonly source: LinkChoiceSource };

export const LINK_ENTRIES_PER_TEMPLATE_MAX = 2_000;
export const LINK_ENTRIES_TOTAL_MAX = 8_000;
export const LINK_TEMPLATES_MAX = 200;
export const LINK_ROWS_DRAWN_MAX = 100;
const ROUTE_CHARS_MAX = 2_048;
const TITLE_CHARS_MAX = 200;
const PROP_KEYS_MAX = 8;

export interface LinkEntry {
  readonly route: string;
  readonly title: string;
}

export type LinkTemplateState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: readonly LinkEntry[]; readonly omitted: number }
  | { readonly kind: 'unavailable' };

export type LinkTemplateResolved = Exclude<LinkTemplateState, { readonly kind: 'loading' }>;

export type LinkEntryLoader = (route: string) => Promise<LinkTemplateResolved>;

export interface LinkPathsAnswer {
  readonly entries: ReadonlyArray<{ readonly route: string; readonly label: string; readonly props?: unknown }>;
  readonly error?: string | undefined;
}

export function linkEntriesFromAnswer(pattern: string, answer: LinkPathsAnswer): LinkTemplateResolved {
  assert(pattern.includes('['), 'linkEntriesFromAnswer: the pattern is a template route');
  assert(answer.entries.length <= LIMITS.scanEntriesMax, 'linkEntriesFromAnswer: entry limit exceeded');
  const seen = new Set<string>();
  const entries: LinkEntry[] = [];
  let omitted = 0;
  for (const entry of answer.entries) {
    if (!isConcreteRoute(entry.route, pattern) || seen.has(entry.route)) {
      continue;
    }
    seen.add(entry.route);
    if (entries.length >= LINK_ENTRIES_PER_TEMPLATE_MAX) {
      omitted += 1;
      continue;
    }
    const title = entryTitle(entry.props) ?? entry.label.trim();
    entries.push({ route: entry.route, title: (title.length > 0 ? title : entry.route).slice(0, TITLE_CHARS_MAX) });
  }
  if (entries.length === 0) {
    return { kind: 'unavailable' };
  }
  assert(entries.length <= LINK_ENTRIES_PER_TEMPLATE_MAX, 'linkEntriesFromAnswer: the cap holds');
  return { kind: 'ready', entries, omitted };
}

function isConcreteRoute(route: string, pattern: string): boolean {
  if (route.length === 0) {
    return false;
  }
  if (route.length > ROUTE_CHARS_MAX) {
    return false;
  }
  if (!route.startsWith('/')) {
    return false;
  }
  if (route.includes('[')) {
    return false;
  }
  if (/[\s?#]/.test(route)) {
    return false;
  }
  return routeMatchesTemplate(route, pattern);
}

export function entryTitle(props: unknown): string | undefined {
  const own = titleIn(props);
  if (own !== undefined) {
    return own;
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return undefined;
  }
  for (const key of Object.keys(props).slice(0, PROP_KEYS_MAX)) {
    const nested = titleIn(Reflect.get(props, key));
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function titleIn(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const direct = nonEmptyText(Reflect.get(value, 'title')) ?? nonEmptyText(Reflect.get(value, 'name'));
  if (direct !== undefined) {
    return direct;
  }
  const data: unknown = Reflect.get(value, 'data');
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return nonEmptyText(Reflect.get(data, 'title')) ?? nonEmptyText(Reflect.get(data, 'name'));
  }
  return undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function linkChoices(
  pages: readonly LinkPage[],
  states: ReadonlyMap<string, LinkTemplateState>,
  current: string,
  translate: Translator = ENGLISH_TRANSLATE,
): readonly LinkChoice[] {
  assert(pages.length <= LIMITS.scanEntriesMax, 'linkChoices: page limit exceeded');
  const templates = pages.filter((page) => isTemplatePage(page));
  assert(templates.length <= pages.length, 'linkChoices: templates are a subset of pages');
  const rows: LinkChoice[] = linkPageOptions(
    pages.filter((page) => !isTemplatePage(page)),
    translate,
  ).map((option) => ({ value: option.value, label: option.label, description: option.description, keywords: option.value, source: 'page' }));
  let entryRows = 0;
  for (const page of templates) {
    const group = pageDisplayLabel(page, translate);
    const state = states.get(page.route);
    if (state?.kind === 'ready') {
      entryRows += appendEntries(rows, group, state, entryRows);
    } else if (state?.kind === 'loading') {
      appendCurrent(rows, group, page.route, current);
    } else {
      rows.push(templateRow(page, group, translate));
    }
  }
  assert(rows.length <= LIMITS.scanEntriesMax, 'linkChoices: row limit exceeded');
  return rows;
}

function appendEntries(rows: LinkChoice[], group: string, state: Extract<LinkTemplateState, { readonly kind: 'ready' }>, alreadyListed: number): number {
  const room = Math.max(0, LINK_ENTRIES_TOTAL_MAX - alreadyListed);
  const shown = state.entries.slice(0, room);
  for (const entry of shown) {
    rows.push({ value: entry.route, label: entry.title, description: entry.route, group, keywords: entry.route, source: 'cms' });
  }
  assert(shown.length <= room, 'appendEntries: the total cap holds');
  return shown.length;
}

function appendCurrent(rows: LinkChoice[], group: string, pattern: string, current: string): void {
  if (routeMatchesTemplate(current, pattern)) {
    rows.push({ value: current, label: current, description: current, group, keywords: current, source: 'cms' });
  }
}

function templateRow(page: LinkPage, group: string, translate: Translator): LinkChoice {
  return {
    value: page.route,
    label: group,
    description: page.route,
    hint: translate('props.link.templateUnresolved'),
    keywords: page.route,
    source: 'cms',
  };
}

export function isTemplatePage(page: Pick<LinkPage, 'route'>): boolean {
  return page.route.includes('[');
}

export function templatesToLoad(pages: readonly LinkPage[]): readonly string[] {
  const routes = pages.filter((page) => isTemplatePage(page)).map((page) => page.route);
  assert(routes.length <= LINK_TEMPLATES_MAX || pages.length > 0, 'templatesToLoad: routes come from the pages');
  return routes.slice(0, LINK_TEMPLATES_MAX);
}
