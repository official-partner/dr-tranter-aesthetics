
import { assert } from '../core/assert';

export type LengthUnit = { readonly kind: 'px' } | { readonly kind: 'rem'; readonly rootFontPx: number };

export type LengthUnitName = 'px' | 'rem';

export const LENGTH_UNIT_LIMITS = {
  rootFontPxMin: 1,
  rootFontPxMax: 128,
  rootFontPxDefault: 16,
  manifestCharsMax: 256 * 1024,
  stylesheetsMax: 32,
  stylesheetCharsMax: 1024 * 1024,
  valueCharsMax: 64 * 1024,
  remDecimalsMax: 4,
  pxMagnitudeMax: 1_000_000,
} as const satisfies Record<string, number>;

export const PX_LENGTHS: LengthUnit = { kind: 'px' };

export interface LengthUnitMarkers {
  readonly manifest: string | undefined;
  readonly lumosGuide: boolean;
  readonly stylesheets: readonly string[];
}

export function detectLengthUnit(markers: LengthUnitMarkers): LengthUnit {
  assert(markers.stylesheets.length <= LENGTH_UNIT_LIMITS.stylesheetsMax, 'detectLengthUnit: stylesheet count is bounded');
  if (!markers.lumosGuide && !isLumosManifest(markers.manifest)) {
    return PX_LENGTHS;
  }
  let rootFontPx: number = LENGTH_UNIT_LIMITS.rootFontPxDefault;
  for (const sheet of markers.stylesheets) {
    const declared = rootFontPxFromCss(sheet);
    if (declared !== undefined) {
      rootFontPx = declared;
    }
  }
  const unit: LengthUnit = { kind: 'rem', rootFontPx };
  assertLengthUnit(unit);
  return unit;
}

export function isLumosManifest(manifest: string | undefined): boolean {
  if (manifest === undefined) {
    return false;
  }
  if (manifest.length > LENGTH_UNIT_LIMITS.manifestCharsMax) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const block: unknown = (parsed as Record<string, unknown>)['lumos'];
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  return !Array.isArray(block);
}

const ROOT_RULE = /(?:^|[}\s;])(?:html|:root)\s*\{([^{}]*)\}/g;
const ROOT_FONT_SIZE = /(?:^|[\s;{])font-size\s*:\s*(\d+(?:\.\d+)?|\.\d+)(px|%|rem|em)\s*(?:!important\s*)?(?:;|$)/i;

export function rootFontPxFromCss(css: string): number | undefined {
  if (css.length > LENGTH_UNIT_LIMITS.stylesheetCharsMax) {
    return undefined;
  }
  let found: number | undefined;
  ROOT_RULE.lastIndex = 0;
  for (let match = ROOT_RULE.exec(css); match !== null; match = ROOT_RULE.exec(css)) {
    const size = ROOT_FONT_SIZE.exec((match[1] ?? '').trim());
    if (size !== null) {
      const px = rootSizePx(Number(size[1]), (size[2] ?? '').toLowerCase());
      if (px >= LENGTH_UNIT_LIMITS.rootFontPxMin && px <= LENGTH_UNIT_LIMITS.rootFontPxMax) {
        found = px;
      }
    }
  }
  return found;
}

function rootSizePx(amount: number, unit: string): number {
  assert(Number.isFinite(amount), 'rootSizePx: the amount is a number');
  if (unit === 'px') {
    return amount;
  }
  if (unit === '%') {
    return (amount * LENGTH_UNIT_LIMITS.rootFontPxDefault) / 100;
  }
  assert(unit === 'rem' || unit === 'em', `rootSizePx: unknown unit ${unit}`);
  return amount * LENGTH_UNIT_LIMITS.rootFontPxDefault;
}

export function parseLengthUnit(input: unknown): LengthUnit {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('LengthUnit: expected object');
  }
  const record = input as Record<string, unknown>;
  if (record['kind'] === 'px') {
    return PX_LENGTHS;
  }
  if (record['kind'] !== 'rem') {
    throw new Error('LengthUnit.kind: expected "px" or "rem"');
  }
  const rootFontPx = record['rootFontPx'];
  if (typeof rootFontPx !== 'number' || !Number.isFinite(rootFontPx)) {
    throw new Error('LengthUnit.rootFontPx: expected a finite number');
  }
  if (rootFontPx < LENGTH_UNIT_LIMITS.rootFontPxMin) {
    throw new Error('LengthUnit.rootFontPx: below the minimum');
  }
  if (rootFontPx > LENGTH_UNIT_LIMITS.rootFontPxMax) {
    throw new Error('LengthUnit.rootFontPx: above the maximum');
  }
  return { kind: 'rem', rootFontPx };
}

