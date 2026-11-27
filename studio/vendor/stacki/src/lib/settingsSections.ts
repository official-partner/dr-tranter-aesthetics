import { assert } from '../../shared/core/assert';
import type { MessageKey } from './i18n/localeContext';
import { loadProjectPreference, saveProjectPreference, type PreferenceStorage, type ProjectPreferenceSpec } from './projectPreference';

export const SETTINGS_VIEW_IDS = ['secrets', 'mcp', 'instructions', 'agents', 'roles'] as const;
export type SettingsViewId = (typeof SETTINGS_VIEW_IDS)[number];

export const SETTINGS_VIEW_TITLE_KEYS: Readonly<Record<SettingsViewId, MessageKey>> = {
  secrets: 'settings.section.secrets',
  mcp: 'settings.section.mcp',
  instructions: 'settings.section.instructions',
  agents: 'settings.section.agents',
  roles: 'roles.studio.title',
};

export const SETTINGS_SECTION_IDS = ['skills', 'rules', 'docs'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const SETTINGS_SECTION_TITLE_KEYS: Readonly<Record<SettingsSectionId, MessageKey>> = {
  skills: 'instructionsPanel.skills.title',
  rules: 'instructionsPanel.rules.title',
  docs: 'instructionsPanel.docs.title',
};

export function sectionsOfView(view: SettingsViewId): readonly SettingsSectionId[] {
  return view === 'instructions' ? SETTINGS_SECTION_IDS : [];
}

export type SettingsFocusTarget = SettingsViewId | SettingsSectionId;

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTION_IDS.some((id) => id === value);
}

export function viewOfTarget(target: SettingsFocusTarget): {
  readonly view: SettingsViewId;
  readonly open: readonly SettingsSectionId[];
  readonly scrollTo: SettingsSectionId | undefined;
} {
  if (target === 'secrets' || target === 'mcp' || target === 'agents' || target === 'roles') {
    return { view: target, open: [], scrollTo: undefined };
  }
  if (target === 'instructions') {
    return { view: 'instructions', open: SETTINGS_SECTION_IDS, scrollTo: 'skills' };
  }
  return { view: 'instructions', open: [target], scrollTo: target };
}


export const SETTINGS_FOLDED_KEY = 'stacki.settingsPanel.folded';

export const SETTINGS_FOLDED_PROJECTS_MAX = 50;

export function parseFoldedSections(stored: unknown): readonly SettingsSectionId[] | undefined {
  if (!Array.isArray(stored)) {
    return undefined;
  }
  const items: readonly unknown[] = stored;
  if (items.length > SETTINGS_SECTION_IDS.length) {
    return undefined;
  }
  const folded: SettingsSectionId[] = [];
  for (const item of items) {
    if (!isSettingsSectionId(item) || folded.includes(item)) {
      return undefined;
    }
    folded.push(item);
  }
  return folded;
}

export const SETTINGS_FOLDED_SPEC: ProjectPreferenceSpec<readonly SettingsSectionId[]> = {
  storageKey: SETTINGS_FOLDED_KEY,
  projectsMax: SETTINGS_FOLDED_PROJECTS_MAX,
  parseValue: parseFoldedSections,
};

export function loadFoldedSections(project: string, storage?: PreferenceStorage): ReadonlySet<SettingsSectionId> {
  return new Set(loadProjectPreference(SETTINGS_FOLDED_SPEC, project, storage) ?? []);
}

export function saveFoldedSections(project: string, folded: ReadonlySet<SettingsSectionId>, storage?: PreferenceStorage): void {
  saveProjectPreference(
    SETTINGS_FOLDED_SPEC,
    project,
    SETTINGS_SECTION_IDS.filter((id) => folded.has(id)),
    storage,
  );
}


export interface SettingsBulkRequest {
  readonly serial: number;
  readonly mode: 'expand' | 'collapse' | undefined;
}

export interface SettingsSectionsContext {
  readonly query: string;
  readonly searching: boolean;
  readonly refreshSerial: number;
  readonly bulk: SettingsBulkRequest;
  readonly isOpen: (id: SettingsSectionId) => boolean;
  readonly toggle: (id: SettingsSectionId) => void;
  readonly open: (id: SettingsSectionId) => void;
  readonly report: (id: SettingsSectionId, matches: number | undefined) => void;
  readonly clearSearch: () => void;
}


interface FocusRequest {
  readonly target: SettingsFocusTarget;
  readonly serial: number;
}

let focusRequest: FocusRequest | undefined;
let focusSerial = 0;
const focusListeners = new Set<() => void>();
const FOCUS_LISTENERS_MAX = 8;

export function requestSettingsSection(target: SettingsFocusTarget): void {
  focusSerial += 1;
  focusRequest = { target, serial: focusSerial };
  for (const listener of focusListeners) {
    listener();
  }
}

export function takeSettingsRequest(): SettingsFocusTarget | undefined {
  const taken = focusRequest;
  focusRequest = undefined;
  return taken?.target;
}

export function settingsRequestSerial(): number {
  return focusSerial;
}

export function subscribeSettingsRequests(listener: () => void): () => void {
  assert(focusListeners.size < FOCUS_LISTENERS_MAX, 'Settings request listeners are bounded');
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}


let shownView: SettingsViewId | undefined;
const shownViewListeners = new Set<() => void>();
const SHOWN_VIEW_LISTENERS_MAX = 8;

export function publishSettingsView(view: SettingsViewId | undefined): void {
  if (shownView === view) {
    return;
  }
  shownView = view;
  for (const listener of shownViewListeners) {
    listener();
  }
}

export function shownSettingsView(): SettingsViewId | undefined {
  return shownView;
}

export function subscribeShownSettingsView(listener: () => void): () => void {
  assert(shownViewListeners.size < SHOWN_VIEW_LISTENERS_MAX, 'Shown Settings view listeners are bounded');
  shownViewListeners.add(listener);
  return () => {
    shownViewListeners.delete(listener);
  };
}
