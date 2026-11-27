
import { assert } from '../../shared/core/assert';

interface CommonRun {
  common: string[];
}
interface DiffRun {
  ours: string[];
  theirs: string[];
  base?: string[];
  changedBy?: 'ours' | 'theirs' | 'both';
}
type Run = CommonRun | DiffRun;

function lineDiff(left: readonly string[], right: readonly string[]): Run[] {
  if (left.length * right.length > 250000) {
    return [{ ours: [...left], theirs: [...right] }];
  }
  const leftCount = left.length;
  const rightCount = right.length;
  const dp: Uint32Array[] = Array.from({ length: leftCount + 1 }, () => new Uint32Array(rightCount + 1));
  for (let i = leftCount - 1; i >= 0; i--) {
    const row = dp[i];
    if (!row) {
      continue;
    }
    for (let j = rightCount - 1; j >= 0; j--) {
      row[j] = left[i] === right[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const runs: Run[] = [];
  let i = 0;
  let j = 0;
  const push = (run: Run): void => {
    const last = runs[runs.length - 1];
    if (last && 'ours' in last === 'ours' in run) {
      if ('ours' in last && 'ours' in run) {
        last.ours.push(...run.ours);
        last.theirs.push(...run.theirs);
      } else if (!('ours' in last) && !('ours' in run)) {
        last.common.push(...run.common);
      }
      return;
    }
    runs.push(run);
  };
  while (i < leftCount && j < rightCount) {
    if (left[i] === right[j]) {
      push({ common: [left[i] ?? ''] });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      push({ ours: [left[i] ?? ''], theirs: [] });
      i++;
    } else {
      push({ ours: [], theirs: [right[j] ?? ''] });
      j++;
    }
  }
  if (i < leftCount || j < rightCount) {
    push({ ours: left.slice(i), theirs: right.slice(j) });
  }
  return runs;
}

interface Interval {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

function changeIntervals(base: readonly string[], side: readonly string[]): Interval[] {
  const out: Interval[] = [];
  let baseLine = 0;
  for (const run of lineDiff(base, side)) {
    if ('ours' in run) {
      out.push({ start: baseLine, end: baseLine + run.ours.length, lines: run.theirs });
      baseLine += run.ours.length;
      continue;
    }
    baseLine += run.common.length;
  }
  return out;
}

function threeWay(base: readonly string[], ours: readonly string[], theirs: readonly string[]): Run[] {
  const oursChanges = changeIntervals(base, ours);
  const theirsChanges = changeIntervals(base, theirs);
  const runs: Run[] = [];
  let i = 0;
  let oursIndex = 0;
  let theirsIndex = 0;

  while (oursIndex < oursChanges.length || theirsIndex < theirsChanges.length) {
    const start = Math.min(oursChanges[oursIndex]?.start ?? Infinity, theirsChanges[theirsIndex]?.start ?? Infinity);
    if (i < start) {
      runs.push({ common: base.slice(i, start) });
      i = start;
    }
    const group = overlappingChanges(oursChanges, theirsChanges, oursIndex, theirsIndex, start);
    assert(group.oursNext + group.theirsNext > oursIndex + theirsIndex, 'threeWay: no progress');
    oursIndex = group.oursNext;
    theirsIndex = group.theirsNext;
    const { mine, yours, end } = group;
    runs.push({
      ours: sideAcross(base, start, end, mine),
      theirs: sideAcross(base, start, end, yours),
      base: base.slice(start, end),
      changedBy: mine.length && yours.length ? 'both' : mine.length ? 'ours' : 'theirs',
    });
    i = end;
  }
  if (i < base.length) {
    runs.push({ common: base.slice(i) });
  }
  return runs;
}

interface ChangeGroup {
  readonly mine: readonly Interval[];
  readonly yours: readonly Interval[];
  readonly end: number;
  readonly oursNext: number;
  readonly theirsNext: number;
}

function overlappingChanges(
  oursChanges: readonly Interval[],
  theirsChanges: readonly Interval[],
  oursIndex: number,
  theirsIndex: number,
  start: number,
): ChangeGroup {
  const mine: Interval[] = [];
  const yours: Interval[] = [];
  let end = start;
  let oursNext = oursIndex;
  let theirsNext = theirsIndex;
  const overlaps = (interval: Interval): boolean => interval.start < end || (interval.start === end && interval.start === interval.end);
  const takeOurs = (interval: Interval): void => {
    end = Math.max(end, interval.end);
    mine.push(interval);
    oursNext++;
  };
  const takeTheirs = (interval: Interval): void => {
    end = Math.max(end, interval.end);
    yours.push(interval);
    theirsNext++;
  };
  const firstOurs = oursChanges[oursNext];
  if (firstOurs !== undefined && firstOurs.start === start) {
    takeOurs(firstOurs);
  }
  const firstTheirs = theirsChanges[theirsNext];
  if (firstTheirs !== undefined && firstTheirs.start === start) {
    takeTheirs(firstTheirs);
  }
  for (let moved = true; moved;) {
    moved = false;
    while (oursNext < oursChanges.length) {
      const interval = oursChanges[oursNext];
      if (interval === undefined || !overlaps(interval)) {
        break;
      }
      takeOurs(interval);
      moved = true;
    }
    while (theirsNext < theirsChanges.length) {
      const interval = theirsChanges[theirsNext];
      if (interval === undefined || !overlaps(interval)) {
        break;
      }
      takeTheirs(interval);
      moved = true;
    }
  }
  assert(end >= start, 'overlappingChanges: a group ends before it starts');
  return { mine, yours, end, oursNext, theirsNext };
}

function sideAcross(base: readonly string[], start: number, end: number, intervals: readonly Interval[]): string[] {
  const out: string[] = [];
  let baseLine = start;
  for (const interval of intervals) {
    out.push(...base.slice(baseLine, interval.start));
    out.push(...interval.lines);
    baseLine = interval.end;
  }
  out.push(...base.slice(baseLine, end));
  return out;
}

const tokenize = (text: unknown): string[] => String(text ?? '').match(/\s+|[A-Za-z0-9_]+|[^\s A-Za-z0-9_]/g) ?? [];

function mergeInline(base: string | undefined, ours: string, theirs: string): string | undefined {
  if (base === undefined) {
    return undefined;
  }
  const runs = threeWay(tokenize(base), tokenize(ours), tokenize(theirs));
  if (runs.some((run) => 'ours' in run && run.changedBy === 'both')) {
    return undefined;
  }
  if (!runs.some((run) => 'ours' in run)) {
    return undefined;
  }
  return runs.map((run) => ('ours' in run ? (run.changedBy === 'theirs' ? run.theirs : run.ours) : run.common).join('')).join('');
}

function whoChanged(ours: string, theirs: string, base: string | undefined): 'ours' | 'theirs' | 'both' {
  if (base === undefined) {
    return 'both';
  }
  const inBase = (text: string): boolean => text.trim() === '' || base.includes(text.trim());
  const oursUnchanged = inBase(ours);
  const theirsUnchanged = inBase(theirs);
  if (oursUnchanged && !theirsUnchanged) {
    return 'theirs';
  }
  if (theirsUnchanged && !oursUnchanged) {
    return 'ours';
  }
  return 'both';
}

const START = /^<<<<<<< ?(.*)\r?$/;
const MIDDLE = /^=======\s*$/;
const BASE = /^\|\|\|\|\|\|\| ?(.*)\r?$/;
const END = /^>>>>>>> ?(.*)\r?$/;

export type ConflictPart =
  | { readonly kind: 'same'; readonly text: string }
  | {
      readonly kind: 'clash';
      readonly ours: string;
      readonly theirs: string;
      readonly changedBy: 'ours' | 'theirs' | 'both';
      merged?: string;
    };

function parseConflict(text: unknown): ConflictPart[] {
  const lines = String(text ?? '').split('\n');
  const parts: ConflictPart[] = [];
  let same: string[] = [];
  let i = 0;

  const flushSame = (): void => {
    if (same.length) {
      parts.push({ kind: 'same', text: same.join('\n') });
    }
    same = [];
  };

  while (i < lines.length) {
    const startLine = lines[i];
    if (startLine === undefined || !START.test(startLine)) {
      same.push(startLine ?? '');
      i++;
      continue;
    }
    const block = readConflictBlock(lines, i);
    if (block.kind === 'unclosed') {
      same.push(startLine);
      i++;
      continue;
    }
    flushSame();
    parts.push(...clashParts(block));
    assert(block.endLine > i, 'parseConflict: a conflict block ends after it starts');
    i = block.endLine + 1;
  }
  flushSame();
  return parts;
}

type ConflictBlock =
  | { readonly kind: 'unclosed' }
  | {
      readonly kind: 'closed';
      readonly ours: readonly string[];
      readonly theirs: readonly string[];
      readonly base: readonly string[];
      readonly sawBase: boolean;
      readonly endLine: number;
    };

function readConflictBlock(lines: readonly string[], startLine: number): ConflictBlock {
  assert(START.test(lines[startLine] ?? ''), 'readConflictBlock: starts at a start marker');
  const ours: string[] = [];
  const theirs: string[] = [];
  const base: string[] = [];
  let sawMiddle = false;
  let sawBase = false;
  for (let j = startLine + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (END.test(line)) {
      return { kind: 'closed', ours, theirs, base, sawBase, endLine: j };
    }
    if (MIDDLE.test(line)) {
      sawMiddle = true;
      continue;
    }
    if (BASE.test(line)) {
      sawBase = true;
      continue;
    }
    (sawMiddle ? theirs : sawBase ? base : ours).push(line);
  }
  return { kind: 'unclosed' };
}

function clashParts(block: Extract<ConflictBlock, { readonly kind: 'closed' }>): ConflictPart[] {
  const { ours, theirs, base, sawBase } = block;
  const split = sawBase
    ? threeWay(base, ours, theirs)
    : lineDiff(ours, theirs).map((run): Run =>
        'ours' in run
          ? {
              ...run,
              changedBy: whoChanged(run.ours.join('\n'), run.theirs.join('\n'), undefined),
            }
          : run,
      );
  const parts: ConflictPart[] = [];
  for (const run of split) {
    if (!('ours' in run)) {
      parts.push({ kind: 'same', text: run.common.join('\n') });
      continue;
    }
    const clash: ConflictPart = {
      kind: 'clash',
      ours: run.ours.join('\n'),
      theirs: run.theirs.join('\n'),
      changedBy: run.changedBy ?? 'both',
    };
    if (clash.kind === 'clash' && clash.changedBy === 'both' && run.base) {
      const merged = mergeInline(run.base.join('\n'), clash.ours, clash.theirs);
      if (merged !== undefined) {
        clash.merged = merged;
      }
    }
    parts.push(clash);
  }
  return parts;
}

const clashCount = (parts: readonly ConflictPart[] | undefined): number => (parts ?? []).filter((part) => part.kind === 'clash').length;

function renderResolved(parts: readonly ConflictPart[] | undefined, picks: readonly unknown[] = []): string {
  let clashIndex = -1;
  return (parts ?? [])
    .map((part) => {
      if (part.kind === 'same') {
        return part.text;
      }
      clashIndex++;
      const pick = picks[clashIndex];
      if (pick === 'merged' && part.merged !== undefined) {
        return part.merged;
      }
      if (pick === 'theirs') {
        return part.theirs;
      }
      if (pick === 'both') {
        return [part.ours, part.theirs].filter((side) => side !== '').join('\n');
      }
      return part.ours;
    })
    .join('\n');
}

export { parseConflict, renderResolved, clashCount, threeWay, lineDiff, mergeInline };
