import { assert } from '../../shared/core/assert';
import { safeHTMLLink } from './htmlFieldModel';
import { escapeHTML } from './richTextModel';

export const MARKDOWN_LIMITS = {
  depthMax: 8,
  inlineDepthMax: 16,
  labelCharsMax: 200,
} as const;

export const KEPT_CLASS = 'stacki-markdown-kept';

export type MarkdownBlockKind = 'paragraph' | 'heading' | 'code' | 'rule' | 'quote' | 'list' | 'table' | 'kept';

export interface MarkdownReadOptions {
  readonly extensions: 'commonmark' | 'gfm';
}

export const TASK_CLASS = 'task';
export const TASK_DONE_CLASS = 'done';

export interface MarkdownItem {
  readonly html: string;
  readonly source: string;
  readonly number: number | undefined;
}

export interface MarkdownBlock {
  readonly kind: MarkdownBlockKind;
  readonly source: string;
  readonly html: string;
  readonly items: readonly MarkdownItem[];
}

export interface MarkdownPlacedBlock {
  readonly gap: string;
  readonly block: MarkdownBlock;
}

export interface MarkdownStyle {
  readonly bullet: '-' | '*' | '+';
  readonly delimiter: '.' | ')';
  readonly fence: '`' | '~';
  readonly emphasis: '*' | '_';
  readonly strong: '**' | '__';
  readonly rule: string;
  readonly setext: boolean;
  readonly wrapColumns: number | undefined;
  readonly infos: ReadonlyMap<string, string>;
  readonly addresses: ReadonlyMap<string, string>;
  readonly references: ReadonlyMap<string, string>;
  readonly autolinks: ReadonlySet<string>;
}

export interface MarkdownDocument {
  readonly lead: string;
  readonly blocks: readonly MarkdownPlacedBlock[];
  readonly trail: string;
  readonly style: MarkdownStyle;
}

export function markdownHTML(document: MarkdownDocument): string {
  const html = document.blocks.map((placed) => placed.block.html).join('');
  assert(document.blocks.length === 0 || html.length > 0, 'Every block is shown');
  return html;
}

export function parseMarkdown(markdown: string, options: MarkdownReadOptions = { extensions: 'commonmark' }): MarkdownDocument {
  const style = newStyleBuilder();
  const lines = splitLines(markdown);
  const references = linkDefinitions(lines.map((line) => line.text));
  const context: RenderContext = { style, references, depth: 0, gfm: options.extensions === 'gfm' };
  const scanned = scanBlocks(lines.map((line) => line.text));
  const blocks: MarkdownPlacedBlock[] = [];
  let previousEnd = 0;
  let lead = '';
  for (const scan of scanned) {
    const first = lines[scan.first];
    const last = lines[scan.end - 1];
    assert(first !== undefined, 'A block starts on a line');
    assert(last !== undefined, 'A block ends on a line');
    const start = first.start;
    const end = last.start + last.text.length + last.carriage.length;
    const between = markdown.slice(previousEnd, start);
    if (blocks.length === 0) {
      lead = between;
    }
    const source = markdown.slice(start, end);
    blocks.push({ gap: blocks.length === 0 ? '' : between, block: topBlock(scan, lines, source, context) });
    previousEnd = end;
  }
  const trail = blocks.length === 0 ? '' : markdown.slice(previousEnd);
  if (blocks.length === 0) {
    lead = markdown;
  }
  const document: MarkdownDocument = { lead, blocks, trail, style: finishStyle(style) };
  assert(printDocument(document) === markdown, 'A body read into blocks prints back byte for byte');
  return document;
}

export function printDocument(document: Pick<MarkdownDocument, 'lead' | 'blocks' | 'trail'>): string {
  return document.lead + document.blocks.map((placed) => placed.gap + placed.block.source).join('') + document.trail;
}


interface Line {
  readonly text: string;
  readonly carriage: string;
  readonly start: number;
}

function splitLines(markdown: string): readonly Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of markdown.split('\n')) {
    const carriage = raw.endsWith('\r') ? '\r' : '';
    lines.push({ text: carriage === '' ? raw : raw.slice(0, -1), carriage, start });
    start += raw.length + 1;
  }
  assert(lines.length > 0, 'Splitting always yields a line');
  return lines;
}

type ScanKind = 'paragraph' | 'setext' | 'heading' | 'fence' | 'indented' | 'rule' | 'quote' | 'list' | 'table' | 'html' | 'definition' | 'esm';

interface Scan {
  readonly kind: ScanKind;
  readonly first: number;
  readonly end: number;
}

