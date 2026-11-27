
import { assert } from '../../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import { NUMBER_DECIMALS_MAX, readPropDocumentation, type NumberSettings } from '../../editor/propDocumentation';

export const SETTING_TAG_NAMES = ['min', 'max', 'decimals', 'format'] as const;
export type SettingTagName = (typeof SETTING_TAG_NAMES)[number];
export const LEGACY_TAG_NAMES = ['onLabel', 'offLabel'] as const;

const LINES_MAX = 1024;
const TAG_LINE = new RegExp(`^\\s*@(${[...SETTING_TAG_NAMES, ...LEGACY_TAG_NAMES].join('|')})\\b`);
const LEGACY_TAG_LINE = new RegExp(`^\\s*@(${LEGACY_TAG_NAMES.join('|')})\\b`);

export function tooltipOf(description: string): string {
  const lines = descriptionLines(description);
  return lines.filter((line) => !TAG_LINE.test(line)).join('\n');
}

export function withTooltip(description: string, tooltip: string): string {
  assert(tooltip.length <= PROPERTY_LIMITS.textCharsMax, 'withTooltip: the tooltip is bounded');
  const tags = descriptionLines(description).filter((line) => TAG_LINE.test(line));
  const out = tags.length === 0 ? tooltip : tooltip === '' ? tags.join('\n') : `${tooltip}\n${tags.join('\n')}`;
  assert(
    tooltipOf(out) ===
      tooltip
        .split('\n')
        .filter((line) => !TAG_LINE.test(line))
        .join('\n'),
    'withTooltip: the tooltip reads back',
  );
  return out;
}

export function tagValue(description: string, name: SettingTagName): string | undefined {
  const line = descriptionLines(description).find((item) => tagName(item) === name);
  return line === undefined
    ? undefined
    : line
        .trim()
        .slice(name.length + 1)
        .trim();
}

export function withTag(description: string, name: SettingTagName, value: string | undefined): string {
  const text = value?.replace(/\s+/g, ' ').trim();
  assert(text === undefined || text.length <= PROPERTY_LIMITS.textCharsMax, 'withTag: the value is bounded');
  const lines = descriptionLines(description);
  const at = lines.findIndex((line) => tagName(line) === name);
  const written = text === undefined || text === '' ? undefined : `@${name} ${text}`;
  let next: readonly string[];
  if (at >= 0) {
    next = written === undefined ? lines.filter((_, index) => index !== at) : lines.map((line, index) => (index === at ? written : line));
  } else {
    next = written === undefined ? lines : [...lines, written];
  }
  const out = next.join('\n').replace(/^\n+/, '');
  assert(tagValue(out, name) === (written === undefined ? undefined : text), 'withTag: the tag reads back');
  return out;
}

export function numberSettingsOf(description: string): NumberSettings {
  return readPropDocumentation(description).number;
}

export function legacyTagsOf(description: string): readonly string[] {
  return descriptionLines(description).filter((line) => LEGACY_TAG_LINE.test(line));
}

export function withoutLegacyTags(description: string): string {
  const out = descriptionLines(description)
    .filter((line) => !LEGACY_TAG_LINE.test(line))
    .join('\n');
  assert(legacyTagsOf(out).length === 0, 'withoutLegacyTags: no legacy tag remains');
  assert(tooltipOf(out) === tooltipOf(description), 'withoutLegacyTags: the tooltip is unchanged');
  return out;
}

export function numberSettingProblem(settings: NumberSettings, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (settings.min !== undefined && settings.max !== undefined && settings.min > settings.max) {
    return translate('componentProps.problem.minAboveMax');
  }
  if (settings.decimals !== undefined) {
    if (!Number.isSafeInteger(settings.decimals)) {
      return translate('componentProps.problem.decimalsWhole');
    }
    if (settings.decimals < 0 || settings.decimals > NUMBER_DECIMALS_MAX) {
      return translate('componentProps.problem.decimalsRange', { max: NUMBER_DECIMALS_MAX });
    }
  }
  return undefined;
}

function tagName(line: string): SettingTagName | undefined {
  const match = TAG_LINE.exec(line);
  const name = match?.[1];
  return SETTING_TAG_NAMES.find((item) => item === name);
}

function descriptionLines(description: string): readonly string[] {
  assert(description.length <= PROPERTY_LIMITS.textCharsMax, 'descriptionLines: the description is bounded');
  const lines = description.split('\n');
  assert(lines.length <= LINES_MAX, 'descriptionLines: the line count is bounded');
  return lines;
}
