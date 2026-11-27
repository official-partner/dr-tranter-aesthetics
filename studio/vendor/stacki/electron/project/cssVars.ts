import { variableFiles as fs } from './variableWorkspace';
import path from 'path';
import { writeProjectText } from './variableWorkspace';
import { assert } from '../../shared/core/assert';
import { findRule, sectionAt, styleWriteProblem } from './cssVarRegions';
import type { Declaration } from 'postcss';
import { described, type Described, type MessageKey, type MessageRef } from '../../shared/properties/i18n/messageRef';
import type { MessageParams } from '../../shared/core/i18n/catalog';


interface Refusal {
  readonly error: string;
  readonly errorRef: MessageRef;
}

function refusal(key: MessageKey, params?: MessageParams): Refusal {
  const sentence = described(key, params);
  return { error: sentence.message, errorRef: sentence.messageRef };
}

function problemRefusal(problem: Described): { readonly error: string; readonly errorRef?: MessageRef | undefined } {
  return { error: problem.message, errorRef: problem.messageRef };
}

function commit(abs: string, { file, text, next }: { readonly file: string; readonly text: string; readonly next: string }): Described | undefined {
  const problem = styleWriteProblem(file, text, next);
  if (problem === undefined) {
    writeProjectText(abs, next);
  }
  return problem;
}

interface SetValuePayload {
  readonly file: string;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly expect?: string;
  readonly value: string;
}

function setVariable(
  projectPath: string,
  { file, valueStart, valueEnd, expect, value }: SetValuePayload,
): { ok: boolean; stale?: boolean; error?: string; errorRef?: MessageRef | undefined } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  const current = text.slice(valueStart, valueEnd);
  if (expect !== undefined && current !== expect) {
    return { ok: false, stale: true, ...refusal('variables.error.changedSincePanelRead') };
  }
  const problem = commit(abs, { file, text, next: text.slice(0, valueStart) + value + text.slice(valueEnd) });
  return problem === undefined ? { ok: true } : { ok: false, ...problemRefusal(problem) };
}

interface SectionRangePayload {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly expect?: string;
  readonly title?: string;
}

function setSectionTitle(
  projectPath: string,
  { file, start, end, expect, title }: SectionRangePayload,
): { ok: boolean; stale?: boolean; error?: string; errorRef?: MessageRef | undefined } {
  const next = String(title ?? '').trim();
  if (!next) {
    return { ok: false, ...refusal('variables.error.headingNeedsName') };
  }
  if (next.includes('*/')) {
    return { ok: false, ...refusal('variables.error.headingCannotContainCommentEnd') };
  }

  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  const current = text.slice(start, end);
  if (expect !== undefined && current !== expect) {
    return { ok: false, stale: true, ...refusal('variables.error.changedSincePanelRead') };
  }
  const problem = commit(abs, { file, text, next: text.slice(0, start) + next + text.slice(end) });
  return problem === undefined ? { ok: true } : { ok: false, ...problemRefusal(problem) };
}

function removeSection(
  projectPath: string,
  { file, start, end, expect }: SectionRangePayload,
): { ok: boolean; stale?: boolean; error?: string; errorRef?: MessageRef | undefined } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  if (expect !== undefined && text.slice(start, end) !== expect) {
    return { ok: false, stale: true, ...refusal('variables.error.changedSincePanelRead') };
  }
  const open = text.lastIndexOf('/*', start);
  const close = text.indexOf('*/', end);
  if (open === -1 || close === -1) {
    return { ok: false, ...refusal('variables.error.headingNotComment') };
  }
  let from = open;
  let to = close + 2;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', to);
  const before = text.slice(lineStart, from);
  const after = text.slice(to, lineEnd === -1 ? text.length : lineEnd);
  if (!before.trim() && !after.trim()) {
    from = lineStart;
    to = lineEnd === -1 ? text.length : lineEnd + 1;
  }
  const problem = commit(abs, { file, text, next: text.slice(0, from) + text.slice(to) });
  return problem === undefined ? { ok: true } : { ok: false, ...problemRefusal(problem) };
}

interface MoveHeadingPayload {
  readonly file: string;
  readonly selector: string;
  readonly start: number;
  readonly end: number;
  readonly expect?: string;
  readonly before?: string;
}

