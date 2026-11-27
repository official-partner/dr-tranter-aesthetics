
import { useEffect, useMemo, useState } from 'react';
import { streamProjectVariables, type ProjectVariable } from './model/webflow';
import { getHost } from './model/host';
import { projectRelative, variableFileOffered, type VariablePlace } from '../../editor/variablePlace';
import { assert } from '../../../shared/core/assert';

export const COLOR_PROP_RE = /(?:^|-)color$/;
export const STRING_PROPS = new Set([
  'font-family',
  'text-transform',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-skip-ink',
  'font-style',
  'white-space',
  'word-break',
  'overflow-wrap',
  'text-overflow',
  'text-wrap',
  'direction',
  'display',
  'position',
  'float',
  'clear',
  'visibility',
  'box-sizing',
  'overflow',
  'overflow-x',
  'overflow-y',
  'cursor',
  'pointer-events',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-self',
  'justify-self',
  'justify-items',
  'align-content',
  'place-content',
  'place-items',
  'place-self',
  'grid-auto-flow',
  'background-repeat',
  'background-attachment',
  'background-clip',
  'background-origin',
  'background-blend-mode',
  'mix-blend-mode',
  'object-fit',
  'border-style',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'outline-style',
  'column-rule-style',
  'column-span',
  'backface-visibility',
  'transform-style',
  'will-change',
]);
const GRADIENT_PROPS: ReadonlySet<string> = new Set(['background', 'background-image', 'border-image', 'border-image-source', 'mask', 'mask-image']);

export function varTypeAllowed(prop: string | undefined, type: string): boolean {
  if (!prop) {
    return true;
  }
  const property = prop.toLowerCase();
  if (COLOR_PROP_RE.test(property) || property === 'fill' || property === 'stroke') {
    return type === 'Color';
  }
  if (STRING_PROPS.has(property)) {
    return type === 'FontFamily' || type === 'String';
  }
  if (GRADIENT_PROPS.has(property)) {
    return type !== 'FontFamily';
  }
  return type !== 'Color' && type !== 'FontFamily';
}

export type VarCollection = {
  collection: string;
  groups: Array<{ group: string; items: ProjectVariable[] }>;
};
export function byCollection(vars: ProjectVariable[]): VarCollection[] {
  const colls = new Map<string, Map<string, ProjectVariable[]>>();
  for (const variable of vars) {
    let groups = colls.get(variable.collection);
    if (!groups) {
      groups = new Map();
      colls.set(variable.collection, groups);
    }
    const list = groups.get(variable.group);
    if (list) {
      list.push(variable);
    } else {
      groups.set(variable.group, [variable]);
    }
  }
  return [...colls.entries()].map(([collection, groups]) => ({
    collection,
    groups: [...groups.entries()].map(([group, items]) => ({ group, items })),
  }));
}

export let sharedVars: ProjectVariable[] = [];
export let sharedDone = false;
export let sharedLoading = false;
export const sharedListeners = new Set<() => void>();
let sharedLoad = 0;
export function ensureSharedVars() {
  if (sharedDone || sharedLoading) {
    return;
  }
  sharedLoading = true;
  sharedLoad += 1;
  const load = sharedLoad;
  const reloading = sharedVars.length > 0;
  const loaded: ProjectVariable[] = [];
  const seen = new Set<string>();
  void streamProjectVariables(
    (variable) => {
      const key = `${variable.file ?? ''}\u0000${variable.binding}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      loaded.push(variable);
      if (load === sharedLoad && !reloading) {
        sharedVars = [...loaded];
        sharedListeners.forEach((listener) => listener());
      }
    },
    () => load !== sharedLoad,
    reloadSharedVars,
  ).then(() => {
    if (load !== sharedLoad) {
      return;
    }
    sharedVars = loaded;
    sharedDone = true;
    sharedLoading = false;
    sharedListeners.forEach((listener) => listener());
  });
}

function reloadSharedVars(): void {
  sharedDone = false;
  sharedLoading = false;
  ensureSharedVars();
}
export function variablesAt(vars: readonly ProjectVariable[], place: VariablePlace): ProjectVariable[] {
  assert(place.openFile !== '', 'variablesAt: an open file has a path');
  const rankOf = (variable: ProjectVariable): number => {
    if (variable.file === undefined) {
      return 2;
    }
    if (variable.file === place.openFile) {
      return 0;
    }
    return variable.file === place.contextPage ? 1 : 2;
  };
  const chosen = new Map<string, ProjectVariable>();
  for (const variable of vars) {
    if (variable.file !== undefined && !variableFileOffered(variable.file, place)) {
      continue;
    }
    const held = chosen.get(variable.binding);
    if (held === undefined) {
      chosen.set(variable.binding, variable);
    } else if (rankOf(variable) < rankOf(held)) {
      chosen.set(variable.binding, variable);
    }
  }
  const offered = vars.filter((variable) => chosen.get(variable.binding) === variable);
  assert(offered.length === chosen.size, 'variablesAt: one entry per offered name');
  return offered;
}

export function hostVariablePlace(): VariablePlace {
  const host = getHost();
  return {
    openFile: projectRelative(host.projectPath, host.openFilePath),
    contextPage: projectRelative(host.projectPath, host.contextPagePath),
  };
}

export function useSharedVars({ active }: { active: boolean }): {
  vars: ProjectVariable[];
  loading: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    ensureSharedVars();
    const listener = () => force((count) => count + 1);
    sharedListeners.add(listener);
    return () => {
      sharedListeners.delete(listener);
    };
  }, [active]);
  const { openFile, contextPage } = hostVariablePlace();
  const listed = sharedVars;
  const vars = useMemo(() => variablesAt(listed, { openFile, contextPage }), [listed, openFile, contextPage]);
  return { vars, loading: !sharedDone };
}
