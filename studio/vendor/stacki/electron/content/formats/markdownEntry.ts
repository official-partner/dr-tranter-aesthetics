
import * as yaml from './yaml';

const FRONTMATTER = /^(---)([ \t]*\r?\n)([\s\S]*?)(\r?\n)(---)([ \t]*)(\r?\n?)/;
const EMPTY_FRONTMATTER = /^(---)([ \t]*\r?\n)(---)([ \t]*)(\r?\n?)/;

interface FrontmatterSpan {
  readonly opening: string;
  readonly block: string;
  readonly separator: string;
  readonly closing: string;
  readonly length: number;
}

function frontmatterSpan(text: string): FrontmatterSpan | undefined {
  const full = text.match(FRONTMATTER);
  if (full !== null) {
    const [whole, open = '', openBreak = '', block = '', separator = '', close = '', closeSpace = '', closeBreak = ''] = full;
    return { opening: open + openBreak, block, separator, closing: close + closeSpace + closeBreak, length: whole.length };
  }
  const empty = text.match(EMPTY_FRONTMATTER);
  if (empty !== null) {
    const [whole, open = '', openBreak = '', close = '', closeSpace = '', closeBreak = ''] = empty;
    return { opening: open + openBreak, block: '', separator: '', closing: close + closeSpace + closeBreak, length: whole.length };
  }
  return undefined;
}

export interface ParsedFrontmatter {
  readonly data: unknown;
  readonly frontmatter: string | undefined;
  readonly body: string;
  readonly offset: number;
}

function parse(text: string): ParsedFrontmatter {
  const span = frontmatterSpan(text);
  if (span === undefined) {
    return { data: undefined, frontmatter: undefined, body: text, offset: 0 };
  }
  return {
    data: span.block === '' ? {} : (yaml.parseData(span.block + '\n') ?? {}),
    frontmatter: span.block,
    body: text.slice(span.length),
    offset: span.length,
  };
}

const parseData = (text: string): unknown => parse(text).data;

function applyEdits(text: string, edits: readonly yaml.Edit[], { body }: { readonly body?: string | undefined } = {}): string {
  const span = frontmatterSpan(text);
  if (span === undefined) {
    if (!edits.length) {
      return body === undefined ? text : body;
    }
    const written = yaml.applyEdits('', edits).replace(/\n?$/, '\n');
    return `---\n${written}---\n${body === undefined ? text : body}`;
  }
  const source = span.block === '' ? '' : span.block + '\n';
  const written = edits.length ? yaml.applyEdits(source, edits).replace(/\n$/, '') : span.block;
  const lineBreak = span.opening.endsWith('\r\n') ? '\r\n' : '\n';
  const separator = written === '' ? '' : span.separator === '' ? lineBreak : span.separator;
  const head = `${span.opening}${written}${separator}${span.closing}`;
  return head + (body === undefined ? text.slice(span.length) : body);
}

export { parse, parseData, applyEdits };
export const DELETE = yaml.DELETE;