function moveHeading(
  projectPath: string,
  { file, selector, start, end, expect, before }: MoveHeadingPayload,
): { ok: boolean; stale?: boolean; error?: string; errorRef?: MessageRef | undefined } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  if (expect !== undefined && text.slice(start, end) !== expect) {
    return { ok: false, stale: true, ...refusal('variables.error.changedSincePanelRead') };
  }
  const open = text.lastIndexOf('/*', start);
  const close = text.indexOf('*/', end);
  if (open === -1 || close === -1) {
    return { ok: false, ...refusal('variables.error.headingNotComment') };
  }

  const comment = text.slice(open, close + 2);
  let from = open;
  let to = close + 2;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', to);
  if (!text.slice(lineStart, from).trim() && !text.slice(to, lineEnd === -1 ? text.length : lineEnd).trim()) {
    from = lineStart;
    to = lineEnd === -1 ? text.length : lineEnd + 1;
  }
  const cut = text.slice(0, from) + text.slice(to);

  const found = findRule(cut, { file, selector, declares: before, section: sectionAt(file, text, start) });
  if (!found.ok) {
    return found;
  }
  const { rule } = found;

  const decls = (rule.nodes || []).filter((node) => node.type === 'decl');
  const anchorDecl = before ? decls.find((declaration) => declaration.prop === before) : undefined;
  let at: number;
  if (anchorDecl) {
    const offset = anchorDecl.source?.start?.offset ?? 0;
    at = cut.lastIndexOf('\n', offset - 1) + 1;
  } else {
    const last = decls[decls.length - 1];
    if (last) {
      const offset = last.source?.end?.offset ?? 0;
      const nl = cut.indexOf('\n', offset);
      at = nl === -1 ? cut.length : nl + 1;
    } else {
      const openOffset = rule.source?.start?.offset ?? 0;
      at = cut.indexOf('{', openOffset) + 2;
    }
  }
  const indent = cut.slice(cut.lastIndexOf('\n', at - 1) + 1, at).match(/^\s*/)?.[0] || '  ';
  const problem = commit(abs, { file, text, next: `${cut.slice(0, at)}${indent}${comment}\n${cut.slice(at)}` });
  return problem === undefined ? { ok: true } : { ok: false, ...problemRefusal(problem) };
}

interface AddSectionPayload {
  readonly file: string;
  readonly selector: string;
  readonly title?: string;
  readonly before?: string;
  readonly at?: number;
}

function addSection(
  projectPath: string,
  { file, selector, title, before, at }: AddSectionPayload,
): { ok: boolean; error?: string; errorRef?: MessageRef | undefined; stale?: boolean; title?: string } {
  const next = String(title ?? '').trim();
  if (!next) {
    return { ok: false, ...refusal('variables.error.headingNeedsName') };
  }
  if (next.includes('*/')) {
    return { ok: false, ...refusal('variables.error.headingCannotContainCommentEnd') };
  }

  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');

  let offset = at;
  if (typeof offset !== 'number') {
    const found = findRule(text, { file, selector, declares: before });
    if (!found.ok) {
      return found;
    }
    const decls = (found.rule.nodes || []).filter((node) => node.type === 'decl');
    const anchorDecl = (before && decls.find((declaration) => declaration.prop === before)) || decls[decls.length - 1] || undefined;
    if (!anchorDecl) {
      return { ok: false, ...refusal('variables.error.nothingToHead', { selector }) };
    }
    offset = anchorDecl.source?.start?.offset ?? 0;
  }
  const sane = outsideComment(text, offset > text.length ? text.length : offset < 0 ? 0 : offset);
  if (sane < 0 || sane > text.length) {
    return { ok: false, ...refusal('variables.error.placeGone') };
  }

  const lineStart = text.lastIndexOf('\n', sane - 1) + 1;
  const indent = text.slice(lineStart, sane).match(/^\s*/)?.[0] ?? '';
  const heading = `${indent}/* ${next} */\n`;
  const problem = commit(abs, { file, text, next: `${text.slice(0, lineStart)}${heading}${text.slice(lineStart)}` });
  return problem === undefined ? { ok: true, title: next } : { ok: false, ...problemRefusal(problem) };
}

