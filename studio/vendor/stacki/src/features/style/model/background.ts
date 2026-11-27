import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../../shared/properties/i18n/messageRef';
import { assert } from '../../../../shared/core/assert';
import { substituteCustomProperties } from './cssVars';

export type LayerKind = 'image' | 'linear' | 'radial' | 'conic' | 'color' | 'other';

export type BgLayer = {
  image: string;
  size: string;
  position: string;
  repeat: string;
  attachment: string;
  origin: string;
  clip: string;
};

export type BackgroundLonghands = {
  image: string;
  size: string;
  position: string;
  repeat: string;
  attachment: string;
  origin: string;
  clip: string;
};

export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

export function colorOverlayOf(image: string): string | undefined {
  const match = image.trim().match(/^linear-gradient\((.*)\)$/is);
  if (!match) {
    return undefined;
  }
  const parts = splitTopLevelCommas(match[1] ?? '');
  if (!parts.length) {
    return undefined;
  }
  const isDirection = (text: string) => /^to\s/i.test(text.trim()) || /^-?[\d.]+(deg|grad|rad|turn)$/i.test(text.trim());
  const stops = isDirection(parts[0] ?? '') ? parts.slice(1) : parts;
  if (stops.length < 2) {
    return undefined;
  }
  const colours = stops.map((stop) =>
    stop
      .trim()
      .replace(/\s+-?[\d.]+(%|px|em|rem|vw|vh|vmin|vmax)?$/i, '')
      .trim(),
  );
  const first = colours[0];
  return first && colours.every((colour) => colour === first) ? first : undefined;
}

export function colorOverlayImage(color: string): string {
  const trimmed = color.trim() || '#000000';
  return `linear-gradient(180deg, ${trimmed}, ${trimmed})`;
}

