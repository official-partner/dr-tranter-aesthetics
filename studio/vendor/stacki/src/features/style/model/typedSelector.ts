
import { assert } from '../../../../shared/core/assert';
import { HTML_TAGS } from '../../../editor/elementSchemas';

const OTHER_TAGS = [
  'body',
  'circle',
  'defs',
  'ellipse',
  'g',
  'head',
  'html',
  'line',
  'math',
  'path',
  'polygon',
  'polyline',
  'rect',
  'slot',
  'svg',
  'symbol',
  'text',
  'tspan',
  'use',
] as const;

const TAG_NAMES: ReadonlySet<string> = new Set([...HTML_TAGS, ...OTHER_TAGS]);

const LEADING_NAME = /^(-?[A-Za-z_][A-Za-z0-9_-]*)(?=$|[.:#[\s>+~])/;

export function typedSelectorText(text: string, elementTag: string | undefined): string {
  const trimmed = text.trim();
  const name = LEADING_NAME.exec(trimmed)?.[1];
  if (name === undefined) {
    return trimmed;
  }
  const lower = name.toLowerCase();
  if (TAG_NAMES.has(lower)) {
    return trimmed;
  }
  if (elementTag !== undefined && elementTag.toLowerCase() === lower) {
    return trimmed;
  }
  const selector = `.${trimmed}`;
  assert(selector.startsWith(`.${name}`), 'typedSelectorText: the class is the name that was typed');
  return selector;
}
