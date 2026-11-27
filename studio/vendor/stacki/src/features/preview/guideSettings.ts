import { useProjectGuideSettings } from './guidePersistence';

import { useEffect, useRef } from 'react';
import { assert } from '../../../shared/core/assert';
import { BOUNDARY_LIMITS } from '../../../shared/core/boundary';
import {
  GUIDE_DEFAULTS,
  GUIDE_COLUMN_COUNT_DEFAULT,
  GUIDE_LIMITS,
  clampGuideOpacity,
  guideVariableNames,
  isGuideColumnPick,
  parseGuideLength,
  parseGuideVariableName,
  resolveGuide,
  type GuideColumnSetting,
  type GuideMetrics,
  type GuideSettings,
  type GuideSize,
  type ResolvedGuide,
} from './guideModel';
import type { GuideMenuProps } from './GuideMenu';

const GUIDE_STORAGE_PREFIX = 'stacki.columnGuide:';
const GUIDE_STORED_CHARS_MAX = 2_048;
const GUIDE_COLUMN_DEFAULTS_VERSION = 1;

export type GuideUpdate = (update: (settings: GuideSettings) => GuideSettings) => void;

export interface GuideFrameLink {
  readonly post: (message: unknown) => void;
  readonly subscribeLoad: (listener: () => void) => () => void;
}

export interface ShownGuide {
  readonly guide: ResolvedGuide;
  readonly settings: GuideSettings;
}

export function useColumnGuide(options: {
  readonly projectKey: string | undefined;
  readonly metrics: GuideMetrics | undefined;
  readonly available: boolean;
  readonly frame: GuideFrameLink;
}): { readonly menu: GuideMenuProps; readonly shown: ShownGuide | undefined } {
  const { settings, update, persistence } = useProjectGuideSettings(options.projectKey);
  useGuideShortcut(update);
  useGuideVariables(guideVariableNames(settings), options.frame);
  const metrics = options.metrics;
  const guide = metrics === undefined ? undefined : resolveGuide(metrics, settings);
  const menu = { settings, update, metrics, guide, persistence, available: options.available };
  if (guide === undefined) {
    return { menu, shown: undefined };
  }
  return { menu, shown: settings.visible ? { guide, settings } : undefined };
}

export function useGuideSettings(projectKey: string | undefined): readonly [GuideSettings, GuideUpdate] {
  const { settings, update } = useProjectGuideSettings(projectKey);
  useGuideShortcut(update);
  return [settings, update] as const;
}

function useGuideVariables(names: readonly string[], frame: GuideFrameLink): void {
  const key = names.join('\n');
  const link = useRef(frame);
  useEffect(() => {
    link.current = frame;
  });
  useEffect(() => {
    const send = (): void => link.current.post({ type: 'avb:guide-variables', names: key === '' ? [] : key.split('\n') });
    send();
    return link.current.subscribeLoad(send);
  }, [key]);
}

export function parseGuideSettings(input: unknown): GuideSettings {
  if (typeof input !== 'object' || input === null) {
    return GUIDE_DEFAULTS;
  }
  const value = new Map<string, unknown>(Object.entries(input));
  const visible = value.get('visible');
  const numbers = value.get('numbers');
  return {
    visible: typeof visible === 'boolean' ? visible : GUIDE_DEFAULTS.visible,
    columns: storedColumns(value),
    color: colorOr(value.get('color')),
    opacity: opacityOr(value.get('opacity')),
    numbers: typeof numbers === 'boolean' ? numbers : GUIDE_DEFAULTS.numbers,
    margin: sizeOr(value.get('margin')),
    gutter: sizeOr(value.get('gutter')),
    widthMax: sizeOr(value.get('widthMax')),
  };
}

export function parseGuideColor(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const value = input.trim();
  if (value.length === 0) {
    return undefined;
  }
  if (value.length > GUIDE_LIMITS.colorCharsMax) {
    return undefined;
  }
  if (value.includes('var(')) {
    return undefined;
  }
  return CSS.supports('color', value) ? value : undefined;
}

