
import { assert } from './assert';

export const CODE_INDENT_UNIT = '\t';

export const CODE_TAB_WIDTH = 2;

export interface MeasuredIndent {
  readonly unit: string;
  readonly unitWidth: number;
}

export function leadingIndent(line: string): string {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  assert(line.startsWith(indent), 'leadingIndent: the indent is the start of the line');
  assert(indent.trim().length === 0, 'leadingIndent: an indent is only whitespace');
  return indent;
}

export function measuredIndent(lines: readonly string[]): MeasuredIndent {
  let spaced = 0;
  let tabbed = 0;
  for (const line of lines) {
    if (line.startsWith(' ')) {
      spaced += 1;
    } else if (line.startsWith('\t')) {
      tabbed += 1;
    }
  }
  const step = commonSpaceStep(lines);
  const unitWidth = step ?? CODE_TAB_WIDTH;
  assert(unitWidth > 0, 'measuredIndent: an indent step is positive');
  assert(spaced + tabbed <= lines.length, 'measuredIndent: each line counts once');
  return { unit: spaced > tabbed ? ' '.repeat(unitWidth) : CODE_INDENT_UNIT, unitWidth };
}

export function indentUnitOf(text: string): string {
  const { unit } = measuredIndent(text.split('\n'));
  assert(unit.length > 0, 'indentUnitOf: a unit is never empty');
  assert(unit.trim().length === 0, 'indentUnitOf: a unit is only whitespace');
  return unit;
}

export function indentUnitBelow(text: string, base: string): string {
  assert(base.trim().length === 0, 'indentUnitBelow: a base indent is only whitespace');
  assert(!base.includes('\n'), 'indentUnitBelow: a base indent is one line');
  let unit = indentUnitOf(text);
  if (/^\t+$/.test(base)) {
    unit = CODE_INDENT_UNIT;
  } else if (/^ +$/.test(base)) {
    unit = ' '.repeat(measuredIndent(text.split('\n')).unitWidth);
  }
  assert(unit.length > 0, 'indentUnitBelow: a unit is never empty');
  return unit;
}

export function withIndentUnit(text: string, unit: string): string {
  assert(unit.length > 0, 'withIndentUnit: a unit is never empty');
  assert(unit.trim().length === 0, 'withIndentUnit: a unit is only whitespace');
  return text.replace(/^\t+/gm, (tabs) => unit.repeat(tabs.length));
}

function commonSpaceStep(lines: readonly string[]): number | undefined {
  const steps = new Map<number, number>();
  let previous: number | undefined;
  for (const line of lines) {
    if (line.trim().length > 0) {
      const indent = leadingIndent(line);
      const width = indent.includes('\t') ? undefined : indent.length;
      if (width !== undefined && previous !== undefined) {
        const step = Math.abs(width - previous);
        if (step > 1) {
          steps.set(step, (steps.get(step) ?? 0) + 1);
        }
      }
      previous = width;
    }
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (count > bestCount) {
      best = step;
      bestCount = count;
    } else if (count === bestCount && best !== undefined && step < best) {
      best = step;
    }
  }
  assert(best === undefined || best > 1, 'commonSpaceStep: one column is not a level');
  assert(bestCount <= lines.length, 'commonSpaceStep: a step occurs at most once per line');
  return best;
}
