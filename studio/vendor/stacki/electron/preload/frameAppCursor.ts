const STYLE_ID = 'avb-app-cursor-style';

const CURSOR_URL_CHARS_MAX = 6000;
const CURSOR_PX_MAX = 32;
const CURSOR_URL_PATTERN = /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function receiveAppCursor(data: unknown): boolean {
  if (typeof data !== 'object' || !data || Reflect.get(data, 'type') !== 'avb:app-cursor') {
    return false;
  }
  const value = cursorValue(Reflect.get(data, 'cursor'));
  if (value === undefined) {
    return true;
  }
  document.getElementById(STYLE_ID)?.remove();
  if (value !== 'none') {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `html, html * { cursor: ${value} !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }
  return true;
}

function cursorValue(cursor: unknown): string | undefined {
  if (cursor === 'crosshair' || cursor === 'default' || cursor === 'none') {
    return cursor;
  }
  if (typeof cursor !== 'object' || cursor === null) {
    return undefined;
  }
  const url: unknown = Reflect.get(cursor, 'url');
  const hotspot: unknown = Reflect.get(cursor, 'hotspot');
  if (typeof url !== 'string' || url.length > CURSOR_URL_CHARS_MAX || !CURSOR_URL_PATTERN.test(url)) {
    return undefined;
  }
  if (typeof hotspot !== 'object' || hotspot === null) {
    return undefined;
  }
  const x = pixelOf(Reflect.get(hotspot, 'x'));
  const y = pixelOf(Reflect.get(hotspot, 'y'));
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return `url("${url}") ${x} ${y}, crosshair`;
}

function pixelOf(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    return undefined;
  }
  return input >= 0 && input < CURSOR_PX_MAX ? input : undefined;
}
