
import { splitEmbed } from './css';
import postcss from 'postcss';
import { getHost, onHostChange, walkNodes } from './host';
import type { StyleRegion } from './styleTypes';
import { listAssetEntries } from '../../../ipc/assetBridge';
import { readAstroStyleFiles, readStyleFiles } from '../stylePanelBridge';
import { variableEdit } from '../../../ipc/variableEditBridge';
import { readCSSVariables, type VariablesSnapshot } from '../../../ipc/variablesBridge';
import { onVariablesChanged } from '../../../ipc/editorEnvironment';
import { projectRelative } from '../../../editor/variablePlace';

export function ruleSelectorOf(parent: unknown): string {
  if (typeof parent === 'object' && parent !== null) {
    if ('selector' in parent) {
      return typeof parent.selector === 'string' ? parent.selector : '';
    }
  }
  return '';
}


export function isGlobalRegion(region: StyleRegion): boolean {
  return region.openTag === undefined || /\bis:global\b/.test(region.openTag);
}


export type ProjectVariable = {
  collection: string;
  group: string;
  name: string;
  value: string;
  binding: string;
  type: string;
  readonly file?: string;
};

export const supports = (prop: string, value: string): boolean => {
  try {
    return typeof CSS !== 'undefined' && CSS.supports(prop, value);
  } catch {
    return false;
  }
};

export const CSS_WIDE_RE = /^(inherit|initial|unset|revert|revert-layer)$/i;

const PERCENTAGE_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)%$/;

export const varKind = (name: string, value: string): string => {
  const trimmed = value.trim();
  if (CSS_WIDE_RE.test(trimmed)) {
    return 'String';
  }
  const unresolved = /var\(/i.test(trimmed);
  if ((!unresolved && supports('color', trimmed)) || /^#|^rgba?\(|^hsla?\(|^color(-mix)?\(/i.test(trimmed)) {
    return 'Color';
  }
  if (/^(calc|clamp|min|max)\(/i.test(trimmed)) {
    return 'Size';
  }
  if (PERCENTAGE_RE.test(trimmed)) {
    return 'Percentage';
  }
  if ((!unresolved && supports('width', trimmed)) || /^-?[\d.]+(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|cm|mm|in)$/i.test(trimmed)) {
    return 'Size';
  }
  if (/^-?[\d.]+$/.test(trimmed)) {
    return 'Number';
  }
  if (/font-?family/i.test(name)) {
    return 'FontFamily';
  }
  return 'String';
};

export const ALIAS_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]*))?\)$/;
export const ALIAS_LIMITS = { depthMax: 8 } as const;
export function resolveAlias(value: string, values: Map<string, string>, depth = 0): string {
  const trimmed = value.trim();
  if (depth > ALIAS_LIMITS.depthMax) {
    return trimmed;
  }
  const match = ALIAS_RE.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const target = values.get((match[1] ?? '').slice(2));
  if (target !== undefined) {
    return resolveAlias(target, values, depth + 1);
  }
  const fallback = match[2]?.trim();
  return fallback ? resolveAlias(fallback, values, depth + 1) : trimmed;
}

export async function readAllProjectCss(): Promise<Array<{ label: string; css: string }>> {
  return [...(await readStylesheetCss()), ...(await readAstroGlobalCss()), ...readOpenFileCss()];
}

async function readStylesheetCss(): Promise<Array<{ label: string; css: string }>> {
  const host = getHost();
  const out: Array<{ label: string; css: string }> = [];
  let files = host.files;
  if (!files.length && host.projectPath) {
    try {
      const result = await readStyleFiles(host.projectPath);
      files = result.ok ? [...result.value] : [];
    } catch {
      files = [];
    }
  }
  const read = await Promise.all(
    files.map(async (file) => {
      try {
        const result = await variableEdit('readStyleFile', file.path);
        return { label: file.rel, css: result.ok ? (result.css ?? '') : '' };
      } catch {
        return undefined;
      }
    }),
  );
  for (const entry of read) {
    if (entry) {
      out.push(entry);
    }
  }
  return out;
}

async function readAstroGlobalCss(): Promise<Array<{ label: string; css: string }>> {
  const host = getHost();
  const out: Array<{ label: string; css: string }> = [];
  let astro = host.astroFiles;
  if (!astro.length && host.projectPath) {
    try {
      const result = await readAstroStyleFiles(host.projectPath);
      astro = result.ok ? [...result.value] : [];
    } catch {
      astro = [];
    }
  }
  const readAstro = await Promise.all(
    astro.map(async (file) => {
      try {
        const result = await variableEdit('readStyleFile', file.path);
        return { name: file.name, css: result.ok ? (result.css ?? '') : '' };
      } catch {
        return undefined;
      }
    }),
  );
  for (const entry of readAstro) {
    if (!entry) {
      continue;
    }
    for (const region of splitEmbed(entry.css).regions) {
      if (isGlobalRegion(region)) {
        out.push({ label: entry.name, css: region.css });
      }
    }
  }
  return out;
}

function readOpenFileCss(): Array<{ label: string; css: string; file?: string }> {
  const host = getHost();
  const file = projectRelative(host.projectPath, host.openFilePath);
  const out: Array<{ label: string; css: string; file?: string }> = [];
  walkNodes(host.nodes, (node) => {
    if (node.kind === 'raw' && node.name === 'style') {
      out.push({ label: '<style>', css: String(node.inner ?? ''), ...(file === undefined ? {} : { file }) });
    }
  });
  return out;
}

