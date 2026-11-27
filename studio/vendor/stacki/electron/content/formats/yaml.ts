
import * as YAML from 'yaml';

import { toRecord, toArray } from '../../../shared/core/record';
import { transplant } from './transplant';

const PARSE_OPTIONS = { keepSourceTokens: true };
const STRINGIFY_OPTIONS = { lineWidth: 0, flowCollectionPadding: false };

const parseData = (text: string): unknown => YAML.parse(text);

const parseDocument = (text: string): YAML.Document => YAML.parseDocument(text, PARSE_OPTIONS);

const isPrimitive = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value);

const DELETE = Symbol('delete');

export interface Edit {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly rename?: string;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  if (!edits.length) {
    return text;
  }
  const yamlDocument = parseDocument(text);
  const before = yamlDocument.toString(STRINGIFY_OPTIONS);
  for (const { path, value, rename } of edits) {
    if (rename !== undefined) {
      const parent = path.length > 1 ? yamlDocument.getIn(path.slice(0, -1), true) : yamlDocument.contents;
      const items = toArray(toRecord(parent)?.['items']);
      const pair = items?.map((item) => toRecord(item)).find((item) => toRecord(item?.['key'])?.['value'] === path[path.length - 1]);
      const pairKey = toRecord(pair?.['key']);
      if (pairKey) {
        pairKey['value'] = rename;
      }
      continue;
    }
    if (!path.length) {
      if (value === DELETE) {
        continue;
      }
      const next = parseDocument(YAML.stringify(value, STRINGIFY_OPTIONS));
      yamlDocument.contents = next.contents;
      continue;
    }
    if (value === DELETE) {
      yamlDocument.deleteIn(path);
      continue;
    }
    const node = yamlDocument.getIn(path, true);
    const nodeRecord = toRecord(node);
    const nodeValue = nodeRecord?.['value'];
    if (nodeRecord && nodeValue !== undefined && isPrimitive(value) && typeof nodeValue === typeof value) {
      nodeRecord['value'] = value;
      continue;
    }
    yamlDocument.setIn(path, value);
  }
  const after = yamlDocument.toString(STRINGIFY_OPTIONS);
  return before === text ? after : transplant(text, before, after);
}

function roundTrips(text: string): boolean {
  try {
    return parseDocument(text).toString(STRINGIFY_OPTIONS) === text;
  } catch {
    return false;
  }
}

export { parseData, parseDocument, applyEdits, roundTrips, DELETE, YAML };
