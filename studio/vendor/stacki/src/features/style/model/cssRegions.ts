
import postcss, { type AtRule, type ChildNode, type Declaration, type Document, type Root, type Rule } from 'postcss';
import { assert } from '../../../../shared/core/assert';
import { CODE_INDENT_UNIT, indentUnitOf } from '../../../../shared/core/indent';
import type { StyleRegion } from './styleTypes';
import { selectorKey } from './resolved';
import { fillTrailingBlankLine, isPaddingProperty, setPaddingDeclaration } from './spacingShorthand';

export type DeclarationValue = { readonly value: string; readonly important: boolean };

export const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase();

export function childRule(container: Root | Rule | AtRule, matches: (rule: Rule) => boolean): Rule | undefined {
  return container.nodes?.find((child): child is Rule => child.type === 'rule' && matches(child));
}

export function childAtRule(container: Root | Rule | AtRule, name: string, params: string): AtRule | undefined {
  return container.nodes?.find(
    (child): child is AtRule => child.type === 'atrule' && child.name.toLowerCase() === name && squash(child.params) === squash(params),
  );
}

export function terminateDeclarations(node: Rule | AtRule): void {
  node.assign({ raws: { ...node.raws, semicolon: true } });
}

export function findChildRuleBySelector(container: Root | AtRule, selector: string): Rule | undefined {
  const key = selectorKey(selector);
  return childRule(container, (rule) => selectorKey(rule.selector) === key);
}

export function setDeclOnRule(rule: Rule, prop: string, declared: DeclarationValue) {
  if (isPaddingProperty(prop)) {
    setPaddingDeclaration(rule, prop, declared);
    return;
  }
  const last = directDecls(rule)
    .filter((declaration) => declaration.prop === prop)
    .at(-1);
  if (last) {
    last.value = declared.value;
    last.important = declared.important;
  } else if (rule.nodes?.some((child) => child.type === 'rule' || child.type === 'atrule')) {
    appendDecl(rule, prop, declared);
  } else {
    rule.append({ prop, value: declared.value, important: declared.important });
    fillTrailingBlankLine(rule);
  }
  terminateDeclarations(rule);
}

export const STYLE_OPEN = /<style\b[^>]*>/gi;
export const STYLE_CLOSE = '</style>';

export function extractStyleRegions(code: string): StyleRegion[] {
  const regions: StyleRegion[] = [];
  const lower = code.toLowerCase();
  const comments = htmlCommentRanges(lower);
  STYLE_OPEN.lastIndex = frontmatterEnd(code);
  for (let match = STYLE_OPEN.exec(code); match !== null; match = STYLE_OPEN.exec(code)) {
    const at = match.index;
    const comment = comments.find((range) => range.start <= at && at < range.end);
    if (comment !== undefined) {
      STYLE_OPEN.lastIndex = comment.end;
      continue;
    }
    const innerStart = match.index + match[0].length;
    const closeIndex = lower.indexOf(STYLE_CLOSE, innerStart);
    if (closeIndex === -1) {
      break;
    }
    regions.push({
      start: innerStart,
      end: closeIndex,
      css: code.slice(innerStart, closeIndex),
      root: undefined,
      openTag: match[0],
    });
    STYLE_OPEN.lastIndex = closeIndex + STYLE_CLOSE.length;
  }
  return regions;
}

const FRONTMATTER_OPEN = /^\uFEFF?[ \t]*---[ \t]*\r?\n/;
const FRONTMATTER_CLOSE = /^[ \t]*---[ \t]*$/m;
export function frontmatterEnd(code: string): number {
  const open = FRONTMATTER_OPEN.exec(code);
  if (open === null) {
    return 0;
  }
  const rest = code.slice(open[0].length);
  const close = FRONTMATTER_CLOSE.exec(rest);
  if (close === null) {
    return 0;
  }
  const end = open[0].length + close.index + close[0].length;
  assert(end <= code.length, 'frontmatterEnd: the fence ends inside the file');
  return end;
}

function htmlCommentRanges(lower: string): { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const rangesMax = Math.ceil(lower.length / 4);
  for (let start = lower.indexOf('<!--'); start !== -1 && ranges.length < rangesMax; start = lower.indexOf('<!--', start + 4)) {
    const close = lower.indexOf('-->', start + 4);
    const end = close === -1 ? lower.length : close + 3;
    ranges.push({ start, end });
    if (close === -1) {
      break;
    }
    start = end - 4;
  }
  assert(ranges.length <= rangesMax, 'htmlCommentRanges: bounded by the text');
  return ranges;
}

export function parseRegion(region: StyleRegion): StyleRegion {
  try {
    const root = postcss.parse(region.css);
    if (!/^[ \t]+\S/m.test(region.css)) {
      root.raws['indent'] = CODE_INDENT_UNIT;
    }
    return { ...region, root, parseError: undefined };
  } catch (error: unknown) {
    const parseError = error instanceof Error ? error.message : String(error);
    return { ...region, root: undefined, parseError };
  }
}

