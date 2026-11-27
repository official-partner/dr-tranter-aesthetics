
import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, tsxLanguage } from '@codemirror/lang-javascript';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { tomlLanguage } from './tomlSyntax';
import type { Parser, Tree } from '@lezer/common';
import { highlightTree, tagHighlighter, tags as t, type Tag } from '@lezer/highlight';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { lineSlices, nextLineSlice, yieldToEventLoop, type LineSlice } from './codeSlices';

export type CodeTokenStyle = {
  readonly color?: string;
  readonly fontStyle?: string;
  readonly fontWeight?: string;
  readonly textDecoration?: string;
};

export interface CodeToken {
  readonly text: string;
  readonly style?: CodeTokenStyle | undefined;
}

export type CodeLine = readonly CodeToken[];

export type CodeLanguage = 'astro' | 'commit' | 'css' | 'html' | 'javascript' | 'json' | 'markdown' | 'shell' | 'toml' | 'typescript';

export const CODE_TOKEN_RULES: readonly { readonly tag: Tag | readonly Tag[]; readonly style: CodeTokenStyle }[] = [
  { tag: [t.keyword, t.modifier], style: { color: '#c792ea' } },
  { tag: [t.propertyName], style: { color: '#80cbc4' } },
  { tag: [t.className, t.tagName], style: { color: '#ffcb6b' } },
  { tag: [t.string, t.special(t.string)], style: { color: '#c3e88d' } },
  { tag: [t.number, t.unit, t.bool, t.null, t.atom], style: { color: '#f78c6c' } },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], style: { color: '#82aaff' } },
  { tag: [t.variableName, t.definition(t.variableName)], style: { color: '#e0e0e0' } },
  { tag: [t.comment, t.blockComment, t.lineComment], style: { color: '#8a8a8a', fontStyle: 'italic' } },
  { tag: [t.operator, t.punctuation, t.separator], style: { color: '#89ddff' } },
  { tag: [t.labelName, t.attributeName], style: { color: '#80cbc4' } },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], style: { color: '#f78c6c' } },
  { tag: [t.heading], style: { color: '#f5f5f5', fontWeight: '600' } },
  { tag: [t.emphasis], style: { fontStyle: 'italic' } },
  { tag: [t.strong], style: { fontWeight: '600', color: '#f5f5f5' } },
  { tag: [t.link, t.url], style: { color: '#82aaff', textDecoration: 'underline' } },
  { tag: [t.monospace], style: { color: '#c3e88d' } },
  { tag: [t.quote], style: { color: '#999999', fontStyle: 'italic' } },
  { tag: [t.list], style: { color: '#89ddff' } },
  { tag: [t.processingInstruction, t.documentMeta], style: { color: '#8a8a8a' } },
];

const CODE_LANGUAGE_NAMES: Readonly<Record<string, CodeLanguage>> = {
  astro: 'astro',
  bash: 'shell',
  cjs: 'javascript',
  console: 'shell',
  css: 'css',
  htm: 'html',
  html: 'html',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  less: 'css',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  sass: 'css',
  scss: 'css',
  sh: 'shell',
  shell: 'shell',
  svg: 'html',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  vue: 'html',
  zsh: 'shell',
};

export function languageNamed(name: string): CodeLanguage | undefined {
  return Object.hasOwn(CODE_LANGUAGE_NAMES, name.toLowerCase()) ? CODE_LANGUAGE_NAMES[name.toLowerCase()] : undefined;
}

export function languageFor(filePath: string | undefined): CodeLanguage | undefined {
  const extension = /\.([a-z0-9]+)$/.exec((filePath ?? '').toLowerCase())?.[1];
  return extension === undefined ? undefined : languageNamed(extension);
}

export function plainCodeLines(text: string): readonly CodeLine[] {
  return text.split('\n').map((line) => (line === '' ? [] : [{ text: line }]));
}

export function codeTokenLines(text: string, language: Exclude<CodeLanguage, 'astro'> | undefined): readonly CodeLine[] {
  if (language === undefined || text.length > LIMITS.syntaxHighlightSliceCharsMax) {
    return plainCodeLines(text);
  }
  return colouredLines(text, language);
}

function colouredLines(text: string, language: Exclude<CodeLanguage, 'astro'>): readonly CodeLine[] {
  const tokens = language === 'shell' ? shellTokens(text) : language === 'commit' ? commitTokens(text) : grammarTokens(text, language);
  const lines = tokensByLine(tokens);
  assert(lines.length === text.split('\n').length, 'Coloured code keeps every line of its source');
  return lines;
}

const parseSliceMsMax = 20;