export function lengthUnitName(unit: LengthUnit): LengthUnitName {
  return unit.kind;
}

export function sameLengthUnit(left: LengthUnit, right: LengthUnit): boolean {
  if (left.kind === 'px') {
    return right.kind === 'px';
  }
  if (right.kind === 'px') {
    return false;
  }
  return left.rootFontPx === right.rootFontPx;
}

export function pxToRem(px: number, rootFontPx: number): number {
  assert(Number.isFinite(px), 'pxToRem: px is a finite number');
  assertRootFontPx(rootFontPx);
  const rem = roundDecimals(px / rootFontPx);
  assert(Number.isFinite(rem), 'pxToRem: the result is a finite number');
  assert(Math.sign(rem) === Math.sign(px) || rem === 0, 'pxToRem: conversion keeps the sign');
  return rem;
}

export function remToPx(rem: number, rootFontPx: number): number {
  assert(Number.isFinite(rem), 'remToPx: rem is a finite number');
  assertRootFontPx(rootFontPx);
  const px = Math.round(rem * rootFontPx * 1e6) / 1e6;
  assert(Number.isFinite(px), 'remToPx: the result is a finite number');
  return px;
}

export function formatPxLength(px: number, unit: LengthUnit): string {
  assert(Number.isFinite(px), 'formatPxLength: px is a finite number');
  if (unit.kind === 'px') {
    return `${numberText(Math.round(px * 1e4) / 1e4)}px`;
  }
  return `${numberText(pxToRem(px, unit.rootFontPx))}rem`;
}

export function projectLength(amount: number, unit: string, lengthUnit: LengthUnit): { readonly amount: number; readonly unit: string } {
  assert(Number.isFinite(amount), 'projectLength: the amount is a finite number');
  if (lengthUnit.kind === 'rem' && unit.toLowerCase() === 'px') {
    return { amount: pxToRem(amount, lengthUnit.rootFontPx), unit: 'rem' };
  }
  return { amount, unit };
}

export function projectDefaultUnit(defaultUnit: string, lengthUnit: LengthUnit): string {
  return defaultUnit.toLowerCase() === 'px' ? lengthUnitName(lengthUnit) : defaultUnit;
}

export function pxPerLengthUnit(unit: string, lengthUnit: LengthUnit): number | undefined {
  const normalized = unit.toLowerCase();
  if (normalized === 'px') {
    return 1;
  }
  if (normalized === 'rem') {
    return lengthUnit.kind === 'rem' ? lengthUnit.rootFontPx : LENGTH_UNIT_LIMITS.rootFontPxDefault;
  }
  return undefined;
}

const PX_TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))px(?![\w-])/gi;

export function convertPxLengths(value: string, lengthUnit: LengthUnit): string {
  if (lengthUnit.kind === 'px') {
    return value;
  }
  if (value.length > LENGTH_UNIT_LIMITS.valueCharsMax) {
    return value;
  }
  const converted = value.replace(PX_TOKEN, (match: string, quoted: string | undefined, number: string | undefined) => {
    if (quoted !== undefined || number === undefined) {
      return match;
    }
    const px = Number(number);
    if (!Number.isFinite(px) || Math.abs(px) > LENGTH_UNIT_LIMITS.pxMagnitudeMax) {
      return match;
    }
    return `${numberText(pxToRem(px, lengthUnit.rootFontPx))}rem`;
  });
  assert(converted.length <= value.length * 2 + 16, 'convertPxLengths: conversion stays near the input length');
  return converted;
}

function assertLengthUnit(unit: LengthUnit): void {
  if (unit.kind === 'rem') {
    assertRootFontPx(unit.rootFontPx);
  }
}

function assertRootFontPx(rootFontPx: number): void {
  assert(Number.isFinite(rootFontPx), 'root font size is a finite number');
  assert(rootFontPx >= LENGTH_UNIT_LIMITS.rootFontPxMin, 'root font size is at least the minimum');
  assert(rootFontPx <= LENGTH_UNIT_LIMITS.rootFontPxMax, 'root font size is at most the maximum');
}

function roundDecimals(value: number): number {
  const factor = 10 ** LENGTH_UNIT_LIMITS.remDecimalsMax;
  return Math.round(value * factor) / factor;
}

function numberText(value: number): string {
  assert(Math.abs(value) <= LENGTH_UNIT_LIMITS.pxMagnitudeMax, 'numberText: magnitude is bounded');
  return String(Object.is(value, -0) ? 0 : value);
}
