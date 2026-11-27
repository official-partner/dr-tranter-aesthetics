
import type { AtRule, ChildNode, Container, Document, Rule } from 'postcss';
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';
import { CODE_INDENT_UNIT, CODE_TAB_WIDTH, indentUnitOf, leadingIndent } from '../../../../shared/core/indent';
import { keepUntouchedLines } from '../../../ui/codeIndentView';

export type RuleLayout = {
  readonly base: string;
  readonly unit: string;
  readonly continuations: readonly string[];
  readonly source: string;
};

export type RuleChainText = {
  readonly text: string;
  readonly depth: number;
  readonly prefix: string;
  readonly suffix: string;
};

export function ruleEditorText(node: Rule | AtRule): string {
  const source = node.toString();
  const text = editorTextFromSource(source, ruleLayout(node));
  assert(!text.includes('\r'), 'ruleEditorText: lines split on \\n only');
  return text;
}

export function ruleLayout(node: Rule | AtRule): RuleLayout {
  const base = lineIndent(node.raws.before);
  const source = node.toString();
  const lines = splitLines(source);
  const starts = preludeStarts(lines);
  const unit = bodyUnit(lines, starts, base) ?? surroundingUnit(node);
  assert(unit.length > 0, 'ruleLayout: an indent unit is never empty');
  const continuations = continuationOffsets(lines, starts, base);
  assert(continuations.length <= lines.length, 'ruleLayout: at most one continuation offset per line');
  return { base, unit, continuations, source };
}

export function ruleChainLevels(node: Rule | AtRule): readonly string[] {
  const levels: string[] = [];
  let parent: Container | Document | undefined = node.parent;
  while (parent !== undefined && isChainLevel(parent)) {
    assert(levels.length <= LIMITS.treeDepthMax, 'ruleChainLevels: a chain is as deep as a parsed tree at most');
    levels.unshift(ruleHead(parent));
    parent = parent.parent;
  }
  return levels;
}

export function ruleHead(node: Rule | AtRule): string {
  if (node.type === 'rule') {
    const raw = node.raws.selector?.raw ?? node.selector;
    assert(raw.length > 0, 'ruleHead: a rule has a selector');
    return raw.trim();
  }
  assert(node.name.length > 0, 'ruleHead: an at-rule has a name');
  return `@${node.name} ${node.params}`.trim();
}

export function indentedRuleHead(head: string, depth: number): string {
  assert(depth >= 0, 'indentedRuleHead: a depth is never negative');
  const indent = CODE_INDENT_UNIT.repeat(depth);
  return head
    .split('\n')
    .map((line) => indent + line.trim())
    .join('\n');
}

export function ruleChainText(node: Rule | AtRule): RuleChainText {
  const levels = ruleChainLevels(node);
  const depth = levels.length;
  const indent = CODE_INDENT_UNIT.repeat(depth);
  const opening = levels.map((level, index) => `${indentedRuleHead(level, index)} {\n`).join('');
  const closing = levels.map((_level, index) => `\n${CODE_INDENT_UNIT.repeat(depth - 1 - index)}}`).join('');
  const lines = ruleEditorText(node)
    .split('\n')
    .map((line, index) => (index === 0 || line.length === 0 ? line : indent + line));
  const prefix = opening + indent;
  const text = prefix + lines.join('\n') + closing;
  assert(text.startsWith(prefix), 'ruleChainText: the text opens with the chain');
  assert(text.endsWith(closing), 'ruleChainText: the text closes with the chain');
  return { text, depth, prefix, suffix: closing };
}

export function ruleTextFromChain(text: string, chain: RuleChainText): string | undefined {
  assert(chain.depth >= 0, 'ruleTextFromChain: a depth is never negative');
  const editable = text.length - chain.prefix.length - chain.suffix.length;
  if (editable < 0) {
    return undefined;
  }
  if (!text.startsWith(chain.prefix)) {
    return undefined;
  }
  if (!text.endsWith(chain.suffix)) {
    return undefined;
  }
  const lines = text.slice(chain.prefix.length, chain.prefix.length + editable).split('\n');
  return lines.map((line, index) => (index === 0 ? line : withoutChainIndent(line, chain.depth))).join('\n');
}

