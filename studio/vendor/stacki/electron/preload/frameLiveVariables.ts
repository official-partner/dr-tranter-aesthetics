
import { assert } from '../../shared/core/assert';
import { LIVE_VARIABLE_LIMITS, liveVariableKey, liveVariablesCss, parseLiveVariableMessage, type LiveVariable } from '../../shared/properties/liveVariables';

const STYLE_ID = 'avb-live-variables';

interface Override {
  readonly variable: LiveVariable;
  readonly until?: string;
  readonly framesWaited: number;
}

const overrides = new Map<string, Override>();
let settleScheduled = false;

export function receiveLiveVariables(input: unknown): boolean {
  const message = parseLiveVariableMessage(input);
  if (message === undefined) {
    return false;
  }
  switch (message.op) {
    case 'clear':
      overrides.clear();
      break;
    case 'set': {
      const key = liveVariableKey(message.variable);
      if (overrides.size >= LIVE_VARIABLE_LIMITS.entriesMax && !overrides.has(key)) {
        const oldest = overrides.keys().next().value;
        if (oldest !== undefined) {
          overrides.delete(oldest);
        }
      }
      overrides.delete(key);
      overrides.set(key, { variable: message.variable, framesWaited: 0 });
      break;
    }
    case 'drop': {
      const key = liveVariableKey(message.variable);
      if (message.until === undefined) {
        overrides.delete(key);
      } else if (overrides.has(key)) {
        overrides.set(key, { variable: message.variable, until: message.until, framesWaited: 0 });
        scheduleSettle();
      }
      break;
    }
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
  assert(overrides.size <= LIVE_VARIABLE_LIMITS.entriesMax, 'receiveLiveVariables: overrides stay bounded');
  paint([...overrides.values()].map((override) => override.variable));
  return true;
}

function styleElement(): HTMLStyleElement | undefined {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const parent = document.head ?? document.documentElement;
  if (parent === null) {
    return undefined;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  parent.appendChild(style);
  return style;
}

function paint(variables: readonly LiveVariable[]): void {
  const style = styleElement();
  if (style === undefined) {
    return;
  }
  const css = liveVariablesCss(variables);
  if (style.textContent !== css) {
    style.textContent = css;
  }
}

function scheduleSettle(): void {
  if (settleScheduled) {
    return;
  }
  settleScheduled = true;
  requestAnimationFrame(settle);
}

function sampleElement(selector: string): Element {
  try {
    return document.querySelector(selector) ?? document.documentElement;
  } catch {
    return document.documentElement;
  }
}

function settle(): void {
  settleScheduled = false;
  const settling = [...overrides].filter(([, override]) => override.until !== undefined);
  if (settling.length === 0) {
    return;
  }
  for (const [key, override] of settling) {
    overrides.delete(key);
    paint([...overrides.values()].map((entry) => entry.variable));
    const computed = getComputedStyle(sampleElement(override.variable.selector)).getPropertyValue(override.variable.name).trim();
    const agrees = computed === override.until;
    const expired = override.framesWaited + 1 >= LIVE_VARIABLE_LIMITS.settleFramesMax;
    if (!agrees && !expired) {
      overrides.set(key, { ...override, framesWaited: override.framesWaited + 1 });
    }
  }
  paint([...overrides.values()].map((entry) => entry.variable));
  if ([...overrides.values()].some((override) => override.until !== undefined)) {
    scheduleSettle();
  }
}
