
import { assert } from '../../../../shared/core/assert';
import { documentFromCode, scanPageNow, type EmbedDocument, type EmbedScan, type EmbedSource } from '../model/webflow';
import { nodeById } from '../model/webflowElement';

export const MEMORY_DOCUMENTS_MAX = 1024;

const remembered = new Map<string, EmbedDocument>();

export interface MemoryContent {
  readonly scan: EmbedScan;
  readonly docs: ReadonlyArray<EmbedDocument | undefined>;
  readonly missing: readonly EmbedSource[];
}

export function rememberDocuments(docs: readonly EmbedDocument[], openFilePath: string | undefined): void {
  for (const document of docs) {
    remembered.delete(document.source.key);
    remembered.set(document.source.key, document);
  }
  if (openFilePath !== undefined) {
    remembered.delete(`astro:${openFilePath}`);
  }
  for (const oldest of remembered.keys()) {
    if (remembered.size <= MEMORY_DOCUMENTS_MAX) {
      break;
    }
    remembered.delete(oldest);
  }
  assert(remembered.size <= MEMORY_DOCUMENTS_MAX, 'rememberDocuments: the memory is bounded');
}

export function forgetDocuments(): void {
  remembered.clear();
}

export function memoryContent(): MemoryContent {
  const page = scanPageNow();
  const docs: Array<EmbedDocument | undefined> = [];
  const missing: EmbedSource[] = [];
  for (const source of page.pageEmbeds) {
    const document = rememberedDocument(source);
    docs.push(document);
    if (document === undefined) {
      missing.push(source);
    }
  }
  assert(docs.length === page.pageEmbeds.length, 'memoryContent: one slot per source');
  assert(missing.length <= docs.length, 'memoryContent: only listed sources are missing');
  const scan: EmbedScan = {
    parentByKey: page.parentByKey,
    childrenByKey: page.childrenByKey,
    elementByKey: page.elementByKey,
    embeds: page.pageEmbeds,
    inComponentContext: page.inComponentContext,
  };
  return { scan, docs, missing };
}

export function filledDocuments(content: MemoryContent, read: readonly EmbedDocument[]): EmbedDocument[] {
  const readByKey = new Map(read.map((document) => [document.source.key, document]));
  const out: EmbedDocument[] = [];
  content.docs.forEach((document, index) => {
    const filled = document ?? readByKey.get(content.scan.embeds[index]?.key ?? '');
    if (filled !== undefined) {
      out.push(filled);
    }
  });
  assert(out.length <= content.scan.embeds.length, 'filledDocuments: at most one document per source');
  return out;
}

function rememberedDocument(source: EmbedSource): EmbedDocument | undefined {
  const known = remembered.get(source.key);
  if (source.origin.kind === 'node') {
    const text = String(nodeById(source.origin.nodeId)?.inner ?? '');
    if (known !== undefined && sameSource(known.source, source) && (known.code === text || known.historyBase !== known.code)) {
      return known;
    }
    return documentFromCode(source, text);
  }
  if (known === undefined) {
    return undefined;
  }
  if (sameSource(known.source, source)) {
    return known;
  }
  return documentFromCode(source, known.code);
}

function sameSource(left: EmbedSource, right: EmbedSource): boolean {
  assert(left.key === right.key, 'sameSource: compared by key first');
  if (left.order !== right.order || left.label !== right.label) {
    return false;
  }
  if (left.fromComponent !== right.fromComponent || left.componentName !== right.componentName) {
    return false;
  }
  if (JSON.stringify(left.styleTag) !== JSON.stringify(right.styleTag)) {
    return false;
  }
  return JSON.stringify(left.origin) === JSON.stringify(right.origin);
}

export function rememberedDocumentCount(): number {
  return remembered.size;
}
