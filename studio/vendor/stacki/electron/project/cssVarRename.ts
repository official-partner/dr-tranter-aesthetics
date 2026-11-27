
import { variableFiles as fs } from './variableWorkspace';
import path from 'path';
import { runSync, type SlicedWork } from '../lib/slicedWork';
import { writeProjectText } from './variableWorkspace';
import { CSS_VARIABLE_LIMITS, SKIPPED_DIRECTORIES, findStylesheets } from './cssVarRead';
import { described, type Described, type MessageRef } from '../../shared/properties/i18n/messageRef';
import { astroDeclaredNames, findAstroSources, relativeTo } from './cssVarRegions';
import { COMPONENT_CANVAS_FILE, parseComponentCanvasSource, renameCanvasVariables, serializeComponentCanvas } from '../../shared/properties/componentCanvas';


export const RENAME_EXTS = /\.(css|s[ac]ss|less|pcss|postcss|astro|html|htm|md|mdx|mdoc|svelte|vue|jsx|tsx|[cm]?[jt]s)$/i;

export function* renameTargetsSliced(projectPath: string): SlicedWork<string[]> {
  const found: string[] = [];
  function* walk(directory: string, depth: number): SlicedWork<void> {
    if (depth > CSS_VARIABLE_LIMITS.renameTargetDepthMax) {
      return;
    }
    let entries: ReturnType<typeof fs.readdirSync>;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        yield* walk(path.join(directory, entry.name), depth + 1);
      } else if (RENAME_EXTS.test(entry.name)) {
        found.push(path.join(directory, entry.name));
      }
    }
    yield;
  }
  yield* walk(projectPath, 0);
  return [...new Set(found)].sort();
}

export function findRenameTargets(projectPath: string): string[] {
  return runSync(renameTargetsSliced(projectPath));
}

export const NAME_RE = /^--[^\s:;{}()'"\\,]+$/;
export const EDGE = '[-\\w\\u00a0-\\uffff]';

export interface Rename {
  readonly from: string;
  readonly to: string;
}

export function renameVariables(
  projectPath: string,
  { renames }: { readonly renames?: readonly Rename[] },
): { ok: boolean; files?: number; occurrences?: number; paths?: readonly string[]; error?: string; errorRef?: MessageRef | undefined } {
  const list = (renames || []).filter((rename) => rename && rename.from !== rename.to);
  if (!list.length) {
    return { ok: true, files: 0, occurrences: 0, paths: [] };
  }
  const problem = renameBatchProblem(list) ?? renameTakenProblem(projectPath, list);
  if (problem !== undefined) {
    return { ok: false, error: problem.message, errorRef: problem.messageRef };
  }

  const by = new Map(list.map(({ from, to }) => [from, to]));
  const alternation = [...by.keys()]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`(?<!${EDGE})(${alternation})(?!${EDGE})`, 'g');

  const writes: [string, string][] = [];
  let occurrences = 0;
  for (const abs of findRenameTargets(projectPath)) {
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    let hits = 0;
    const next = text.replace(re, (match: string): string => {
      hits += 1;
      return by.get(match) ?? match;
    });
    if (!hits) {
      continue;
    }
    occurrences += hits;
    writes.push([abs, next]);
  }

  const canvas = renamedCanvasSettings(projectPath, by);
  if (canvas !== undefined) {
    occurrences += 1;
    writes.push(canvas);
  }

  for (const [abs, next] of writes) {
    writeProjectText(abs, next);
  }
  return { ok: true, files: writes.length, occurrences, paths: writes.map(([abs]) => abs) };
}

function renamedCanvasSettings(projectPath: string, by: ReadonlyMap<string, string>): [string, string] | undefined {
  const abs = path.join(projectPath, ...COMPONENT_CANVAS_FILE.split('/'));
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = parseComponentCanvasSource(text);
  if (!parsed.ok) {
    return undefined;
  }
  const renamed = renameCanvasVariables(parsed.value, (name) => by.get(name) ?? name);
  return renamed === parsed.value ? undefined : [abs, serializeComponentCanvas(renamed)];
}

export function renameBatchProblem(list: readonly Rename[]): Described | undefined {
  const froms = new Set<string>();
  const tos = new Set<string>();
  for (const { from, to } of list) {
    if (!NAME_RE.test(String(from || ''))) {
      return described('variables.error.notVariableName', { name: from });
    }
    if (!NAME_RE.test(String(to || ''))) {
      return described('variables.error.badVariableName', { name: String(to || '').replace(/^--/, '') });
    }
    if (froms.has(from)) {
      return described('variables.error.renamedTwice', { name: from });
    }
    if (tos.has(to)) {
      return described('variables.error.sameNameTwice', { name: to });
    }
    froms.add(from);
    tos.add(to);
  }
  return undefined;
}

export function renameTakenProblem(projectPath: string, list: readonly Rename[]): Described | undefined {
  const froms = new Set(list.map(({ from }) => from));
  const declared = new Set<string>();
  for (const abs of findStylesheets(projectPath)) {
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/(^|[;{}\s])(--[^\s:;{}()'"\\,]+)\s*:/g)) {
      const name = match[2];
      if (name) {
        declared.add(name);
      }
    }
  }
  for (const abs of findAstroSources(projectPath)) {
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const name of astroDeclaredNames(relativeTo(projectPath, abs), text)) {
      declared.add(name);
    }
  }
  for (const { to } of list) {
    if (declared.has(to) && !froms.has(to)) {
      return described('variables.error.alreadyExists', { name: to });
    }
  }
  return undefined;
}
