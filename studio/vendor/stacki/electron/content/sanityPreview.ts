
import { assert } from '../../shared/core/assert';
import { NAME_KEYS } from '../../shared/properties/entryTitle';
import type { SanityPreview } from './sanitySchema';

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/;
const FALLBACK_TITLE = `${NAME_KEYS.join(', ')}, slug.current`;
const SUBTITLE_CHARS_MAX = 200;

export function previewProjection(preview: SanityPreview | undefined): string {
  const title = preview?.title ? `${read(preview.title)}, ` : '';
  assert(
    (preview?.parts ?? []).every((part) => KEY.test(part.key)),
    'Preview keys are names',
  );
  const parts = [
    `"title": coalesce(${title}${FALLBACK_TITLE}, _id)`,
    preview?.media ? `"media": ${read(preview.media, '.asset->url')}` : '',
    ...(preview?.parts ?? []).map((part, index) => `"part${index}_${part.key}": ${read(part.path)}`),
  ].filter((part) => part !== '');
  return `"preview": {${parts.join(', ')}}`;
}

export function mediaProjection(types: readonly string[], mediaOf: (type: string) => string | undefined): string {
  const cases = types.flatMap((type) => {
    const media = mediaOf(type);
    return media === undefined ? [] : [`_type == ${JSON.stringify(type)} => ${read(media, '.asset->url')}`];
  });
  assert(cases.length <= types.length, 'One picture path per type at most');
  return cases.length === 0 ? '' : `, "media": select(${cases.join(', ')})`;
}

export function previewOf(row: unknown): {
  readonly title: string | undefined;
  readonly subtitle: string | undefined;
  readonly imageURL: string | undefined;
} {
  const preview: unknown = isObject(row) ? Reflect.get(row, 'preview') : undefined;
  const value = (key: string): unknown => (isObject(preview) ? Reflect.get(preview, key) : undefined);
  const title = value('title');
  const media = value('media');
  const parts = Object.keys(isObject(preview) ? preview : {})
    .map((key) => ({ key, match: /^part(\d+)_(\w+)$/.exec(key) }))
    .filter((entry) => entry.match !== null)
    .sort((left, right) => Number(left.match?.[1]) - Number(right.match?.[1]))
    .map((entry) => shown(value(entry.key), entry.match?.[2] ?? 'items'));
  const subtitle = parts
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
    .slice(0, SUBTITLE_CHARS_MAX);
  return {
    title: typeof title === 'string' ? title : undefined,
    subtitle: subtitle || undefined,
    imageURL: typeof media === 'string' && media.startsWith('https://') ? media : undefined,
  };
}

function read(path: string, suffix = ''): string {
  assert(PATH.test(path), 'A preview path is plain field names');
  const steps = path.split('.');
  let ways = [steps[0] ?? ''];
  for (const step of steps.slice(1)) {
    ways = ways.flatMap((way) => [`${way}->${step}`, `${way}.${step}`]);
  }
  assert(ways.length <= 4, 'A preview path is read at most four ways');
  return `coalesce(${ways.map((way) => `${way}${suffix}`).join(', ')})`;
}

function shown(value: unknown, name: string): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const plural = name.endsWith('s') ? name : `${name}s`;
    const word = value.length === 1 ? plural.replace(/s$/, '') : plural;
    return `${value.length} ${word}`;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return value;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
