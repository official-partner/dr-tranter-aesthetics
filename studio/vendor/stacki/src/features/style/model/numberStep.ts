
import type { KeyboardEvent } from 'react';
import { projectLength, type LengthUnit } from '../../../../shared/properties/lengthUnit';
import { projectLengthUnit } from './lengthUnit';

export type StepMode = 'whole' | 'ten' | 'fine';

export type NumberRun = {
  start: number;
  numEnd: number;
  end: number;
  raw: string;
  unit: string;
};

const ROOT_PX = 16;
const NUMBER_UNIT_RE = /([-+]?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]*)/g;

function stepSizeFor(mode: StepMode, unit: string, scale: number, lengthUnit: LengthUnit): number {
  if (lengthUnit.kind === 'rem' && unit === 'rem') {
    return pixelSteps(mode) * (scale / lengthUnit.rootFontPx);
  }
  if (mode === 'ten') {
    return 10 * scale;
  }
  if (mode === 'whole') {
    return scale;
  }
  if (unit === 'rem') {
    return scale / ROOT_PX;
  }
  return 0.1 * scale;
}

function pixelSteps(mode: StepMode): number {
  if (mode === 'ten') {
    return 10;
  }
  if (mode === 'whole') {
    return 1;
  }
  return 0.1;
}

function stepBase(text: string, run: NumberRun, lengthUnit: LengthUnit): { amount: number; unit: string; unitText: string } | undefined {
  const parsed = Number.parseFloat(run.raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const written = projectLength(parsed, run.unit, lengthUnit);
  const unit = written.unit.toLowerCase();
  const unitText = written.unit === run.unit ? text.slice(run.numEnd, run.end) : written.unit;
  return { amount: written.amount, unit, unitText };
}

function snapStep(value: number, step: number, direction: 1 | -1): number {
  const quotient = value / step;
  const raw = direction > 0 ? (Math.floor(quotient + 1e-9) + 1) * step : (Math.ceil(quotient - 1e-9) - 1) * step;
  return Math.round(raw * 1e5) / 1e5;
}

function numberRuns(text: string): NumberRun[] {
  NUMBER_UNIT_RE.lastIndex = 0;
  const runs: NumberRun[] = [];
  for (let match = NUMBER_UNIT_RE.exec(text); match !== null; match = NUMBER_UNIT_RE.exec(text)) {
    const start = match.index;
    const raw = match[1] ?? '';
    const unit = match[2] ?? '';
    const numberEnd = start + raw.length;
    runs.push({ start, numEnd: numberEnd, end: numberEnd + unit.length, raw, unit });
  }
  return runs;
}

export function stepNumberAtCaret(
  text: string,
  caret: number,
  direction: 1 | -1,
  mode: StepMode,
  min?: number,
  scale = 1,
  lengthUnit: LengthUnit = projectLengthUnit(),
): { text: string; caret: number } | undefined {
  const hit = numberRuns(text).find((run) => caret >= run.start && caret <= run.end);
  if (!hit) {
    return undefined;
  }
  const base = stepBase(text, hit, lengthUnit);
  if (base === undefined) {
    return undefined;
  }
  const stepped = snapStep(base.amount, stepSizeFor(mode, base.unit, scale, lengthUnit), direction);
  const nextText = String(min !== undefined && stepped < min ? min : stepped);
  const unitOffset = Math.min(caret - hit.numEnd, base.unitText.length);
  const nextCaret = caret <= hit.numEnd ? hit.start + nextText.length : hit.start + nextText.length + unitOffset;
  return { text: text.slice(0, hit.start) + nextText + base.unitText + text.slice(hit.end), caret: nextCaret };
}


const SCRUB_UNITS = new Set([
  '',
  '%',
  'px',
  'em',
  'rem',
  'ex',
  'ch',
  'cap',
  'ic',
  'lh',
  'rlh',
  'vw',
  'vh',
  'vi',
  'vb',
  'vmin',
  'vmax',
  'svw',
  'svh',
  'lvw',
  'lvh',
  'dvw',
  'dvh',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
  'cm',
  'mm',
  'q',
  'in',
  'pt',
  'pc',
  'deg',
  'grad',
  'rad',
  'turn',
  's',
  'ms',
  'hz',
  'khz',
  'dpi',
  'dpcm',
  'dppx',
  'x',
  'fr',
]);

function isScrubbable(text: string, run: NumberRun): boolean {
  const before = text[run.start - 1];
  if (before !== undefined && /[\w#-]/.test(before)) {
    return false;
  }
  return SCRUB_UNITS.has(run.unit.toLowerCase());
}

export function findScrubTarget(text: string, caret: number): NumberRun | undefined {
  const runs = numberRuns(text).filter((run) => isScrubbable(text, run));
  const under = runs.find((run) => caret >= run.start && caret <= run.end);
  if (under) {
    return under;
  }
  let best: NumberRun | undefined;
  let bestDistance = Infinity;
  for (const run of runs) {
    const distance = caret < run.start ? run.start - caret : caret - run.end;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = run;
    }
  }
  return best;
}

export function hasScrubTarget(text: string): boolean {
  return findScrubTarget(text, 0) !== undefined;
}

export function scrubNumber(text: string, run: NumberRun, steps: number, mode: StepMode, scale = 1, lengthUnit: LengthUnit = projectLengthUnit()): string {
  const base = stepBase(text, run, lengthUnit);
  if (base === undefined) {
    return text;
  }
  const next = Math.round((base.amount + steps * stepSizeFor(mode, base.unit, scale, lengthUnit)) * 1e5) / 1e5;
  return text.slice(0, run.start) + String(next) + base.unitText + text.slice(run.end);
}

export function stepModeOf(event: { shiftKey: boolean; altKey: boolean }): StepMode {
  return event.shiftKey ? 'ten' : event.altKey ? 'fine' : 'whole';
}

export function handleArrowStep(
  event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  min?: number,
  scale = 1,
): { text: string; caret: number } | undefined {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    return undefined;
  }
  const element = event.currentTarget;
  return stepNumberAtCaret(element.value, element.selectionStart ?? element.value.length, event.key === 'ArrowUp' ? 1 : -1, stepModeOf(event), min, scale);
}
