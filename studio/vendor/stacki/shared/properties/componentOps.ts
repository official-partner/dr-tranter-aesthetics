import { assert } from '../core/assert';
import { record } from '../core/boundary';
import { parseComponentPath, type ComponentRule } from './componentAccess';
import { DEFAULT_LIMITS, type ComponentDefaults, type ComponentRecipe, type RecipeChild } from './componentDefaults';

export const COMPONENT_OP_LIMITS = {
  copyNameAttemptsMax: 1000,
  folderFilesMax: 256,
  folderDepthMax: 8,
  folderBytesMax: 4_194_304,
  folderConfirmFilesMin: 6,
  undoEntriesMax: 16,
} as const satisfies Record<string, number>;

export interface ComponentOpTarget {
  readonly kind: 'component' | 'folder';
  readonly path: string;
}

export type ComponentUses = 'refuse' | 'remove';

export function parseComponentUses(input: unknown): ComponentUses {
  if (input === 'refuse' || input === 'remove') {
    return input;
  }
  throw new Error('A deletion mode is "refuse" or "remove"');
}

export function parseComponentOpTarget(input: unknown): ComponentOpTarget {
  const value = record(input);
  const kind = value['kind'];
  const path = parseComponentPath(value['path']);
  if (kind === 'component' || kind === 'folder') {
    return { kind, path };
  }
  throw new Error('A component target is a "component" or a "folder"');
}

export function parseComponentOpError(input: unknown): ComponentOpError {
  const value = record(input);
  const code = value['code'];
  const message = value['message'];
  if (typeof message !== 'string' || typeof code !== 'string' || !COMPONENT_OP_ERROR_CODES.some((known) => known === code)) {
    throw new Error('Unknown component operation error');
  }
  return { code: code as ComponentOpErrorCode, message };
}

export const COMPONENT_OP_ERROR_CODES = [
  'not-a-component',
  'outside-components',
  'missing',
  'in-use',
  'too-large',
  'foreign-files',
  'name-unavailable',
  'write-failed',
  'unknown-undo',
  'invalid',
  'exists',
  'unsafe-file',
  'defaults-taken',
  'filesystem',
  'conflict',
  'rollback',
] as const;

export type ComponentOpErrorCode = (typeof COMPONENT_OP_ERROR_CODES)[number];

export interface ComponentOpError {
  readonly code: ComponentOpErrorCode;
  readonly message: string;
}

export function copyName(stem: string, isTaken: (candidate: string) => boolean): string | undefined {
  assert(stem.length > 0, 'A copy starts from a name');
  assert(!stem.includes('/'), 'A copy name is one path segment');
  const separated = /[-_]/.test(stem);
  const separator = stem.includes('-') ? '-' : '_';
  const base = separated ? `${stem}${separator}copy` : `${stem}Copy`;
  for (let attempt = 1; attempt <= COMPONENT_OP_LIMITS.copyNameAttemptsMax; attempt += 1) {
    const candidate = attempt === 1 ? base : separated ? `${base}${separator}${attempt}` : `${base}${attempt}`;
    if (!isTaken(candidate)) {
      assert(candidate.startsWith(stem), 'A copy name starts with the original');
      return candidate;
    }
  }
  return undefined;
}

export function dropDefaultsFor(config: ComponentDefaults, owns: (file: string) => boolean): ComponentDefaults {
  assert(config.version === 1, 'Cleanup reads the current recipe format');
  assert(Object.keys(config.components).length <= DEFAULT_LIMITS.componentsMax, 'Cleanup starts from bounded parsed configuration');
  const kept = Object.entries(config.components).filter(([file]) => !owns(file));
  const cleaned = kept.map(([file, recipe]) => [file, withoutChildren(recipe, 0, owns)] as const);
  assert(cleaned.length <= Object.keys(config.components).length, 'Cleanup never adds a recipe');
  return { version: 1, components: Object.fromEntries(cleaned) };
}

function withoutChildren(recipe: ComponentRecipe, depth: number, owns: (file: string) => boolean): ComponentRecipe {
  assert(depth <= DEFAULT_LIMITS.depthMax, 'Recipe nesting is bounded by the recipe parser');
  if (recipe.children === undefined) {
    return recipe;
  }
  const children: RecipeChild[] = [];
  for (const child of recipe.children) {
    if ('literal' in child) {
      children.push(child);
    } else if ('component' in child) {
      if (!owns(child.component)) {
        children.push({ ...child, ...withoutChildren(child, depth + 1, owns) });
      }
    } else {
      children.push({ ...child, ...withoutChildren(child, depth + 1, owns) });
    }
  }
  return { ...recipe, children };
}

export function targetOwns(target: ComponentOpTarget, file: string): boolean {
  assert(target.path.length > 0, 'A target names a path');
  return target.kind === 'component' ? file === target.path : file.startsWith(`${target.path}/`);
}

export function dropRulesFor(rules: readonly ComponentRule[], target: ComponentOpTarget): readonly ComponentRule[] {
  assert(target.path.length > 0, 'A target names a path');
  const kept = rules.filter((rule) => !(rule.path === target.path || (target.kind === 'folder' && rule.path.startsWith(`${target.path}/`))));
  assert(kept.length <= rules.length, 'Cleanup never adds a rule');
  return kept;
}
