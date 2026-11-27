
import fs from 'node:fs';
import { parseSerializePage } from './astroParserValidation';
import { readFrontmatter, writeFrontmatter } from '../../shared/page/frontmatterSource';
import type { FrontmatterModel, ImportMember } from '../../shared/page/frontmatterSource';
import { assertTreeInvariants } from '../../shared/page/pageNode';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode, ParserPageModel, ParsedPage, SourceLocation } from './astroParserTypes';
import { assignPathIds, parseAttrs, serializeAttrs, required } from './astroAttrs';
import { readFence } from './astroFence';
import { parseState, resetParseBail } from './astroParseState';
import { serializeNode, serializeNodes } from './astroSerialize';
import { parseTemplate } from './astroTemplate';
import { serializeNodesMarked, type MarkedSource } from './astroSerializeMarked';
import { resolveChunks, chunkImportMarks, markChunkHtml } from './astroChunks';
import { parsePropSchema } from './astroPropSchema';
import { parseSlots, rootTag, rootComponent, defaultSlotInline, parseExtendsTag } from './astroComponentApi';
import type { PreviewStamp } from '../../shared/page/previewToken';

export {
  parsePage,
  locateSelection,
  serializePage,
  serializePageMarked,
  parseTemplate,
  serializeNodes,
  resolveChunks,
  markChunkHtml,
  parsePropSchema,
  parseExtendsTag,
  parseSlots,
  defaultSlotInline,
  rootTag,
  rootComponent,
  parseAttrs,
  serializeAttrs,
};


function parsePage(source: string, options: { readonly locs?: boolean } = {}): ParsedPage {
  if (typeof source !== 'string' || source.length > LIMITS.ipcFieldCharsMax) {
    return {
      editable: false,
      reason: 'Page source is invalid or exceeds the size limit.',
      bail: undefined,
    };
  }
  const fence = readFence(source);
  if (fence.kind === 'unreadable') {
    return {
      editable: false,
      reason: `Page contains markup the visual editor cannot represent. Found ${fence.what}.`,
      bail: { what: fence.what, near: fence.near },
    };
  }
  const frontmatter = fence.kind === 'fence' ? fence.code : '';
  const hadFrontmatter = fence.kind === 'fence';
  const bodyStart = fence.kind === 'fence' ? fence.length : source.startsWith('\uFEFF') ? 1 : 0;
  const body = source.slice(bodyStart);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  const frontmatterModel = readFrontmatter(frontmatter);
  const { imports } = frontmatterModel;

  resetParseBail();
  const { nodes: topNodes, clean, trailingBlank } = parseTemplate(body, options.locs ? bodyStart : undefined);
  if (topNodes.length) {
    const lead = (body.match(/^(?:[ \t]*\r?\n)+/) || [''])[0];
    const blanks = (lead.match(/\n/g) || []).length;
    const first = required(topNodes[0], 'First top-level node exists');
    if (blanks) {
      first.blankBefore = blanks;
    } else {
      delete first.blankBefore;
    }
  }
  if (!clean) {
    let where = '';
    if (parseState.lastBail) {
      const at = source.indexOf(parseState.lastBail.near);
      const line = at === -1 ? 0 : source.slice(0, at).split('\n').length;
      where = ` Found ${parseState.lastBail.what}${line ? ` on line ${line}` : ''}.`;
    }
    return {
      editable: false,
      reason: `Page contains markup the visual editor cannot represent.${where}`,
      bail: parseState.lastBail ? { what: parseState.lastBail.what, near: parseState.lastBail.near } : undefined,
    };
  }

  const importsByName = Object.fromEntries(imports.filter((i) => !i.typeOnly).map((i) => [i.name, i]));

  parsePageLayout(topNodes, importsByName);

  parsePageMarkDynamic(topNodes, importsByName, 0);

  assignPathIds(topNodes, '', 0);
  assertTreeInvariants(topNodes);

  const model: ParserPageModel = {
    ...frontmatterModel,
    hadFrontmatter,
    trailingBlank,
    eol,
    nodes: topNodes,
    ...(options.locs ? { bodyStart } : {}),
  };
  const refusal = writerRefusal(model);
  if (refusal !== undefined) {
    return {
      editable: false,
      reason: `Page contains markup the visual editor cannot represent. Found ${refusal}.`,
      bail: { what: refusal, near: '' },
    };
  }
  return { editable: true, model };
}

function writerRefusal(model: ParserPageModel): string | undefined {
  try {
    parseSerializePage(model);
    return undefined;
  } catch (failure: unknown) {
    return `a part of the page past the editor's limits (${failure instanceof Error ? failure.message : String(failure)})`;
  }
}

function serializeFrontmatter(model: FrontmatterModel, lines: string[], specFor?: (imp: ImportMember) => string): void {
  const text = writeFrontmatter(model, specFor);
  if (text) {
    lines.push(text.replace(/\r?\n$/, ''));
  }
}

