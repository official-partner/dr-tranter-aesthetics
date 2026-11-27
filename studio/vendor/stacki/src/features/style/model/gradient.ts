
import { assert } from '../../../../shared/core/assert';
import { splitTopLevelCommas, splitTopLevelSpaces } from './background';

export type GradientType = 'linear' | 'radial' | 'conic';

export type GradientStop = { color: string; pos: string };

export type Gradient = {
  type: GradientType;
  repeating: boolean;
  angle: string;
  shape: string;
  size: string;
  from: string;
  posX: string;
  posY: string;
  stops: GradientStop[];
};
export type GradientPatch =
  | Pick<Gradient, 'angle'>
  | Pick<Gradient, 'from'>
  | Pick<Gradient, 'posX'>
  | Pick<Gradient, 'posY'>
  | Pick<Gradient, 'posX' | 'posY'>
  | Pick<Gradient, 'repeating'>
  | Pick<Gradient, 'size'>;
export type GradientStopPatch = Pick<GradientStop, 'color'> | Pick<GradientStop, 'pos'>;

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\s*\(([\s\S]*)\)\s*$/i;
const RADIAL_SIZE_KW = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner']);
const isAngle = (token: string) => /^-?[\d.]+(deg|grad|rad|turn)$/i.test(token.trim());
const isLength = (token: string) => /^-?[\d.]+(px|%|em|rem|vw|vh|vmin|vmax|ch|fr)?$/i.test(token.trim());
const POSITION_KEYWORDS: Record<string, string> = {
  left: '0%',
  right: '100%',
  top: '0%',
  bottom: '100%',
  center: '50%',
};

function positionValue(token: string): string {
  const normalized = token.trim().toLowerCase();
  return POSITION_KEYWORDS[normalized] ?? token.trim();
}

function parseCenter(text: string): { posX: string; posY: string } {
  const toks = splitTopLevelSpaces(text);
  if (!toks.length) {
    return { posX: '', posY: '' };
  }
  if (toks.length === 1) {
    const first = toks[0] ?? '';
    const position = positionValue(first);
    if (/^(top|bottom)$/i.test(first)) {
      return { posX: '50%', posY: position };
    }
    return { posX: position, posY: '50%' };
  }
  return { posX: positionValue(toks[0] ?? ''), posY: positionValue(toks[1] ?? '') };
}

function parseStop(part: string): GradientStop {
  const toks = splitTopLevelSpaces(part);
  if (toks.length > 1 && isLength(toks[toks.length - 1] ?? '')) {
    return { pos: toks.pop() ?? '', color: toks.join(' ') };
  }
  return { color: toks.join(' '), pos: '' };
}

function isPrelude(type: GradientType, part: string): boolean {
  const normalized = part.trim().toLowerCase();
  if (type === 'linear') {
    return normalized.startsWith('to ') || isAngle(normalized);
  }
  if (type === 'conic') {
    return normalized.startsWith('from ') || normalized.startsWith('at ');
  }
  if (normalized.startsWith('circle') || normalized.startsWith('ellipse') || normalized.includes(' at ') || normalized.startsWith('at ')) {
    return true;
  }
  if (RADIAL_SIZE_KW.has(normalized)) {
    return true;
  }
  const tokens = splitTopLevelSpaces(normalized);
  return tokens.length > 0 && tokens.every((token) => RADIAL_SIZE_KW.has(token.toLowerCase()) || isLength(token));
}

export function parseGradient(image: string): Gradient | undefined {
  const match = GRADIENT_RE.exec(image.trim());
  if (!match) {
    return undefined;
  }
  const typeText = (match[2] ?? '').toLowerCase();
  if (typeText !== 'linear' && typeText !== 'radial' && typeText !== 'conic') {
    return undefined;
  }
  const type: GradientType = typeText;
  const parts = splitTopLevelCommas(match[3] ?? '').filter((part) => part.length);
  if (!parts.length) {
    return undefined;
  }
  const hasPrelude = isPrelude(type, parts[0] ?? '');
  const geometry = hasPrelude ? parsePrelude(type, parts[0] ?? '') : {};
  const rest = hasPrelude ? parts.slice(1) : parts;
  const stops = rest.map(parseStop).filter((stop) => stop.color);
  if (stops.length < 2) {
    return undefined;
  }
  return { ...blankGradientOf(type), repeating: !!match[1], ...geometry, stops };
}

export function gradientFitsEditor(gradient: Gradient): boolean {
  assert(gradient.stops.length >= 2, 'gradientFitsEditor: a gradient has two stops');
  for (const stop of gradient.stops) {
    if (splitTopLevelSpaces(stop.color).length !== 1) {
      return false;
    }
    if (stop.pos !== '' && !isLength(stop.pos)) {
      return false;
    }
  }
  const geometry = [gradient.angle, gradient.shape, gradient.size, gradient.from, gradient.posX, gradient.posY];
  return geometry.every((value) => !value.includes('('));
}

type Geometry = Partial<Pick<Gradient, 'angle' | 'shape' | 'size' | 'from' | 'posX' | 'posY'>>;