function useGuideShortcut(update: GuideUpdate): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== 'G') {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }
      }
      event.preventDefault();
      update((settings) => ({ ...settings, visible: !settings.visible }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update]);
}

function storageKey(projectKey: string): string {
  assert(projectKey.length > 0, 'Guide settings: project key is non-empty');
  assert(projectKey.length <= BOUNDARY_LIMITS.pathLengthMax, 'Guide settings: key within limit');
  return GUIDE_STORAGE_PREFIX + projectKey;
}

export function loadLegacyGuideSettings(projectKey: string | undefined): GuideSettings | undefined {
  if (projectKey === undefined) {
    return undefined;
  }
  const key = storageKey(projectKey);
  try {
    const raw = localStorage.getItem(key) ?? undefined;
    if (raw === undefined) {
      return undefined;
    }
    if (raw.length > GUIDE_STORED_CHARS_MAX) {
      return undefined;
    }
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object') {
      return undefined;
    }
    if (stored === null) {
      return undefined;
    }
    if (Array.isArray(stored)) {
      return undefined;
    }
    return parseGuideSettings(stored);
  } catch {
    return undefined;
  }
}

function storedColumns(value: ReadonlyMap<string, unknown>): GuideColumnSetting {
  const columns = columnsOr(value.get('columns'), value.get('columnVariable'));
  if (value.get('columnDefaultsVersion') !== GUIDE_COLUMN_DEFAULTS_VERSION) {
    if (columns.kind === 'count') {
      if (columns.count === GUIDE_COLUMN_COUNT_DEFAULT) {
        return GUIDE_DEFAULTS.columns;
      }
    }
  }
  return columns;
}

function columnsOr(input: unknown, legacyVariable: unknown): GuideColumnSetting {
  if (isGuideColumnPick(input)) {
    return { kind: 'count', count: input };
  }
  if (input === 'project') {
    const name = parseGuideVariableName(legacyVariable);
    return name === undefined ? GUIDE_DEFAULTS.columns : { kind: 'variable', name };
  }
  if (typeof input !== 'object' || input === null) {
    return GUIDE_DEFAULTS.columns;
  }
  const value = new Map<string, unknown>(Object.entries(input));
  switch (value.get('kind')) {
    case 'automatic':
      return GUIDE_DEFAULTS.columns;
    case 'count': {
      const count = value.get('count');
      return isGuideColumnPick(count) ? { kind: 'count', count } : GUIDE_DEFAULTS.columns;
    }
    case 'variable': {
      const name = parseGuideVariableName(value.get('name'));
      return name === undefined ? GUIDE_DEFAULTS.columns : { kind: 'variable', name };
    }
    default:
      return GUIDE_DEFAULTS.columns;
  }
}

function colorOr(input: unknown): string {
  return parseGuideColor(input) ?? GUIDE_DEFAULTS.color;
}

function opacityOr(input: unknown): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? clampGuideOpacity(input) : GUIDE_DEFAULTS.opacity;
  }
  return GUIDE_DEFAULTS.opacity;
}

function sizeOr(input: unknown): GuideSize | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const value = new Map<string, unknown>(Object.entries(input));
  switch (value.get('kind')) {
    case 'length':
      return storedLength(value.get('length'));
    case 'variable': {
      const name = parseGuideVariableName(value.get('name'));
      return name === undefined ? undefined : { kind: 'variable', name };
    }
    default:
      return undefined;
  }
}

function storedLength(input: unknown): GuideSize | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const value = new Map<string, unknown>(Object.entries(input));
  const amount = value.get('amount');
  const unit = value.get('unit');
  if (typeof amount !== 'number') {
    return undefined;
  }
  if (unit !== 'px') {
    if (unit !== 'rem') {
      return undefined;
    }
  }
  const length = parseGuideLength(`${amount}${unit}`);
  return length === undefined ? undefined : { kind: 'length', length };
}
