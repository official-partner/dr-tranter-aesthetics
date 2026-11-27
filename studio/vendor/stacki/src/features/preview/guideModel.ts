
import { assert } from '../../../shared/core/assert';

export { GUIDE_LIMITS } from '../../../shared/properties/guideLimits';
import { GUIDE_LIMITS } from '../../../shared/properties/guideLimits';

export type GuideColumnSetting =
  { readonly kind: 'automatic' } | { readonly kind: 'count'; readonly count: number } | { readonly kind: 'variable'; readonly name: string };

export const GUIDE_COLUMN_COUNT_DEFAULT = 12;
export const GUIDE_COLUMN_VARIABLE_DEFAULT = '--site-columns';
export const GUIDE_NUMBER_OPACITY = 0.5;

export type GuideLengthUnit = 'px' | 'rem';
export interface GuideLength {
  readonly amount: number;
  readonly unit: GuideLengthUnit;
}

export type GuideSize = { readonly kind: 'length'; readonly length: GuideLength } | { readonly kind: 'variable'; readonly name: string };

export const GUIDE_PROJECT_VARIABLES = {
  margin: '--site-margin',
  gutter: '--site-gutter',
  widthMax: '--max-width-main',
} as const;

export const GUIDE_VARIABLE_PATTERN = /^--[A-Za-z0-9_-]+$/;

export const GUIDE_LENGTH_DEFAULTS = {
  margin: { amount: 3, unit: 'rem' },
  gutter: { amount: 1, unit: 'rem' },
  widthMax: { amount: 90, unit: 'rem' },
} as const satisfies Record<string, GuideLength>;

export interface GuideMetrics {
  readonly viewportWidthPx: number;
  readonly rootFontPx: number;
  readonly marginPx: number | undefined;
  readonly gutterPx: number | undefined;
  readonly widthMaxPx: number | undefined;
  readonly variablesPx: Readonly<Record<string, number | undefined>>;
  readonly variableCounts: Readonly<Record<string, number | undefined>>;
}

export interface GuideSettings {
  readonly visible: boolean;
  readonly columns: GuideColumnSetting;
  readonly color: string;
  readonly opacity: number;
  readonly numbers: boolean;
  readonly margin: GuideSize | undefined;
  readonly gutter: GuideSize | undefined;
  readonly widthMax: GuideSize | undefined;
}

export const GUIDE_DEFAULTS: GuideSettings = {
  visible: false,
  columns: { kind: 'automatic' },
  color: 'rgb(146, 146, 146)',
  opacity: 0.06,
  numbers: true,
  margin: undefined,
  gutter: undefined,
  widthMax: undefined,
};

export type GuideSource = 'project' | 'variable' | 'fixed' | 'default';
export interface GuideValue {
  readonly px: number;
  readonly source: GuideSource;
}
export type GuideColumnSource = 'project' | 'stacki';

export interface ResolvedGuide {
  readonly viewportWidthPx: number;
  readonly rootFontPx: number;
  readonly columnCount: number;
  readonly columnSource: GuideColumnSource;
  readonly margin: GuideValue;
  readonly gutter: GuideValue;
  readonly widthMax: GuideValue | undefined;
}

export interface GuideColumn {
  readonly xPx: number;
  readonly widthPx: number;
}

export function resolveGuide(metrics: GuideMetrics, settings: GuideSettings): ResolvedGuide {
  assert(metrics.viewportWidthPx >= 0, 'Guide: viewport width is nonnegative');
  assert(metrics.rootFontPx > 0, 'Guide: root font size is positive');
  return {
    viewportWidthPx: metrics.viewportWidthPx,
    rootFontPx: metrics.rootFontPx,
    ...columnCountOf(metrics, settings),
    margin: spacingValue(metrics.marginPx, settings.margin, metrics, GUIDE_LENGTH_DEFAULTS.margin),
    gutter: spacingValue(metrics.gutterPx, settings.gutter, metrics, GUIDE_LENGTH_DEFAULTS.gutter),
    widthMax: widthMaxValue(metrics, settings.widthMax),
  };
}