function lastContentLine(lines: readonly string[], end: number): number {
  let last = end;
  while (last > 0 && isBlank(lines[last - 1] ?? '')) {
    last -= 1;
  }
  return last;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^( {0,3})([-+*])(?:([ \t]+)(.*))?$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*))?$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.){1,200})\]:[ \t]*(\S+)(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const ESM = /^(?:import[ \t]+(?:[\w*{][^'"]*from[ \t]*)?['"]|export[ \t]+(?:const|let|var|function|async|class|default|\{|\*))/;
const HTML_COMMENT = /^ {0,3}<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/;
const HTML_OPEN = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/;
const HTML_WHOLE_TAG =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/;
const HTML_BLOCK_NAMES = new Set(
  (
    'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption ' +
    'figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol ' +
    'optgroup option p param search section summary table tbody td tfoot th thead title tr track ul script pre style textarea'
  ).split(' '),
);

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function indentOf(line: string): number {
  let columns = 0;
  for (const character of line) {
    if (character === ' ') {
      columns += 1;
    } else if (character === '\t') {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
  }
  return columns;
}

function dedent(line: string, columns: number): string {
  let taken = 0;
  let index = 0;
  while (index < line.length && taken < columns) {
    const character = line[index];
    if (character === ' ') {
      taken += 1;
    } else if (character === '\t') {
      const width = 4 - (taken % 4);
      if (taken + width > columns) {
        return ' '.repeat(taken + width - columns) + line.slice(index + 1);
      }
      taken += width;
    } else {
      break;
    }
    index += 1;
  }
  return line.slice(index);
}

function isHTMLBlockStart(line: string, options: { readonly interrupting: boolean }): boolean {
  if (HTML_COMMENT.test(line)) {
    return true;
  }
  const name = HTML_OPEN.exec(line)?.[1]?.toLowerCase();
  if (name !== undefined && HTML_BLOCK_NAMES.has(name)) {
    return true;
  }
  if (options.interrupting) {
    return false;
  }
  return HTML_WHOLE_TAG.test(line) || /^ {0,3}<[A-Z]/.test(line);
}

function listMarker(line: string): { readonly ordered: boolean; readonly marker: string; readonly empty: boolean } | undefined {
  if (RULE.test(line)) {
    return undefined;
  }
  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    return { ordered: false, marker: bullet[2] ?? '-', empty: isBlank(bullet[4] ?? '') };
  }
  const ordered = ORDERED.exec(line);
  if (ordered !== null) {
    return { ordered: true, marker: `${ordered[2] ?? '1'}${ordered[3] ?? '.'}`, empty: isBlank(ordered[5] ?? '') };
  }
  return undefined;
}

function interruptsParagraph(line: string): boolean {
  if (isBlank(line)) {
    return true;
  }
  if (indentOf(line) >= 4) {
    return false;
  }
  if (FENCE.test(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line) || isHTMLBlockStart(line, { interrupting: true })) {
    return true;
  }
  const marker = listMarker(line);
  if (marker === undefined || marker.empty) {
    return false;
  }
  return !marker.ordered || /^1[.)]$/.test(marker.marker);
}

function scanBlocks(lines: readonly string[]): readonly Scan[] {
  const scans: Scan[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (isBlank(line)) {
      index += 1;
      continue;
    }
    const scan = scanBlock(lines, index);
    assert(scan.end > index, 'Every block reads at least one line');
    assert(scan.end <= lines.length, 'A block ends inside its lines');
    scans.push(scan);
    index = scan.end;
  }
  return scans;
}

function scanBlock(lines: readonly string[], index: number): Scan {
  const line = lines[index] ?? '';
  assert(!isBlank(line), 'A block starts on a line with text');
  if (indentOf(line) >= 4) {
    return { kind: 'indented', first: index, end: indentedEnd(lines, index) };
  }
  const fence = FENCE.exec(line);
  if (fence !== null && !((fence[2] ?? '').startsWith('`') && (fence[3] ?? '').includes('`'))) {
    return { kind: 'fence', first: index, end: fenceEnd(lines, index, fence[2] ?? '```') };
  }
  if (ATX.test(line)) {
    return { kind: 'heading', first: index, end: index + 1 };
  }
  if (RULE.test(line)) {
    return { kind: 'rule', first: index, end: index + 1 };
  }
  if (QUOTE.test(line)) {
    return { kind: 'quote', first: index, end: quoteEnd(lines, index) };
  }
  if (listMarker(line) !== undefined) {
    return { kind: 'list', first: index, end: listEnd(lines, index) };
  }
  return scanLeaf(lines, index);
}

function scanLeaf(lines: readonly string[], index: number): Scan {
  const line = lines[index] ?? '';
  if (isHTMLBlockStart(line, { interrupting: false })) {
    const comment = /^ {0,3}<!--/.test(line);
    return { kind: 'html', first: index, end: comment ? commentEnd(lines, index) : runEnd(lines, index) };
  }
  if (ESM.test(line)) {
    return { kind: 'esm', first: index, end: runEnd(lines, index) };
  }
  if (DEFINITION.test(line)) {
    return { kind: 'definition', first: index, end: index + 1 };
  }
  const next = lines[index + 1];
  if (line.includes('|') && next !== undefined && next.includes('|') && next.includes('-') && TABLE_DELIMITER.test(next)) {
    return { kind: 'table', first: index, end: runEnd(lines, index) };
  }
  let end = index + 1;
  while (end < lines.length) {
    const following = lines[end] ?? '';
    if (SETEXT.test(following) && indentOf(following) < 4) {
      return { kind: 'setext', first: index, end: end + 1 };
    }
    if (interruptsParagraph(following)) {
      break;
    }
    end += 1;
  }
  return { kind: 'paragraph', first: index, end };
}

function runEnd(lines: readonly string[], index: number): number {
  let end = index + 1;
  while (end < lines.length && !isBlank(lines[end] ?? '')) {
    end += 1;
  }
  return end;
}

function commentEnd(lines: readonly string[], index: number): number {
  for (let end = index; end < lines.length; end += 1) {
    if ((lines[end] ?? '').includes('-->')) {
      return end + 1;
    }
  }
  return lines.length;
}

function indentedEnd(lines: readonly string[], index: number): number {
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (!isBlank(line) && indentOf(line) < 4) {
      break;
    }
    end += 1;
  }
  return lastContentLine(lines, end);
}

function fenceEnd(lines: readonly string[], index: number, opening: string): number {
  const character = opening[0] ?? '`';
  for (let end = index + 1; end < lines.length; end += 1) {
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[end] ?? '')?.[1];
    if (close !== undefined && close[0] === character && close.length >= opening.length) {
      return end + 1;
    }
  }
  return lines.length;
}

function quoteEnd(lines: readonly string[], index: number): number {
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (QUOTE.test(line)) {
      end += 1;
    } else if (!interruptsParagraph(line) && !isBlank(lines[end - 1] ?? '')) {
      end += 1;
    } else {
      break;
    }
  }
  return end;
}

interface ItemScan {
  readonly first: number;
  readonly end: number;
  readonly marker: string;
  readonly contents: readonly string[];
}

function listEnd(lines: readonly string[], index: number): number {
  const items = listItems(lines, index);
  const last = items[items.length - 1];
  assert(last !== undefined, 'A list has an item');
  return last.end;
}

function listItems(lines: readonly string[], index: number): readonly ItemScan[] {
  const first = listMarker(lines[index] ?? '');
  assert(first !== undefined, 'A list starts on an item');
  const items: ItemScan[] = [];
  let line = index;
  while (line < lines.length && items.length < lines.length) {
    const marker = listMarker(lines[line] ?? '');
    if (marker === undefined || marker.ordered !== first.ordered || marker.marker.slice(-1) !== first.marker.slice(-1)) {
      break;
    }
    const item = scanItem(lines, line);
    items.push(item);
    line = item.end;
    let next = line;
    while (next < lines.length && isBlank(lines[next] ?? '')) {
      next += 1;
    }
    const following = listMarker(lines[next] ?? '');
    if (next >= lines.length || following === undefined || indentOf(lines[next] ?? '') > 3) {
      break;
    }
    line = next;
  }
  assert(items.length > 0, 'A list reads at least one item');
  return items;
}

function scanItem(lines: readonly string[], index: number): ItemScan {
  const line = lines[index] ?? '';
  const match = BULLET.exec(line) ?? ORDERED.exec(line);
  assert(match !== null, 'An item starts on its marker');
  const marker = match[2] ?? '-';
  const ordered = BULLET.exec(line) === null;
  const markerColumns = (match[1] ?? '').length + marker.length + (ordered ? (match[3] ?? '').length : 0);
  const spacing = indentOf(ordered ? (match[4] ?? '') : (match[3] ?? ''));
  const rest = ordered ? (match[5] ?? '') : (match[4] ?? '');
  const empty = isBlank(rest);
  const contentIndent = empty || spacing >= 5 ? markerColumns + 1 : markerColumns + spacing;
  const contents: string[] = [empty ? '' : spacing >= 5 ? ' '.repeat(spacing - 1) + rest : rest];
  let end = index + 1;
  while (end < lines.length) {
    const next = lines[end] ?? '';
    const previous = contents[contents.length - 1] ?? '';
    if (isBlank(next)) {
      if (empty && contents.length === 1) {
        break;
      }
      contents.push('');
    } else if (indentOf(next) >= contentIndent) {
      contents.push(dedent(next, contentIndent));
    } else if (!isBlank(previous) && !interruptsParagraph(next) && listMarker(next) === undefined) {
      contents.push(next.trimStart());
    } else {
      break;
    }
    end += 1;
  }
  const last = lastContentLine(contents, contents.length);
  const itemEnd = index + Math.max(last, 1);
  assert(itemEnd <= end, 'An item ends at or before the first line it does not hold');
  return { first: index, end: itemEnd, marker, contents: contents.slice(0, Math.max(last, 1)) };
}


interface StyleBuilder {
  bullet: MarkdownStyle['bullet'] | undefined;
  delimiter: MarkdownStyle['delimiter'] | undefined;
  fence: MarkdownStyle['fence'] | undefined;
  emphasis: MarkdownStyle['emphasis'] | undefined;
  strong: MarkdownStyle['strong'] | undefined;
  rule: string | undefined;
  setext: boolean;
  wrapColumns: number | undefined;
  readonly infos: Map<string, string>;
  readonly addresses: Map<string, string>;
  readonly written: Set<string>;
  readonly references: Map<string, string>;
  readonly autolinks: Set<string>;
}

interface Definition {
  readonly label: string;
  readonly address: string;
  readonly title: string | undefined;
}

interface RenderContext {
  readonly style: StyleBuilder;
  readonly references: ReadonlyMap<string, Definition>;
  readonly depth: number;
  readonly gfm: boolean;
}

function newStyleBuilder(): StyleBuilder {
  return {
    bullet: undefined,
    delimiter: undefined,
    fence: undefined,
    emphasis: undefined,
    strong: undefined,
    rule: undefined,
    setext: false,
    wrapColumns: undefined,
    infos: new Map(),
    addresses: new Map(),
    written: new Set(),
    references: new Map(),
    autolinks: new Set(),
  };
}

function finishStyle(style: StyleBuilder): MarkdownStyle {
  const addresses = new Map([...style.addresses].filter(([shown]) => !style.written.has(shown)));
  return {
    bullet: style.bullet ?? '-',
    delimiter: style.delimiter ?? '.',
    fence: style.fence ?? '`',
    emphasis: style.emphasis ?? '_',
    strong: style.strong ?? '**',
    rule: style.rule ?? '---',
    setext: style.setext,
    wrapColumns: style.wrapColumns,
    infos: style.infos,
    addresses,
    references: style.references,
    autolinks: style.autolinks,
  };
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function linkDefinitions(lines: readonly string[]): ReadonlyMap<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const line of lines) {
    const match = DEFINITION.exec(line);
    if (match === null) {
      continue;
    }
    const label = match[1] ?? '';
    const key = normalizeLabel(label);
    if (!definitions.has(key)) {
      const title = match[3];
      definitions.set(key, { label, address: (match[2] ?? '').replace(/^<(.*)>$/, '$1'), title: title === undefined ? undefined : title.slice(1, -1) });
    }
  }
  return definitions;
}