function parsePrelude(type: GradientType, prelude: string): Geometry {
  const trimmed = prelude.trim();
  if (type === 'linear') {
    return { angle: trimmed };
  }
  const at = trimmed.split(/\bat\b/i);
  const center = at[1] ? parseCenter(at[1]) : {};
  if (type === 'conic') {
    const fromPart = (at[0] ?? '').replace(/^from\s+/i, '').trim();
    return { ...(fromPart ? { from: fromPart } : {}), ...center };
  }
  let shape = '';
  let size = '';
  for (const token of splitTopLevelSpaces(at[0] ?? '')) {
    const lower = token.toLowerCase();
    if (lower === 'circle' || lower === 'ellipse') {
      shape = lower;
    } else if (RADIAL_SIZE_KW.has(lower) || isLength(token)) {
      size = size ? `${size} ${token}` : token;
    }
  }
  return { shape, size, ...center };
}

export function gradientCenter(gradient: Gradient): { x: string; y: string } {
  return { x: gradient.posX.trim() || '50%', y: gradient.posY.trim() || '50%' };
}

function radialPrelude(gradient: Gradient): string {
  const shapeSize = [gradient.shape.trim(), gradient.size.trim()].filter(Boolean).join(' ');
  const x = gradient.posX.trim();
  const y = gradient.posY.trim();
  const centered = (!x || x === '50%') && (!y || y === '50%');
  const at = centered ? '' : `at ${x || '50%'} ${y || '50%'}`;
  return [shapeSize, at].filter(Boolean).join(' ');
}

function conicPrelude(gradient: Gradient): string {
  const from = gradient.from.trim() ? `from ${gradient.from.trim()}` : '';
  const x = gradient.posX.trim();
  const y = gradient.posY.trim();
  const centered = (!x || x === '50%') && (!y || y === '50%');
  const at = centered ? '' : `at ${x || '50%'} ${y || '50%'}`;
  return [from, at].filter(Boolean).join(' ');
}

export function blankGradientOf(type: GradientType): Gradient {
  return {
    type,
    repeating: false,
    angle: '',
    shape: '',
    size: '',
    from: '',
    posX: '',
    posY: '',
    stops: [],
  };
}

export function serializeGradient(gradient: Gradient): string {
  const functionName = `${gradient.repeating ? 'repeating-' : ''}${gradient.type}-gradient`;
  const prelude = gradient.type === 'linear' ? gradient.angle.trim() : gradient.type === 'radial' ? radialPrelude(gradient) : conicPrelude(gradient);
  const stops = gradient.stops.map((stop) => (stop.pos.trim() ? `${stop.color.trim()} ${stop.pos.trim()}` : stop.color.trim())).join(', ');
  return `${functionName}(${prelude ? `${prelude}, ` : ''}${stops})`;
}

export function stopsBarCss(stops: GradientStop[]): string {
  if (stops.length < 2) {
    return 'transparent';
  }
  const parts = stops.map((stop, i) => {
    const position = stop.pos.trim() || `${Math.round((i / (stops.length - 1)) * 100)}%`;
    return `${stop.color.trim() || 'transparent'} ${position}`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function stopPercent(stops: GradientStop[], i: number): number {
  const raw = stops[i]?.pos.trim();
  const match = raw ? /^(-?[\d.]+)%$/.exec(raw) : undefined;
  const amount = match ? parseFloat(match[1] ?? '') : Number.NaN;
  if (Number.isFinite(amount)) {
    return Math.max(0, Math.min(100, amount));
  }
  return stops.length > 1 ? (i / (stops.length - 1)) * 100 : 0;
}

const PERCENT_DECIMALS = 2;
const PERCENT_SCALE = 10 ** PERCENT_DECIMALS;

export function clampedPercent(value: number): number {
  assert(Number.isFinite(value), 'clampedPercent: a position is a finite number');
  const rounded = Math.round(Math.max(0, Math.min(100, value)) * PERCENT_SCALE) / PERCENT_SCALE;
  const percent = rounded + 0;
  assert(percent >= 0, 'clampedPercent: a position is at least 0');
  assert(percent <= 100, 'clampedPercent: a position is at most 100');
  return percent;
}

export function formatPercent(value: number): string {
  const text = `${clampedPercent(value)}%`;
  assert(PLAIN_PERCENT_RE.test(text), 'formatPercent: a position is written in plain notation');
  return text;
}

const PLAIN_PERCENT_RE = /^\d{1,3}(\.\d+)?%$/;

export function withStopAt(gradient: Gradient, index: number, percent: number): Gradient {
  assert(Number.isSafeInteger(index), 'withStopAt: a stop index is an integer');
  assert(index >= 0, 'withStopAt: a stop index is at least 0');
  assert(index < gradient.stops.length, 'withStopAt: the stop exists');
  const position = formatPercent(percent);
  const next = { ...gradient, stops: gradient.stops.map((stop, other) => (other === index ? { ...stop, pos: position } : stop)) };
  const reread = parseGradient(serializeGradient(next));
  if (reread?.stops.length === next.stops.length) {
    assert(reread.stops[index]?.pos === position, 'withStopAt: the written stop reads back at its position');
  }
  return next;
}

export function stopPositionWritable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') {
    return true;
  }
  if (/^[a-z-]+\(/i.test(trimmed)) {
    return true;
  }
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%|em|rem|vw|vh|vmin|vmax|ch)?$/i.exec(trimmed);
  return match !== null && Number.isFinite(parseFloat(match[1] ?? ''));
}


const SIDE_DEG: Record<string, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  'right top': 45,
  'bottom right': 135,
  'bottom left': 225,
  'left top': 315,
};

