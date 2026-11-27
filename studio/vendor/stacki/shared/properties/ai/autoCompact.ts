import { assert } from '../../core/assert';
import type { AgentId } from './agentIds';

export const AUTO_COMPACT_LIMITS = {
  percentMin: 30,
  percentMax: 95,
} as const;

export const AUTO_COMPACT_PRESETS = [50, 60, 70, 80, 90] as const;

export const AUTO_COMPACT_VARIABLE = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

export function autoCompactSupported(agent: AgentId): boolean {
  return agent === 'claude';
}

export function parseAutoCompactPercent(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error('Auto-compact: expected an integer percentage');
  }
  if (input < AUTO_COMPACT_LIMITS.percentMin || input > AUTO_COMPACT_LIMITS.percentMax) {
    throw new Error('Auto-compact: percentage out of range');
  }
  return input;
}

export function autoCompactEnvironment(agent: AgentId, percent: number | undefined): Readonly<Record<string, string>> {
  if (percent === undefined || !autoCompactSupported(agent)) {
    return {};
  }
  parseAutoCompactPercent(percent);
  const environment = { [AUTO_COMPACT_VARIABLE]: String(percent) };
  assert(Object.keys(environment).length === 1, 'autoCompactEnvironment: one variable');
  return environment;
}

export type ContextBarTone = 'unknown' | 'blue' | 'amber' | 'red';

export function contextBarTone(percent: number | undefined): ContextBarTone {
  if (percent === undefined) {
    return 'unknown';
  }
  assert(Number.isFinite(percent), 'contextBarTone: a finite percentage');
  if (percent >= 90) {
    return 'red';
  }
  if (percent >= 70) {
    return 'amber';
  }
  return 'blue';
}