function keptHTML(source: string): string {
  return `<pre class="${KEPT_CLASS}">${escapeHTML(source)}</pre>`;
}

function topBlock(scan: Scan, lines: readonly Line[], source: string, context: RenderContext): MarkdownBlock {
  const texts = lines.slice(scan.first, scan.end).map((line) => line.text);
  if (scan.kind === 'list') {
    const items = listItems(texts, 0);
    const html = renderList(texts, items, context);
    if (html !== undefined) {
      const loose = looseList(items);
      const kept = items.map((item) => ({
        html: renderItem(item, { loose }, context) ?? '',
        source: lines
          .slice(scan.first + item.first, scan.first + item.end)
          .map((line) => line.text + line.carriage)
          .join('\n'),
        number: /^\d+/.test(item.marker) ? Number.parseInt(item.marker, 10) : undefined,
      }));
      return { kind: 'list', source, html, items: kept };
    }
    return { kind: 'kept', source, html: keptHTML(source), items: [] };
  }
  const rendered = renderScan(scan, texts, scan.first, context);
  if (rendered === undefined) {
    return { kind: 'kept', source, html: keptHTML(source), items: [] };
  }
  if (rendered.kind === 'table') {
    const rows = lines.slice(scan.first, scan.end).map((line, at) => ({
      html: at === 1 ? '' : (tableRowHTML(line.text, at === 0 ? 'th' : 'td', tableShape(texts[1] ?? ''), context) ?? ''),
      source: line.text + line.carriage,
      number: undefined,
    }));
    return { kind: 'table', source, html: rendered.html, items: rows };
  }
  return { kind: rendered.kind, source, html: rendered.html, items: [] };
}