export function angleToDegrees(angle: string): number {
  const normalized = angle.trim().toLowerCase();
  if (!normalized) {
    return 180;
  }
  const match = normalized.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
  if (match) {
    const degrees = matchedDegrees(parseFloat(match[1] ?? ''), match[2]);
    return Number.isFinite(degrees) ? degrees : 180;
  }
  if (normalized.startsWith('to ')) {
    const sides = normalized.slice(3).trim().split(/\s+/).filter(Boolean).sort().join(' ');
    return SIDE_DEG[sides] ?? 180;
  }
  return 180;
}

function matchedDegrees(amount: number, unit: string | undefined): number {
  switch (unit) {
    case 'turn':
      return amount * 360;
    case 'grad':
      return amount * 0.9;
    case 'rad':
      return (amount * 180) / Math.PI;
    case 'deg':
    case undefined:
      return amount;
    default:
      return Number.NaN;
  }
}

export function degreesToAngle(deg: number): string {
  assert(Number.isFinite(deg), 'degreesToAngle: an angle is a finite number');
  const whole = Number.isSafeInteger(Math.round(deg)) ? Math.round(deg) : 180;
  const normalized = (((whole % 360) + 360) % 360) + 0;
  assert(Number.isSafeInteger(normalized), 'degreesToAngle: a whole number of degrees');
  assert(normalized >= 0, 'degreesToAngle: at least 0');
  assert(normalized < 360, 'degreesToAngle: less than one turn');
  return `${normalized}deg`;
}


type RGBA = [number, number, number, number];

function parseColor(input: string): RGBA | undefined {
  const normalized = input.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let hexDigits = hex[1] ?? '';
    if (hexDigits.length === 3 || hexDigits.length === 4) {
      hexDigits = hexDigits
        .split('')
        .map((x) => x + x)
        .join('');
    }
    if (hexDigits.length === 6) {
      hexDigits += 'ff';
    }
    if (hexDigits.length !== 8) {
      return undefined;
    }
    return [
      parseInt(hexDigits.slice(0, 2), 16),
      parseInt(hexDigits.slice(2, 4), 16),
      parseInt(hexDigits.slice(4, 6), 16),
      parseInt(hexDigits.slice(6, 8), 16) / 255,
    ];
  }
  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = (rgb[1] ?? '').split(',').map((part) => parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((channel) => Number.isNaN(channel))) {
      return undefined;
    }
    const [red = 0, green = 0, blue = 0, alpha] = parts;
    return [red, green, blue, alpha === undefined || Number.isNaN(alpha) ? 1 : alpha];
  }
  return undefined;
}

function formatColor([red, green, blue, alpha]: RGBA): string {
  const hx = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  if (alpha >= 1) {
    return `#${hx(red)}${hx(green)}${hx(blue)}`;
  }
  const channels = `${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}`;
  return `rgba(${channels}, ${Math.round(alpha * 100) / 100})`;
}

export function mixColors(left: string, right: string, amount: number): string {
  const leftColor = parseColor(left);
  const rightColor = parseColor(right);
  if (!leftColor || !rightColor) {
    return left;
  }
  return formatColor([
    leftColor[0] + (rightColor[0] - leftColor[0]) * amount,
    leftColor[1] + (rightColor[1] - leftColor[1]) * amount,
    leftColor[2] + (rightColor[2] - leftColor[2]) * amount,
    leftColor[3] + (rightColor[3] - leftColor[3]) * amount,
  ]);
}

export function colorAt(stops: GradientStop[], percent: number): string {
  if (!stops.length) {
    return 'transparent';
  }
  const last = stops.length - 1;
  const percents = stops.map((_, i) => stopPercent(stops, i));
  const firstStop = stops[0];
  const lastStop = stops[last];
  if (firstStop === undefined || lastStop === undefined) {
    throw new Error('Gradient stop invariant failed');
  }
  if (percent <= (percents[0] ?? 0)) {
    return firstStop.color;
  }
  if (percent >= (percents[last] ?? 100)) {
    return lastStop.color;
  }
  for (let i = 0; i < last; i += 1) {
    const leftPercent = percents[i];
    const rightPercent = percents[i + 1];
    const leftStop = stops[i];
    const rightStop = stops[i + 1];
    if (leftPercent === undefined || rightPercent === undefined) {
      continue;
    }
    if (leftStop === undefined || rightStop === undefined) {
      continue;
    }
    if (percent >= leftPercent && percent <= rightPercent) {
      const span = rightPercent - leftPercent;
      return mixColors(leftStop.color, rightStop.color, span === 0 ? 0 : (percent - leftPercent) / span);
    }
  }
  return lastStop.color;
}
