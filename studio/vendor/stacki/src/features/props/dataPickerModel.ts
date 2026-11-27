
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { pathSteps } from '../../editor/dataSample';

export interface EntryPage {
  readonly index: number;
  readonly count: number;
}

export type EntryPages = Readonly<Record<string, number>>;

interface PagedNode {
  readonly path: string;
  readonly entryCount?: number | undefined;
  readonly children: readonly { readonly path: string }[] | undefined;
}

export function entryPageOf(node: PagedNode, pages: EntryPages): EntryPage | undefined {
  const count = node.entryCount;
  if (count === undefined || node.children === undefined) {
    return undefined;
  }
  assert(Number.isSafeInteger(count), 'entryPageOf: entry count is an integer');
  if (count < 2) {
    return undefined;
  }
  const asked = pages[node.path] ?? 0;
  const index = Math.min(Math.max(asked, 0), count - 1);
  assert(index < count, 'entryPageOf: the shown entry is inside the list');
  return { index, count };
}

export function steppedEntryIndex(page: EntryPage, step: -1 | 1): number {
  assert(page.count >= 2, 'steppedEntryIndex: a single entry has nowhere to step');
  assert(page.index >= 0, 'steppedEntryIndex: the index is not negative');
  assert(page.index < page.count, 'steppedEntryIndex: the index is inside the list');
  const next = (((page.index + step) % page.count) + page.count) % page.count;
  assert(next >= 0, 'steppedEntryIndex: the step lands at or after the first entry');
  assert(next < page.count, 'steppedEntryIndex: the step lands at or before the last entry');
  return next;
}

export function entryPath(listPath: string, index: number): string {
  assert(Number.isSafeInteger(index), 'entryPath: index is an integer');
  assert(index >= 0, 'entryPath: index is not negative');
  return `${listPath}[${index}]`;
}

export function shownEntryRows<Row extends { readonly path: string; readonly missing?: boolean | undefined }>(
  listPath: string,
  children: readonly Row[],
  page: EntryPage,
): { readonly rows: readonly Row[]; readonly unread: boolean } {
  assert(children.length <= LIMITS.treeNodesMax, 'shownEntryRows: node limit exceeded');
  const chosen = entryPath(listPath, page.index);
  const entry = children.find((child) => child.path === chosen);
  const rows = children.filter((child) => child === entry || child.missing === true);
  assert(rows.length <= children.length, 'shownEntryRows: rows are drawn from the children');
  return { rows, unread: entry === undefined };
}

export function pagesOfPath(path: string | undefined): EntryPages {
  const text = path ?? '';
  assert(text.length <= LIMITS.attrCharsMax, 'pagesOfPath: binding path limit exceeded');
  const steps = pathSteps(text) ?? [];
  const pages: Record<string, number> = {};
  let listEnd = 0;
  for (const step of steps) {
    if (typeof step.key === 'number' && listEnd > 0) {
      pages[text.slice(0, listEnd)] = step.key;
    }
    listEnd = step.end;
  }
  assert(Object.keys(pages).length <= steps.length, 'pagesOfPath: at most one page per step');
  return pages;
}


export interface DataOrigin {
  readonly file: string | undefined;
  readonly page: string | undefined;
}

export function sectionHeading(section: string, origin: DataOrigin | undefined, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const dataFile = dataFileOfSection(section);
  if (dataFile !== undefined) {
    return dataFile.startsWith('src/') ? dataFile.slice('src/'.length) : dataFile;
  }
  const file = fileNameOf(origin?.file);
  const component = componentNameOf(origin?.file);
  switch (section) {
    case 'loop':
      return translate('props.dataPicker.section.loopItem');
    case 'props':
      return component ?? (file === undefined ? translate('props.dataPicker.section.props') : translate('props.dataPicker.section.fileProps', { file }));
    case 'frontmatter':
      return file === undefined ? translate('props.dataPicker.section.frontmatter') : translate('props.dataPicker.section.fileFrontmatter', { file });
    case 'collections':
      return translate('props.dataPicker.section.collections');
    case 'loop-sanity':
      return 'Sanity';
    case PROJECT_DATA_SECTION:
      return translate('props.dataPicker.section.projectData');
    case 'loop-page':
      return translate('props.dataPicker.section.onPage');
    case 'loop-component':
      return component ?? translate('props.dataPicker.section.onPage');
    default:
      return undefined;
  }
}