function renderScans(lines: readonly string[], context: RenderContext): string | undefined {
  let html = '';
  for (const scan of scanBlocks(lines)) {
    const rendered = renderScan(scan, lines, 0, context);
    if (rendered === undefined) {
      return undefined;
    }
    html += rendered.html;
  }
  return html;
}

function renderScan(
  scan: Scan,
  all: readonly string[],
  offset: number,
  context: RenderContext,
): { readonly kind: MarkdownBlockKind; readonly html: string } | undefined {
  const lines = all.slice(scan.first - offset, scan.end - offset);
  assert(lines.length > 0, 'A rendered block has lines');
  switch (scan.kind) {
    case 'paragraph':
      return wrapInline('paragraph', 'p', paragraphText(lines), context, lines);
    case 'setext':
      return renderSetext(lines, context);
    case 'heading':
      return renderHeading(lines[0] ?? '', context);
    case 'fence':
      return { kind: 'code', html: renderFence(lines, context) };
    case 'indented':
      return { kind: 'code', html: codeHTML(lines.map((line) => dedent(line, 4)).join('\n'), undefined) };
    case 'rule':
      context.style.rule ??= (lines[0] ?? '---').trim();
      return { kind: 'rule', html: '<hr>' };
    case 'quote':
      return renderQuote(lines, context);
    case 'list': {
      const items = listItems(lines, 0);
      const html = renderList(lines, items, context);
      return html === undefined ? undefined : { kind: 'list', html };
    }
    case 'table': {
      const table = context.gfm ? renderTable(lines, context) : undefined;
      return table === undefined ? undefined : { kind: 'table', html: table };
    }
    case 'html':
    case 'definition':
    case 'esm':
      return undefined;
    default: {
      const exhaustive: never = scan.kind;
      return exhaustive;
    }
  }
}

