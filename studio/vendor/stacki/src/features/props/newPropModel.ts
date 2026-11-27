
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { ReactNode } from 'react';
import type { Result } from '../../../shared/core/result';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../shared/properties/i18n/messageRef';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import { memberTypes, type NewPropKind, type PropDeclaration } from '../../editor/propDeclaration';
import { readPropsDestructure } from '../../editor/loopProps';
import { isMediaName } from '../../editor/fieldNames';
import { imageDefaultOf, isImageType } from '../../editor/imagePropDefault';
import { findImportOf } from '../../editor/dataSource';
import type { ItemFieldDeclaration } from '../../editor/itemFields';

export type FieldFit = 'content' | 'text' | 'number' | 'boolean' | 'attributes' | 'image' | 'list' | 'classList';

export type ImagePropKind = 'asset' | 'url';

export interface NewPropHost {
  readonly componentName: string;
  readonly propKeys: readonly string[];
  readonly restLocal: string | undefined;
  readonly releaseRest?: ((local: string) => void) | undefined;
  readonly create: (declaration: PropDeclaration) => Result<string, string>;
  readonly imageProps?: ReadonlyMap<string, ImagePropKind> | undefined;
  readonly projectPath?: string | undefined;
  readonly fileDirectory?: string | undefined;
  readonly propSettings?: PropSettingsOffer | undefined;
}

export interface PropSettingsOffer {
  readonly keyOf: (path: string) => string | undefined;
  readonly render: (key: string, onClose: () => void) => ReactNode;
}

export interface NewPropSeed {
  readonly fit: FieldFit;
  readonly label: string;
  readonly value: string;
  readonly tag?: string | undefined;
  readonly reference?: 'url' | 'module' | undefined;
  readonly itemFields?: readonly ItemFieldDeclaration[] | undefined;
}

export interface FitNode {
  readonly kind: string;
  readonly section?: string | undefined;
  readonly children?: readonly FitNode[] | undefined;
}

export const FIT_KINDS: Readonly<Record<FieldFit, readonly NewPropKind[]>> = {
  content: ['string'],
  text: ['string', 'option'],
  number: ['number'],
  boolean: ['boolean'],
  attributes: ['attributes'],
  image: ['image'],
  list: ['list'],
  classList: ['string'],
};

export const KIND_TITLE_KEYS: Readonly<Record<NewPropKind, MessageKey>> = {
  string: 'props.newProp.kind.string',
  number: 'props.newProp.kind.number',
  boolean: 'props.newProp.kind.boolean',
  option: 'props.newProp.kind.option',
  attributes: 'props.newProp.kind.attributes',
  list: 'props.newProp.kind.list',
  image: 'props.newProp.kind.image',
};

export function newPropTitle(fit: FieldFit, translate: Translator = ENGLISH_TRANSLATE): string {
  switch (fit) {
    case 'content':
      return translate('props.newProp.title.content');
    case 'text':
      return translate('props.newProp.title.text');
    case 'number':
      return translate('props.newProp.title.number');
    case 'boolean':
      return translate('props.newProp.title.boolean');
    case 'attributes':
      return translate('props.newProp.title.attributes');
    case 'image':
      return translate('props.newProp.title.image');
    case 'list':
      return translate('props.newProp.title.list');
    case 'classList':
      return translate('props.newProp.title.classList');
    default: {
      const exhaustive: never = fit;
      return exhaustive;
    }
  }
}

export const IMAGE_NODE_KINDS: Readonly<Record<ImagePropKind, string>> = { asset: 'image', url: 'image url' };

type PropShape = 'words' | 'number' | 'switch' | 'attributes' | 'image' | 'imageUrl' | 'list' | 'structure' | 'unknown';

function shapeOf(kind: string): PropShape {
  switch (kind) {
    case 'string':
    case 'text':
    case 'enum':
    case 'date':
      return 'words';
    case 'number':
      return 'number';
    case 'boolean':
      return 'switch';
    case 'rest props':
      return 'attributes';
    case 'image':
      return 'image';
    case 'image url':
      return 'imageUrl';
    case 'list':
      return 'list';
    case 'object':
    case 'code':
    case 'slot':
    case 'style':
    case 'attrs':
      return 'structure';
    default:
      return 'unknown';
  }
}

