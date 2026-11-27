import type { ReactNode } from 'react';
import { assert } from '../../../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../lib/i18n/localeContext';
import { clipOptions } from '../BackgroundSection';
import { DISPLAY_VALUES, displayMenuLabel } from '../DisplayControl';
import { BLEND_MODES, cursorOptions, eventsOptions, outlineOptions } from '../EffectsKit';
import { FIT_OPTIONS } from '../ObjectFitFields';
import { POSITION_PRESETS } from '../PositionSection';
import { clearSegments, floatSegments, type Seg } from '../PositionSegments';
import type { SegOption } from '../SegmentedField';
import { BOX_OPTIONS, OVERFLOW_SEGS } from '../SizeSection';
import { TEXT_OVERFLOW_OPTIONS, WHITE_SPACE, WORD_BREAK, WRAP_OPTIONS } from '../TextWrapRows';
import { alignSegments, decorSegments, directionSegments, italicSegments, transformSegments } from '../TypographySection';
import type { SelectOption } from '../components/selectTypes';


export interface KeywordOption {
  readonly value: string;
  readonly text: string;
  readonly icon: ReactNode | undefined;
}

interface KeywordProperty {
  readonly options: (translate: Translator) => readonly KeywordOption[];
  readonly segments: (options: readonly KeywordOption[]) => readonly string[];
}

export const KEYWORD_SEGMENTS_MAX = 5;

const allWhenShort = (options: readonly KeywordOption[]): readonly string[] =>
  options.length <= KEYWORD_SEGMENTS_MAX ? options.map((option) => option.value) : [];


function fromSegs(segs: readonly Seg[]): readonly KeywordOption[] {
  return segs.map((seg) => ({ value: seg.value, text: seg.label, icon: seg.icon }));
}

function fromSegOptions(options: readonly SegOption[]): readonly KeywordOption[] {
  return options.map((option) => ({ value: option.value, text: option.menuLabel, icon: typeof option.label === 'string' ? undefined : option.label }));
}

function fromSelect(options: readonly SelectOption<string>[]): readonly KeywordOption[] {
  return options.filter((option) => option.heading !== true).map((option) => ({ value: option.value, text: option.label, icon: option.icon }));
}

function fromPairs(pairs: ReadonlyArray<readonly [string, string]>): readonly KeywordOption[] {
  return pairs.map(([value, text]) => ({ value, text, icon: undefined }));
}

function fromKeyed(
  options: ReadonlyArray<{ readonly value: string; readonly icon?: ReactNode; readonly labelKey: Parameters<Translator>[0] }>,
  translate: Translator,
): readonly KeywordOption[] {
  return options.map((option) => ({ value: option.value, text: translate(option.labelKey), icon: option.icon }));
}


const overflow: KeywordProperty = { options: (translate) => fromKeyed(OVERFLOW_SEGS, translate), segments: allWhenShort };

export const KEYWORD_PROPERTIES = {
  display: {
    options: () => DISPLAY_VALUES.map((value) => ({ value, text: displayMenuLabel(value), icon: undefined })),
    segments: () => ['block', 'flex', 'grid', 'none'],
  },
  overflow,
  'overflow-x': overflow,
  'overflow-y': overflow,
  'box-sizing': { options: (translate) => fromKeyed(BOX_OPTIONS, translate), segments: allWhenShort },
  'object-fit': { options: () => fromSelect(FIT_OPTIONS), segments: allWhenShort },
  position: { options: () => POSITION_PRESETS.map((preset) => ({ value: preset.value, text: preset.label, icon: preset.icon })), segments: allWhenShort },
  float: { options: (translate) => fromSegs(floatSegments(translate)), segments: allWhenShort },
  clear: { options: (translate) => fromSegs(clearSegments(translate)), segments: allWhenShort },
  'text-align': { options: (translate) => fromSegs(alignSegments(translate)), segments: allWhenShort },
  'text-decoration': { options: (translate) => fromSegs(decorSegments(translate)), segments: allWhenShort },
  'font-style': { options: (translate) => fromSegs(italicSegments(translate)), segments: allWhenShort },
  'text-transform': { options: (translate) => fromSegs(transformSegments(translate)), segments: allWhenShort },
  direction: { options: (translate) => fromSegs(directionSegments(translate)), segments: allWhenShort },
  'word-break': { options: () => fromPairs(WORD_BREAK.options), segments: allWhenShort },
  'white-space': { options: () => fromPairs(WHITE_SPACE.options), segments: allWhenShort },
  'text-overflow': {
    options: () => TEXT_OVERFLOW_OPTIONS.map((option) => ({ value: option.value, text: option.label, icon: undefined })),
    segments: allWhenShort,
  },
  'overflow-wrap': { options: () => fromPairs(WRAP_OPTIONS), segments: allWhenShort },
  'background-clip': {
    options: (translate) => clipOptions(translate).map((option) => ({ value: option.value, text: option.label, icon: undefined })),
    segments: allWhenShort,
  },
  'mix-blend-mode': { options: () => fromSelect(BLEND_MODES), segments: allWhenShort },
  'outline-style': { options: (translate) => fromSegOptions(outlineOptions(translate)), segments: allWhenShort },
  cursor: { options: (translate) => fromSelect(cursorOptions(translate)), segments: allWhenShort },
  'pointer-events': { options: (translate) => fromSegOptions(eventsOptions(translate)), segments: allWhenShort },
} as const satisfies Record<string, KeywordProperty>;

export type KeywordPropertyName = keyof typeof KEYWORD_PROPERTIES;

const KEYWORD_NAMES: ReadonlySet<string> = new Set(Object.keys(KEYWORD_PROPERTIES));

export function isKeywordProperty(property: string): property is KeywordPropertyName {
  return KEYWORD_NAMES.has(property);
}

const KEYWORD_VALUES = new Map<string, ReadonlySet<string>>();
function valuesOf(property: KeywordPropertyName): ReadonlySet<string> {
  const known = KEYWORD_VALUES.get(property);
  if (known !== undefined) {
    return known;
  }
  const values = new Set(KEYWORD_PROPERTIES[property].options(ENGLISH_TRANSLATE).map((option) => option.value.toLowerCase()));
  assert(values.size > 0, 'valuesOf: a keyword property has options');
  KEYWORD_VALUES.set(property, values);
  return values;
}

export function isKeywordOf(property: KeywordPropertyName, value: string): boolean {
  return valuesOf(property).has(value.trim().toLowerCase());
}

export function keywordChoices(
  property: KeywordPropertyName,
  translate: Translator,
): { readonly segments: readonly KeywordOption[]; readonly list: readonly KeywordOption[] } {
  const entry: KeywordProperty = KEYWORD_PROPERTIES[property];
  const options = entry.options(translate);
  const segmentValues = new Set(entry.segments(options));
  const segments = options.filter((option) => segmentValues.has(option.value));
  const list = options.filter((option) => !segmentValues.has(option.value));
  assert(segments.length + list.length === options.length, 'keywordChoices: every option is drawn once');
  assert(segments.length <= KEYWORD_SEGMENTS_MAX, 'keywordChoices: the button group fits the popover');
  return { segments, list };
}

export function keywordOption(property: KeywordPropertyName, value: string, translate: Translator): KeywordOption | undefined {
  const lower = value.trim().toLowerCase();
  return KEYWORD_PROPERTIES[property].options(translate).find((option) => option.value.toLowerCase() === lower);
}
