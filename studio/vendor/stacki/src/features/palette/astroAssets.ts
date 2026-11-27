import type { Attr } from '../../../shared/page/pageNode';
import type { BuiltinField } from '../../editor/elementSchemas';
export interface AstroAsset {
  readonly name: string;
  readonly tag: string;
  readonly blurb: string;
  readonly astroAsset: true;
  readonly hasRest: true;
  readonly slots: readonly string[];
  readonly schema: readonly BuiltinField[];
}


export const ASTRO_ASSETS_MODULE = 'astro:assets';

export const ASTRO_ASSET_COLOR = '#ff5d01';

const COMMON: readonly BuiltinField[] = [
  { name: 'src', type: 'other' },
  { name: 'alt', type: 'string' },
  { name: 'width', type: 'number' },
  { name: 'height', type: 'number' },
  { name: 'quality', type: 'other' },
  { name: 'loading', type: 'enum', options: ['lazy', 'eager'], default: 'lazy' },
  { name: 'decoding', type: 'enum', options: ['async', 'sync', 'auto'], default: 'async' },
  { name: 'fetchpriority', type: 'enum', options: ['auto', 'high', 'low'], default: 'auto' },
  { name: 'densities', type: 'other' },
  { name: 'widths', type: 'other' },
  { name: 'sizes', type: 'string' },
  { name: 'class', type: 'string' },
];

export const ASTRO_ASSETS: readonly AstroAsset[] = [
  {
    name: 'Image',
    tag: 'img',
    blurb: 'Optimised <img> from astro:assets',
    astroAsset: true,
    hasRest: true,
    slots: [],
    schema: [
      ...COMMON,
      {
        name: 'format',
        type: 'enum',
        options: ['webp', 'avif', 'png', 'jpeg', 'jpg', 'svg', 'gif'],
      },
    ],
  },
  {
    name: 'Picture',
    tag: 'picture',
    blurb: 'Responsive <picture> from astro:assets',
    astroAsset: true,
    hasRest: true,
    slots: [],
    schema: [
      ...COMMON,
      { name: 'formats', type: 'other' },
      {
        name: 'fallbackFormat',
        type: 'enum',
        options: ['webp', 'avif', 'png', 'jpeg', 'jpg', 'svg', 'gif'],
      },
      { name: 'pictureAttributes', type: 'other' },
    ],
  },
];

export const PLACEHOLDER_SOURCE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'" +
  " width='400' height='300'%3E%3Crect width='400' height='300'" +
  " fill='%23d8d8d8'/%3E%3C/svg%3E";
export const PLACEHOLDER_PROPS: Readonly<Record<string, Attr>> = {
  src: { type: 'string', value: PLACEHOLDER_SOURCE },
  alt: { type: 'string', value: '' },
  width: { type: 'expr', value: '400' },
  height: { type: 'expr', value: '300' },
};

export const isAstroAsset = (name: unknown) => ASTRO_ASSETS.some((asset) => asset.name === name);
export const astroAsset = (name: unknown) => ASTRO_ASSETS.find((asset) => asset.name === name);
