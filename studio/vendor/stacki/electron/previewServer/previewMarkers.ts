import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assert } from '../../shared/core/assert';
import { isDefaultsCanvas } from '../../shared/properties/defaultsCanvas';
import { toDigest } from '../../shared/core/brand';
import { stampComment, stampPathProblem, type PreviewStamp } from '../../shared/page/previewToken';
import { markChunkHtml, parsePage, resolveChunks, serializePageMarked } from '../parse/astroParser';
import { withScopeCapture } from './scopeCapture';
export { scanStyleBlocks } from './styleBlockScan';
export { loopbackGuardMiddleware } from './loopbackGuard';
import { isLoopbackAddress } from './loopbackGuard';
import { parseVariantHeader, VARIANT_HEADER, VARIANT_SCOPE_GLOBAL, withVariantOverride, type VariantOverride } from '../../shared/page/variantOverride';

export interface MarkedSource {
  readonly code: string;
  readonly source: string;
  readonly page: boolean;
  readonly file: string;
}

export function markSourceFile(file: string, projectDirectories: readonly string[]): MarkedSource | undefined {
  if (!file.endsWith('.astro')) {
    return undefined;
  }
  const projectFile = projectDirectories
    .map((directory) => ({
      directory,
      relative: path.relative(directory, file).split(path.sep).join('/'),
    }))
    .find(({ relative }) => relative.startsWith('src/') || isDefaultsCanvas(relative));
  if (projectFile === undefined) {
    return undefined;
  }
  const bytes = readFileSync(file);
  const source = bytes.toString('utf8');
  const parsed = parsePage(source, { locs: true });
  if (!parsed.editable) {
    return undefined;
  }
  resolveChunks(parsed.model, file);
  const relativePath = projectFile.relative;
  assert(stampPathProblem(relativePath) === undefined, 'A file under src has a project-relative path');
  const page = relativePath.startsWith('src/pages/') || isDefaultsCanvas(relativePath);
  const checksum = toDigest(createHash('sha256').update(bytes).digest('hex'));
  const stamp: PreviewStamp = { file: relativePath, checksum };
  const marked = serializePageMarked(parsed.model, page ? '' : `${relativePath}|`, stamp, source);
  assert(marked.endsWith('\n'), 'The marked serializer ends on a line of its own');
  const captured = withScopeCapture(marked, relativePath);
  assert(captured.endsWith('\n'), 'The scope capture keeps the template’s last line');
  const template = captured.endsWith('---\n') ? captured : captured.slice(0, -1);
  return { code: `${template}${stampComment(stamp)}\n`, source, page, file: relativePath };
}

export function markCanvasSourceFile(file: string, projectDirectories: readonly string[]): MarkedSource | undefined {
  const marked = markSourceFile(file, projectDirectories);
  if (marked === undefined || marked.page) {
    return marked;
  }
  const code = withVariantOverride(marked.code, marked.file);
  assert(code.length > marked.code.length, 'markCanvasSourceFile: the preview check is added');
  return { ...marked, code };
}

const variantScope = new AsyncLocalStorage<VariantOverride>();
Reflect.set(globalThis, VARIANT_SCOPE_GLOBAL, variantScope);

export function variantScopeMiddleware(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
  const override = isLoopbackAddress(request.socket.remoteAddress) ? parseVariantHeader(request.headers[VARIANT_HEADER]) : undefined;
  if (override === undefined) {
    next();
    return;
  }
  assert(override.prop.length > 0, 'variantScopeMiddleware: an override names its prop');
  variantScope.run(override, next);
}

export function markChunkFile(file: string, prefix: string, { group }: { readonly group: boolean }): string | undefined {
  const bytes = readFileSync(file);
  return markChunkHtml(bytes.toString('utf8'), prefix, { group });
}
