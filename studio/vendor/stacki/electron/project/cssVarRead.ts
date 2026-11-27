
import { variableFiles as fs } from './variableWorkspace';
import path from 'path';
import postcss from 'postcss';
import type { Declaration, Rule as PostcssRule } from 'postcss';
import { LIMITS } from '../../shared/core/limits';
import { runSync, type SlicedWork } from '../lib/slicedWork';
import { commentLabel } from '../../shared/page/commentLabel';
import { PROJECT_FOLDERS_FILE, configOf, foldersFor, readProjectFoldersSource } from '../../shared/properties/projectFolders';

const WALK_DEPTH_MAX = Math.floor(LIMITS.ipcPathCharsMax / 2);
export const CSS_VARIABLE_LIMITS = {
  stylesheetDepthMax: WALK_DEPTH_MAX,
  renameTargetDepthMax: WALK_DEPTH_MAX,
  resolveDepthMax: 8,
} as const;

export const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.astro', '.stacki']);

export const toPosix = (filePath: string): string => filePath.split(path.sep).join('/');


export function* stylesheetsSliced(projectPath: string): SlicedWork<string[]> {
  const roots = variableFolders(projectPath).map((folder) => path.join(projectPath, ...folder.split('/')));
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
      } else if (/\.css$/i.test(entry.name)) {
        found.push(full);
      }
    }
    yield;
  }
  for (const root of roots) {
    yield* walk(root, 0);
  }
  return [...new Set(found)].sort();
}

export function findStylesheets(projectPath: string): string[] {
  return runSync(stylesheetsSliced(projectPath));
}

function variableFolders(projectPath: string): readonly string[] {
  let source: string | undefined;
  try {
    source = fs.readFileSync(path.join(projectPath, PROJECT_FOLDERS_FILE), 'utf8');
  } catch {
    source = undefined;
  }
  return foldersFor('variables', configOf(readProjectFoldersSource(source)));
}

export interface VarEntry {
  readonly kind: 'var';
  readonly name: string;
  readonly value: string;
  readonly important: boolean;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly line: number;
}
export interface CommentEntry {
  readonly kind: 'comment';
  readonly text: string;
  readonly textStart: number;
  readonly textEnd: number;
  readonly description?: string;
}
export type Entry = VarEntry | CommentEntry;

export interface Rule {
  selector: string;
  selectors: readonly string[];
  context: readonly string[];
  line: number;
  entries: Entry[];
}

export const leading = (text: string): number => text.match(/^\s*/)?.[0]?.length ?? 0;

export function readDeclarations(text: string): Rule[] {
  const root = postcss.parse(text);
  const rules: Rule[] = [];

  const contextOf = (node: Declaration | PostcssRule): string[] => {
    const parts: string[] = [];
    let parent = node.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule') {
        parts.unshift(`@${parent.name} ${parent.params}`.trim());
      } else if (parent.type === 'rule') {
        parts.unshift(parent.selector);
      }
      parent = parent.parent;
    }
    return parts;
  };

  root.walkRules((rule: PostcssRule) => {
    const entries: Entry[] = [];
    for (const node of rule.nodes || []) {
      if (node.type === 'comment') {
        const open = node.source?.start?.offset ?? 0;
        const bodyStart = open + 2 + (node.raws?.['left']?.length ?? 0);
        const label = commentLabel(node.text);
        entries.push({
          kind: 'comment',
          text: label.title,
          textStart: bodyStart + label.titleStart,
          textEnd: bodyStart + label.titleEnd,
          ...(label.description === undefined ? {} : { description: label.description }),
        });
        continue;
      }
      if (node.type !== 'decl' || !node.prop.startsWith('--')) {
        continue;
      }
      const start = node.source?.start?.offset ?? 0;
      const end = node.source?.end?.offset ?? start;
      const declText = text.slice(start, end);
      const rawValue = node.raws.value?.raw ?? node.value;
      const valueStart = start + node.prop.length + (node.raws.between ?? ':').length + leading(rawValue);
      const valueEnd = Math.max(valueStart, start + declText.replace(/[\s;]+$/, '').length);
      entries.push({
        kind: 'var',
        name: node.prop,
        value: text.slice(valueStart, valueEnd),
        important: !!node.important,
        valueStart,
        valueEnd,
        line: node.source?.start?.line ?? 0,
      });
    }
    if (!entries.some((entry) => entry.kind === 'var')) {
      return;
    }
    rules.push({
      selector: rule.selector,
      selectors: rule.selectors ?? [],
      context: contextOf(rule),
      line: rule.source?.start?.line ?? 0,
      entries,
    });
  });

  return rules;
}
