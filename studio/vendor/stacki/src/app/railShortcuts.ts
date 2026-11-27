import type { SettingsViewId } from '../lib/settingsSections';

export type RailAction =
  | 'elements'
  | 'pages'
  | 'navigator'
  | 'properties'
  | 'components'
  | 'assets'
  | 'cms'
  | 'variables'
  | 'selectors'
  | 'code'
  | 'files'
  | 'history'
  | 'apps'
  | 'audits'
  | 'projectSettings'
  | 'ai'
  | Exclude<SettingsViewId, 'roles'>;

export interface RailShortcut {
  readonly action: RailAction;
  readonly letter: string;
  readonly alt: boolean;
  readonly shift: boolean;
}

export const RAIL_SHORTCUTS: readonly RailShortcut[] = [
  { action: 'elements', letter: 'e', alt: true, shift: false },
  { action: 'pages', letter: 'p', alt: true, shift: false },
  { action: 'navigator', letter: 'n', alt: true, shift: false },
  { action: 'assets', letter: 'k', alt: true, shift: false },
  { action: 'cms', letter: 'd', alt: true, shift: false },
  { action: 'variables', letter: 'v', alt: true, shift: false },
  { action: 'history', letter: 'g', alt: true, shift: false },
  { action: 'components', letter: 'c', alt: true, shift: false },
  { action: 'properties', letter: 'k', alt: false, shift: false },
  { action: 'apps', letter: 'b', alt: true, shift: false },
  { action: 'code', letter: 'o', alt: true, shift: false },
  { action: 'files', letter: 'f', alt: true, shift: false },
  { action: 'selectors', letter: 's', alt: true, shift: false },
  { action: 'audits', letter: 'u', alt: true, shift: false },
  { action: 'projectSettings', letter: 'z', alt: true, shift: false },
  { action: 'ai', letter: 'a', alt: true, shift: false },
  { action: 'secrets', letter: 'r', alt: true, shift: false },
  { action: 'mcp', letter: 'm', alt: true, shift: false },
  { action: 'instructions', letter: 'i', alt: true, shift: false },
  { action: 'agents', letter: 'q', alt: true, shift: false },
];

export const PREVIEW_SHORTCUT = { letter: 'p', alt: true, shift: true } as const satisfies Omit<RailShortcut, 'action'>;

export const PULL_SHORTCUT = { letter: 'g', alt: true, shift: true } as const satisfies Omit<RailShortcut, 'action'>;

export function isPullChord(event: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'code'>): boolean {
  if (event.metaKey || event.ctrlKey) {
    return false;
  }
  if (!event.altKey || !event.shiftKey) {
    return false;
  }
  return event.code === `Key${PULL_SHORTCUT.letter.toUpperCase()}`;
}

export function railShortcutLabel(shortcut: Omit<RailShortcut, 'action'>): string {
  return `${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.letter.toUpperCase()}`;
}

export function shortcutOf(action: RailAction): string {
  const found = RAIL_SHORTCUTS.find((shortcut) => shortcut.action === action);
  if (found === undefined) {
    throw new Error(`No rail shortcut for ${action}`);
  }
  return railShortcutLabel(found);
}

export function railActionOf(event: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'key' | 'code'>): RailShortcut | undefined {
  if (event.metaKey || event.ctrlKey) {
    return undefined;
  }
  return RAIL_SHORTCUTS.find((shortcut) => {
    if (shortcut.alt !== event.altKey) {
      return false;
    }
    if (shortcut.alt) {
      return !event.shiftKey && event.code === `Key${shortcut.letter.toUpperCase()}`;
    }
    return shortcut.shift === event.shiftKey && event.key.toLowerCase() === shortcut.letter;
  });
}
