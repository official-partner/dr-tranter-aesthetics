import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, type AppCanvasCursor, type AppCanvasCursorRequest } from '../../../shared/properties/appsRpc';

export type CursorImageOutcome = { readonly ok: true; readonly cursor: AppCanvasCursor } | { readonly ok: false; readonly reason: string };

export type BundleBytesReader = (appId: string, path: string, bytesMax: number) => Promise<Uint8Array | undefined>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_SIZE_OFFSET = 16;

export async function resolveCanvasCursor(appId: string, request: AppCanvasCursorRequest, read: BundleBytesReader): Promise<CursorImageOutcome> {
  if (typeof request === 'string') {
    return { ok: true, cursor: request };
  }
  const bytes = await read(appId, request.image, APP_RPC_LIMITS.cursorImageBytesMax);
  if (bytes === undefined) {
    return { ok: false, reason: `cursor.image must be a file in the app’s bundle of at most ${APP_RPC_LIMITS.cursorImageBytesMax} bytes` };
  }
  assert(bytes.length <= APP_RPC_LIMITS.cursorImageBytesMax, 'A reader keeps to the byte bound');
  const checked = request.image.endsWith('.png') ? checkPNG(bytes) : checkSVG(bytes);
  if (!checked.ok) {
    return checked;
  }
  const url = `data:${checked.type};base64,${base64Of(bytes)}`;
  return { ok: true, cursor: { url, hotspot: request.hotspot } };
}

export function bundleBytesReader(urlFor: (appId: string, path: string) => string): BundleBytesReader {
  return async (appId, path, bytesMax) => {
    let response: Response;
    try {
      response = await fetch(urlFor(appId, path));
    } catch {
      return undefined;
    }
    if (!response.ok || response.body === null) {
      return undefined;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total <= bytesMax) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
      chunks.push(value);
    }
    if (total > bytesMax) {
      await reader.cancel();
      return undefined;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };
}

type Checked = { readonly ok: true; readonly type: 'image/png' | 'image/svg+xml' } | { readonly ok: false; readonly reason: string };

export function checkPNG(bytes: Uint8Array): Checked {
  if (bytes.length < PNG_SIZE_OFFSET + 8 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return { ok: false, reason: 'cursor.image ends in .png but is not a PNG' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return sized(view.getUint32(PNG_SIZE_OFFSET), view.getUint32(PNG_SIZE_OFFSET + 4), 'image/png');
}

export function checkSVG(bytes: Uint8Array): Checked {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'cursor.image ends in .svg but is not UTF-8 text' };
  }
  const root = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (root === undefined) {
    return { ok: false, reason: 'cursor.image ends in .svg but has no <svg> element' };
  }
  const width = pixelsOf(/\swidth\s*=\s*["']\s*([0-9.]+)\s*(?:px)?\s*["']/i.exec(root)?.[1]);
  const height = pixelsOf(/\sheight\s*=\s*["']\s*([0-9.]+)\s*(?:px)?\s*["']/i.exec(root)?.[1]);
  if (width === undefined || height === undefined) {
    return { ok: false, reason: 'A cursor SVG sets width and height in pixels on its <svg> element' };
  }
  return sized(width, height, 'image/svg+xml');
}

function sized(width: number, height: number, type: 'image/png' | 'image/svg+xml'): Checked {
  const max = APP_RPC_LIMITS.cursorImagePxMax;
  if (width < 1 || height < 1 || width > max || height > max) {
    return { ok: false, reason: `A cursor image is 1 to ${max} pixels a side; this one is ${width}×${height}` };
  }
  return { ok: true, type };
}

function pixelsOf(input: string | undefined): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