function paragraphText(lines: readonly string[]): string {
  return lines.map((line, at) => (at === lines.length - 1 ? line.trim() : line.trimStart())).join('\n');
}

function wrapInline(
  kind: MarkdownBlockKind,
  tag: string,
  text: string,
  context: RenderContext,
  lines: readonly string[],
): { readonly kind: MarkdownBlockKind; readonly html: string } | undefined {
  const inline = renderInline(text, context, 0);
  if (inline === undefined) {
    return undefined;
  }
  if (kind === 'paragraph' && lines.length > 1) {
    const widest = Math.max(...lines.map((line) => line.length));
    context.style.wrapColumns = Math.max(context.style.wrapColumns ?? 0, widest);
  }
  return { kind, html: `<${tag}>${inline}</${tag}>` };
}

function renderSetext(lines: readonly string[], context: RenderContext): { readonly kind: MarkdownBlockKind; readonly html: string } | undefined {
  const underline = (lines[lines.length - 1] ?? '').trim();
  context.style.setext = true;
  return wrapInline('heading', underline.startsWith('=') ? 'h1' : 'h2', paragraphText(lines.slice(0, -1)), context, lines);
}

function renderHeading(line: string, context: RenderContext): { readonly kind: MarkdownBlockKind; readonly html: string } | undefined {
  const match = ATX.exec(line);
  assert(match !== null, 'A heading block is an ATX line');
  const level = (match[1] ?? '#').length;
  assert(level >= 1, 'A heading has at least one mark');
  assert(level <= 6, 'A heading has at most six marks');
  return wrapInline('heading', `h${level}`, (match[2] ?? '').trim(), context, [line]);
}

function renderFence(lines: readonly string[], context: RenderContext): string {
  const open = FENCE.exec(lines[0] ?? '');
  assert(open !== null, 'A fenced block opens on a fence');
  const indent = (open[1] ?? '').length;
  const marks = open[2] ?? '```';
  const info = (open[3] ?? '').trim();
  const closing = lines.length > 1 && new RegExp(`^ {0,3}${marks[0] === '`' ? '`' : '~'}{${marks.length},}[ \\t]*$`).test(lines[lines.length - 1] ?? '');
  const body = lines.slice(1, closing ? -1 : undefined).map((line) => dedent(line, Math.min(indent, indentOf(line))));
  const language = info.split(/\s+/)[0] ?? '';
  context.style.fence ??= marks[0] === '~' ? '~' : '`';
  if (language !== '' && language.length <= MARKDOWN_LIMITS.labelCharsMax && !context.style.infos.has(language)) {
    context.style.infos.set(language, info);
  }
  return codeHTML(body.join('\n'), language === '' ? undefined : language);
}