export function guideColumns(guide: ResolvedGuide): readonly GuideColumn[] {
  assert(Number.isSafeInteger(guide.columnCount), 'Guide: column count is an integer');
  assert(guide.columnCount >= GUIDE_LIMITS.columnPickMin, 'Guide: column count within range');
  assert(guide.columnCount <= GUIDE_LIMITS.columnPickMax, 'Guide: column count within range');
  const available = Math.max(0, guide.viewportWidthPx - 2 * guide.margin.px);
  const widthMax = guide.widthMax?.px ?? Number.POSITIVE_INFINITY;
  const contentWidthPx = Math.min(available, widthMax);
  const guttersPx = guide.gutter.px * (guide.columnCount - 1);
  const columnWidthPx = (contentWidthPx - guttersPx) / guide.columnCount;
  if (columnWidthPx > 0) {
    const leftPx = (guide.viewportWidthPx - contentWidthPx) / 2;
    const columns = Array.from({ length: guide.columnCount }, (_, index) => ({
      xPx: leftPx + index * (columnWidthPx + guide.gutter.px),
      widthPx: columnWidthPx,
    }));
    assert(columns.length === guide.columnCount, 'Guide: one box per column');
    return columns;
  }
  return [];
}

export function lengthPx(length: GuideLength, rootFontPx: number): number {
  assert(length.amount >= 0, 'Guide: length is nonnegative');
  assert(rootFontPx > 0, 'Guide: root font size is positive');
  return length.unit === 'px' ? length.amount : length.amount * rootFontPx;
}

const LENGTH_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)\s*(px|rem)?$/i;

export function parseGuideLength(text: string): GuideLength | undefined {
  const match = LENGTH_PATTERN.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const amount = Number.parseFloat(match[1] ?? '');
  const unit = (match[2] ?? 'px').toLowerCase() === 'rem' ? 'rem' : 'px';
  const maximum = unit === 'px' ? GUIDE_LIMITS.lengthPxMax : GUIDE_LIMITS.lengthRemMax;
  if (Number.isFinite(amount)) {
    return amount <= maximum ? { amount, unit } : undefined;
  }
  return undefined;
}

export function guideLengthText(length: GuideLength): string {
  return `${roundTo(length.amount, 1_000)}${length.unit}`;
}

const VARIABLE_REFERENCE_PATTERN = /^var\(\s*(--[^\s()]+)\s*\)$/;

export function parseGuideSize(text: string): GuideSize | undefined {
  const trimmed = text.trim();
  const reference = VARIABLE_REFERENCE_PATTERN.exec(trimmed)?.[1] ?? trimmed;
  if (reference.startsWith('--')) {
    const name = parseGuideVariableName(reference);
    return name === undefined ? undefined : { kind: 'variable', name };
  }
  const length = parseGuideLength(trimmed);
  return length === undefined ? undefined : { kind: 'length', length };
}

export function parseGuideVariableName(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  if (input.length > GUIDE_LIMITS.variableCharsMax) {
    return undefined;
  }
  return GUIDE_VARIABLE_PATTERN.test(input) ? input : undefined;
}

export function guideSizeText(size: GuideSize): string {
  switch (size.kind) {
    case 'length':
      return guideLengthText(size.length);
    case 'variable':
      return `var(${size.name})`;
    default: {
      const exhaustive: never = size;
      return exhaustive;
    }
  }
}

export function guideVariableNames(settings: GuideSettings): readonly string[] {
  const names = new Set<string>();
  for (const size of [settings.margin, settings.gutter, settings.widthMax]) {
    if (size?.kind === 'variable') {
      names.add(size.name);
    }
  }
  if (settings.columns.kind === 'variable') {
    names.add(settings.columns.name);
  }
  if (settings.columns.kind !== 'count') {
    names.add(GUIDE_COLUMN_VARIABLE_DEFAULT);
  }
  assert(names.size <= GUIDE_LIMITS.variablesMax, 'Guide: four menu variables plus the fallback');
  return [...names];
}

export function clampGuideOpacity(value: number): number {
  const stepped = Math.round(value / GUIDE_LIMITS.opacityStep) * GUIDE_LIMITS.opacityStep;
  const clamped = Math.min(GUIDE_LIMITS.opacityMax, Math.max(GUIDE_LIMITS.opacityMin, stepped));
  return roundTo(clamped, 100);
}