export function editorTextFromSource(source: string, layout: RuleLayout): string {
  assert(layout.unit.length > 0, 'editorTextFromSource: an indent unit is never empty');
  const lines = splitLines(source);
  const starts = preludeStarts(lines);
  const prefixes = continuationPrefixes(lines, starts);
  const shown: string[] = [];
  for (const [index, line] of lines.entries()) {
    const start = starts[index];
    if (index === 0) {
      shown.push(line);
    } else if (start === undefined) {
      shown.push(reindentLine(stripBase(line, layout.base), layout.unit, CODE_INDENT_UNIT, ''));
    } else {
      assert(start < index, 'editorTextFromSource: a prelude starts before its continuation');
      const startShown = shown[start];
      assert(startShown !== undefined, 'editorTextFromSource: the prelude start line is shown');
      shown.push(rebaseLine(line, prefixes.get(start) ?? '', leadingIndent(startShown)));
    }
  }
  assert(shown.length === lines.length, 'editorTextFromSource: one shown line per source line');
  return shown.join('\n');
}

export function sourceTextFromEditor(editorText: string, layout: RuleLayout): string {
  assert(layout.unit.length > 0, 'sourceTextFromEditor: an indent unit is never empty');
  const lines = splitLines(editorText.replace(/\r\n?/g, '\n'));
  const starts = preludeStarts(lines);
  const ordinals = preludeOrdinals(starts);
  const written: string[] = [];
  for (const [index, line] of lines.entries()) {
    const start = starts[index];
    if (index === 0) {
      written.push(line.trimStart());
    } else if (start === undefined) {
      written.push(reindentLine(line, CODE_INDENT_UNIT, layout.unit, layout.base));
    } else {
      assert(start < index, 'sourceTextFromEditor: a prelude starts before its continuation');
      const startEditor = lines[start];
      const startWritten = written[start];
      assert(startEditor !== undefined, 'sourceTextFromEditor: the prelude start line exists');
      assert(startWritten !== undefined, 'sourceTextFromEditor: the prelude start line is written');
      const startIndent = start === 0 ? layout.base : leadingIndent(startWritten);
      const ordinal = ordinals.get(start) ?? 0;
      const offset = layout.continuations[ordinal] ?? layout.continuations[0] ?? '';
      written.push(rebaseLine(line, leadingIndent(startEditor), startIndent + offset));
    }
  }
  assert(written.length === lines.length, 'sourceTextFromEditor: one written line per editor line');
  const edit = { source: splitLines(layout.source), shown: splitLines(editorTextFromSource(layout.source, layout)), next: lines };
  return keepUntouchedLines(edit, (_line, index) => written[index] ?? '').join('\n');
}

function isChainLevel(node: Container | Document): node is Rule | AtRule {
  return node.type === 'rule' || node.type === 'atrule';
}

function withoutChainIndent(line: string, depth: number): string {
  let removed = 0;
  while (removed < depth && line[removed] === CODE_INDENT_UNIT) {
    removed += 1;
  }
  assert(removed <= depth, 'withoutChainIndent: never removes more than the chain added');
  return line.slice(removed);
}

function surroundingUnit(node: ChildNode): string {
  return indentUnitOf(node.root().toString());
}

function lineIndent(raw: string | undefined): string {
  if (raw === undefined) {
    return '';
  }
  const lineStart = raw.lastIndexOf('\n');
  if (lineStart < 0) {
    return '';
  }
  return raw.slice(lineStart + 1).replace(/\S/g, '');
}

function bodyUnit(lines: readonly string[], starts: readonly (number | undefined)[], base: string): string | undefined {
  assert(starts.length === lines.length, 'bodyUnit: one prelude entry per line');
  let unit: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (index === 0 || starts[index] !== undefined) {
      continue;
    }
    const rest = stripBase(line, base);
    const leading = leadingIndent(rest);
    if (leading.length > 0 && leading.length < rest.length) {
      if (unit === undefined || leading.length < unit.length) {
        unit = leading;
      }
    }
  }
  return unit;
}

function reindentLine(line: string, fromUnit: string, toUnit: string, prefix: string): string {
  const leading = leadingIndent(line);
  const content = line.slice(leading.length);
  if (content.length === 0) {
    return '';
  }
  const unitWidth = fromUnit === CODE_INDENT_UNIT ? CODE_TAB_WIDTH : fromUnit.length;
  const width = leading.replace(/\t/g, ' '.repeat(unitWidth)).length;
  const levels = Math.floor(width / unitWidth);
  const spareCount = width - levels * unitWidth;
  assert(spareCount >= 0, 'reindentLine: whole levels never exceed the width');
  assert(spareCount < unitWidth, 'reindentLine: the spare part is less than a level');
  return prefix + toUnit.repeat(levels) + ' '.repeat(spareCount) + content;
}

