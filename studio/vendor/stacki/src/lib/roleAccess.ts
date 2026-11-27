import { assert } from '../../shared/core/assert';
import { ACCESS_FEATURES, can, type AccessFeature, type RoleView } from '../../shared/properties/projectRoles';
import type { SettingsViewId } from './settingsSections';

export function panelFeature(id: string): AccessFeature | undefined {
  assert(id.length > 0, 'A panel id is never empty');
  if (id === 'files') {
    return 'code:edit';
  }
  const feature = ACCESS_FEATURES.find((item) => item === `panel:${id}`);
  assert(feature === undefined || feature.startsWith('panel:'), 'A panel feature is a panel');
  return feature;
}

export function canPanel(role: RoleView, id: string): boolean {
  const feature = panelFeature(id);
  return feature === undefined ? true : can(role, feature);
}

export function canSettingsTab(role: RoleView, tab: string): boolean {
  assert(tab.length > 0, 'A settings tab id is never empty');
  if (tab === 'roles') {
    return true;
  }
  const feature = ACCESS_FEATURES.find((item) => item === `settings:${tab}`);
  return feature === undefined ? true : can(role, feature);
}

export function settingsViewsOf(role: RoleView): readonly SettingsViewId[] {
  const project: readonly SettingsViewId[] = can(role, 'panel:projectSettings') ? ['secrets', 'mcp'] : [];
  const instructions: readonly SettingsViewId[] = can(role, 'panel:instructions') ? ['instructions', 'agents'] : [];
  return [...project, ...instructions];
}

export function canSettingsPanel(role: RoleView): boolean {
  return settingsViewsOf(role).length > 0;
}

export function canRailTab(role: RoleView, id: string): boolean {
  return id === 'projectSettings' ? canSettingsPanel(role) : canPanel(role, id);
}
