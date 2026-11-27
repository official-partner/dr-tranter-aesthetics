
import { assert } from '../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import { PROP_TAG_LIMITS, deprecationOf, readPropTags, withoutSettingTags } from '../../shared/properties/propTags';

export { deprecationOf, withoutSettingTags };

export interface NumberSettings {
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly decimals: number | undefined;
}

export interface PropDocumentation {
  readonly tooltip: string;
  readonly number: NumberSettings;
  readonly format: string | undefined;
  readonly deprecated: string | undefined;
}

export const NUMBER_DECIMALS_MAX = PROP_TAG_LIMITS.decimalsMax;

export function readPropDocumentation(documentation: string | undefined): PropDocumentation {
  const tags = readPropTags(documentation);
  const result: PropDocumentation = {
    tooltip: tags.tooltip,
    number: { min: tags.min, max: tags.max, decimals: tags.decimals },
    format: tags.format,
    deprecated: tags.deprecated,
  };
  assert(
    result.number.min === undefined || result.number.max === undefined || result.number.min <= result.number.max,
    'readPropDocumentation: the range is ordered',
  );
  return result;
}

export function settledNumber(value: number, settings: NumberSettings): number {
  assert(Number.isFinite(value), 'settledNumber: the value is a number');
  let out = value;
  if (settings.min !== undefined && out < settings.min) {
    out = settings.min;
  }
  if (settings.max !== undefined && out > settings.max) {
    out = settings.max;
  }
  if (settings.decimals !== undefined) {
    out = Number(out.toFixed(settings.decimals));
  }
  assert(Number.isFinite(out), 'settledNumber: the result is a number');
  return out;
}

export function numberNote(value: number, settings: NumberSettings, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (!Number.isFinite(value)) {
    return translate('editor.propDocumentation.enterNumber');
  }
  if (settings.min !== undefined && value < settings.min) {
    return translate('editor.propDocumentation.least', { min: settings.min });
  }
  if (settings.max !== undefined && value > settings.max) {
    return translate('editor.propDocumentation.most', { max: settings.max });
  }
  if (settings.decimals !== undefined && Number(value.toFixed(settings.decimals)) !== value) {
    return settings.decimals === 0
      ? translate('editor.propDocumentation.wholeNumbers')
      : translate('editor.propDocumentation.decimals', { count: settings.decimals });
  }
  return undefined;
}

const DEPRECATED_LINE = /(?<=^|\s)@deprecated\b[^@]*/g;

export function fieldTooltip(documentation: string | undefined, deprecated: string | undefined, translate: Translator = ENGLISH_TRANSLATE): string {
  const words = withoutSettingTags(documentation ?? '')
    .replace(DEPRECATED_LINE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (deprecated === undefined) {
    return words;
  }
  const notice =
    deprecated === '' ? translate('editor.propDocumentation.deprecated') : translate('editor.propDocumentation.deprecatedNote', { note: deprecated });
  const out = words === '' ? notice : `${notice}\n${words}`;
  assert(out.startsWith(notice), 'fieldTooltip: a deprecation leads the tooltip');
  return out;
}