export async function* codeLineBatches(text: string, language: Exclude<CodeLanguage, 'astro'> | undefined): AsyncGenerator<readonly CodeLine[]> {
  const sliceCharsMax = LIMITS.syntaxHighlightSliceCharsMax;
  if (language === undefined || text.length <= sliceCharsMax) {
    yield language === undefined ? plainCodeLines(text) : colouredLines(text, language);
    return;
  }
  if (language === 'shell' || language === 'commit') {
    for (const slice of lineSlices(text, 0, sliceCharsMax)) {
      yield colouredLines(text.slice(slice.start, slice.end), language);
      await yieldToEventLoop();
    }
    return;
  }
  yield* grammarBatches(text, language, sliceCharsMax);
}

async function* grammarBatches(
  text: string,
  language: Exclude<CodeLanguage, 'astro' | 'commit' | 'shell'>,
  sliceCharsMax: number,
): AsyncGenerator<readonly CodeLine[]> {
  const parser = grammarFor(language).parser;
  const wrapped = language === 'json';
  const offset = wrapped ? 1 : 0;
  const slices = lineSlices(text, 0, sliceCharsMax);
  let pending = nextOrUndefined(slices);
  let prefixCharsMax = sliceCharsMax;
  for (let round = 0; pending !== undefined; round++) {
    assert(round < 64, 'grammarBatches: a prefix that doubles reaches any text within 64 rounds');
    const prefixSlice = nextLineSlice(text, 0, prefixCharsMax);
    const prefix = text.slice(0, prefixSlice.end);
    const source = wrapped ? `(${prefix}${prefixSlice.last ? ')' : ''}` : prefix;
    const tree = round === 0 ? parser.parse(source) : await parseInSlices(parser, source);
    const clearEnd = prefixSlice.end - sliceCharsMax;
    while (pending !== undefined && pending.end <= prefixSlice.end && (round === 0 || prefixSlice.last || pending.end <= clearEnd)) {
      yield tokensByLine(rangeTokens(tree, text, { offset, from: pending.start, to: pending.end }));
      await yieldToEventLoop();
      pending = nextOrUndefined(slices);
    }
    prefixCharsMax *= 2;
  }
}

async function parseInSlices(parser: Parser, source: string): Promise<Tree> {
  const parse = parser.startParse(source);
  let sliceStartedMs = performance.now();
  let previousPosition = 0;
  for (let step = 0; step < Number.MAX_SAFE_INTEGER; step++) {
    const tree = parse.advance();
    if (tree !== null) {
      return tree;
    }
    assert(parse.parsedPos >= previousPosition, 'parseInSlices: a parse never moves backwards');
    previousPosition = parse.parsedPos;
    if (performance.now() - sliceStartedMs > parseSliceMsMax) {
      await yieldToEventLoop();
      sliceStartedMs = performance.now();
    }
  }
  throw new Error('parseInSlices: the step counter ran out');
}

function nextOrUndefined(slices: Generator<LineSlice>): LineSlice | undefined {
  const result = slices.next();
  return result.done === true ? undefined : result.value;
}

const ruleHighlighter = tagHighlighter(CODE_TOKEN_RULES.map((rule, index) => ({ tag: rule.tag, class: String(index) })));

function ruleStyle(classes: string): CodeTokenStyle {
  return classes.split(' ').reduce<CodeTokenStyle>((merged, index) => {
    const rule = CODE_TOKEN_RULES[Number(index)];
    assert(rule !== undefined, 'A highlighted range names a rule in the table');
    return { ...merged, ...rule.style };
  }, {});
}

function grammarTokens(text: string, language: Exclude<CodeLanguage, 'astro' | 'commit' | 'shell'>): readonly CodeToken[] {
  const wrapped = language === 'json';
  const tree = grammarFor(language).parser.parse(wrapped ? `(${text})` : text);
  return rangeTokens(tree, text, { offset: wrapped ? 1 : 0, from: 0, to: text.length });
}

function rangeTokens(tree: Tree, text: string, range: { readonly offset: number; readonly from: number; readonly to: number }): readonly CodeToken[] {
  assert(range.from <= range.to, 'rangeTokens: a range does not end before it starts');
  assert(range.to <= text.length, 'rangeTokens: a range stays inside the text');
  const tokens: CodeToken[] = [];
  let position = range.from;
  highlightTree(
    tree,
    ruleHighlighter,
    (from, to, classes) => {
      const start = Math.max(from - range.offset, position);
      const end = Math.min(to - range.offset, range.to);
      if (end <= start) {
        return;
      }
      if (position < start) {
        tokens.push({ text: text.slice(position, start) });
      }
      tokens.push({ text: text.slice(start, end), style: ruleStyle(classes) });
      position = end;
    },
    range.from + range.offset,
    range.to + range.offset,
  );
  if (position < range.to) {
    tokens.push({ text: text.slice(position, range.to) });
  }
  return tokens;
}