function outsideComment(text: string, offset: number): number {
  assert(offset >= 0, 'outsideComment: the offset is in the file');
  assert(offset <= text.length, 'outsideComment: the offset is in the file');
  const open = text.lastIndexOf('/*', offset);
  if (open === -1) {
    return offset;
  }
  const close = text.indexOf('*/', open + 2);
  if (close === -1) {
    return offset;
  }
  return close + 2 > offset ? open : offset;
}

interface MoveVariablePayload {
  readonly file: string;
  readonly selector: string;
  readonly name: string;
  readonly target?: string;
  readonly at?: number;
}

interface SourcedNode {
  readonly source?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
}

function lineSpan(text: string, node: SourcedNode): { from: number; to: number } {
  const start = node.source?.start?.offset ?? 0;
  const end = node.source?.end?.offset ?? start;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextLine = text.indexOf('\n', end);
  return { from: lineStart, to: nextLine === -1 ? text.length : nextLine + 1 };
}

function moveVariable(
  projectPath: string,
  { file, selector, name, target, at: landAt }: MoveVariablePayload,
): { ok: boolean; error?: string; errorRef?: MessageRef | undefined; changed?: boolean } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  const found = findRule(text, { file, selector, declares: name });
  if (!found.ok) {
    return found;
  }
  const { rule } = found;

  const declOf = (prop: string): Declaration | undefined => (rule.nodes || []).find((node): node is Declaration => node.type === 'decl' && node.prop === prop);
  const moved = declOf(name);
  if (!moved) {
    return { ok: false, ...refusal('variables.error.notDeclared', { name }) };
  }
  const before = target ? declOf(target) : undefined;
  if (target && !before) {
    return { ok: false, ...refusal('variables.error.notDeclared', { name: target }) };
  }

  const span = lineSpan(text, moved);
  const line = text.slice(span.from, span.to);
  const allDecls = (rule.nodes || []).filter((node) => node.type === 'decl');
  const lastDecl = allDecls[allDecls.length - 1] ?? moved;
  const at =
    typeof landAt === 'number'
      ? text.lastIndexOf('\n', outsideComment(text, Math.max(0, Math.min(landAt, text.length))) - 1) + 1
      : before
        ? lineSpan(text, before).from
        : lineSpan(text, lastDecl).to;

  const withoutLine = text.slice(0, span.from) + text.slice(span.to);
  const insertAt = at > span.from ? at - (span.to - span.from) : at;
  const next = withoutLine.slice(0, insertAt) + line + withoutLine.slice(insertAt);
  if (next === text) {
    return { ok: true, changed: false };
  }
  const problem = commit(abs, { file, text, next });
  return problem === undefined ? { ok: true, changed: true } : { ok: false, ...problemRefusal(problem) };
}

interface MoveSectionPayload {
  readonly file: string;
  readonly selector: string;
  readonly names: readonly string[];
  readonly target?: string;
}