function codeHTML(code: string, language: string | undefined): string {
  const safe = language === undefined ? undefined : /^[\w#+.-]{1,64}$/.test(language) ? language : undefined;
  return `<pre><code${safe === undefined ? '' : ` class="language-${safe}"`}>${escapeHTML(code)}</code></pre>`;
}

function renderQuote(lines: readonly string[], context: RenderContext): { readonly kind: MarkdownBlockKind; readonly html: string } | undefined {
  if (context.depth >= MARKDOWN_LIMITS.depthMax) {
    return undefined;
  }
  const inner = lines.map((line) => (QUOTE.test(line) ? line.replace(/^ {0,3}> ?/, '') : line));
  const html = renderScans(inner, { ...context, depth: context.depth + 1 });
  return html === undefined ? undefined : { kind: 'quote', html: `<blockquote>${html}</blockquote>` };
}

function looseList(items: readonly ItemScan[]): boolean {
  for (const [at, item] of items.entries()) {
    const next = items[at + 1];
    if (next !== undefined && next.first > item.end) {
      return true;
    }
    const scans = scanBlocks(item.contents);
    for (const [index, scan] of scans.entries()) {
      const following = scans[index + 1];
      if (following !== undefined && following.first > scan.end) {
        return true;
      }
    }
  }
  return false;
}

function renderList(lines: readonly string[], items: readonly ItemScan[], context: RenderContext): string | undefined {
  if (context.depth >= MARKDOWN_LIMITS.depthMax) {
    return undefined;
  }
  assert(items.length > 0, 'A list has an item');
  const first = items[0];
  assert(first !== undefined, 'A list has a first item');
  assert((items[items.length - 1]?.end ?? 0) <= lines.length, 'A list ends inside its lines');
  const ordered = /^\d/.test(first.marker);
  if (ordered) {
    const delimiter = first.marker.slice(-1);
    context.style.delimiter ??= delimiter === ')' ? ')' : '.';
  } else {
    const bullet = first.marker;
    context.style.bullet ??= bullet === '*' ? '*' : bullet === '+' ? '+' : '-';
  }
  const loose = looseList(items);
  let html = '';
  for (const item of items) {
    const rendered = renderItem(item, { loose }, context);
    if (rendered === undefined) {
      return undefined;
    }
    html += rendered;
  }
  if (!ordered) {
    return `<ul>${html}</ul>`;
  }
  const start = Number.parseInt(first.marker, 10);
  return start === 1 ? `<ol>${html}</ol>` : `<ol start="${start}">${html}</ol>`;
}

function renderItem(item: ItemScan, shape: { readonly loose: boolean }, context: RenderContext): string | undefined {
  const inner = { ...context, depth: context.depth + 1 };
  const task = context.gfm ? (TASK.exec(item.contents[0] ?? '') ?? undefined) : undefined;
  const contents = task === undefined ? item.contents : [(item.contents[0] ?? '').slice(task[0].length), ...item.contents.slice(1)];
  let html = '';
  for (const scan of scanBlocks(contents)) {
    const lines = contents.slice(scan.first, scan.end);
    if (!shape.loose && scan.kind === 'paragraph') {
      const inline = renderInline(paragraphText(lines), inner, 0);
      if (inline === undefined) {
        return undefined;
      }
      html += inline;
      continue;
    }
    const rendered = renderScan(scan, contents, 0, inner);
    if (rendered === undefined) {
      return undefined;
    }
    html += rendered.html;
  }
  if (task === undefined) {
    return `<li>${html}</li>`;
  }
  const done = (task[1] ?? ' ') !== ' ';
  return `<li class="${done ? `${TASK_CLASS} ${TASK_DONE_CLASS}` : TASK_CLASS}">${html}</li>`;
}

const TASK = /^\[([ xX])\][ \t]+(?=\S)/;


type CellAlign = 'left' | 'center' | 'right' | undefined;

export function tableCells(line: string): readonly string[] {
  let row = line.trim();
  if (row.startsWith('|')) {
    row = row.slice(1);
  }
  if (row.endsWith('|') && !row.endsWith('\\|')) {
    row = row.slice(0, -1);
  }
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index] ?? '';
    if (character === '\\' && row[index + 1] === '|') {
      cell += '\\|';
      index += 1;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  assert(cells.length > 0, 'A row has a cell');
  return cells;
}

export function tableShape(delimiter: string): readonly CellAlign[] {
  return tableCells(delimiter).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) {
      return 'center';
    }
    if (right) {
      return 'right';
    }
    return left ? 'left' : undefined;
  });
}

function tableRowHTML(line: string, tag: 'th' | 'td', aligns: readonly CellAlign[], context: RenderContext): string | undefined {
  const cells = tableCells(line);
  if (cells.length !== aligns.length) {
    return undefined;
  }
  let html = '';
  for (const [at, cell] of cells.entries()) {
    const inline = renderInline(cell, context, 0);
    if (inline === undefined) {
      return undefined;
    }
    const align = aligns[at];
    html += `<${tag}${align === undefined ? '' : ` class="align-${align}"`}>${inline}</${tag}>`;
  }
  return `<tr>${html}</tr>`;
}

function renderTable(lines: readonly string[], context: RenderContext): string | undefined {
  assert(lines.length >= 2, 'A table has a header and a delimiter');
  const delimiter = lines[1] ?? '';
  assert(TABLE_DELIMITER.test(delimiter), 'A table block has its delimiter row second');
  const aligns = tableShape(delimiter);
  const header = tableRowHTML(lines[0] ?? '', 'th', aligns, context);
  if (header === undefined) {
    return undefined;
  }
  let body = '';
  for (const line of lines.slice(2)) {
    const row = tableRowHTML(line, 'td', aligns, context);
    if (row === undefined) {
      return undefined;
    }
    body += row;
  }
  return `<table><thead>${header}</thead>${body === '' ? '' : `<tbody>${body}</tbody>`}</table>`;
}


const INLINE_TAGS = new Set('b strong i em u s strike sub sup small mark kbd code br'.split(' '));
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const ENTITY = /^&(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][0-9A-Fa-f]{1,6});/;
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_AUTOLINK =
  /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const INLINE_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)([^<>]*)>/;