export function propFits(kind: string, fit: FieldFit): boolean {
  const shape = shapeOf(kind);
  switch (fit) {
    case 'content':
    case 'text':
    case 'classList':
      return shape === 'words' || shape === 'number' || shape === 'imageUrl' || shape === 'unknown';
    case 'number':
      return shape === 'number' || shape === 'unknown';
    case 'boolean':
      return shape === 'switch' || shape === 'unknown';
    case 'attributes':
      return shape === 'attributes';
    case 'image':
      return shape === 'image' || shape === 'imageUrl' || shape === 'unknown';
    case 'list':
      return shape === 'list' || shape === 'unknown';
    default: {
      const exhaustive: never = fit;
      return exhaustive;
    }
  }
}

export function fittingTree<Node extends FitNode & { readonly path: string }>(
  tree: readonly Node[],
  fit: FieldFit,
  imageProps: ReadonlyMap<string, ImagePropKind> = new Map(),
): readonly Node[] {
  assert(tree.length <= LIMITS.treeNodesMax, 'fittingTree: node limit exceeded');
  const kinded = tree.map((node) => {
    const image = node.section === 'props' ? imageProps.get(node.path) : undefined;
    return image === undefined ? node : { ...node, kind: IMAGE_NODE_KINDS[image] };
  });
  const out = kinded.filter((node) => {
    if (node.section !== 'props') {
      return fit !== 'attributes';
    }
    if (propFits(node.kind, fit)) {
      return true;
    }
    return fit !== 'attributes' && (node.children?.length ?? 0) > 0;
  });
  assert(out.length <= tree.length, 'fittingTree: fitting only removes rows');
  return out;
}

export function propKeysByLocal(
  entries: readonly { readonly key: string; readonly local: string }[],
  declared: readonly string[],
  restLocal: string | undefined,
): ReadonlyMap<string, string> {
  assert(entries.length + declared.length <= LIMITS.treeNodesMax, 'propKeysByLocal: the props are bounded');
  const out = new Map(entries.map((entry) => [entry.local, entry.key]));
  const aliased = new Set(entries.map((entry) => entry.key));
  for (const key of declared) {
    if (!aliased.has(key)) {
      out.set(key, key);
    }
  }
  if (restLocal !== undefined) {
    out.delete(restLocal);
  }
  assert(out.size <= entries.length + declared.length, 'propKeysByLocal: only known props are listed');
  return out;
}

export function propNameProblem(key: string, host: Pick<NewPropHost, 'propKeys' | 'restLocal'>, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (key === '') {
    return translate('props.newProp.name.empty');
  }
  if (key.length > PROPERTY_LIMITS.nameCharsMax) {
    return translate('props.newProp.name.tooLong');
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
    return translate('props.newProp.name.invalid');
  }
  if (host.propKeys.includes(key) || host.restLocal === key) {
    return translate('props.newProp.name.taken', { name: key });
  }
  return undefined;
}

const NAME_SUFFIX_MAX = 100;

export function suggestedPropName(label: string, host: Pick<NewPropHost, 'propKeys' | 'restLocal'>): string {
  assert(label.length <= LIMITS.attrCharsMax, 'suggestedPropName: label is bounded');
  const words = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '');
  const joined = words.map((word, index) => (index === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)).join('');
  const base = (joined === '' ? 'property' : /^\d/.test(joined) ? `prop${joined}` : joined).slice(0, PROPERTY_LIMITS.nameCharsMax - 4);
  for (let suffix = 1; suffix <= NAME_SUFFIX_MAX; suffix++) {
    const key = suffix === 1 ? base : `${base}${suffix}`;
    if (propNameProblem(key, host) === undefined) {
      return key;
    }
  }
  assert(false, 'suggestedPropName: a free name is found within the suffix bound');
  return base;
}

export function suggestedRestName(host: Pick<NewPropHost, 'propKeys' | 'restLocal'>): string {
  return suggestedPropName('rest', host);
}

export type RestConnectOffer = { readonly kind: 'declare'; readonly declaration: PropDeclaration } | { readonly kind: 'spread'; readonly local: string };

export function restConnectOffer(
  host: Pick<NewPropHost, 'propKeys' | 'restLocal'> | undefined,
  element: { readonly tag: string; readonly connected: boolean },
): RestConnectOffer | undefined {
  if (host === undefined || element.connected || !/^[a-z][a-z0-9-]*$/.test(element.tag)) {
    return undefined;
  }
  if (host.restLocal !== undefined) {
    return { kind: 'spread', local: host.restLocal };
  }
  const declaration = restDeclaration(host, element.tag);
  assert(declaration.kind === 'attributes', 'restConnectOffer: an attributes prop is declared');
  assert(propNameProblem(declaration.key, host) === undefined, 'restConnectOffer: the name is free');
  return { kind: 'declare', declaration };
}