export function splitTopLevelSpaces(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  const chars = [...value.trim()];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < chars.length) {
        current += chars[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

export function isShadowLength(token: string): boolean {
  const text = token.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([a-z]+|%)?$/i.test(text) || /^[+-]?(calc|min|max|clamp)\(.*\)$/is.test(text);
}

const REPEAT_KW = new Set(['repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round']);
const ATTACH_KW = new Set(['scroll', 'fixed', 'local']);
const BOX_KW = new Set(['border-box', 'padding-box', 'content-box']);
const CLIP_ONLY_KW = new Set(['text', 'border-area']);
const IMAGE_FUNCTION = /^(-(webkit|moz|o)-)?(url|(repeating-)?(linear|radial|conic)-gradient|gradient|image-set|image|cross-fade|element|paint)\(/i;
const isImageToken = (token: string) => IMAGE_FUNCTION.test(token) || token.toLowerCase() === 'none';
const isVariableToken = (token: string) => /^var\(/i.test(token);
const isMathToken = (token: string) => /^(calc|min|max|clamp)\(/i.test(token);
const isPositionToken = (token: string) => /^(left|right|top|bottom|center)$/i.test(token) || /^-?[\d.]+(px|%|em|rem|vw|vh|vmin|vmax|ch|fr)?$/i.test(token);

export function splitBackgroundShorthand(bg: string, variables: ReadonlyMap<string, string> = new Map()): BackgroundLonghands & { color: string } {
  const layerTexts = splitTopLevelCommas(bg);
  const parsed: BackgroundLayerTokens[] = [];
  let color = '';
  layerTexts.forEach((layerText, layerIndex) => {
    const isLastLayer = layerIndex === layerTexts.length - 1;
    const layer = parseBackgroundLayer(layerText, { isLastLayer, variables });
    if (!isLastLayer) {
      parsed.push(layer.image ? layer : withStrayImage(layer));
      return;
    }
    color = layer.color;
    if (layer.image) {
      parsed.push(layer);
      return;
    }
    if (!color) {
      color = layer.positionTokens.join(' ').trim();
    }
    const above = parsed[parsed.length - 1];
    if (clipOf(layer) !== (above === undefined ? 'border-box' : clipOf(above))) {
      parsed.push({ ...layer, image: 'none', positionTokens: [], color: '' });
    }
  });
  const join = (list: string[], initial: string) => (list.some((item) => item.trim()) ? list.map((item) => item.trim() || initial).join(', ') : '');
  return {
    image: parsed.map((layer) => layer.image).join(', '),
    size: join(
      parsed.map((layer) => layer.sizeTokens.join(' ')),
      'auto',
    ),
    position: join(
      parsed.map((layer) => layer.positionTokens.join(' ')),
      '0% 0%',
    ),
    repeat: join(
      parsed.map((layer) => layer.repeat),
      'repeat',
    ),
    attachment: join(
      parsed.map((layer) => layer.attachment),
      'scroll',
    ),
    origin: boxList(
      parsed.map((layer) => layer.origin),
      'padding-box',
    ),
    clip: boxList(
      parsed.map((layer) => layer.clip),
      'border-box',
    ),
    color,
  };
}

const clipOf = (layer: Pick<BackgroundLayerTokens, 'clip'>): string => layer.clip || 'border-box';

function boxList(entries: readonly string[], initial: string): string {
  if (!entries.some((entry) => entry.trim())) {
    return '';
  }
  const filled = entries.map((entry) => entry.trim() || initial);
  return new Set(filled).size === 1 ? (filled[0] ?? initial) : filled.join(', ');
}

function withStrayImage(layer: BackgroundLayerTokens): BackgroundLayerTokens {
  const at = layer.positionTokens.findIndex((token) => token.includes('(') && !isMathToken(token));
  return {
    ...layer,
    image: layer.positionTokens[at] ?? 'none',
    positionTokens: layer.positionTokens.filter((_, index) => index !== at),
  };
}

export function layerShorthand(layer: BgLayer): string {
  const parts = [layer.image.trim()];
  const position = layer.position.trim();
  const size = layer.size.trim();
  if (size !== '') {
    parts.push(`${position !== '' ? position : '0 0'} / ${size}`);
  } else if (position !== '') {
    parts.push(position);
  }
  for (const part of [layer.repeat, layer.attachment, boxShorthand(layer)]) {
    if (part.trim() !== '') {
      parts.push(part.trim());
    }
  }
  const text = parts.join(' ');
  assert(text.startsWith(parts[0] ?? ''), 'layerShorthand: the image leads');
  return text;
}

function boxShorthand(layer: Pick<BgLayer, 'origin' | 'clip'>): string {
  const origin = layer.origin.trim();
  const clip = layer.clip.trim();
  if (CLIP_ONLY_KW.has(clip)) {
    return origin ? `${origin} ${clip}` : clip;
  }
  if (!origin && !clip) {
    return '';
  }
  const pair = [origin || 'padding-box', clip || 'border-box'];
  return pair[0] === pair[1] ? (pair[0] ?? '') : pair.join(' ');
}

export function parseLayerShorthand(text: string): BgLayer | undefined {
  if (splitTopLevelCommas(text).length !== 1) {
    return undefined;
  }
  const tokens = parseBackgroundLayer(text.trim(), { isLastLayer: false, variables: new Map() });
  if (!tokens.image) {
    return undefined;
  }
  return {
    image: tokens.image,
    size: tokens.sizeTokens.join(' '),
    position: tokens.positionTokens.join(' '),
    repeat: tokens.repeat,
    attachment: tokens.attachment,
    origin: tokens.origin,
    clip: tokens.clip,
  };
}

type BackgroundLayerTokens = {
  image: string;
  repeat: string;
  attachment: string;
  origin: string;
  clip: string;
  positionTokens: string[];
  sizeTokens: string[];
  color: string;
};

type LayerContext = { readonly isLastLayer: boolean; readonly variables: ReadonlyMap<string, string> };

function imageVariable(tokens: readonly string[], context: LayerContext): string | undefined {
  if (tokens.some(isImageToken)) {
    return undefined;
  }
  const variables = tokens.filter(isVariableToken);
  if (!context.isLastLayer) {
    return variables[0];
  }
  const resolved = variables.map((token) => substituteCustomProperties(token, context.variables).trim());
  const at = resolved.findIndex((value) => IMAGE_FUNCTION.test(value));
  if (at >= 0) {
    return variables[at];
  }
  const placed = tokens.some((token) => token === '/' || REPEAT_KW.has(token.toLowerCase()) || ATTACH_KW.has(token.toLowerCase()));
  return placed && resolved[0] === '' && tokens[0] === variables[0] ? variables[0] : undefined;
}

function parseBackgroundLayer(layerText: string, context: LayerContext): BackgroundLayerTokens {
  const tokens = splitTopLevelSpaces(spaceTopLevelSlashes(layerText));
  const variableImage = imageVariable(tokens, context);
  const layer: BackgroundLayerTokens = {
    image: '',
    repeat: '',
    attachment: '',
    origin: '',
    clip: '',
    positionTokens: [],
    sizeTokens: [],
    color: '',
  };
  let afterSlash = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (token === '/') {
      afterSlash = true;
    } else if (isImageToken(token) || (token === variableImage && !layer.image)) {
      layer.image = token;
    } else if (REPEAT_KW.has(lower)) {
      layer.repeat = layer.repeat ? `${layer.repeat} ${lower}` : lower;
    } else if (ATTACH_KW.has(lower)) {
      layer.attachment = lower;
    } else if (BOX_KW.has(lower)) {
      layer.clip = lower;
      layer.origin ||= lower;
    } else if (CLIP_ONLY_KW.has(lower)) {
      layer.clip = lower;
    } else if (afterSlash) {
      layer.sizeTokens.push(token);
    } else if (isPositionToken(token)) {
      layer.positionTokens.push(token);
    } else if (context.isLastLayer) {
      layer.color = token;
    } else {
      layer.positionTokens.push(token);
    }
  }
  return layer;
}

function spaceTopLevelSlashes(text: string): string {
  let depth = 0;
  let quote = '';
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== '') {
      quote = ch === quote ? '' : quote;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    out += ch === '/' && quote === '' && depth === 0 ? ' / ' : ch;
  }
  return out;
}

export function layerKind(image: string): LayerKind {
  const normalized = image.trim().toLowerCase();
  if (normalized.startsWith('url(')) {
    return 'image';
  }
  if (colorOverlayOf(image) !== undefined) {
    return 'color';
  }
  if (normalized.startsWith('linear-gradient') || normalized.startsWith('repeating-linear-gradient')) {
    return 'linear';
  }
  if (normalized.startsWith('radial-gradient') || normalized.startsWith('repeating-radial-gradient')) {
    return 'radial';
  }
  if (normalized.startsWith('conic-gradient') || normalized.startsWith('repeating-conic-gradient')) {
    return 'conic';
  }
  return 'other';
}

export function urlFileName(image: string): string | undefined {
  const match = image.match(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/i);
  if (!match) {
    return undefined;
  }
  const path = (match[1] ?? '').split('?')[0] ?? '';
  const file = path.split(/[\\/]/).pop() ?? path;
  return file || path;
}

export function layerLabel(image: string, translate: Translator = ENGLISH_TRANSLATE): string {
  switch (layerKind(image)) {
    case 'image':
      return urlFileName(image) ?? translate('styleModel.background.layer.image');
    case 'color':
      return colorOverlayOf(image) ?? translate('styleModel.background.layer.colorOverlay');
    case 'linear':
      return translate('styleModel.background.layer.linear');
    case 'radial':
      return translate('styleModel.background.layer.radial');
    case 'conic':
      return translate('styleModel.background.layer.conic');
    case 'other':
      return image.trim() || translate('styleModel.background.layer.other');
  }
}

export function parseLayers(props: BackgroundLonghands): BgLayer[] {
  const images = props.image.trim() ? splitTopLevelCommas(props.image).filter(Boolean) : [];
  const sizes = props.size.trim() ? splitTopLevelCommas(props.size) : [];
  const positions = props.position.trim() ? splitTopLevelCommas(props.position) : [];
  const repeats = props.repeat.trim() ? splitTopLevelCommas(props.repeat) : [];
  const attachments = props.attachment.trim() ? splitTopLevelCommas(props.attachment) : [];
  const origins = props.origin.trim() ? splitTopLevelCommas(props.origin) : [];
  const clips = props.clip.trim() ? splitTopLevelCommas(props.clip) : [];
  if (images.every((image) => image.toLowerCase() === 'none') && !origins.length && !clips.length) {
    return [];
  }
  return images.map((image, i) => ({
    image,
    size: sizes[i] ?? '',
    position: positions[i] ?? '',
    repeat: repeats[i] ?? '',
    attachment: attachments[i] ?? '',
    origin: origins[i % origins.length] ?? '',
    clip: clips[i % clips.length] ?? '',
  }));
}

const INITIAL = {
  size: 'auto',
  position: '0% 0%',
  repeat: 'repeat',
  attachment: 'scroll',
} as const;

export function serializeLayers(layers: BgLayer[]): BackgroundLonghands {
  if (!layers.length) {
    return { image: '', size: '', position: '', repeat: '', attachment: '', origin: '', clip: '' };
  }
  const list = (key: 'size' | 'position' | 'repeat' | 'attachment'): string =>
    layers.some((layer) => layer[key].trim()) ? layers.map((layer) => layer[key].trim() || INITIAL[key]).join(', ') : '';
  return {
    image: layers.map((layer) => layer.image.trim()).join(', '),
    size: list('size'),
    position: list('position'),
    repeat: list('repeat'),
    attachment: list('attachment'),
    origin: boxList(
      layers.map((layer) => layer.origin),
      'padding-box',
    ),
    clip: boxList(
      layers.map((layer) => layer.clip),
      'border-box',
    ),
  };
}

export function blankLayer(kind: LayerKind): BgLayer {
  const image =
    kind === 'linear'
      ? 'linear-gradient(180deg, #000000, #ffffff)'
      : kind === 'radial'
        ? 'radial-gradient(circle, #000000, #ffffff)'
        : kind === 'conic'
          ? 'conic-gradient(from 0deg, #000000, #ffffff)'
          : kind === 'color'
            ? colorOverlayImage('rgba(0, 0, 0, 0.5)')
            : 'url()';
  return { image, size: '', position: '', repeat: '', attachment: '', origin: '', clip: '' };
}
