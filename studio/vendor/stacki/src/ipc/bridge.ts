import type { PreloadBridge } from '../../shared/ipc/preloadApi';

import { toProjectPath, toFilePath } from '../../shared/core/brand';
import { parseScanResult, type ScanResult } from '../../shared/properties/projectScan';
import { parsePageReadResult, type ParsePageResult } from '../../shared/page/pageNode';
import { parsePageDiskRead, type PageDiskRead } from '../../shared/ipc/pageSave';
import {
  parseSymbolReadResult,
  parseResolvePathResult,
  parseTextResult,
  parseOkResult,
  type SymbolReadResult,
  type ResolvePathResult,
} from '../../shared/ipc/ipcContract';

declare global {
  interface Window {
    avb: PreloadBridge;
  }
}

export async function scanProject(projectPath: string): Promise<ScanResult> {
  const result = await window.avb.scanProject(toProjectPath(projectPath));
  return parseScanResult(result);
}

export async function readPage(path: string): Promise<PageDiskRead> {
  const result = await window.avb.readPage(toFilePath(path));
  return parsePageDiskRead(result);
}

export async function parsePageSource(path: string, source: string): Promise<ParsePageResult & { readonly source: string }> {
  const result = await window.avb.parsePageSource({ pagePath: toFilePath(path), source });
  return parsePageReadResult(result);
}

export async function readText(projectPath: string, rel: string): Promise<string> {
  const result = await window.avb.readSourceText({ projectPath: toProjectPath(projectPath), rel });
  return parseTextResult(result).text;
}

export async function writeText(projectPath: string, rel: string, text: string): Promise<void> {
  const result = await window.avb.writeSourceText({
    projectPath: toProjectPath(projectPath),
    rel,
    text,
  });
  parseOkResult(result);
}

export async function readSymbol(projectPath: string, fromFile: string, spec: string, name: string): Promise<SymbolReadResult> {
  const result = await window.avb.readSymbolSource({
    projectPath: toProjectPath(projectPath),
    fromFile: toFilePath(fromFile),
    spec,
    name,
  });
  return parseSymbolReadResult(result);
}

export async function resolvePath(projectPath: string, fromFile: string, spec: string): Promise<ResolvePathResult> {
  const result = await window.avb.resolveSourcePath({
    projectPath: toProjectPath(projectPath),
    fromFile: toFilePath(fromFile),
    spec,
  });
  return parseResolvePathResult(result);
}
