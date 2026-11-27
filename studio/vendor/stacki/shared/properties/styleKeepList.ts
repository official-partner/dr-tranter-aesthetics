import { assert } from '../core/assert';
import { list, record, text } from '../core/boundary';
import { DEFAULT_NEW_STYLE_TAG, newStyleTagDocument, parseNewStyleTag, sameNewStyleTag, type NewStyleTagSettings } from './newStyleTag';
import { locationsOfLegacy, newStyleLocationsDocument, parseNewStyleLocations, sameNewStyleLocations, type NewStyleLocations } from './newStyleLocations';

export const STYLE_KEEP_LIMITS = {
  patternsMax: 1_000,
  patternCharsMax: 128,
  lockedStylesheetsMax: 500,
  lockedPathCharsMax: 512,
  lockedPathSegmentsMax: 32,
} as const satisfies Record<string, number>;

export interface StyleKeepList {
  readonly version: 1;
  readonly keep: readonly string[];
  readonly lockedStylesheets: readonly string[];
  readonly newStyleTag?: NewStyleTagSettings;
  readonly newStyleLocations?: NewStyleLocations;
}

export function effectiveNewStyleLocations(keepList: StyleKeepList): NewStyleLocations {
  return keepList.newStyleLocations ?? locationsOfLegacy(keepList.newStyleTag ?? DEFAULT_NEW_STYLE_TAG);
}

export const EMPTY_KEEP_LIST: StyleKeepList = { version: 1, keep: [], lockedStylesheets: [] };

const PATTERN = /^[^\s"'`,{}<>]+$/;

export function parseStyleKeepList(input: unknown): StyleKeepList {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Unsupported styles settings version');
  }
  const keep = value['keep'] === undefined ? [] : list(keepPattern)(value['keep']);
  if (keep.length > STYLE_KEEP_LIMITS.patternsMax) {
    throw new Error(`Keep list exceeds ${STYLE_KEEP_LIMITS.patternsMax} patterns`);
  }
  const lockedStylesheets = value['lockedStylesheets'] === undefined ? [] : list(lockedPath)(value['lockedStylesheets']);
  if (lockedStylesheets.length > STYLE_KEEP_LIMITS.lockedStylesheetsMax) {
    throw new Error(`Locked stylesheets exceed ${STYLE_KEEP_LIMITS.lockedStylesheetsMax} paths`);
  }
  const newStyleTag = value['newStyleTag'] === undefined ? undefined : parseNewStyleTag(value['newStyleTag']);
  const newStyleLocations = value['newStyleLocations'] === undefined ? undefined : parseNewStyleLocations(value['newStyleLocations']);
  return {
    version: 1,
    keep,
    lockedStylesheets,
    ...(newStyleTag === undefined ? {} : { newStyleTag }),
    ...(newStyleLocations === undefined ? {} : { newStyleLocations }),
  };
}

export function serializeStyleKeepList(keepList: StyleKeepList): string {
  const keep = [...new Set(keepList.keep)].sort();
  const lockedStylesheets = [...new Set(keepList.lockedStylesheets)].sort();
  const base = lockedStylesheets.length === 0 ? { version: 1, keep } : { version: 1, keep, lockedStylesheets };
  const withTag = keepList.newStyleTag === undefined ? base : { ...base, newStyleTag: newStyleTagDocument(keepList.newStyleTag) };
  const shape =
    keepList.newStyleLocations === undefined
      ? withTag
      : {
          ...base,
          newStyleTag: newStyleTagDocument(keepList.newStyleLocations.page.tag),
          newStyleLocations: newStyleLocationsDocument(keepList.newStyleLocations),
        };
  const source = JSON.stringify(shape, undefined, 2) + '\n';
  const written: unknown = JSON.parse(source);
  const reread = parseStyleKeepList(written);
  assert(reread.keep.length === keep.length, 'serializeStyleKeepList: keep patterns round-trip');
  assert(reread.lockedStylesheets.length === lockedStylesheets.length, 'serializeStyleKeepList: locked stylesheets round-trip');
  const writtenTag = keepList.newStyleLocations === undefined ? keepList.newStyleTag : keepList.newStyleLocations.page.tag;
  assert((reread.newStyleTag === undefined) === (writtenTag === undefined), 'serializeStyleKeepList: the new style tag section round-trips');
  assert(
    reread.newStyleTag === undefined || writtenTag === undefined || sameNewStyleTag(reread.newStyleTag, writtenTag),
    'serializeStyleKeepList: the new style tag attributes and template round-trip',
  );
  assert(
    (reread.newStyleLocations === undefined) === (keepList.newStyleLocations === undefined),
    'serializeStyleKeepList: the new style locations section round-trips',
  );
  assert(
    reread.newStyleLocations === undefined ||
      keepList.newStyleLocations === undefined ||
      sameNewStyleLocations(reread.newStyleLocations, keepList.newStyleLocations),
    'serializeStyleKeepList: the new style locations read back the same',
  );
  return source;
}

