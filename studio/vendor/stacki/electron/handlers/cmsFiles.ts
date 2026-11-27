
import { readSource } from '../lib/mainLimits';
import { isPathWithin } from '../lib/platform';
import { parseContentConfig } from '../app/mainValidation';
import type { CmsFile } from '../lib/mainTypes';
import * as path from 'path';
import * as fs from 'fs';
import { findCollections, readGeneral, GENERAL } from '../content/jsCollections';
import { defaultImports } from '../project/assetRefs';
import { readContentConfig } from '../content/contentConfig';
import { toPosix, errorMessage, readJson, parseData, parseRecord } from '../lib/mainHelpers';
import { resolveImportPath } from '../properties/importPaths';
import { MEDIA_EXT } from '../project/assetFiles';


export const CMS_SKIP = /^(tsconfig|jsconfig|package|package-lock|studio-cms-schema|studio-cms-deleted|env\.d)\.json$/i;

export const PAGE_SCAN = { requireExport: false, allowPlainLists: true };

export const isAstroRel = (rel: string) => /\.astro$/i.test(String(rel || ''));

export function frontmatterSpan(source: string) {
  const open = /^---[ \t]*\r?\n/.exec(source);
  if (!open) {
    return undefined;
  }
  const start = open[0].length;
  const close = source.slice(start).search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (close === -1) {
    return undefined;
  }
  return { start, end: start + close };
}

export function frontmatterOf(source: string) {
  const span = frontmatterSpan(source);
  return span ? source.slice(span.start, span.end) : undefined;
}

export function splitCmsRel(rel: string) {
  const at = String(rel || '').lastIndexOf('#');
  return at === -1 ? { fileRel: String(rel || ''), exportName: undefined } : { fileRel: String(rel).slice(0, at), exportName: String(rel).slice(at + 1) };
}

export function cmsAbs(projectPath: string, rel: string) {
  const root = path.resolve(projectPath, 'src');
  const abs = path.resolve(root, rel || '');
  if (!isPathWithin(root, abs)) {
    throw new Error('Invalid data path');
  }
  return abs;
}

export function assetOfImport(projectPath: string, abs: string, source: string) {
  const imports = defaultImports(source);
  return (name: string) => {
    const imp = imports.find((i) => i.name === name);
    if (!imp) {
      return undefined;
    }
    const target = resolveImportPath(projectPath, abs, imp.spec);
    if (!target || !MEDIA_EXT.test(target)) {
      return undefined;
    }
    const rel = toPosix(path.relative(projectPath, target));
    return rel && !rel.startsWith('..') ? rel : undefined;
  };
}

export const cmsMetaPath = (projectPath: string) => path.join(projectPath, 'src', 'data', 'studio-cms-schema.json');

export function readCmsMeta(projectPath: string) {
  try {
    return parseRecord(parseData(readJson(cmsMetaPath(projectPath))));
  } catch {
    return {};
  }
}

export const collectionOf = async (projectPath: string, name: string) => {
  const config = parseContentConfig(await readContentConfig(projectPath));
  const collection = (config.collections || []).find((candidate) => candidate.name === name);
  if (!collection) {
    throw new Error(`${name} is not a collection in this project.`);
  }
  return { config, collection };
};

const fileName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

export function readCmsSource(full: string, entryRel: string, options: { readonly page: boolean; readonly includeGeneralOnly?: boolean }): CmsFile[] {
  let source: string;
  try {
    source = readSource(full);
  } catch {
    return [];
  }
  if (options.page) {
    const body = frontmatterOf(source);
    if (!body) {
      return [];
    }
    source = body;
  }
  const scan = options.page ? PAGE_SCAN : undefined;
  const collections = findCollections(source, scan);
  if (!options.page) {
    if (!options.includeGeneralOnly) {
      if (collections.length === 0) {
        return [];
      }
    }
  }
  const metadata = {
    dir: entryRel,
    abs: full,
    fromFile: true,
    ...(options.page ? { fromPage: true } : {}),
  };
  const general = readGeneral(source, scan);
  const files: CmsFile[] = general ? [{ ...metadata, rel: `${entryRel}#${GENERAL}`, name: fileName(entryRel), data: general }] : [];
  for (const collection of collections) {
    if (collection.data) {
      files.push({
        ...metadata,
        rel: `${entryRel}#${collection.name}`,
        name: collection.name,
        data: collection.data,
      });
    }
  }
  return files;
}

export function readCmsJson(full: string, entryRel: string, rel: string, name: string): CmsFile {
  let file: CmsFile = { rel: entryRel, name, dir: rel, abs: full };
  try {
    const stat = fs.statSync(full);
    file = { ...file, size: stat.size };
    return { ...file, data: parseData(readJson(full)) };
  } catch (error: unknown) {
    return {
      ...file,
      error: `Not valid JSON — ${errorMessage(error).replace(/\s+in JSON.*$/, '')}`,
    };
  }
}