function renderInline(text: string, context: RenderContext, depth: number): string | undefined {
  if (depth > MARKDOWN_LIMITS.inlineDepthMax) {
    return undefined;
  }
  let html = '';
  let index = 0;
  while (index < text.length) {
    const step = inlineStep(text, index, context, depth);
    if (step === undefined) {
      return undefined;
    }
    assert(step.next > index, 'Inline reading always moves forward');
    html += step.html;
    index = step.next;
  }
  return html;
}

interface Step {
  readonly html: string;
  readonly next: number;
}

function inlineStep(text: string, index: number, context: RenderContext, depth: number): Step | undefined {
  const character = text[index] ?? '';
  switch (character) {
    case '\\':
      return escapeStep(text, index);
    case '`':
      return codeSpan(text, index);
    case '!':
      return text[index + 1] === '[' ? linkOrText(linkStep(text, index + 1, context, depth, 'image'), '!', index) : { html: '!', next: index + 1 };
    case '[':
      return linkOrText(linkStep(text, index, context, depth, 'link'), '[', index);
    case '*':
    case '_':
    case '~':
      return emphasisStep(text, index, context, depth);
    case '<':
      return angleStep(text, index, context);
    case '&': {
      const entity = ENTITY.exec(text.slice(index, index + 40))?.[0];
      return entity === undefined ? { html: '&amp;', next: index + 1 } : { html: entity, next: index + entity.length };
    }
    case '\n':
      return { html: '\n', next: index + 1 };
    case ' ':
      return spaceStep(text, index);
    default:
      return plainStep(text, index);
  }
}

function plainStep(text: string, index: number): Step {
  let end = index + 1;
  while (end < text.length && !'\\`![*_~<&\n '.includes(text[end] ?? '')) {
    end += 1;
  }
  return { html: escapeHTML(text.slice(index, end)), next: end };
}

function spaceStep(text: string, index: number): Step {
  let end = index;
  while (text[end] === ' ') {
    end += 1;
  }
  if (text[end] === '\n') {
    return end - index >= 2 ? { html: '<br>', next: end + 1 } : { html: '\n', next: end + 1 };
  }
  return { html: text.slice(index, end), next: end };
}

function escapeStep(text: string, index: number): Step {
  const next = text[index + 1];
  if (next === '\n') {
    return { html: '<br>', next: index + 2 };
  }
  if (next !== undefined && PUNCTUATION.test(next)) {
    return { html: escapeHTML(next), next: index + 2 };
  }
  return { html: '\\', next: index + 1 };
}

function runLength(text: string, index: number, character: string): number {
  let end = index;
  while (text[end] === character) {
    end += 1;
  }
  return end - index;
}

function codeSpan(text: string, index: number): Step {
  const width = runLength(text, index, '`');
  let search = index + width;
  while (search < text.length) {
    const found = text.indexOf('`', search);
    if (found < 0) {
      break;
    }
    const closing = runLength(text, found, '`');
    if (closing === width) {
      let code = text.slice(index + width, found).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      return { html: `<code>${escapeHTML(code)}</code>`, next: found + width };
    }
    search = found + closing;
  }
  return { html: '`'.repeat(width), next: index + width };
}

function closingBracket(text: string, index: number): number | undefined {
  let depth = 0;
  let at = index;
  while (at < text.length) {
    const character = text[at];
    if (character === '\\') {
      at += 2;
      continue;
    }
    if (character === '`') {
      const step = codeSpan(text, at);
      at = step.next;
      continue;
    }
    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return at;
      }
    }
    at += 1;
  }
  return undefined;
}

interface Destination {
  readonly address: string;
  readonly title: string | undefined;
  readonly next: number;
}

