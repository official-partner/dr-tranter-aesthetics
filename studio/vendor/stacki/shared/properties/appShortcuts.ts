import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';

export const APP_SHORTCUT_LIMITS = {
  claimsMax: 32,
  commandsMax: 16,
  commandIdCharsMax: 64,
  commandTitleCharsMax: 80,
  commandPanelCharsMax: 64,
  shortcutCharsMax: 32,
} as const satisfies Record<string, number>;

export const APP_SHORTCUTS = ['undo', 'redo', 'save', 'palette', 'escape'] as const;
export type AppShortcut = (typeof APP_SHORTCUTS)[number];

export const APP_FORWARDED_KEYS: Readonly<Record<string, AppShortcut>> = {
  'Mod+Z': 'undo',
  'Mod+Shift+Z': 'redo',
  'Mod+Y': 'redo',
  'Mod+S': 'save',
  'Mod+E': 'palette',
  Escape: 'escape',
};

export const APP_RESERVED_SHORTCUTS = [
  'Mod+Alt+Shift+1',
  'Mod+Alt+Shift+2',
  'Mod+Alt+Shift+3',
  'Mod+Alt+Shift+4',
  'Mod+Alt+Shift+5',
  'Mod+Alt+Shift+6',
  'Mod+Alt+Shift+7',
  'Mod+Alt+Shift+8',
  'Mod+Alt+Shift+9',
] as const;
export type AppReservedShortcut = (typeof APP_RESERVED_SHORTCUTS)[number];

const NAMED_KEYS = ['Escape', 'Enter', 'Backspace', 'Delete', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
const MODIFIERS = ['Mod', 'Alt', 'Shift'] as const;

export interface AppKeyPress {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function shortcutOfPress(press: AppKeyPress): string | undefined {
  const key = keyOfPress(press);
  if (key === undefined) {
    return undefined;
  }
  const parts: string[] = [];
  if (press.metaKey || press.ctrlKey) {
    parts.push('Mod');
  }
  if (press.altKey) {
    parts.push('Alt');
  }
  if (press.shiftKey) {
    parts.push('Shift');
  }
  parts.push(key);
  return parts.join('+');
}

export function forwardedShortcutOf(press: AppKeyPress): AppShortcut | undefined {
  const shortcut = shortcutOfPress(press);
  return shortcut === undefined ? undefined : APP_FORWARDED_KEYS[shortcut];
}

export function isReservedShortcut(shortcut: string): shortcut is AppReservedShortcut {
  return APP_RESERVED_SHORTCUTS.some((reserved) => reserved === shortcut);
}

export function parseShortcut(input: unknown): string {
  const raw = text(input);
  if (raw.length === 0 || raw.length > APP_SHORTCUT_LIMITS.shortcutCharsMax) {
    throw new Error(`A shortcut is 1 to ${APP_SHORTCUT_LIMITS.shortcutCharsMax} characters, like "Mod+Shift+1"`);
  }
  const parts = raw.split('+').map((part) => part.trim());
  const key = parts.at(-1) ?? '';
  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.find((name) => name.toLowerCase() === part.toLowerCase());
    if (modifier === undefined) {
      throw new Error(`"${part.slice(0, 20)}" is not a modifier: use Mod, Alt or Shift`);
    }
    modifiers.add(modifier);
  }
  const named = NAMED_KEYS.find((name) => name.toLowerCase() === key.toLowerCase());
  const canonicalKey = named ?? (/^[A-Za-z0-9]$/.test(key) ? key.toUpperCase() : undefined);
  if (canonicalKey === undefined) {
    throw new Error(`"${key.slice(0, 20)}" is not a key: use a letter, a digit or ${NAMED_KEYS.join(', ')}`);
  }
  const shortcut = [...MODIFIERS.filter((name) => modifiers.has(name)), canonicalKey].join('+');
  assert(shortcut.length <= APP_SHORTCUT_LIMITS.shortcutCharsMax + 8, 'A canonical shortcut stays short');
  return shortcut;
}

export function parseCommandShortcut(input: unknown): AppReservedShortcut {
  const shortcut = parseShortcut(input);
  if (!isReservedShortcut(shortcut)) {
    throw new Error(`App command shortcuts are ${APP_RESERVED_SHORTCUTS.join(', ')} (Mod is ⌘ on macOS, Ctrl elsewhere); "${shortcut}" is Stacki's`);
  }
  return shortcut;
}

export function parseShortcutClaims(input: unknown): readonly string[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('shortcutClaims must be a list of shortcuts');
  }
  if (items.length > APP_SHORTCUT_LIMITS.claimsMax) {
    throw new Error(`An app claims at most ${APP_SHORTCUT_LIMITS.claimsMax} shortcuts`);
  }
  return [...new Set(items.map(parseShortcut))];
}

