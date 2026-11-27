
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';

export interface PropTags {
  readonly tooltip: string;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly step: number | undefined;
  readonly decimals: number | undefined;
  readonly integer: boolean;
  readonly format: string | undefined;
  readonly group: string | undefined;
  readonly deprecated: string | undefined;
}

export const PROP_TAG_LIMITS = {
  docCharsMax: LIMITS.attrCharsMax * 4,
  decimalsMax: 10,
  groupCharsMax: 80,
} as const;

const NUMBER_TAG_SOURCE = String.raw`(-?\d+(?:\.\d+)?)(?![\d.]*\d)`;

export function readPropTags(documentation: string | undefined): PropTags {
  const text = documentation ?? '';
  assert(text.length <= PROP_TAG_LIMITS.docCharsMax, 'readPropTags: doc text is bounded');
  const tagAt = text.search(/(^|\s)@\w/);
  const tooltip = (tagAt < 0 ? text : text.slice(0, tagAt)).replace(/\s+/g, ' ').trim();
  const min = numberTag(text, 'min');
  const maxStated = numberTag(text, 'max');
  const max = min !== undefined && maxStated !== undefined && maxStated < min ? undefined : maxStated;
  const decimalsStated = numberTag(text, 'decimals');
  const decimals =
    decimalsStated !== undefined && Number.isSafeInteger(decimalsStated) && decimalsStated >= 0 && decimalsStated <= PROP_TAG_LIMITS.decimalsMax
      ? decimalsStated
      : undefined;
  const stepStated = numberTag(text, 'step');
  const tags: PropTags = {
    tooltip,
    min,
    max,
    step: stepStated !== undefined && stepStated > 0 ? stepStated : undefined,
    decimals,
    integer: /@(?:int|integer)\b/i.test(text),
    format: formatTag(text),
    group: labelTag(text, 'group', PROP_TAG_LIMITS.groupCharsMax),
    deprecated: deprecationOf(text),
  };
  assert(tags.min === undefined || tags.max === undefined || tags.min <= tags.max, 'readPropTags: the range is ordered');
  assert(tags.tooltip.length <= text.length, 'readPropTags: the tooltip is part of the doc');
  return tags;
}

export function tagStep(tags: Pick<PropTags, 'step' | 'decimals' | 'integer'>): number | undefined {
  if (tags.step !== undefined) {
    return tags.step;
  }
  if (tags.decimals !== undefined) {
    const step = Number((10 ** -tags.decimals).toFixed(tags.decimals));
    assert(step > 0, 'tagStep: a precision gives a positive step');
    return step;
  }
  return tags.integer ? 1 : undefined;
}

const DEPRECATED_TAG = /(?:^|\s)@deprecated\b([^@]*)/;

export function deprecationOf(documentation: string | undefined): string | undefined {
  const text = documentation ?? '';
  assert(text.length <= PROP_TAG_LIMITS.docCharsMax, 'deprecationOf: doc text is bounded');
  const match = DEPRECATED_TAG.exec(text) ?? undefined;
  if (match === undefined) {
    return undefined;
  }
  const reason = (match[1] ?? '').replace(/\s+/g, ' ').trim();
  assert(reason.length <= text.length, 'deprecationOf: the reason is part of the doc');
  return reason;
}

const SETTING_TAG = /(?<=^|\s)@(min|max|step|decimals|int|integer|onLabel|offLabel|format|group)\b[^\n@]*/g;

export function withoutSettingTags(documentation: string): string {
  assert(documentation.length <= PROP_TAG_LIMITS.docCharsMax, 'withoutSettingTags: doc text is bounded');
  const out = documentation.replace(SETTING_TAG, '').replace(/\s+/g, ' ').trim();
  assert(out.length <= documentation.length, 'withoutSettingTags: only removes text');
  return out;
}

function numberTag(text: string, name: string): number | undefined {
  const match = new RegExp(`@${name}[ \\t]+${NUMBER_TAG_SOURCE}`, 'i').exec(text) ?? undefined;
  const value = match?.[1];
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function labelTag(text: string, name: string, charsMax: number): string | undefined {
  const match = new RegExp(`@${name}[ \\t]+([^\\n@*]+)`).exec(text) ?? undefined;
  const label = match?.[1]?.trim();
  return label === undefined || label === '' || label.length > charsMax ? undefined : label;
}

function formatTag(text: string): string | undefined {
  const match = /@format[ \t]+([A-Za-z][\w-]*)/.exec(text) ?? undefined;
  return match?.[1]?.toLowerCase();
}