function inlineDestination(text: string, index: number): Destination | undefined {
  const match =
    /^\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)/.exec(
      text.slice(index),
    );
  if (match === null) {
    return undefined;
  }
  const address = (match[1] ?? match[2] ?? '').replace(/\\([!-/:-@[-`{-~])/g, '$1');
  const title = match[3] === undefined ? undefined : match[3].slice(1, -1).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return { address, title, next: index + match[0].length };
}

type LinkRead = { readonly kind: 'link'; readonly step: Step } | { readonly kind: 'text' } | { readonly kind: 'unsupported' };

function linkOrText(read: LinkRead, character: string, index: number): Step | undefined {
  switch (read.kind) {
    case 'link':
      return read.step;
    case 'text':
      return { html: escapeHTML(character), next: index + 1 };
    case 'unsupported':
      return undefined;
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}

function linkStep(text: string, index: number, context: RenderContext, depth: number, kind: 'link' | 'image'): LinkRead {
  const close = closingBracket(text, index);
  if (close === undefined) {
    return { kind: 'text' };
  }
  const label = text.slice(index + 1, close);
  const inline = inlineDestination(text, close + 1);
  let target: Destination | undefined = inline;
  if (target === undefined) {
    const reference = /^\[((?:[^\]\\]|\\.){0,200})\]/.exec(text.slice(close + 1));
    const key = normalizeLabel(reference === null || reference[1] === '' ? label : (reference[1] ?? ''));
    const definition = context.references.get(key);
    if (definition === undefined) {
      return { kind: 'text' };
    }
    if (!context.style.references.has(definition.address)) {
      context.style.references.set(definition.address, definition.label);
    }
    target = { address: definition.address, title: definition.title, next: close + 1 + (reference === null ? 0 : reference[0].length) };
  }
  const shown = shownAddress(target.address, kind, context);
  if (shown === undefined) {
    return { kind: 'unsupported' };
  }
  const title = target.title === undefined ? '' : ` title="${escapeHTML(target.title)}"`;
  if (kind === 'image') {
    return { kind: 'link', step: { html: `<img src="${escapeHTML(shown)}" alt="${escapeHTML(label)}"${title}>`, next: target.next } };
  }
  const inner = renderInline(label, context, depth + 1);
  if (inner === undefined) {
    return { kind: 'unsupported' };
  }
  return { kind: 'link', step: { html: `<a href="${escapeHTML(shown)}"${title}>${inner}</a>`, next: target.next } };
}

function shownAddress(address: string, kind: 'link' | 'image', context: RenderContext): string | undefined {
  const safe = kind === 'link' ? safeHTMLLink(address) : /^(?:https?:\/\/|\/|\.\.?\/)/i.test(address.trim());
  if (safe) {
    context.style.written.add(address);
    return address;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(address) || address.trim() === '') {
    return undefined;
  }
  const shown = `./${address}`;
  if (!context.style.addresses.has(shown)) {
    context.style.addresses.set(shown, address);
  }
  return shown;
}

function angleStep(text: string, index: number, context: RenderContext): Step | undefined {
  const rest = text.slice(index, index + 2_048);
  const link = AUTOLINK.exec(rest);
  const autolink = link ?? EMAIL_AUTOLINK.exec(rest) ?? undefined;
  if (autolink !== undefined) {
    const address = autolink[1] ?? '';
    const href = link === null ? `mailto:${address}` : address;
    if (!safeHTMLLink(href)) {
      return undefined;
    }
    context.style.autolinks.add(href);
    return { html: `<a href="${escapeHTML(href)}">${escapeHTML(address)}</a>`, next: index + autolink[0].length };
  }
  const tag = INLINE_TAG.exec(rest);
  if (tag !== null) {
    const name = (tag[2] ?? '').toLowerCase();
    const attributes = (tag[3] ?? '').replace(/\/$/, '').trim();
    if (!INLINE_TAGS.has(name) || attributes !== '') {
      return undefined;
    }
    return { html: `<${tag[1] ?? ''}${name}>`, next: index + tag[0].length };
  }
  if (/^<(?:!--|\?|!)/.test(rest)) {
    return undefined;
  }
  return { html: '&lt;', next: index + 1 };
}

const MARK_TAGS: Readonly<Record<string, string>> = { '**': 'strong', __: 'strong', '*': 'em', _: 'em', '~~': 's' };

function emphasisStep(text: string, index: number, context: RenderContext, depth: number): Step | undefined {
  const character = text[index] ?? '*';
  const run = runLength(text, index, character);
  const before = text[index - 1];
  const after = text[index + run];
  const opens = after !== undefined && !/\s/.test(after) && !(character === '_' && before !== undefined && /[A-Za-z0-9]/.test(before));
  const widths = character === '~' ? (run === 2 ? [2] : []) : run >= 2 ? [2, 1] : [1];
  for (const width of opens ? widths : []) {
    const close = closingRun(text, index + width, character, width);
    if (close === undefined) {
      continue;
    }
    const inner = renderInline(text.slice(index + width, close), context, depth + 1);
    if (inner === undefined) {
      return undefined;
    }
    const marker = character.repeat(width);
    noteEmphasis(context.style, marker);
    const tag = MARK_TAGS[marker] ?? 'em';
    return { html: `<${tag}>${inner}</${tag}>`, next: close + width };
  }
  return { html: escapeHTML(character.repeat(run)), next: index + run };
}

function noteEmphasis(style: StyleBuilder, marker: string): void {
  if (marker === '**' || marker === '__') {
    style.strong ??= marker;
  } else if (marker === '*' || marker === '_') {
    style.emphasis ??= marker;
  }
}

function closingRun(text: string, from: number, character: string, width: number): number | undefined {
  let at = from;
  while (at < text.length) {
    const current = text[at];
    if (current === '\\') {
      at += 2;
      continue;
    }
    if (current === '`') {
      at = codeSpan(text, at).next;
      continue;
    }
    if (current !== character) {
      at += 1;
      continue;
    }
    const run = runLength(text, at, character);
    const before = text[at - 1];
    const after = text[at + run];
    const touches = at > from && before !== undefined && !/\s/.test(before);
    const wordEnd = !(character === '_' && after !== undefined && /[A-Za-z0-9]/.test(after));
    const fits = width === 1 ? run !== 2 : run >= width;
    if (touches && wordEnd && fits) {
      return at + run - width;
    }
    at += run;
  }
  return undefined;
}
