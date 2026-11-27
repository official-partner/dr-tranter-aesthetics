
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../../shared/properties/i18n/messageRef';
import { isShadowLength, splitTopLevelSpaces } from './background';
import { rawLayer, splitFunctionList, type RawLayer } from './rawLayer';

export type FilterType = 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'hue-rotate' | 'invert' | 'saturate' | 'sepia' | 'drop-shadow';

export type Filter = {
  type: FilterType;
  amount: string;
  x: string;
  y: string;
  blur: string;
  color: string;
};
export type FilterLayer = Filter | RawLayer;
export type FilterPatch = Pick<Filter, 'amount'> | Pick<Filter, 'x'> | Pick<Filter, 'y'> | Pick<Filter, 'blur'> | Pick<Filter, 'color'>;

export type FilterControl = 'amount' | 'angle' | 'shadow';
export const FILTER_META: Record<
  FilterType,
  { label: string; labelKey: MessageKey; unit: string; min: number; max: number; control: FilterControl; def: string }
> = {
  blur: { label: 'Blur', labelKey: 'styleModel.filter.type.blur', unit: 'px', min: 0, max: 100, control: 'amount', def: '4px' },
  brightness: { label: 'Brightness', labelKey: 'styleModel.filter.type.brightness', unit: '%', min: 0, max: 200, control: 'amount', def: '100%' },
  contrast: { label: 'Contrast', labelKey: 'styleModel.filter.type.contrast', unit: '%', min: 0, max: 200, control: 'amount', def: '100%' },
  saturate: { label: 'Saturation', labelKey: 'styleModel.filter.type.saturate', unit: '%', min: 0, max: 200, control: 'amount', def: '100%' },
  grayscale: { label: 'Grayscale', labelKey: 'styleModel.filter.type.grayscale', unit: '%', min: 0, max: 100, control: 'amount', def: '100%' },
  invert: { label: 'Invert', labelKey: 'styleModel.filter.type.invert', unit: '%', min: 0, max: 100, control: 'amount', def: '100%' },
  sepia: { label: 'Sepia', labelKey: 'styleModel.filter.type.sepia', unit: '%', min: 0, max: 100, control: 'amount', def: '100%' },
  'hue-rotate': {
    label: 'Hue rotate',
    labelKey: 'styleModel.filter.type.hueRotate',
    unit: 'deg',
    min: 0,
    max: 360,
    control: 'angle',
    def: '0deg',
  },
  'drop-shadow': { label: 'Drop shadow', labelKey: 'styleModel.filter.type.dropShadow', unit: 'px', min: 0, max: 100, control: 'shadow', def: '' },
};

export const FILTER_GROUPS: ReadonlyArray<{ heading: string; headingKey: MessageKey; types: FilterType[] }> = [
  { heading: 'General', headingKey: 'styleModel.filter.group.general', types: ['blur', 'drop-shadow'] },
  { heading: 'Color adjustments', headingKey: 'styleModel.filter.group.colorAdjustments', types: ['brightness', 'contrast', 'hue-rotate', 'saturate'] },
  { heading: 'Color effects', headingKey: 'styleModel.filter.group.colorEffects', types: ['grayscale', 'invert', 'sepia'] },
];

function isFilterType(value: string): value is FilterType {
  return value in FILTER_META;
}

const DROP_DEFAULT = { x: '0px', y: '2px', blur: '5px', color: 'rgba(0, 0, 0, 0.7)' };
const round = (value: number) => Math.round(value * 100) / 100;

const functionName = (call: string): string => call.slice(0, call.indexOf('(')).trim().toLowerCase();
const innerOf = (call: string): string => {
  const openIndex = call.indexOf('(');
  const closeIndex = call.lastIndexOf(')');
  return openIndex < 0 || closeIndex <= openIndex ? '' : call.slice(openIndex + 1, closeIndex).trim();
};

function normalizeAmount(type: FilterType, inner: string): string {
  const meta = FILTER_META[type];
  const match = inner.trim().match(/^(-?[\d.]+)(%|px|deg|rad|turn|grad|em|rem)?$/i);
  if (!match) {
    return inner.trim();
  }
  let amount = parseFloat(match[1] ?? '');
  const unit = (match[2] || '').toLowerCase();
  if (meta.unit === '%') {
    return `${round(unit === '%' ? amount : amount * 100)}%`;
  }
  if (meta.unit === 'deg') {
    if (unit === 'turn') {
      amount *= 360;
    } else if (unit === 'grad') {
      amount *= 0.9;
    } else if (unit === 'rad') {
      amount = (amount * 180) / Math.PI;
    }
    return `${round(amount)}deg`;
  }
  return `${round(amount)}${unit || 'px'}`;
}

export function parseFilters(value: string): FilterLayer[] {
  return splitFunctionList(value).map((call) => {
    const name = functionName(call);
    if (!call.endsWith(')') || !isFilterType(name)) {
      return rawLayer(call);
    }
    if (name === 'drop-shadow') {
      return dropShadowLayer(innerOf(call)) ?? rawLayer(call);
    }
    return { ...blankFilter(name), amount: normalizeAmount(name, innerOf(call)) };
  });
}

function dropShadowLayer(inner: string): Filter | undefined {
  const lengths: string[] = [];
  const others: string[] = [];
  for (const argument of splitTopLevelSpaces(inner)) {
    (isShadowLength(argument) ? lengths : others).push(argument);
  }
  if (lengths.length < 2 || lengths.length > 3 || others.length > 1) {
    return undefined;
  }
  return {
    type: 'drop-shadow',
    amount: '',
    x: lengths[0] ?? '0px',
    y: lengths[1] ?? '0px',
    blur: lengths[2] ?? '0px',
    color: others[0] ?? DROP_DEFAULT.color,
  };
}

function serializeOne(filter: Filter): string {
  if (filter.type === 'drop-shadow') {
    const x = filter.x.trim() || '0px',
      y = filter.y.trim() || '0px',
      blur = filter.blur.trim() || '0px';
    const color = filter.color.trim() || DROP_DEFAULT.color;
    return `drop-shadow(${x} ${y} ${blur} ${color})`;
  }
  return `${filter.type}(${filter.amount.trim() || FILTER_META[filter.type].def})`;
}

export function serializeFilters(list: readonly FilterLayer[]): string {
  return list
    .map((layer) => (layer.type === 'raw' ? layer.text : serializeOne(layer)))
    .filter(Boolean)
    .join(' ');
}

export function blankFilter(type: FilterType = 'blur'): Filter {
  return {
    type,
    amount: FILTER_META[type].def,
    x: DROP_DEFAULT.x,
    y: DROP_DEFAULT.y,
    blur: DROP_DEFAULT.blur,
    color: DROP_DEFAULT.color,
  };
}

export function retypeFilter(type: FilterType): Filter {
  return blankFilter(type);
}

export function filterLabel(filter: Filter, translate: Translator = ENGLISH_TRANSLATE): string {
  const meta = FILTER_META[filter.type];
  const name = translate(meta.labelKey);
  if (filter.type === 'drop-shadow') {
    const lengths = [filter.x, filter.y, filter.blur].map((length) => length.trim() || '0px');
    return `${name}: ${lengths.join(' ')}`;
  }
  return `${name}: ${filter.amount.trim() || meta.def}`;
}
