import { request } from '../../../../src/features/project/projectClient';
import { resolveImport } from '../../../../src/features/source/imports';
import { parseResolvePathResult } from '../../shared/ipc/ipcContract';
import type { ResolvePathResult } from '../../shared/ipc/ipcContract';
import { toProjectPath, toFilePath } from '../../shared/core/brand';
import { boolean, count, list, object, optional, pathText, record, text } from '../../shared/core/boundary';
import type { WireAssetEntry } from '../../shared/ipc/ipcResults';
import type { Result } from '../../shared/core/result';

const entryBase = object({ rel: pathText, name: text, parent: pathText, root: text });
const entryFile = object({ abs: pathText, size: count, modifiedMs: optional(count) });
const entryDirectory = object({ isRoot: optional(boolean) });

export function parseAssetEntry(input: unknown): WireAssetEntry {
  const value = record(input);
  const base = entryBase(value);
  if (boolean(value['isDir'])) {
    const { isRoot } = entryDirectory(value);
    return isRoot ? { ...base, isDir: true, isRoot: true } : { ...base, isDir: true };
  }
  const { abs, size, modifiedMs } = entryFile(value);
  return modifiedMs === undefined ? { ...base, isDir: false, abs, size } : { ...base, isDir: false, abs, size, modifiedMs };
}

export const parseAssetEntries = object({ entries: list(parseAssetEntry) });

export async function listAssetEntries(_projectPath: string): Promise<Result<readonly WireAssetEntry[], string>> {
  let response: unknown;
  try {
    response = await request('/studio/api/assets');
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, value: parseAssetEntries(response).entries };
}

export function onAssetEntriesChanged(callback: () => void): () => void {
  window.addEventListener('studio:assets-changed', callback);
  return () => window.removeEventListener('studio:assets-changed', callback);
}

export async function resolveAssetImport(projectPath: string, fromFile: string, spec: string): Promise<ResolvePathResult> {
  const payload = {
    projectPath: toProjectPath(projectPath),
    fromFile: toFilePath(fromFile),
    spec: pathText(spec),
  };
  let response: unknown;
  try {
    const rel = resolveImport(payload.fromFile, payload.spec);
    response = rel ? { ok: true, rel } : { ok: false };
  } catch {
    return { ok: false };
  }
  const result = parseResolvePathResult(response);
  return result.ok ? { ok: true, rel: pathText(result.rel) } : result;
}

function imageDimension(input: unknown): number {
  const value = count(input);
  if (value === 0 || value > 0xffff_ffff) {
    throw new Error('AssetDimensions: expected positive 32-bit dimension');
  }
  return value;
}
const dimensions = object({ w: imageDimension, h: imageDimension });
export function parseAssetDimensions(input: unknown) {
  return optional(dimensions)(record(input)['dims']);
}

export async function readAssetDimensions(projectPath: string, rel: string): Promise<Result<ReturnType<typeof parseAssetDimensions>, string>> {
  const payload = { projectPath: toProjectPath(projectPath), rel: pathText(rel) };
  let response: unknown;
  try {
    response = await new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error('Image preview timed out')), 10000);
      image.onload = () => {
        clearTimeout(timer);
        resolve({ dims: { w: image.naturalWidth, h: image.naturalHeight } });
      };
      image.onerror = () => {
        clearTimeout(timer);
        resolve({});
      };
      image.src = '/studio/api/asset?file=' + encodeURIComponent(payload.rel);
    });
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, value: parseAssetDimensions(response) };
}
