import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import {
  DEFAULT_NEW_STYLE_TAG,
  NEW_STYLE_TAG_RULES_TOKEN,
  newStyleTagDocument,
  parseNewStyleTag,
  sameNewStyleTag,
  templateFrame,
  type NewStyleTagSettings,
  type TemplateWrapper,
} from './newStyleTag';

export const NEW_STYLE_LOCATION_LIMITS = {
  pathCharsMax: 512,
  pathSegmentsMax: 32,
} as const satisfies Record<string, number>;

export const NEW_STYLE_SCOPES = ['page', 'component'] as const;
export type NewStyleScope = (typeof NEW_STYLE_SCOPES)[number];

export type NewStyleLocation =
  { readonly kind: 'tag'; readonly tag: NewStyleTagSettings } | { readonly kind: 'file'; readonly path: string; readonly tag: NewStyleTagSettings };

export interface NewStyleLocations {
  readonly page: NewStyleLocation;
  readonly component: NewStyleLocation;
}

export const DEFAULT_NEW_STYLE_LOCATIONS: NewStyleLocations = {
  page: { kind: 'tag', tag: DEFAULT_NEW_STYLE_TAG },
  component: { kind: 'tag', tag: DEFAULT_NEW_STYLE_TAG },
};

export function locationsOfLegacy(tag: NewStyleTagSettings): NewStyleLocations {
  return { page: { kind: 'tag', tag }, component: { kind: 'tag', tag } };
}

export function withFile(location: NewStyleLocation, path: string): NewStyleLocation {
  return { kind: 'file', path, tag: location.tag };
}

export function withTag(location: NewStyleLocation): NewStyleLocation {
  return { kind: 'tag', tag: location.tag };
}

export function withTagSettings(location: NewStyleLocation, tag: NewStyleTagSettings): NewStyleLocation {
  return location.kind === 'file' ? { kind: 'file', path: location.path, tag } : { kind: 'tag', tag };
}

const STYLESHEET_EXTENSION = /\.(css|scss|sass|less)$/i;

export function isStylesheetPath(value: string): boolean {
  if (value.length === 0 || value.length > NEW_STYLE_LOCATION_LIMITS.pathCharsMax) {
    return false;
  }
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  if (!STYLESHEET_EXTENSION.test(value)) {
    return false;
  }
  const segments = value.split('/');
  if (segments.length > NEW_STYLE_LOCATION_LIMITS.pathSegmentsMax) {
    return false;
  }
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function parseNewStyleLocations(input: unknown): NewStyleLocations {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Unsupported newStyleLocations version');
  }
  return { page: parseLocation(value['page'], 'page'), component: parseLocation(value['component'], 'component') };
}

function parseLocation(input: unknown, scope: NewStyleScope): NewStyleLocation {
  if (input === undefined) {
    return DEFAULT_NEW_STYLE_LOCATIONS[scope];
  }
  const value = record(input);
  const tag = value['tag'] === undefined ? DEFAULT_NEW_STYLE_TAG : parseNewStyleTag(value['tag']);
  const use = value['use'] === undefined ? 'tag' : text(value['use']);
  if (use === 'tag') {
    if (value['file'] !== undefined) {
      throw new Error(`newStyleLocations.${scope}.file: only written when use is "file"`);
    }
    return { kind: 'tag', tag };
  }
  if (use !== 'file') {
    throw new Error(`newStyleLocations.${scope}.use: expected "tag" or "file"`);
  }
  const path = text(value['file']);
  if (!isStylesheetPath(path)) {
    throw new Error(`newStyleLocations.${scope}.file: expected a project-relative stylesheet path such as src/styles/global.css`);
  }
  return { kind: 'file', path, tag };
}

export function newStyleLocationsDocument(locations: NewStyleLocations): Record<string, unknown> {
  const document = { version: 1, page: locationDocument(locations.page), component: locationDocument(locations.component) };
  assert(sameNewStyleLocations(parseNewStyleLocations(document), locations), 'newStyleLocationsDocument: the section reads back');
  return document;
}

function locationDocument(location: NewStyleLocation): Record<string, unknown> {
  const tag = newStyleTagDocument(location.tag);
  return location.kind === 'file' ? { use: 'file', file: location.path, tag } : { use: 'tag', tag };
}

export function sameNewStyleLocation(left: NewStyleLocation, right: NewStyleLocation): boolean {
  if (!sameNewStyleTag(left.tag, right.tag)) {
    return false;
  }
  if (left.kind === 'file') {
    return right.kind === 'file' && right.path === left.path;
  }
  return right.kind === 'tag';
}

export function sameNewStyleLocations(left: NewStyleLocations, right: NewStyleLocations): boolean {
  return sameNewStyleLocation(left.page, right.page) && sameNewStyleLocation(left.component, right.component);
}

export function stylesheetChoices(rels: readonly string[]): readonly string[] {
  const choices = rels.filter(isStylesheetPath);
  assert(choices.length <= rels.length, 'stylesheetChoices: filtering never adds a path');
  return choices;
}

export type LocationHealth = { readonly kind: 'ready' } | { readonly kind: 'missing'; readonly path: string };

export function locationHealth(location: NewStyleLocation, rels: readonly string[]): LocationHealth {
  if (location.kind === 'tag') {
    return { kind: 'ready' };
  }
  return rels.includes(location.path) ? { kind: 'ready' } : { kind: 'missing', path: location.path };
}

export function effectiveLocation(
  location: NewStyleLocation,
  rels: readonly string[],
): { readonly kind: 'tag'; readonly tag: NewStyleTagSettings } | { readonly kind: 'file'; readonly path: string } {
  if (location.kind === 'file' && rels.includes(location.path)) {
    return { kind: 'file', path: location.path };
  }
  return { kind: 'tag', tag: location.tag };
}

export function fileRuleWrappers(css: string): readonly TemplateWrapper[] {
  const frame = templateFrame(css);
  if (!frame.ok) {
    return [];
  }
  if (css.includes(NEW_STYLE_TAG_RULES_TOKEN)) {
    return frame.frame.wrappers;
  }
  const wrappers = frame.frame.wrappers;
  const only = wrappers[0];
  if (wrappers.length === 1 && only !== undefined && only.name === 'layer') {
    return wrappers;
  }
  return [];
}