export function isGuideColumnPick(value: unknown): value is number {
  if (typeof value !== 'number') {
    return false;
  }
  if (!Number.isSafeInteger(value)) {
    return false;
  }
  if (value < GUIDE_LIMITS.columnPickMin) {
    return false;
  }
  return value <= GUIDE_LIMITS.columnPickMax;
}

const COUNT_PATTERN = /^\d{1,2}$/;

export function parseGuideColumnCount(text: string): number | undefined {
  assert(String(GUIDE_LIMITS.columnPickMax).length <= 2, 'Guide: the pattern holds every pick');
  if (!COUNT_PATTERN.test(text)) {
    return undefined;
  }
  const count = Number.parseInt(text, 10);
  return isGuideColumnPick(count) ? count : undefined;
}

export function parseGuideColumnSetting(text: string): GuideColumnSetting | undefined {
  const count = parseGuideColumnCount(text.trim());
  if (count !== undefined) {
    return { kind: 'count', count };
  }
  const size = parseGuideSize(text);
  return size?.kind === 'variable' ? size : undefined;
}

export function guideColumnText(setting: GuideColumnSetting, metrics: GuideMetrics | undefined = undefined): string {
  switch (setting.kind) {
    case 'automatic':
      return isGuideColumnPick(metrics?.variableCounts[GUIDE_COLUMN_VARIABLE_DEFAULT])
        ? `var(${GUIDE_COLUMN_VARIABLE_DEFAULT})`
        : String(GUIDE_COLUMN_COUNT_DEFAULT);
    case 'count':
      return String(setting.count);
    case 'variable':
      return `var(${setting.name})`;
    default: {
      const exhaustive: never = setting;
      return exhaustive;
    }
  }
}

function columnCountOf(metrics: GuideMetrics, settings: GuideSettings): Pick<ResolvedGuide, 'columnCount' | 'columnSource'> {
  const setting = settings.columns;
  if (setting.kind === 'count') {
    assert(isGuideColumnPick(setting.count), 'Guide: the literal count is within range');
    return { columnCount: setting.count, columnSource: 'stacki' };
  }
  const name = setting.kind === 'automatic' ? GUIDE_COLUMN_VARIABLE_DEFAULT : setting.name;
  const declared = metrics.variableCounts[name];
  if (isGuideColumnPick(declared)) {
    return { columnCount: declared, columnSource: 'project' };
  }
  const fallback = metrics.variableCounts[GUIDE_COLUMN_VARIABLE_DEFAULT];
  if (isGuideColumnPick(fallback)) {
    return { columnCount: fallback, columnSource: 'project' };
  }
  return { columnCount: GUIDE_COLUMN_COUNT_DEFAULT, columnSource: 'stacki' };
}

function spacingValue(projectPx: number | undefined, setting: GuideSize | undefined, metrics: GuideMetrics, fallback: GuideLength): GuideValue {
  const chosen = settingValue(setting, metrics);
  if (chosen !== undefined) {
    return chosen;
  }
  if (projectPx !== undefined) {
    return { px: projectPx, source: 'project' };
  }
  const px = lengthPx(fallback, metrics.rootFontPx);
  return { px, source: 'default' };
}

function widthMaxValue(metrics: GuideMetrics, setting: GuideSize | undefined): GuideValue | undefined {
  const chosen = settingValue(setting, metrics);
  if (chosen !== undefined) {
    if (chosen.px > 0) {
      return chosen;
    }
  }
  if (metrics.widthMaxPx !== undefined) {
    if (metrics.widthMaxPx > 0) {
      return { px: metrics.widthMaxPx, source: 'project' };
    }
  }
  return { px: lengthPx(GUIDE_LENGTH_DEFAULTS.widthMax, metrics.rootFontPx), source: 'default' };
}

function settingValue(setting: GuideSize | undefined, metrics: GuideMetrics): GuideValue | undefined {
  if (setting === undefined) {
    return undefined;
  }
  switch (setting.kind) {
    case 'length':
      return { px: lengthPx(setting.length, metrics.rootFontPx), source: 'fixed' };
    case 'variable': {
      const px = metrics.variablesPx[setting.name];
      return px === undefined ? undefined : { px, source: 'variable' };
    }
    default: {
      const exhaustive: never = setting;
      return exhaustive;
    }
  }
}

function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}
