import { assert } from '../../core/assert';
import { AGENT_IDS, type AgentId } from './agentIds';
import { AI_LIMITS } from './aiLimits';
import type { ChatOption } from './chatModel';

export interface RememberedSetting {
  readonly option: string;
  readonly value: string;
}

export type RememberedSettings = Readonly<Record<AgentId, readonly RememberedSetting[]>>;

export const NO_REMEMBERED_SETTINGS: RememberedSettings = { claude: [], codex: [] };

export type RememberAction = { readonly kind: 'set'; readonly option: string; readonly value: string } | { readonly kind: 'reset' };

function isBoundedText(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= AI_LIMITS.idCharsMax;
}

function parseAgentSettings(input: unknown): readonly RememberedSetting[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const settings: RememberedSetting[] = [];
  const entries: readonly unknown[] = input;
  for (const entry of entries.slice(0, AI_LIMITS.configOptionsMax)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const option: unknown = Reflect.get(entry, 'option');
    const value: unknown = Reflect.get(entry, 'value');
    if (isBoundedText(option) && isBoundedText(value) && !settings.some((setting) => setting.option === option)) {
      settings.push({ option, value });
    }
  }
  assert(settings.length <= AI_LIMITS.configOptionsMax, 'parseAgentSettings: bounded');
  return settings;
}

export function parseRememberedSettings(input: unknown): RememberedSettings {
  if (typeof input !== 'object' || input === null) {
    return NO_REMEMBERED_SETTINGS;
  }
  const parsed: RememberedSettings = { claude: parseAgentSettings(Reflect.get(input, 'claude')), codex: parseAgentSettings(Reflect.get(input, 'codex')) };
  assert(
    AGENT_IDS.every((agent) => parsed[agent].length <= AI_LIMITS.configOptionsMax),
    'parseRememberedSettings: every agent is bounded',
  );
  return parsed;
}

export function parseRememberedFile(input: unknown): RememberedSettings {
  if (typeof input !== 'object' || input === null) {
    return NO_REMEMBERED_SETTINGS;
  }
  return parseRememberedSettings(Reflect.get(input, 'agents'));
}

export function serializeRememberedSettings(settings: RememberedSettings): string {
  return `${JSON.stringify({ version: 1, agents: settings })}\n`;
}

export function applyRemember(settings: RememberedSettings, agent: AgentId, action: RememberAction): RememberedSettings {
  if (action.kind === 'reset') {
    return { ...settings, [agent]: [] };
  }
  const kept = settings[agent].filter((setting) => setting.option !== action.option);
  const next = [...kept, { option: action.option, value: action.value }].slice(-AI_LIMITS.configOptionsMax);
  assert(
    next.some((setting) => setting.option === action.option),
    'applyRemember: the choice is remembered',
  );
  assert(next.length <= AI_LIMITS.configOptionsMax, 'applyRemember: bounded');
  return { ...settings, [agent]: next };
}

export function usableSettings(options: readonly ChatOption[], settings: readonly RememberedSetting[]): readonly RememberedSetting[] {
  return settings.filter((setting) =>
    options.some((option) => option.id === setting.option && option.choices.some((choice) => choice.value === setting.value)),
  );
}

export function overlaySettings(base: readonly RememberedSetting[], over: readonly RememberedSetting[]): readonly RememberedSetting[] {
  const merged = [...base.filter((setting) => !over.some((other) => other.option === setting.option)), ...over];
  return merged.slice(0, AI_LIMITS.configOptionsMax);
}

export function parseRememberAction(input: unknown): RememberAction {
  if (typeof input !== 'object' || input === null) {
    throw new Error('remember action: expected object');
  }
  const kind: unknown = Reflect.get(input, 'kind');
  if (kind === 'reset') {
    return { kind: 'reset' };
  }
  if (kind === 'set') {
    const option: unknown = Reflect.get(input, 'option');
    const value: unknown = Reflect.get(input, 'value');
    if (!isBoundedText(option)) {
      throw new Error('remember action.option: expected bounded text');
    }
    if (!isBoundedText(value)) {
      throw new Error('remember action.value: expected bounded text');
    }
    return { kind: 'set', option, value };
  }
  throw new Error('remember action: unknown kind');
}