async function readBlockVariables(): Promise<VariablesSnapshot | undefined> {
  const { projectPath } = getHost();
  if (projectPath === undefined) {
    return undefined;
  }
  const result = await readCSSVariables(projectPath);
  return result.ok ? result.value : undefined;
}

type BlockVariable = { readonly collection: string; readonly group: string; readonly name: string; readonly value: string; readonly file: string };

function blockVariables(snapshot: VariablesSnapshot | undefined): readonly BlockVariable[] {
  const found: BlockVariable[] = [];
  for (const file of snapshot?.files ?? []) {
    for (const group of file.groups) {
      if (group.scope === undefined) {
        continue;
      }
      for (const block of group.blocks) {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            if (cell !== undefined) {
              found.push({ collection: file.name, group: cell.selector, name: cell.name.slice(2), value: cell.value.trim(), file: file.rel });
            }
          }
        }
      }
    }
  }
  return found;
}

export function whenProjectReady(timeoutMs = 4000): Promise<void> {
  if (getHost().projectPath) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = onHostChange(() => {
      if (getHost().projectPath) {
        done();
      }
    });
    const timer = setTimeout(done, timeoutMs);
  });
}

export async function streamProjectVariables(
  onAdd: (v: ProjectVariable) => void,
  isCancelled: () => boolean = () => false,
  onChanged?: () => void,
): Promise<ProjectVariable[]> {
  if (onChanged !== undefined) {
    const stop = onVariablesChanged(() => {
      stop();
      onChanged();
    });
  }
  await whenProjectReady();
  const all: ProjectVariable[] = [];
  const seen = new Set<string>();
  const keyOf = (file: string | undefined, name: string): string => `${file ?? ''}\u0000${name}`;
  const parsed: Array<{ label: string; file: string | undefined; root: ReturnType<typeof postcss.parse> }> = [];
  const values = new Map<string, string>();
  const sources: ReadonlyArray<{ readonly label: string; readonly css: string; readonly file?: string }> = [
    ...readOpenFileCss(),
    ...(await readStylesheetCss()),
  ];
  for (const { label, css, file } of sources) {
    if (isCancelled()) {
      break;
    }
    let root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    parsed.push({ label, file, root });
    root.walkDecls((decl) => {
      const key = decl.prop.startsWith('--') ? decl.prop.slice(2) : undefined;
      if (key && !values.has(key)) {
        values.set(key, decl.value.trim());
      }
    });
  }
  const snapshot = await readBlockVariables();
  const inBlocks = blockVariables(snapshot);
  for (const { name, value } of inBlocks) {
    if (!values.has(name)) {
      values.set(name, value);
    }
  }
  for (const { label, file, root } of parsed) {
    if (isCancelled()) {
      break;
    }
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) {
        return;
      }
      const name = decl.prop.slice(2);
      if (seen.has(keyOf(file, name))) {
        return;
      }
      seen.add(keyOf(file, name));
      const variable: ProjectVariable = {
        collection: label,
        group: ruleSelectorOf(decl.parent) || ':root',
        name,
        value: decl.value.trim(),
        binding: `var(${decl.prop})`,
        type: varKind(name, resolveAlias(decl.value, values)),
        ...(file === undefined ? {} : { file }),
      };
      all.push(variable);
      onAdd(variable);
    });
  }
  for (const { collection, group, name, value, file } of inBlocks) {
    if (isCancelled()) {
      break;
    }
    if (!seen.has(keyOf(file, name))) {
      seen.add(keyOf(file, name));
      const variable: ProjectVariable = { collection, group, name, value, binding: `var(--${name})`, type: varKind(name, resolveAlias(value, values)), file };
      all.push(variable);
      onAdd(variable);
    }
  }
  return all;
}

export async function getProjectFontFamilies(): Promise<string[]> {
  await whenProjectReady();
  const families = new Set<string>();
  for (const { css } of await readAllProjectCss()) {
    let root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    root.walkDecls(/^font-family$/i, (decl) => {
      for (const part of decl.value.split(',')) {
        const name = part.trim().replace(/^['"]|['"]$/g, '');
        if (name && !name.startsWith('var(')) {
          families.add(name);
        }
      }
    });
    root.walkAtRules(/^font-face$/i, (rule) => {
      rule.walkDecls(/^font-family$/i, (decl) => {
        const name = decl.value.trim().replace(/^['"]|['"]$/g, '');
        if (name) {
          families.add(name);
        }
      });
    });
  }
  return [...families].sort((left, right) => left.localeCompare(right));
}

export type ImageAsset = { id: string; name: string; url: string };

export async function getImageAssets(): Promise<ImageAsset[]> {
  const host = getHost();
  if (!host.projectPath) {
    return [];
  }
  try {
    const result = await listAssetEntries(host.projectPath);
    if (!result.ok) {
      return [];
    }
    return result.value
      .filter((entry) => !entry.isDir && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(entry.name))
      .map((entry) => ({ id: entry.rel, name: entry.name, url: `/${entry.rel}` }));
  } catch {
    return [];
  }
}