function preludeStarts(lines: readonly string[]): readonly (number | undefined)[] {
  const starts: (number | undefined)[] = lines.map(() => undefined);
  let quote: string | undefined;
  let comment = false;
  let statementStart: number | undefined;
  for (const [index, line] of lines.entries()) {
    let previous = '';
    for (const character of line) {
      const pair = previous + character;
      previous = character;
      if (comment) {
        if (pair === '*/') {
          comment = false;
          previous = '';
        }
      } else if (quote !== undefined) {
        if (pair === '\\' + character) {
          previous = '';
        } else if (character === quote) {
          quote = undefined;
        }
      } else if (pair === '/*') {
        comment = true;
        previous = '';
      } else if (character === '"' || character === "'") {
        quote = character;
        statementStart ??= index;
      } else if (character === '{') {
        if (statementStart !== undefined) {
          assert(statementStart <= index, 'preludeStarts: a prelude ends at or after its start');
          starts.fill(statementStart, statementStart + 1, index + 1);
        }
        statementStart = undefined;
      } else if (character === ';' || character === '}') {
        statementStart = undefined;
      } else if (character.trim().length > 0 && character !== '/') {
        statementStart ??= index;
      }
    }
  }
  assert(starts.length === lines.length, 'preludeStarts: one entry per line');
  return starts;
}

function continuationPrefixes(lines: readonly string[], starts: readonly (number | undefined)[]): ReadonlyMap<number, string> {
  assert(starts.length === lines.length, 'continuationPrefixes: one prelude entry per line');
  const prefixes = new Map<number, string>();
  for (const [index, line] of lines.entries()) {
    const start = starts[index];
    if (start === undefined || line.trim().length === 0) {
      continue;
    }
    const leading = leadingIndent(line);
    const known = prefixes.get(start);
    prefixes.set(start, known === undefined ? leading : commonPrefix(known, leading));
  }
  assert(prefixes.size <= lines.length, 'continuationPrefixes: at most one prefix per line');
  return prefixes;
}

function continuationOffsets(lines: readonly string[], starts: readonly (number | undefined)[], base: string): readonly string[] {
  const offsets: string[] = [];
  for (const [start, prefix] of continuationPrefixes(lines, starts)) {
    const line = lines[start];
    assert(line !== undefined, 'continuationOffsets: a prelude start is a line');
    const startIndent = start === 0 ? base : leadingIndent(line);
    offsets.push(prefix.startsWith(startIndent) ? prefix.slice(startIndent.length) : '');
  }
  return offsets;
}

function preludeOrdinals(starts: readonly (number | undefined)[]): ReadonlyMap<number, number> {
  const ordinals = new Map<number, number>();
  for (const start of starts) {
    if (start !== undefined && !ordinals.has(start)) {
      ordinals.set(start, ordinals.size);
    }
  }
  assert(ordinals.size <= starts.length, 'preludeOrdinals: at most one ordinal per line');
  return ordinals;
}

function rebaseLine(line: string, fromPrefix: string, toPrefix: string): string {
  const content = line.trimStart();
  if (content.length === 0) {
    return '';
  }
  const rest = line.startsWith(fromPrefix) ? line.slice(fromPrefix.length) : content;
  return toPrefix + rest;
}

function commonPrefix(first: string, second: string): string {
  let length = 0;
  const lengthMax = Math.min(first.length, second.length);
  while (length < lengthMax && first[length] === second[length]) {
    length += 1;
  }
  assert(length <= lengthMax, 'commonPrefix: never longer than the shorter string');
  return first.slice(0, length);
}

function stripBase(line: string, base: string): string {
  if (line.startsWith(base)) {
    return line.slice(base.length);
  }
  return line.trimStart();
}

function splitLines(text: string): readonly string[] {
  const lines = text.split('\n');
  assert(lines.length <= LIMITS.treeNodesMax, 'splitLines: a rule spans a bounded number of lines');
  return lines;
}