function grammarFor(language: Exclude<CodeLanguage, 'astro' | 'commit' | 'shell'>) {
  switch (language) {
    case 'css':
      return cssLanguage;
    case 'html':
      return htmlLanguage;
    case 'markdown':
      return markdownLanguage;
    case 'toml':
      return tomlLanguage;
    case 'json':
      return javascriptLanguage;
    case 'javascript':
    case 'typescript':
      return tsxLanguage;
    default: {
      const exhaustive: never = language;
      return exhaustive;
    }
  }
}

function tokensByLine(tokens: readonly CodeToken[]): readonly CodeLine[] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    token.text.split('\n').forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part !== '') {
        lines.at(-1)?.push({ ...token, text: part });
      }
    });
  }
  return lines;
}

const SHELL_TOKEN_TAGS = {
  argument: undefined,
  assignment: t.variableName,
  command: t.function(t.variableName),
  comment: t.lineComment,
  flag: t.attributeName,
  operator: t.operator,
  separator: t.operator,
  space: undefined,
  string: t.string,
  variable: t.variableName,
} as const;

type ShellTokenKind = keyof typeof SHELL_TOKEN_TAGS;

const SHELL_PATTERNS: readonly (readonly [ShellTokenKind, RegExp])[] = [
  ['space', /[ \t\r]+/y],
  ['separator', /(?:\n|;|&&|\|\||\||&)/y],
  ['operator', /[<>]+/y],
  ['string', /(?:'[^']*'?|"(?:\\.|[^"\\])*"?)/sy],
  ['variable', /\$(?:\{[^}\n]*\}?|[A-Za-z_][A-Za-z0-9_]*|[0-9@#?$!*-])/y],
  ['assignment', /[A-Za-z_][A-Za-z0-9_]*=(?:"[^"\n]*"?|'[^'\n]*'?|[^\s;|&<>]*)/y],
];
const SHELL_COMMENT = /#[^\n]*/y;
const SHELL_WORD = /(?:[^\s;|&<>'"$]+|.)/sy;

function matchAt(pattern: RegExp, text: string, index: number): string | undefined {
  // eslint-disable-next-line no-param-reassign -- a sticky pattern is positioned through lastIndex.
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0];
}

function shellTokens(text: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  let commandNext = true;
  while (index < text.length) {
    const wordStart = index === 0 || /\s/.test(text.charAt(index - 1));
    const [kind, value] = shellTokenOf(text, index, { commandNext, wordStart });
    assert(value.length > 0, 'A shell token consumes text');
    const tag = SHELL_TOKEN_TAGS[kind];
    tokens.push({ text: value, style: tag === undefined ? undefined : tagStyle(tag) });
    index += value.length;
    if (kind === 'separator') {
      commandNext = true;
    } else if (kind === 'command') {
      commandNext = false;
    }
  }
  assert(index === text.length, 'Shell tokens cover the whole text');
  return tokens;
}

function shellTokenOf(text: string, index: number, place: { readonly commandNext: boolean; readonly wordStart: boolean }): readonly [ShellTokenKind, string] {
  if (place.wordStart) {
    const comment = matchAt(SHELL_COMMENT, text, index);
    if (comment !== undefined) {
      return ['comment', comment];
    }
  }
  for (const [kind, pattern] of SHELL_PATTERNS) {
    const value = matchAt(pattern, text, index);
    if (value !== undefined) {
      return [kind, value];
    }
  }
  const word = matchAt(SHELL_WORD, text, index);
  assert(word !== undefined, 'The word pattern matches any character');
  if (word.startsWith('-')) {
    return ['flag', word];
  }
  return [place.commandNext ? 'command' : 'argument', word];
}

function tagStyle(tag: Tag): CodeTokenStyle | undefined {
  const classes = ruleHighlighter.style([tag]);
  return classes === null ? undefined : ruleStyle(classes);
}

const COMMIT_PREFIX = /^([A-Za-z]+)(?:(\()([^()\s:]*)(\)))?(!)?(:)/;

function commitTokens(text: string): readonly CodeToken[] {
  const match = COMMIT_PREFIX.exec(text);
  if (match === null) {
    return [{ text }];
  }
  const [prefix, type = '', open, scope, close, breaking, colon = ''] = match;
  const parts: readonly (readonly [string | undefined, Tag | undefined])[] = [
    [type, t.keyword],
    [open, t.punctuation],
    [scope, t.labelName],
    [close, t.punctuation],
    [breaking, t.atom],
    [colon, t.punctuation],
    [text.slice(prefix.length), undefined],
  ];
  const tokens = parts.flatMap(([value, tag]) => (value ? [{ text: value, style: tag === undefined ? undefined : tagStyle(tag) }] : []));
  assert(tokens.map((token) => token.text).join('') === text, 'Commit tokens cover the whole subject');
  return tokens;
}