function serializePage(input: unknown, unit?: string): string {
  const model = parseSerializePage(input);
  const fmLines: string[] = [];
  serializeFrontmatter(model, fmLines);
  const lines: string[] = [];
  if (fmLines.length || model.hadFrontmatter !== false) {
    lines.push('---', ...fmLines, '---');
  }

  for (const node of model.nodes) {
    serializeNode(node, '', lines, 0, unit);
  }
  for (let i = 0; i < (model.trailingBlank || 0); i++) {
    lines.push('');
  }
  const source = lines.join('\n') + '\n';
  return model.eol === '\r\n' ? source.replace(/\r?\n/g, '\r\n') : source.replace(/\r\n/g, '\n');
}

function serializePageMarked(input: unknown, prefix = '', stamp: PreviewStamp | undefined = undefined, source: MarkedSource = undefined): string {
  const model = parseSerializePage(input);
  const marks = chunkImportMarks(model);
  const lines = ['---'];
  serializeFrontmatter(model, lines, (imp) => {
    const mark = /\.html\?raw$/i.test(imp.path) ? marks.get(imp.name) : undefined;
    return mark ? `${imp.path}&avb=${mark.path}${mark.group ? '&avbg=1' : ''}` : imp.path;
  });
  lines.push('---');
  const roots = serializeNodesMarked(model.nodes, { pathOf: (i) => `${prefix}${i}`, atRoot: true, stamp, source });
  if (roots !== '') {
    lines.push(roots);
  }
  return lines.join('\n') + '\n';
}


function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function locateSelection(absPath: string, indexPath: string): SourceLocation | undefined {
  let source;
  try {
    source = fs.readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
  const bare = { file: absPath };
  if (!indexPath) {
    return bare;
  }

  const parsed = parsePage(source, { locs: true });
  if (!parsed.editable) {
    return bare;
  }
  if (indexPath === 'frontmatter') {
    return parsed.model.bodyStart ? { file: absPath, startLine: 1, endLine: lineOf(source, parsed.model.bodyStart - 1) } : bare;
  }
  resolveChunks(parsed.model, absPath, { locs: true });

  let file = absPath;
  let list: ParserNode[] | undefined = parsed.model.nodes;
  let node = undefined;
  for (const part of indexPath.split('.')) {
    if (node?.chunkFile) {
      file = node.chunkFile;
    }
    node = Array.isArray(list) ? list[Number(part)] : undefined;
    if (!node) {
      return { file };
    }
    list = node.children;
  }
  if (!node) {
    return { file };
  }
  let span: { readonly start?: number | undefined; readonly end?: number | undefined } = node;
  if (typeof span.start !== 'number' && Array.isArray(node.children)) {
    const placed = node.children.filter((child) => typeof child.start === 'number');
    if (placed.length) {
      span = {
        start: required(placed[0], 'First placed child exists').start,
        end: required(placed[placed.length - 1], 'Last placed child exists').end,
      };
    }
  }
  if (typeof span.start !== 'number') {
    return { file };
  }

  let text = source;
  if (file !== absPath) {
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return { file };
    }
  }
  let start = span.start;
  let end = Math.min(required(span.end, 'Placed node has an end offset'), text.length);
  while (start < end && /\s/.test(text.charAt(start))) {
    start++;
  }
  while (end > start && /\s/.test(text.charAt(end - 1))) {
    end--;
  }
  return { file, startLine: lineOf(text, start), endLine: lineOf(text, end - 1) };
}

function parsePageMarkDynamic(list: readonly ParserNode[], importsByName: Readonly<Record<string, ImportMember>>, depth: number): void {
  assert(depth <= LIMITS.treeDepthMax, 'parsePageMarkDynamic: depth limit');
  for (const node of list) {
    if (node.kind === 'component' && node.name !== 'Fragment') {
      const imp = importsByName[node.name];
      if (!imp) {
        node.dynamicTag = true;
      }
      else if (imp.path === 'astro:assets') {
        node.astroAsset = true;
      }
    }
    if (Array.isArray(node.children)) {
      parsePageMarkDynamic(node.children, importsByName, depth + 1);
    }
  }
}

function parsePageLayout(topNodes: readonly ParserNode[], importsByName: Readonly<Record<string, ImportMember>>): void {
  const significant = topNodes.filter((node) => node.kind !== 'comment');
  let wrapper: ParserNode | undefined;
  const significantFirst = significant[0];
  if (
    significant.length === 1 &&
    significantFirst !== undefined &&
    significantFirst.kind === 'component' &&
    significantFirst.name !== 'Fragment' &&
    significantFirst.children !== undefined &&
    !!importsByName[significantFirst.name]
  ) {
    wrapper = significantFirst;
  } else if (significant.length > 1) {
    const layoutish = significant.filter(
      (node) => node.kind === 'component' && node.children !== undefined && /layout/i.test(importsByName[node.name]?.path || ''),
    );
    if (layoutish.length === 1) {
      wrapper = layoutish[0];
    }
  }
  if (wrapper) {
    wrapper.id = 'layout';
  }
}