function moveSection(
  projectPath: string,
  { file, selector, names, target }: MoveSectionPayload,
): { ok: boolean; error?: string; errorRef?: MessageRef | undefined; changed?: boolean } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  const found = findRule(text, { file, selector, declares: names[0] });
  if (!found.ok) {
    return found;
  }
  const { rule } = found;

  const nodes = rule.nodes || [];
  const declOf = (prop: string): Declaration | undefined => nodes.find((node): node is Declaration => node.type === 'decl' && node.prop === prop);

  const decls = names.map(declOf).filter((declaration): declaration is Declaration => declaration !== undefined);
  const firstDecl = decls[0];
  if (!firstDecl) {
    return { ok: false, ...refusal('variables.error.variablesNotDeclared') };
  }

  const spans = decls.map((declaration) => lineSpan(text, declaration));
  const firstSpan = spans[0];
  if (!firstSpan) {
    return { ok: false, ...refusal('variables.error.variablesNotDeclared') };
  }
  const firstAt = nodes.indexOf(firstDecl);
  const heading = firstAt > 0 && nodes[firstAt - 1]?.type === 'comment' ? nodes[firstAt - 1] : undefined;
  if (heading?.type === 'comment') {
    spans.unshift(lineSpan(text, heading));
  }

  spans.sort((left, right) => left.from - right.from);
  const last = spans[spans.length - 1] ?? firstSpan;
  const blank = text.slice(last.to).match(/^[ \t]*\r?\n/);
  if (blank) {
    last.to += blank[0]?.length ?? 0;
  }
  let block = spans.map((span) => text.slice(span.from, span.to)).join('');

  const landing = target ? declOf(target) : undefined;
  if (target && !landing) {
    return { ok: false, ...refusal('variables.error.notDeclared', { name: target }) };
  }
  const landingAt = landing ? nodes.indexOf(landing) : -1;
  const landingHeading = landingAt > 0 ? nodes[landingAt - 1] : undefined;
  const lastDecl = decls[decls.length - 1] ?? firstDecl;
  const at = landing ? lineSpan(text, landingHeading?.type === 'comment' ? landingHeading : landing).from : lineSpan(text, lastDecl).to;
  if (!landing) {
    block = block.replace(/(?:[ \t]*\r?\n)+$/, '\n').replace(/^/, '\n');
  } else if (!/\n[ \t]*\r?\n$/.test(block)) {
    block += '\n';
  }

  const next = cutAndInsert(text, spans, block, at);
  if (next === text) {
    return { ok: true, changed: false };
  }
  const problem = commit(abs, { file, text, next });
  return problem === undefined ? { ok: true, changed: true } : { ok: false, ...problemRefusal(problem) };
}

function cutAndInsert(text: string, spans: readonly { readonly from: number; readonly to: number }[], block: string, at: number): string {
  let out = text;
  for (const span of [...spans].reverse()) {
    out = out.slice(0, span.from) + out.slice(span.to);
  }
  const removedBefore = spans.reduce((sum, span) => (span.to <= at ? sum + (span.to - span.from) : sum), 0);
  const insertAt = at - removedBefore;
  assert(insertAt >= 0, 'cutAndInsert: the insertion point is not before the text');
  return out.slice(0, insertAt) + block + out.slice(insertAt);
}

interface AddVariablePayload {
  readonly file: string;
  readonly selector: string;
  readonly name: string;
  readonly value?: string;
  readonly after?: string;
}

function addVariable(
  projectPath: string,
  { file, selector, name, value = 'unset', after }: AddVariablePayload,
): { ok: boolean; error?: string; errorRef?: MessageRef | undefined; name?: string } {
  const abs = path.resolve(projectPath, file);
  const text = fs.readFileSync(abs, 'utf8');
  const found = findRule(text, { file, selector, declares: after });
  if (!found.ok) {
    return found;
  }
  const { rule } = found;

  const decls = (rule.nodes || []).filter((node) => node.type === 'decl');
  if (decls.some((declaration) => declaration.prop === name)) {
    return { ok: false, ...refusal('variables.error.alreadyDeclared', { name, selector }) };
  }

  const previous = (after && decls.find((declaration) => declaration.prop === after)) || decls[decls.length - 1] || undefined;
  const indentOf = (node: Declaration): string => {
    const start = node.source?.start?.offset ?? 0;
    return text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
  };
  const line = `${previous ? indentOf(previous) : '  '}${name}: ${value};\n`;

  let at: number;
  if (previous) {
    const end = previous.source?.end?.offset ?? 0;
    const nextLine = text.indexOf('\n', end);
    at = nextLine === -1 ? text.length : nextLine + 1;
  } else {
    const openOffset = rule.source?.start?.offset ?? 0;
    at = text.indexOf('{', openOffset) + 2;
  }

  const problem = commit(abs, { file, text, next: text.slice(0, at) + line + text.slice(at) });
  return problem === undefined ? { ok: true, name } : { ok: false, ...problemRefusal(problem) };
}

export { setSectionTitle, removeSection, addSection, moveHeading, setVariable, moveVariable, moveSection, addVariable };
export { readDeclarations, findStylesheets } from './cssVarRead';
export { findFamilies, groupRules, labelForRule } from './cssVarGroups';
export { readVariables, readVariablesSliced } from './cssVarModel';
export { renameVariables } from './cssVarRename';