export const PROJECT_DATA_SECTION = 'loop-project';

const DATA_FILE_SECTION = 'data-file:';

export function dataFileSection(file: string): string {
  assert(file.length > 0, 'dataFileSection: the file is named');
  return DATA_FILE_SECTION + file;
}

export function dataFileOfSection(section: string | undefined): string | undefined {
  if (section === undefined || !section.startsWith(DATA_FILE_SECTION)) {
    return undefined;
  }
  const file = section.slice(DATA_FILE_SECTION.length);
  return file === '' ? undefined : file;
}

export type SectionHead = { readonly kind: 'group'; readonly heading: string; readonly section: string } | { readonly kind: 'part'; readonly heading: string };

export function sectionHeads(
  section: string,
  previous: string | undefined,
  origin: DataOrigin | undefined,
  translate: Translator = ENGLISH_TRANSLATE,
): readonly SectionHead[] {
  const component = componentNameOf(origin?.file);
  if (section === 'frontmatter' && component !== undefined) {
    const part: SectionHead = { kind: 'part', heading: translate('props.dataPicker.section.frontmatter') };
    return previous === 'props' ? [part] : [{ kind: 'group', heading: component, section: 'props' }, part];
  }
  const heading = sectionHeading(section, origin, translate);
  return heading === undefined ? [] : [{ kind: 'group', heading, section }];
}

export function isComponentSection(section: string | undefined, origin: DataOrigin | undefined): boolean {
  if (section !== 'props' && section !== 'loop-component') {
    return false;
  }
  return componentNameOf(origin?.file) !== undefined;
}

export function settingsKeyOf(
  node: { readonly path: string; readonly section?: string | undefined },
  keyOf: ((path: string) => string | undefined) | undefined,
): string | undefined {
  if (keyOf === undefined) {
    return undefined;
  }
  if (node.section !== 'props' && node.section !== 'loop-component') {
    return undefined;
  }
  return keyOf(node.path);
}

export function componentNameOf(file: string | undefined): string | undefined {
  const name = fileNameOf(file);
  if (file === undefined || name === undefined || /(^|[\\/])src[\\/]pages[\\/]/.test(file)) {
    return undefined;
  }
  return name.replace(/\.astro$/, '');
}

function fileNameOf(path: string | undefined): string | undefined {
  if (path === undefined || path === '') {
    return undefined;
  }
  const name = path.split(/[\\/]/).pop() ?? '';
  return name === '' ? undefined : name;
}


export interface MissingAnchor {
  readonly key: string;
  readonly preview: string;
  readonly query?: { readonly collection: string; readonly name: string } | undefined;
  readonly nav?: EntryPage | undefined;
  readonly children: readonly { readonly key: string }[] | undefined;
}

export function missingLabel(anchors: readonly MissingAnchor[], translate: Translator = ENGLISH_TRANSLATE): string {
  assert(anchors.length <= LIMITS.treeDepthMax, 'missingLabel: anchors stay inside the depth limit');
  const nearest = anchors[anchors.length - 1];
  if (nearest === undefined) {
    return translate('props.dataPicker.missing.notInScope');
  }
  if (anchors.some(isEntryLike)) {
    return translate('props.dataPicker.missing.notInEntry');
  }
  if (nearest.children === undefined || nearest.children.length === 0) {
    return translate('props.dataPicker.missing.fieldsUnknown');
  }
  assert(nearest.children.length > 0, 'missingLabel: a value with listed fields has some');
  return translate('props.dataPicker.missing.noSuchField');
}

function isEntryLike(node: MissingAnchor): boolean {
  if (node.query !== undefined || node.nav !== undefined) {
    return true;
  }
  if (/\bentr(?:y|ies)$/.test(node.preview)) {
    return true;
  }
  const keys = new Set((node.children ?? []).map((child) => child.key));
  return keys.has('collection') && keys.has('data');
}