export function splitEmbed(code: string): { segments: string[]; regions: StyleRegion[] } {
  const regions = extractStyleRegions(code);
  const segments: string[] = [];
  let cursor = 0;
  for (const region of regions) {
    segments.push(code.slice(cursor, region.start));
    cursor = region.end;
  }
  segments.push(code.slice(cursor));
  return { segments, regions };
}

export function renderEmbed(segments: string[], regions: StyleRegion[]): string {
  let out = segments[0] ?? '';
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    if (region === undefined) {
      throw new Error(`Style region ${i} is missing`);
    }
    out += regionText(region);
    out += segments[i + 1] ?? '';
  }
  return out;
}


export function directDecls(node: Rule | AtRule): Declaration[] {
  const out: Declaration[] = [];
  node.each((child) => {
    if (child.type === 'decl') {
      out.push(child as Declaration);
    }
  });
  return out;
}

export function appendDecl(node: Rule | AtRule, prop: string, declared: DeclarationValue): void {
  if (isPaddingProperty(prop)) {
    setPaddingDeclaration(node, prop, declared);
    return;
  }
  const decl = postcss.decl({ prop, value: declared.value, important: declared.important });
  const firstNested = node.nodes?.find((child) => child.type === 'rule' || child.type === 'atrule');
  if (firstNested) {
    node.insertBefore(firstNested, decl);
  } else {
    node.append(decl);
    fillTrailingBlankLine(node);
  }
  placeChild(node, decl);
  terminateDeclarations(node);
}

export function placeChild(parent: Rule | AtRule, child: ChildNode): void {
  const indent = indentInside(parent);
  if (indent === undefined) {
    return;
  }
  assert(!indent.includes('\n'), 'An indentation is one line');
  const block = child.type === 'rule' || child.type === 'atrule';
  child.assign({ raws: { ...child.raws, before: `\n${indent}`, ...(block ? { after: `\n${indent}` } : {}) } });
  assert(child.parent === parent, 'A placed node is inside its parent');
}

function indentInside(parent: Rule | AtRule): string | undefined {
  const own = lineIndentOf(parent.raws.before) ?? regionStartIndent(parent);
  const children = (parent.nodes ?? []).filter((node) => node.raws.before !== undefined);
  const lined = children.find((node) => lineIndentOf(node.raws.before) !== undefined);
  if (lined !== undefined) {
    return lineIndentOf(lined.raws.before);
  }
  if (children.length > 0 || own === undefined) {
    return undefined;
  }
  return own + indentStep(parent.root());
}

function regionStartIndent(node: Rule | AtRule): string | undefined {
  const parent = node.parent;
  if (parent === undefined) {
    return undefined;
  }
  if (parent.type !== 'root') {
    return undefined;
  }
  if (parent.first !== node) {
    return undefined;
  }
  return node.raws.before === '' ? '' : undefined;
}

export function regionText(region: StyleRegion): string {
  if (region.root === undefined) {
    return region.css;
  }
  const text = region.root.toString();
  if (!region.css.includes('\r\n')) {
    return text;
  }
  if (/(^|[^\r])\n/.test(region.css)) {
    return text;
  }
  const crlf = text.replace(/\r?\n/g, '\r\n');
  assert(!/(^|[^\r])\n/.test(crlf), 'regionText: every line ends in \\r\\n');
  assert(crlf.replace(/\r/g, '') === text.replace(/\r/g, ''), 'regionText: only line endings change');
  return crlf;
}

function lineIndentOf(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.includes('\n')) {
    return undefined;
  }
  return raw.slice(raw.lastIndexOf('\n') + 1).replace(/\S/g, '');
}

function indentStep(root: Root | Document): string {
  let step: string | undefined;
  root.walkDecls((decl) => {
    const parent = decl.parent;
    const inner = lineIndentOf(decl.raws.before);
    const outer = parent?.type === 'rule' ? lineIndentOf(parent.raws.before) : undefined;
    if (inner !== undefined && outer !== undefined && inner.length > outer.length && inner.startsWith(outer)) {
      step = inner.slice(outer.length);
      return false;
    }
    return undefined;
  });
  return step ?? indentUnitOf(root.toString());
}

export function setDeclDirect(node: Rule | AtRule, prop: string, declared: DeclarationValue) {
  if (isPaddingProperty(prop)) {
    setPaddingDeclaration(node, prop, declared);
    return;
  }
  const key = prop.trim().toLowerCase();
  const existing = directDecls(node).find((declaration) => declaration.prop.trim().toLowerCase() === key);
  if (existing) {
    existing.value = declared.value;
    existing.important = declared.important;
    terminateDeclarations(node);
  } else {
    appendDecl(node, prop, declared);
  }
}
