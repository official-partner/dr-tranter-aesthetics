
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { Attr } from '../../shared/page/pageNode';
import { parseTemplate, serializeNodes } from './astroParser';
import { type MarkdownNodeList, type PrintNode, type MarkdownLayout, splitFrontmatter, layoutFromFrontmatter, splitLines, lineAt } from './markdownLines';
import { type ParseEnv, parseBlocks, assignPathIds } from './markdownBlocks';

export { type PrintNode, type MarkdownLayout } from './markdownLines';


function serializeBlocks(nodes: readonly PrintNode[] | undefined, out: string[]): void {
  for (const node of nodes ?? []) {
    pushBlanks(out, node.mdBlanksBefore ?? 0);
    serializeBlock(node, out);
  }
  const trailing = nodes && 'mdTrailingBlanks' in nodes ? Number(nodes['mdTrailingBlanks']) : 0;
  pushBlanks(out, trailing);
}

function pushBlanks(out: string[], count: number): void {
  assert(count <= LIMITS.treeNodesMax, 'Blank runs are inside the parser bound');
  for (let i = 0; i < count; i++) {
    out.push('');
  }
}

function attrValue(attr: Attr | undefined): string | undefined {
  return attr !== undefined && 'value' in attr ? attr.value : undefined;
}

function textOf(node: PrintNode): string {
  return (node.children ?? [])
    .filter((child) => child.kind === 'text')
    .map((child) => child.value)
    .join('');
}

function serializeBlock(node: PrintNode, out: string[]): void {
  switch (node.kind) {
    case 'raw-line':
    case 'raw':
      out.push(...String(node.value ?? node.inner ?? '').split('\n'));
      return;
    case 'text':
      out.push(...String(node.value ?? '').split('\n'));
      return;
    case 'comment':
      out.push(`<!--${node.value}-->`);
      return;
    default:
      serializeElement(node, out);
  }
}

function serializeElement(node: PrintNode, out: string[]): void {
  const name = node.name || '';
  if (/^h[1-6]$/.test(name)) {
    serializeHeading(node, out);
  } else if (name === 'p') {
    out.push(...textOf(node).split('\n'));
  } else if (name === 'hr') {
    out.push(node.mdRaw ?? '---');
  } else if (name === 'img') {
    const propText = (name: string): string => attrValue(node.props?.[name]) ?? '';
    const title = propText('title') ? ` "${propText('title')}"` : '';
    out.push(`![${propText('alt')}](${propText('src')}${title})`);
  } else if (name === 'pre') {
    serializeFence(node, out);
  } else if (name === 'blockquote') {
    serializeQuote(node, out);
  } else if (name === 'ul' || name === 'ol') {
    serializeList(node, out);
  } else {
    serializeMarkup(node, out);
  }
}

function serializeHeading(node: PrintNode, out: string[]): void {
  if (node.mdSetext) {
    out.push(textOf(node));
    out.push(node.mdSetext);
    return;
  }
  const hashes = '#'.repeat(Number((node.name ?? '').charAt(1)));
  const indent = node.mdIndent ?? '';
  out.push(`${indent}${hashes}${node.mdGap ?? ' '}${textOf(node)}${node.mdTrail ?? ''}`);
}

function serializeFence(node: PrintNode, out: string[]): void {
  const indent = node.mdIndent ?? '';
  const fence = node.mdFence ?? '```';
  const info = node.mdInfo ?? attrValue(node.props?.['lang']) ?? '';
  out.push(`${indent}${fence}${info}`);
  const lines = textOf(node).split('\n');
  if (lines.length !== 1 || lines[0] !== '') {
    out.push(...lines);
  }
  if (!node.mdUnclosed) {
    out.push(`${indent}${fence}`);
  }
}

function serializeQuote(node: PrintNode, out: string[]): void {
  const inner: string[] = [];
  serializeBlocks(node.children ?? [], inner);
  const gap = node.mdGap ?? ' ';
  for (const line of inner) {
    out.push(line ? `>${gap}${line}` : '>');
  }
}

function serializeList(node: PrintNode, out: string[]): void {
  const ordered = node.name === 'ol';
  const marker = node.mdMarker ?? (ordered ? '.' : '-');
  const start = Number(attrValue(node.props?.['start']) ?? 1) || 1;
  const indent = node.mdIndent ?? '';
  (node.children ?? []).forEach((item, index) => {
    pushBlanks(out, item.mdBlanksBefore ?? 0);
    const number = ordered ? (node.mdNumbers?.[index] ?? start + index) : undefined;
    serializeItem(item, { marker, number, indent }, out);
  });
}

interface ItemMarker {
  readonly marker: string;
  readonly number: number | undefined;
  readonly indent: string;
}

