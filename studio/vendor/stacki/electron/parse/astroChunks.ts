
import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode, ParserPageModel } from './astroParserTypes';
import { makeId, assignPathIds, required } from './astroAttrs';
import { parseTemplate } from './astroTemplate';
import { serializeNodesMarked } from './astroSerializeMarked';


export function resolveChunks(model: ParserPageModel, pagePath: string, options: { readonly locs?: boolean } = {}): void {
  const rawImports = new Map<string, string>();
  for (const imp of model.imports) {
    if (/\.html\?raw$/i.test(imp.path) && imp.path.startsWith('.')) {
      rawImports.set(imp.name, path.resolve(path.dirname(pagePath), imp.path.replace(/\?raw$/i, '')));
    }
  }
  if (!rawImports.size) {
    return;
  }

  const aggregates = resolveChunksAggregates(model.extraFrontmatter);

  const walk = (list: readonly ParserNode[], depth: number): void => {
    assert(depth <= LIMITS.treeDepthMax, 'resolveChunks: depth limit');
    for (const node of list) {
      if (node.kind === 'component' && node.props?.['set:html']?.type === 'expr' && node.children === undefined) {
        const ref = node.props['set:html'].value.trim();
        if (rawImports.has(ref)) {
          const file = required(rawImports.get(ref), 'Chunk import exists');
          const children = resolveChunksParseFile(file, options);
          if (children) {
            node.chunkFile = file;
            node.children = children;
          }
          continue;
        }
        if (aggregates.has(ref)) {
          const groups: ParserNode[] = [];
          for (const ident of required(aggregates.get(ref), 'Chunk aggregate exists')) {
            if (!rawImports.has(ident)) {
              continue;
            }
            const file = required(rawImports.get(ident), 'Aggregate chunk import exists');
            const children = resolveChunksParseFile(file, options);
            if (children) {
              groups.push({
                id: makeId(),
                kind: 'chunk-group',
                name: ident,
                chunkFile: file,
                children,
              });
            }
          }
          if (groups.length) {
            node.children = groups;
            node.chunkAggregate = true;
          }
          continue;
        }
      }
      if (Array.isArray(node.children)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(model.nodes, 0);
  assignPathIds(model.nodes, '', 0);
}

export function chunkImportMarks(model: ParserPageModel): Map<string, { path: string; group: boolean }> {
  const marks = new Map<string, { path: string; group: boolean }>();
  const walk = (list: readonly ParserNode[], prefix: string, depth: number): void => {
    assert(depth <= LIMITS.treeDepthMax, 'chunkImportMarks: depth limit');
    list.forEach((node, i) => {
      const childPath = prefix ? `${prefix}.${i}` : String(i);
      if (node.chunkFile) {
        const group = node.kind === 'chunk-group';
        const html = node.props?.['set:html'];
        const ident = group ? node.name : html && html.type !== 'bare' ? html.value.trim() : undefined;
        if (ident) {
          marks.set(ident, { path: childPath, group });
        }
      }
      if (Array.isArray(node.children)) {
        walk(node.children, childPath, depth + 1);
      }
    });
  };
  walk(model.nodes, '', 0);
  return marks;
}

export function markChunkHtml(source: string, prefix: string, { group }: { readonly group: boolean }): string | undefined {
  const { nodes, clean } = parseTemplate(source, 0);
  if (!clean) {
    return undefined;
  }
  const roots = serializeNodesMarked(nodes, { pathOf: (i) => `${prefix}.${i}`, atRoot: false, stamp: undefined, source });
  const marked = group ? `<!--avb-s:${prefix}-->${roots}<!--avb-e:${prefix}-->` : roots;
  assert(group || nodes.length === 0 || marked.length > 0, 'markChunkHtml: a chunk with nodes prints them');
  return `${marked}\n`;
}

function resolveChunksParseFile(filePath: string, options: { readonly locs?: boolean }): ParserNode[] | undefined {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const { nodes, clean } = parseTemplate(source, options.locs ? 0 : undefined);
  return clean ? nodes : undefined;
}

function resolveChunksAggregates(extraFrontmatter: string): Map<string, string[]> {
  const aggregates = new Map<string, string[]>();
  const aggRe = /(?:const|let)\s+(\w+)\s*=\s*\[([^\]]*)\]\s*\.join\(/g;
  let am;
  while ((am = aggRe.exec(extraFrontmatter)) !== null) {
    const idents = required(am[2], 'Chunk aggregate members capture')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (idents.length && idents.every((i) => /^\w+$/.test(i))) {
      aggregates.set(required(am[1], 'Chunk aggregate name capture'), idents);
    }
  }

  return aggregates;
}
