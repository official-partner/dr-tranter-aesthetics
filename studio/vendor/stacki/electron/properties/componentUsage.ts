
import fs from 'fs';
import path from 'path';

import { aliasMap, boundNames, resolveSpec } from '../content/cmsRefs';
import type { Alias } from '../content/cmsRefs';
import { MAIN_LIMITS } from '../lib/mainLimits';
import { comparablePath, sameFilesystemPath } from '../lib/platform';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

const toPosix = (filePath: string): string => filePath.split(path.sep).join('/');

function astroFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const out: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > MAIN_LIMITS.directoryDepthMax) {
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name.endsWith('.astro') || (current.includes(`${path.sep}pages`) && /\.mdx?$/i.test(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(directory, 0);
  return out;
}

function templateOf(source: unknown): string {
  return String(source ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
}

function countIn(source: unknown, name: unknown): number {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(String(name || ''))) {
    return 0;
  }
  return (templateOf(source).match(new RegExp(`<${String(name)}[\\s/>]`, 'g')) || []).length;
}

const IMPORT_RE = /^[ \t]*import\s+([^;'"]*?)\s+from\s*['"]([^'"]+)['"]/gm;

export interface FileImport {
  readonly names: readonly string[];
  readonly candidates: ReadonlySet<string>;
}

function importsOf(source: unknown, file: string, aliases: readonly Alias[]): FileImport[] {
  const out: FileImport[] = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(String(source))) !== null) {
    const clause = match[1];
    const spec = match[2];
    if (clause === undefined || spec === undefined) {
      continue;
    }
    const names = boundNames(clause);
    if (!names.length) {
      continue;
    }
    const candidates = new Set<string>();
    for (const base of resolveSpec(spec, file, aliases)) {
      candidates.add(base);
      if (!/\.[a-z]+$/i.test(base)) {
        candidates.add(`${base}.astro`);
      }
    }
    if (candidates.size) {
      out.push({ names, candidates });
    }
  }
  return out;
}

interface InstanceArgs {
  readonly file: string;
  readonly targetPath?: string | undefined;
  readonly name: string;
  readonly aliases?: readonly Alias[];
  readonly counts?: InstanceCounts;
}

type InstanceCounts = (target: Pick<InstanceArgs, 'targetPath' | 'name'>) => number;

export function instanceCounts(source: unknown, file: string, aliases: readonly Alias[]): InstanceCounts {
  const text = String(source ?? '');
  assert(text.length <= LIMITS.sourceBytesMax, 'Usage source stays within the reader limit');
  const names = instanceTagCounts(templateOf(text));
  const imports = importsOf(text, file, aliases);
  const targets = new Map<string, number>();
  const bound = new Set<string>();
  for (const item of imports) {
    let count = 0;
    for (const name of item.names) {
      bound.add(name);
      count += names.get(name) ?? 0;
    }
    const candidates = new Set([...item.candidates].map((candidate) => comparablePath(candidate)));
    for (const key of candidates) {
      targets.set(key, (targets.get(key) ?? 0) + count);
    }
  }
  assert(bound.size <= text.length, 'Usage bindings come from the source text');
  return ({ targetPath, name }) => {
    if (targetPath) {
      const count = targets.get(comparablePath(targetPath));
      if (count !== undefined) {
        return count;
      }
      if (bound.has(name)) {
        return 0;
      }
    }
    return names.get(name) ?? 0;
  };
}

function instanceTagCounts(template: string): ReadonlyMap<string, number> {
  assert(template.length <= LIMITS.sourceBytesMax, 'Usage template stays within the reader limit');
  const counts = new Map<string, number>();
  for (const match of template.matchAll(/<([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    const name = match[1];
    if (name !== undefined) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  assert(counts.size <= template.length, 'Usage tag names come from the template text');
  return counts;
}

function instancesIn(source: unknown, { file, targetPath, name, aliases = [], counts }: InstanceArgs): number {
  return (counts ?? instanceCounts(source, file, aliases))({ targetPath, name });
}

export interface UsageFile {
  readonly rel: string;
  readonly path: string;
  readonly kind: 'page' | 'layout' | 'component' | 'file';
  readonly count: number;
}

function componentUsage({ projectPath, name, exclude }: { readonly projectPath: string; readonly name: string; readonly exclude?: string }): {
  files: UsageFile[];
  total: number;
} {
  const sourceFolder = path.join(projectPath, 'src');
  const skip = exclude ? path.resolve(exclude) : undefined;
  const aliases = aliasMap(projectPath);
  const kindOf = (file: string): UsageFile['kind'] => {
    const rel = toPosix(path.relative(sourceFolder, file));
    if (rel.startsWith('pages/')) {
      return 'page';
    }
    if (rel.startsWith('layouts/')) {
      return 'layout';
    }
    if (rel.startsWith('components/')) {
      return 'component';
    }
    return 'file';
  };

  const files: UsageFile[] = [];
  for (const file of astroFiles(sourceFolder)) {
    if (skip && sameFilesystemPath(file, skip)) {
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const count = instancesIn(text, { file, targetPath: exclude, name, aliases });
    if (!count) {
      continue;
    }
    files.push({
      rel: toPosix(path.relative(projectPath, file)),
      path: file,
      kind: kindOf(file),
      count,
    });
  }
  files.sort((left, right) => right.count - left.count || left.rel.localeCompare(right.rel));
  return { files, total: files.reduce((total, usage) => total + usage.count, 0) };
}

export { componentUsage, countIn, instancesIn, importsOf, templateOf, astroFiles };