function serializeItem(item: PrintNode, at: ItemMarker, out: string[]): void {
  const bullet = at.number === undefined ? at.marker : `${at.number}${at.marker}`;
  const gap = item.mdGap ?? ' ';
  const inner: string[] = [];
  serializeBlocks(item.children ?? [], inner);
  const pad = ' '.repeat(at.indent.length + bullet.length + gap.length);
  inner.forEach((line, index) => {
    if (index === 0) {
      out.push(`${at.indent}${bullet}${gap}${line}`);
    } else {
      out.push(line ? pad + line : '');
    }
  });
  if (!inner.length) {
    out.push(`${at.indent}${bullet}`);
  }
}

function serializeMarkup(node: PrintNode, out: string[]): void {
  const text = serializeNodes([node]).replace(/\n$/, '');
  if (node.mdSource !== undefined) {
    const original = parseTemplate(node.mdSource);
    if (original.clean && original.nodes.length === 1) {
      if (serializeNodes(original.nodes).replace(/\n$/, '') === text) {
        out.push(...node.mdSource.split('\n'));
        return;
      }
    }
  }
  out.push(...text.split('\n'));
}

function placedLines(lines: readonly string[], layout: MarkdownLayout): string {
  const blank = layout.prefix.trimEnd();
  return lines
    .map((line, index) => {
      if (index === 0) {
        return line;
      }
      return line === '' ? blank : `${layout.prefix}${line}`;
    })
    .join(layout.eol);
}


export interface MarkdownModel {
  readonly format: 'md' | 'mdx';
  readonly imports: readonly { readonly name: string; readonly path: string }[];
  readonly extraFrontmatter: string;
  readonly frontmatterLang: 'yaml';
  readonly layoutPath: string | undefined;
  readonly nodes: MarkdownNodeList;
  readonly mdEol: string;
  readonly mdEndsWithNewline: boolean;
  readonly mdHasFrontmatter: boolean;
  readonly bodyStart: number;
}

export type MarkdownParse =
  { readonly editable: true; readonly model: MarkdownModel } | { readonly editable: false; readonly reason: string; readonly bail: undefined };

function parseMarkdownPage(source: string, { mdx = false }: { readonly mdx?: boolean } = {}): MarkdownParse {
  if (source.length > LIMITS.ipcFieldCharsMax) {
    return { editable: false, reason: 'The page exceeds the source limit.', bail: undefined };
  }
  const bom = source.startsWith('﻿') ? 1 : 0;
  const text = source.slice(bom);
  const { frontmatter, body, offset } = splitFrontmatter(text);
  const env: ParseEnv = { mdx, imports: [], esm: [] };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(body, bom + offset);
  const endsWithNewline = lineAt(lines, lines.length - 1).text === '';
  if (endsWithNewline) {
    lines.pop();
  }
  const nodes = parseBlocks(lines, env, 0);
  const size = assignPathIds(nodes);
  if (size.nodes > LIMITS.treeNodesMax || size.depth > LIMITS.treeDepthMax) {
    return { editable: false, reason: 'The page exceeds the tree limits.', bail: undefined };
  }
  return {
    editable: true,
    model: {
      format: mdx ? 'mdx' : 'md',
      imports: env.imports,
      extraFrontmatter: frontmatter ?? '',
      frontmatterLang: 'yaml',
      layoutPath: layoutFromFrontmatter(frontmatter),
      nodes,
      mdEol: eol,
      mdEndsWithNewline: endsWithNewline,
      mdHasFrontmatter: frontmatter !== undefined,
      bodyStart: bom + offset,
    },
  };
}

function serializeMarkdownPage(
  model: Pick<MarkdownModel, 'extraFrontmatter' | 'mdHasFrontmatter' | 'mdEol' | 'mdEndsWithNewline'> & { readonly nodes: readonly PrintNode[] },
): string {
  const out: string[] = [];
  const fm = model.extraFrontmatter;
  if (model.mdHasFrontmatter || fm.trim()) {
    out.push('---');
    if (fm !== '') {
      out.push(...fm.split(/\r?\n/));
    }
    out.push('---');
  }
  serializeBlocks(model.nodes, out);
  const eol = model.mdEol || '\n';
  return out.join(eol) + (model.mdEndsWithNewline === false ? '' : eol);
}

function printMarkdownNode(node: PrintNode, layout: MarkdownLayout): string {
  const out: string[] = [];
  serializeBlock(node, out);
  return placedLines(out, layout);
}

function printMarkdownItem(item: PrintNode, at: Pick<ItemMarker, 'marker' | 'number'> & { readonly indent: string }, layout: MarkdownLayout): string {
  const out: string[] = [];
  serializeItem(item, at, out);
  const [first, ...rest] = out;
  assert(first !== undefined, 'An item prints at least its marker line');
  assert(first.startsWith(at.indent), 'An item line starts with its list indentation');
  return placedLines([first.slice(at.indent.length), ...rest], layout);
}

function printMarkdownFrontmatter(yaml: string, eol: string): string {
  const lines = yaml === '' ? [] : yaml.split(/\r?\n/);
  return ['---', ...lines, '---'].join(eol);
}

export { layoutFromFrontmatter, parseMarkdownPage, printMarkdownFrontmatter, printMarkdownItem, printMarkdownNode, serializeMarkdownPage, splitFrontmatter };