export function isLockedFolder(lockedPath: string): boolean {
  return lockedPath.endsWith('/');
}

export function stylesheetLock(keepList: StyleKeepList, rel: string): string | undefined {
  assert(rel !== '', 'stylesheetLock: the stylesheet is named');
  assert(!rel.endsWith('/'), 'stylesheetLock: a stylesheet is a file, not a folder');
  return pathLock(keepList, rel);
}

export function folderLock(keepList: StyleKeepList, folder: string): string | undefined {
  assert(isLockedFolder(folder), 'folderLock: a folder path ends in /');
  return pathLock(keepList, folder);
}

export function stylesheetLockMatcher(keepList: StyleKeepList): (rel: string) => boolean {
  if (keepList.lockedStylesheets.length === 0) {
    return () => false;
  }
  const files = new Set(keepList.lockedStylesheets.filter((entry) => !isLockedFolder(entry)));
  const folders = keepList.lockedStylesheets.filter(isLockedFolder);
  assert(files.size + folders.length <= STYLE_KEEP_LIMITS.lockedStylesheetsMax, 'stylesheetLockMatcher: the parser bounds locked paths');
  return (rel) => {
    if (files.has(rel)) {
      return true;
    }
    return folders.some((folder) => rel.startsWith(folder));
  };
}

function pathLock(keepList: StyleKeepList, target: string): string | undefined {
  let best: string | undefined;
  for (const entry of keepList.lockedStylesheets) {
    const covers = entry === target || (isLockedFolder(entry) && target.startsWith(entry));
    if (covers) {
      if (best === undefined || entry.length > best.length) {
        best = entry;
      }
    }
  }
  return best;
}

export function keepMatcher(keepList: StyleKeepList): (name: string) => boolean {
  const exact = new Set<string>();
  const wildcards: RegExp[] = [];
  for (const pattern of keepList.keep) {
    if (pattern.includes('*')) {
      const body = pattern
        .split('*')
        .map((part) => part.replace(/[\\^$.+?()[\]{}|/]/g, '\\$&'))
        .join('.*');
      wildcards.push(new RegExp(`^${body}$`));
    } else {
      exact.add(pattern);
    }
  }
  assert(exact.size + wildcards.length <= STYLE_KEEP_LIMITS.patternsMax, 'keepMatcher: the parser bounds patterns');
  return (name) => {
    if (exact.has(name)) {
      return true;
    }
    return wildcards.some((wildcard) => wildcard.test(name));
  };
}

function keepPattern(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > STYLE_KEEP_LIMITS.patternCharsMax) {
    throw new Error(`Keep patterns must be 1 to ${STYLE_KEEP_LIMITS.patternCharsMax} characters`);
  }
  if (!PATTERN.test(value)) {
    throw new Error(`Keep pattern "${value}" contains whitespace, quotes or commas`);
  }
  if (value.replaceAll('*', '').length === 0) {
    throw new Error('A keep pattern must name more than a wildcard');
  }
  return value;
}

function lockedPath(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > STYLE_KEEP_LIMITS.lockedPathCharsMax) {
    throw new Error(`Locked stylesheet paths must be 1 to ${STYLE_KEEP_LIMITS.lockedPathCharsMax} characters`);
  }
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Locked stylesheet path "${value}" must be relative to the project, with / between folders`);
  }
  const segments = (isLockedFolder(value) ? value.slice(0, -1) : value).split('/');
  if (segments.length > STYLE_KEEP_LIMITS.lockedPathSegmentsMax) {
    throw new Error(`Locked stylesheet path "${value}" is nested more than ${STYLE_KEEP_LIMITS.lockedPathSegmentsMax} folders deep`);
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Locked stylesheet path "${value}" has an empty, . or .. step`);
    }
  }
  return value;
}

export function newProjectStylesSource(existing: string | undefined): string | undefined {
  if (existing === undefined) {
    return serializeStyleKeepList({ version: 1, keep: [], lockedStylesheets: [], newStyleTag: DEFAULT_NEW_STYLE_TAG });
  }
  let keepList: StyleKeepList;
  try {
    const input: unknown = JSON.parse(existing);
    keepList = parseStyleKeepList(input);
  } catch {
    return undefined;
  }
  return keepList.newStyleTag === undefined ? serializeStyleKeepList({ ...keepList, newStyleTag: DEFAULT_NEW_STYLE_TAG }) : serializeStyleKeepList(keepList);
}