export interface AppCommand {
  readonly id: string;
  readonly title: string;
  readonly shortcut: AppReservedShortcut | undefined;
  readonly panel: string | undefined;
}

export function parseAppCommand(input: unknown): AppCommand {
  const value = record(input);
  const id = text(value['id']);
  if (!new RegExp(`^[a-z0-9][a-z0-9._-]{0,${APP_SHORTCUT_LIMITS.commandIdCharsMax - 1}}$`).test(id)) {
    throw new Error('A command id is lowercase letters, digits, dots, dashes and underscores');
  }
  const title = text(value['title']).trim();
  if (title.length === 0 || title.length > APP_SHORTCUT_LIMITS.commandTitleCharsMax) {
    throw new Error(`A command title is 1 to ${APP_SHORTCUT_LIMITS.commandTitleCharsMax} characters`);
  }
  const panelInput = value['panel'];
  let panel: string | undefined;
  if (panelInput !== undefined) {
    panel = text(panelInput);
    if (!new RegExp(`^[A-Za-z0-9_.:/-]{1,${APP_SHORTCUT_LIMITS.commandPanelCharsMax}}$`).test(panel)) {
      throw new Error('A command panel is letters, digits and _.:/-');
    }
  }
  const shortcutInput = value['shortcut'];
  return { id, title, shortcut: shortcutInput === undefined ? undefined : parseCommandShortcut(shortcutInput), panel };
}

export function parseAppCommands(input: unknown): readonly AppCommand[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('commands must be a list');
  }
  if (items.length > APP_SHORTCUT_LIMITS.commandsMax) {
    throw new Error(`An app declares at most ${APP_SHORTCUT_LIMITS.commandsMax} commands`);
  }
  const commands = items.map(parseAppCommand);
  if (new Set(commands.map((command) => command.id)).size !== commands.length) {
    throw new Error('Command ids are unique within an app');
  }
  const shortcuts = commands.flatMap((command) => (command.shortcut === undefined ? [] : [command.shortcut]));
  if (new Set(shortcuts).size !== shortcuts.length) {
    throw new Error('Two commands of one app share a shortcut');
  }
  return commands;
}

export function shortcutLabel(shortcut: string, platform: 'mac' | 'other'): string {
  const parts = shortcut.split('+');
  if (platform === 'mac') {
    const symbols: Readonly<Record<string, string>> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
    return parts.map((part) => symbols[part] ?? part).join('');
  }
  return parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)).join('+');
}

function keyOfPress(press: AppKeyPress): string | undefined {
  const letter = /^Key([A-Z])$/.exec(press.code);
  if (letter?.[1] !== undefined) {
    return letter[1];
  }
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(press.code);
  if (digit?.[1] !== undefined) {
    return digit[1];
  }
  if (press.key === ' ') {
    return 'Space';
  }
  const named = NAMED_KEYS.find((name) => name === press.key);
  if (named !== undefined) {
    return named;
  }
  return /^[A-Za-z0-9]$/.test(press.key) ? press.key.toUpperCase() : undefined;
}
