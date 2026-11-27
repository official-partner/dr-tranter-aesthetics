
import {
  DEFAULT_NEW_STYLE_LOCATIONS,
  effectiveLocation,
  fileRuleWrappers,
  sameNewStyleLocations,
  type NewStyleLocation,
  type NewStyleLocations,
  type NewStyleScope,
} from '../../../../shared/properties/newStyleLocations';
import { templateFrame, type NewStyleTagSettings, type TemplateFrame, type TemplateWrapper } from '../../../../shared/properties/newStyleTag';
import { getHost } from './host';

let current: NewStyleLocations = DEFAULT_NEW_STYLE_LOCATIONS;
const listeners = new Set<() => void>();

export function getNewStyleLocations(): NewStyleLocations {
  return current;
}

export function publishNewStyleLocations(next: NewStyleLocations): void {
  if (sameNewStyleLocations(next, current)) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function onNewStyleLocations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openStyleScope(): NewStyleScope {
  return getHost().openFileKind === 'component' ? 'component' : 'page';
}

export function getNewStyleLocation(scope: NewStyleScope = openStyleScope()): NewStyleLocation {
  return current[scope];
}

export function getNewStyleTagSettings(scope: NewStyleScope = openStyleScope()): NewStyleTagSettings {
  return current[scope].tag;
}

export function newStyleFileOf(scope: NewStyleScope, rels: readonly string[]): string | undefined {
  const place = effectiveLocation(current[scope], rels);
  return place.kind === 'file' ? place.path : undefined;
}

export function newStyleTagFrame(settings: NewStyleTagSettings = getNewStyleTagSettings()): TemplateFrame {
  const result = templateFrame(settings.content);
  if (!result.ok) {
    throw new Error(`Assertion failed: the stored new style tag template parses (${result.error.code})`);
  }
  return result.frame;
}

export function newRuleWrappers(source: { readonly origin: { readonly kind: string }; readonly label: string }, code: string): readonly TemplateWrapper[] {
  if (source.origin.kind === 'node') {
    return newStyleTagFrame().wrappers;
  }
  if (source.origin.kind !== 'file') {
    return [];
  }
  const chosen = newStyleFileOf(
    openStyleScope(),
    getHost().files.map((file) => file.rel),
  );
  return chosen !== undefined && chosen === source.label ? fileRuleWrappers(code) : [];
}
