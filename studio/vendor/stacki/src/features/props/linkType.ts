import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { ScanPage } from '../../../shared/properties/projectScan';
import { pageDisplayLabel } from '../../lib/pageName';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';


export const LINK_TYPES = ['url', 'page', 'section', 'email', 'phone', 'asset'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface LinkTypeContext {
  readonly routes: readonly string[];
  readonly sectionIds: readonly string[];
}

export type LinkPage = Pick<ScanPage, 'name' | 'route' | 'title'>;

export interface LinkPageOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function linkPageOptions(pages: readonly LinkPage[], translate: Translator = ENGLISH_TRANSLATE): readonly LinkPageOption[] {
  assert(pages.length <= LIMITS.scanEntriesMax, 'linkPageOptions: page limit exceeded');
  return pages.map((page) => ({ value: page.route, label: pageDisplayLabel(page, translate), description: page.route }));
}

export function detectLinkType(text: string, context: LinkTypeContext): LinkType {
  assert(context.routes.length <= LIMITS.scanEntriesMax, 'detectLinkType: route limit exceeded');
  assert(context.sectionIds.length <= LIMITS.treeNodesMax, 'detectLinkType: section limit exceeded');
  if (text.length === 0) {
    return 'url';
  }
  if (text.startsWith('#')) {
    if (anchorTargetExists(text, context.sectionIds)) {
      return 'section';
    }
    return 'url';
  }
  if (text.startsWith('mailto:')) {
    return 'email';
  }
  if (text.startsWith('tel:')) {
    return 'phone';
  }
  if (context.routes.includes(text)) {
    return 'page';
  }
  if (isAssetPath(text)) {
    return 'asset';
  }
  if (context.routes.some((route) => route.includes('[') && routeMatchesTemplate(text, route))) {
    return 'page';
  }
  return 'url';
}

const ROUTE_SEGMENTS_MAX = 64;

export function routeMatchesTemplate(path: string, pattern: string): boolean {
  if (!path.startsWith('/')) {
    return false;
  }
  if (!pattern.startsWith('/')) {
    return false;
  }
  const have = path.split('/').slice(1);
  const want = pattern.split('/').slice(1);
  if (have.length > ROUTE_SEGMENTS_MAX) {
    return false;
  }
  if (want.length > ROUTE_SEGMENTS_MAX) {
    return false;
  }
  for (let index = 0; index < want.length; index += 1) {
    const segment = want[index] ?? '';
    const actual = have[index];
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) {
      return index === want.length - 1 && have.slice(index).every((part) => part.length > 0) && actual !== undefined;
    }
    if (actual === undefined || actual.length === 0) {
      return false;
    }
    if (/^\[[^\]]+\]$/.test(segment)) {
      continue;
    }
    if (segment !== actual) {
      return false;
    }
  }
  return have.length === want.length;
}

export function anchorTargetExists(text: string, sectionIds: readonly string[]): boolean {
  if (text.startsWith('#')) {
    const id = text.slice(1);
    if (id.length > 0) {
      return sectionIds.includes(id);
    }
    return false;
  }
  return false;
}

function isAssetPath(text: string): boolean {
  if (text.startsWith('/')) {
    return /\.[a-z0-9]+$/i.test(text);
  }
  return false;
}
