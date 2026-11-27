
export type InspectorTabId = 'style' | 'settings';

export const INSPECTOR_TAB_KEYS = { style: 'S', settings: 'D' } as const satisfies Readonly<Record<InspectorTabId, string>>;

export function inspectorTabOfKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey'>): InspectorTabId | undefined {
  if (event.altKey || event.metaKey || event.ctrlKey) {
    return undefined;
  }
  const key = event.key.toUpperCase();
  if (key === INSPECTOR_TAB_KEYS.style) {
    return 'style';
  }
  return key === INSPECTOR_TAB_KEYS.settings ? 'settings' : undefined;
}