export function restDeclaration(host: Pick<NewPropHost, 'propKeys' | 'restLocal'>, tag: string): PropDeclaration {
  assert(/^[a-z][a-z0-9-]*$/.test(tag), 'restDeclaration: an HTML tag');
  assert(host.restLocal === undefined, 'restDeclaration: a component passes its attributes on once');
  const out: PropDeclaration = {
    key: suggestedRestName(host),
    tooltip: '',
    kind: 'attributes',
    defaultText: '',
    options: [],
    number: { min: undefined, max: undefined, decimals: undefined },
    attributes: [],
    tag,
    list: { fields: [], items: [] },
    image: '',
  };
  return out;
}

export function fitOfFieldType(
  type: string,
  options: { readonly numeric?: boolean | undefined; readonly media?: boolean | undefined; readonly list?: boolean | undefined } = {},
): FieldFit | undefined {
  if (options.media === true && ['string', 'other', 'url', 'image', 'media'].includes(type)) {
    return 'image';
  }
  if (options.list === true && type === 'code') {
    return 'list';
  }
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return options.numeric === true ? 'number' : 'text';
    case 'string':
    case 'text':
    case 'link':
    case 'url':
    case 'image':
    case 'media':
    case 'style':
      return 'text';
    default:
      return undefined;
  }
}

export function literalOf(value: { readonly type: string; readonly value?: string } | undefined): string {
  if (value === undefined || value.type === 'bare') {
    return '';
  }
  if (value.type === 'string') {
    return value.value ?? '';
  }
  const code = (value.value ?? '').trim();
  return /^(true|false|-?\d+(\.\d+)?)$/.test(code) ? code : '';
}

export function defaultForConnectedValue(
  current: { readonly type: string; readonly value?: string } | undefined,
  kind: FieldFit,
  frontmatter: string = '',
): string {
  if (kind !== 'image') {
    return literalOf(current);
  }
  if (current === undefined || current.type === 'bare') {
    return '';
  }
  const text = (current.value ?? '').trim();
  let candidate = text;
  if (current.type === 'expr') {
    const reading = /^([A-Za-z_$][\w$]*)(?:\.src)?$/.exec(text);
    const name = reading?.[1];
    candidate = name === undefined ? '' : (findImportOf(frontmatter, name)?.spec ?? '');
  } else if (current.type !== 'string') {
    candidate = '';
  }
  return imageDefaultOf(candidate).ok ? candidate : '';
}

export function boundPath(local: string, image: ImagePropKind | undefined, reference: NewPropSeed['reference']): string {
  assert(/^[A-Za-z_$][\w$]*$/.test(local), 'boundPath: a prop is read by an identifier');
  const out = image === 'asset' && reference === 'url' ? `${local}.src` : local;
  assert(out.startsWith(local), 'boundPath: the binding reads the prop');
  return out;
}

export function seedName(seed: Pick<NewPropSeed, 'fit' | 'label'>): string {
  return seed.fit === 'image' && /^(src|data-src)$/i.test(seed.label) ? 'image' : seed.label;
}

const IMAGE_FILE = /\.(png|jpe?g|webp|avif|gif|svg)(\?.*)?$/i;

export function imagePropsOf(frontmatter: string): ReadonlyMap<string, ImagePropKind> {
  const types = memberTypes(frontmatter);
  const out = new Map<string, ImagePropKind>();
  for (const entry of readPropsDestructure(frontmatter)?.entries ?? []) {
    const type = types.get(entry.key);
    if (type === undefined) {
      continue;
    }
    if (isImageType(type)) {
      out.set(entry.local, 'asset');
      continue;
    }
    const fallback = entry.defaultValue === undefined ? '' : frontmatter.slice(entry.defaultValue.from, entry.defaultValue.to);
    if (type === 'string' && (isMediaName(entry.key) || IMAGE_FILE.test(fallback.replace(/^["'`]|["'`]$/g, '')))) {
      out.set(entry.local, 'url');
    }
  }
  assert(out.size <= types.size, 'imagePropsOf: only declared props are images');
  return out;
}
