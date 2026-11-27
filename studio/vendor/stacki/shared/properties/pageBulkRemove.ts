import { count, list, record, text } from '../core/boundary';
import { parsePageSettingsSummary, type PageSettingsSummary } from './pageSettings';
import { renamePath } from './pageRename';

export const PAGE_BULK_REMOVE_LIMITS = {
  pagesMax: 500,
  foldersMax: 100,
} as const satisfies Record<string, number>;

const PAGE_EXTENSION = /\.(astro|mdx?)$/i;

export interface PageBulkRemoveRequest {
  readonly pages: readonly string[];
  readonly folders: readonly string[];
}

export function parsePageBulkRemoveRequest(input: unknown): PageBulkRemoveRequest {
  const value = record(input);
  const pages = distinct('pages', list(renamePath)(value['pages']), PAGE_BULK_REMOVE_LIMITS.pagesMax);
  const folders = distinct('folders', list(renamePath)(value['folders']), PAGE_BULK_REMOVE_LIMITS.foldersMax);
  for (const page of pages) {
    if (!PAGE_EXTENSION.test(page)) {
      throw new Error('Page removal: expected a page file');
    }
  }
  if (pages.length + folders.length === 0) {
    throw new Error('Page removal: nothing selected');
  }
  return { pages, folders };
}

function distinct(label: string, values: readonly string[], limit: number): readonly string[] {
  if (values.length > limit) {
    throw new Error(`Page removal: too many ${label}`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Page removal: duplicate ${label}`);
  }
  return values;
}

export interface PageBulkRemoveSummary {
  readonly pages: number;
  readonly folders: number;
  readonly errorPages: number;
  readonly impact: PageSettingsSummary;
}

export function parsePageBulkRemoveSummary(input: unknown): PageBulkRemoveSummary {
  const value = record(input);
  const pages = count(value['pages']);
  const folders = count(value['folders']);
  const errorPages = count(value['errorPages']);
  if (pages > PAGE_BULK_REMOVE_LIMITS.pagesMax) {
    throw new Error('Page removal: summary names too many pages');
  }
  if (folders > PAGE_BULK_REMOVE_LIMITS.foldersMax) {
    throw new Error('Page removal: summary names too many folders');
  }
  if (errorPages > pages) {
    throw new Error('Page removal: more error pages than pages');
  }
  const impact = parsePageSettingsSummary(value['impact']);
  if (impact.moves.length > 0) {
    throw new Error('Page removal: a deletion moves nothing');
  }
  return { pages, folders, errorPages, impact };
}

export interface PageBulkRemoveApplied {
  readonly summary: PageBulkRemoveSummary;
  readonly undo: string;
}

export function parsePageBulkRemoveApplied(input: unknown): PageBulkRemoveApplied {
  const value = record(input);
  const undo = text(value['undo']);
  if (undo.length === 0 || undo.length > 64) {
    throw new Error('Page removal: invalid undo token');
  }
  return { summary: parsePageBulkRemoveSummary(value['summary']), undo };
}
