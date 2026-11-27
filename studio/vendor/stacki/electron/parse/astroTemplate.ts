
import { textValue } from '../../shared/page/htmlText';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode, MapNode, CondNode, ParsedTemplate } from './astroParserTypes';
import { VOID_ELEMENTS, RAW_ELEMENTS, makeId, assignPathIds, tagFields, required } from './astroAttrs';
import {
  findMatchingBrace,
  findMatchingParen,
  normalizeHead,
  dedentHead,
  splitBlockLoopBody,
  topLevelOps,
  NOT_YET_FOUND,
  nextDelimiters,
  findMatchingClose,
  findMatchingFragmentClose,
} from './astroScan';
import {
  makeBranch,
  branchIsMarkup,
  exprBranch,
  parseState,
  bail,
  type TemplateTagResult,
  parseTemplateAt,
  type TemplateTagOpen,
  parseTemplateWithinBounds,
} from './astroParseState';
import { isInlineRun } from './astroSerialize';
import { scanTag } from './astroTag';
import { readMapSyntax, type MapSyntax } from './astroMapSyntax';

function tryParseMap(exprText: string, base: number | undefined = undefined): MapNode | undefined {
  const inner = exprText.slice(1, -1);
  const syntax = readMapSyntax(inner);
  if (!syntax) {
    return undefined;
  }
  const inBase = base === undefined ? undefined : base + 1;
  return parseMapEmpty(syntax) || parseMapSimple(inner, syntax, inBase) || parseMapCallback(inner, syntax, inBase);
}

function parseMapEmpty(syntax: MapSyntax): MapNode | undefined {
  const [part] = syntax.parts;
  if (syntax.markup.length !== 0 || syntax.parts.length !== 1 || part === undefined) {
    return undefined;
  }
  if (!/^\(?\s*null\s*\)\s*\)\s*\}?\s*$/.test(part)) {
    return undefined;
  }
  return { id: makeId(), kind: 'map', head: normalizeHead(syntax.head), headSource: syntax.head, children: [] };
}

function parseMapSimple(inner: string, syntax: MapSyntax, base: number | undefined) {
  switch (syntax.form) {
    case 'conditional':
      return tryParseConditionalMap(inner, base);
    case 'markup':
      return tryParseConciseMap(inner, base) || tryParseBareMap(inner, base);
    case 'block':
      return syntax.markup.length === 1 ? tryParseBlockMap(inner, base) : undefined;
    case 'general':
      return undefined;
    default: {
      const exhaustive: never = syntax.form;
      return exhaustive;
    }
  }
}

function parseMapCallback(inner: string, syntax: MapSyntax, base: number | undefined): MapNode | undefined {
  const children: ParserNode[] = [];
  const count = parseState.nodes;
  const previousBail = parseState.lastBail;
  for (const span of syntax.markup) {
    const parsed = parseTemplate(inner.slice(span.start, span.end), base === undefined ? undefined : base + span.start);
    if (!parsed.clean || parsed.nodes.length !== 1) {
      parseState.nodes = count;
      parseState.lastBail = previousBail;
      return undefined;
    }
    children.push(required(parsed.nodes[0], 'A callback markup root parsed as one node'));
  }
  assert(syntax.parts.length === children.length + 1, 'Callback code surrounds each markup root');
  return {
    id: makeId(),
    kind: 'map',
    head: normalizeHead(syntax.head),
    headSource: syntax.head,
    bodyParts: syntax.parts,
    children,
  };
}

function tryParseConditionalMap(inner: string, base: number | undefined = undefined): MapNode | undefined {
  const arrow = inner.match(/^([\s\S]*?\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*)/);
  if (!arrow) {
    return undefined;
  }
  const headRaw = required(arrow[1], 'Conditional loop header capture');
  const mapOpen = headRaw.lastIndexOf('.map(') + '.map'.length;
  const mapClose = findMatchingParen(inner, mapOpen);
  if (mapClose === -1 || inner.slice(mapClose + 1).trim()) {
    return undefined;
  }
  const body = inner.slice(headRaw.length, mapClose).replace(/,\s*$/, '');
  const child = conditionalMapBody(body, base === undefined ? undefined : base + headRaw.length);
  if (!child) {
    return undefined;
  }
  return {
    id: makeId(),
    kind: 'map',
    head: normalizeHead(headRaw + '('),
    children: [child],
  };
}

function conditionalMapBody(raw: string, base: number | undefined): CondNode | undefined {
  let text = raw.trim();
  let at = base === undefined ? undefined : base + (raw.length - raw.trimStart().length);
  while (text.startsWith('(') && findMatchingParen(text, 0) === text.length - 1) {
    const inner = text.slice(1, -1);
    const trimmed = inner.trimStart();
    if (at !== undefined) {
      at += 1 + (inner.length - trimmed.length);
    }
    text = trimmed.trimEnd();
  }
  if (text.startsWith('<')) {
    return undefined;
  }
  const count = parseState.nodes;
  const previousBail = parseState.lastBail;
  const child = parseCondSource(text, at);
  if (!child) {
    parseState.nodes = count;
    parseState.lastBail = previousBail;
    return undefined;
  }
  if (at !== undefined) {
    child.start = at;
    child.end = at + text.length;
  }
  return child;
}

function tryParseConciseMap(inner: string, base: number | undefined = undefined): MapNode | undefined {
  const arrow = inner.match(/^([\s\S]*?\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\()/);
  if (!arrow) {
    return undefined;
  }
  const headRaw = required(arrow[1], 'Loop header capture');
  const openIndex = arrow[0].length - 1;
  const closeIndex = findMatchingParen(inner, openIndex);
  if (closeIndex === -1) {
    return undefined;
  }
  if (!/^\s*\)\s*$/.test(inner.slice(closeIndex + 1))) {
    return undefined;
  }
  const body = inner.slice(openIndex + 1, closeIndex);
  if (!body.trimStart().startsWith('<')) {
    return undefined;
  }
  const parsed = parseTemplate(body, base === undefined ? undefined : base + openIndex + 1);
  if (!parsed.clean) {
    return undefined;
  }
  return {
    id: makeId(),
    kind: 'map',
    head: normalizeHead(headRaw),
    headSource: dedentHead(headRaw),
    ...unwrappedLoopBody(body, parsed.nodes),
  };
}

function unwrappedLoopBody(body: string, nodes: ParserNode[]): { children: ParserNode[]; fragment?: '<>' | 'Fragment' } {
  const significant = nodes.filter((node) => node.kind !== 'comment');
  const only = significant.length === 1 && nodes.length === 1 ? significant[0] : undefined;
  if (only === undefined || only.kind !== 'component' || only.name !== 'Fragment') {
    return { children: nodes };
  }
  if (Object.keys(only.props ?? {}).length > 0) {
    return { children: nodes };
  }
  const fragment = body.trimStart().startsWith('<>') ? '<>' : 'Fragment';
  const children = only.children ?? [];
  assert(children !== nodes, 'unwrappedLoopBody: the children are the wrapper’s own');
  return { children, fragment };
}

function tryParseBareMap(inner: string, base: number | undefined = undefined): MapNode | undefined {
  const arrow = inner.match(/^([\s\S]*?\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*)</);
  if (!arrow) {
    return undefined;
  }
  const headRaw = required(arrow[1], 'Loop header capture');
  const mapOpen = headRaw.lastIndexOf('.map(') + '.map'.length;
  const mapClose = findMatchingParen(inner, mapOpen);
  if (mapClose === -1) {
    return undefined;
  }
  if (inner.slice(mapClose + 1).trim()) {
    return undefined;
  }
  const bareBody = inner.slice(headRaw.length, mapClose);
  const parsed = parseTemplate(bareBody, base === undefined ? undefined : base + headRaw.length);
  if (!parsed.clean) {
    return undefined;
  }
  return {
    id: makeId(),
    kind: 'map',
    head: normalizeHead(headRaw + '('),
    bare: true,
    ...unwrappedLoopBody(bareBody, parsed.nodes),
  };
}

function tryParseBlockMap(inner: string, base: number | undefined = undefined): MapNode | undefined {
  const arrow = inner.match(/^([\s\S]*?\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*)\{/);
  if (!arrow) {
    return undefined;
  }
  const headRaw = required(arrow[1], 'Loop header capture');
  const openIndex = arrow[0].length - 1;
  const closeIndex = findMatchingBrace(inner, openIndex);
  if (closeIndex === -1) {
    return undefined;
  }
  if (!/^\s*\)\s*$/.test(inner.slice(closeIndex + 1))) {
    return undefined;
  }
  const split = splitBlockLoopBody(inner.slice(openIndex + 1, closeIndex));
  if (!split) {
    return undefined;
  }
  const parsed = parseTemplate(split.markup, base === undefined ? undefined : base + openIndex + 1 + split.at);
  if (!parsed.clean) {
    return undefined;
  }
  return {
    id: makeId(),
    kind: 'map',
    head: normalizeHead(headRaw + '('),
    body: split.body,
    ...unwrappedLoopBody(split.markup, parsed.nodes),
  };
}

function branchNodes(raw: string, base: number | undefined = undefined): ParserNode[] | undefined {
  const text = String(raw);
  let expression = text.trimStart();
  let at = base === undefined ? undefined : base + (text.length - expression.length);
  expression = expression.trimEnd();
  while (expression.startsWith('(') && findMatchingParen(expression, 0) === expression.length - 1) {
    const inner = expression.slice(1, -1);
    const trimmed = inner.trimStart();
    if (at !== undefined) {
      at += 1 + (inner.length - trimmed.length);
    }
    expression = trimmed.trimEnd();
  }
  if (expression === '' || /^(null|undefined|false|''|"")$/.test(expression)) {
    return [];
  }
  if (expression.startsWith('<')) {
    const saved = parseState.lastBail;
    const parsed = parseTemplate(expression, at);
    if (parsed.clean) {
      return parsed.nodes;
    }
    parseState.lastBail = saved;
    return undefined;
  }
  const nested = parseCondSource(expression, at);
  if (nested && at !== undefined) {
    nested.start = at;
    nested.end = at + expression.length;
  }
  return nested ? [nested] : undefined;
}

function parseCondSource(source: string, base: number | undefined = undefined): CondNode | undefined {
  if (parseState.conditions >= LIMITS.treeDepthMax) {
    return undefined;
  }
  parseState.conditions++;
  try {
    return parseCondSourceBody(source, base);
  } finally {
    parseState.conditions--;
    assert(parseState.conditions >= 0, 'Conditional recursion unwinds to its caller');
  }
}

function parseCondSourceBody(source: string, base: number | undefined): CondNode | undefined {
  const raw = String(source);
  const text = raw.trim();
  if (!text) {
    return undefined;
  }
  const from = base === undefined ? undefined : base + (raw.length - raw.trimStart().length);
  const ops = topLevelOps(text);
  const ternary = ops.find((operator) => operator.op === '?');
  if (ternary) {
    const colon = ops.find((operator) => operator.op === ':' && operator.at > ternary.at);
    if (!colon) {
      return undefined;
    }
    const test = text.slice(0, ternary.at).trim();
    if (!test) {
      return undefined;
    }
    const thenRaw = text.slice(ternary.at + 1, colon.at);
    const elseRaw = text.slice(colon.at + 1);
    let thenKids = branchNodes(thenRaw, from === undefined ? undefined : from + ternary.at + 1);
    let elseKids = branchNodes(elseRaw, from === undefined ? undefined : from + colon.at + 1);
    if (thenKids && !elseKids && branchIsMarkup(thenKids)) {
      elseKids = exprBranch(elseRaw, from === undefined ? undefined : from + colon.at + 1);
    } else if (elseKids && !thenKids && branchIsMarkup(elseKids)) {
      thenKids = exprBranch(thenRaw, from === undefined ? undefined : from + ternary.at + 1);
    }
    if (!thenKids || !elseKids) {
      return undefined;
    }
    return {
      id: makeId(),
      kind: 'cond',
      op: '?',
      test,
      children: [
        makeBranch('then', thenKids, thenRaw, from === undefined ? undefined : from + ternary.at + 1),
        makeBranch('else', elseKids, elseRaw, from === undefined ? undefined : from + colon.at + 1),
      ],
    };
  }
  const ands = ops.filter((operator) => operator.op === '&&');
  const and = ands[ands.length - 1];
  if (!and) {
    return undefined;
  }
  const test = text.slice(0, and.at).trim();
  if (!test) {
    return undefined;
  }
  const thenRaw = text.slice(and.at + 2);
  const thenAt = from === undefined ? undefined : from + and.at + 2;
  const kids = branchNodes(thenRaw, thenAt);
  if (!kids || !kids.length) {
    return undefined;
  }
  return {
    id: makeId(),
    kind: 'cond',
    op: '&&',
    test,
    children: [makeBranch('then', kids, thenRaw, thenAt)],
  };
}

function tryParseMapWithSource(exprText: string, base: number | undefined = undefined): MapNode | undefined {
  const node = tryParseMap(exprText, base);
  if (node) {
    node.source = exprText;
  }
  return node;
}

function tryParseCond(exprText: string, base: number | undefined = undefined): CondNode | undefined {
  const node = parseCondSource(exprText.slice(1, -1), base === undefined ? undefined : base + 1);
  if (node) {
    node.source = exprText;
  }
  return node;
}

export function parseTemplate(template: string, base: number | undefined = undefined): ParsedTemplate {
  if (typeof template !== 'string') {
    return bail([], '', 0, 'a non-string template');
  }
  if (template.length > LIMITS.ipcFieldCharsMax) {
    return bail([], '', 0, 'a template exceeding the source limit');
  }
  if (parseState.depth > LIMITS.treeDepthMax) {
    return bail([], template, 0, 'markup exceeding the nesting limit');
  }
  if (parseState.depth === 0) {
    parseState.nodes = 0;
  }
  parseState.depth++;
  try {
    const result = parseTemplateBody(template, base);
    if (parseState.depth === 1 && result.clean && !parseTemplateWithinBounds(result.nodes)) {
      return bail([], template, 0, 'markup exceeding the tree limits');
    }
    if (parseState.depth === 1) {
      assignPathIds(result.nodes, '', 0);
    }
    return result;
  } finally {
    parseState.depth--;
    assert(parseState.depth >= 0, 'Template recursion unwinds to its caller');
  }
}

function parseTemplateBody(template: string, base: number | undefined): ParsedTemplate {
  const nodes: ParserNode[] = [];
  let position = 0;
  let pendingBlank = 0;
  const gaps: { readonly index: number; readonly from: number; readonly to: number }[] = [];
  const emit = (node: ParserNode): void => {
    const placed = pendingBlank ? { ...node, blankBefore: pendingBlank } : node;
    pendingBlank = 0;
    nodes.push(placed);
    parseState.nodes++;
  };

  const at = (node: ParserNode, from: number, to: number): ParserNode => parseTemplateAt(node, base, from, to);

  let found = NOT_YET_FOUND;
  while (position < template.length) {
    if (parseState.nodes >= LIMITS.treeNodesMax) {
      return bail(nodes, template, position, 'markup exceeding the node limit');
    }
    found = nextDelimiters(template, position, found);
    const { lt, br, next } = found;

    const textEnd = next === -1 ? template.length : next;
    const text = template.slice(position, textEnd);
    if (!text.trim() && text) {
      const breaks = (text.match(/\n/g) || []).length;
      if (breaks > 1) {
        pendingBlank = Math.max(pendingBlank, breaks - 1);
      }
      if (nodes.length) {
        gaps.push({ index: nodes.length, from: position, to: textEnd });
      }
    }
    if (text.trim()) {
      const node: ParserNode = { id: makeId(), kind: 'text', value: textValue(text) };
      if (text.includes('\n') || /&[#a-zA-Z]/.test(text)) {
        node.source = text;
      }
      emit(at(node, position, textEnd));
    }
    if (next === -1) {
      break;
    }

    if (next === br && (lt === -1 || br < lt)) {
      const close = findMatchingBrace(template, br);
      if (close === -1) {
        return bail(nodes, template, br, 'an unclosed { … } expression');
      }
      const exprText = template.slice(br, close + 1);
      const node = parseTemplateExpression(exprText, base === undefined ? undefined : base + br);
      emit(at(node, br, close + 1));
      position = close + 1;
      continue;
    }

    const tag = parseTemplateMarkup(template, lt, base);
    switch (tag.kind) {
      case 'bail':
        return bail(nodes, template, lt, tag.what);
      case 'child-bail':
        return { nodes, clean: false };
      case 'tag':
        emit(tag.node);
        position = tag.end;
        break;
    }
  }

  parseTemplateGaps(nodes, gaps, base);
  return { nodes, clean: true, trailingBlank: pendingBlank };
}

function parseTemplateTag(template: string, lt: number, base: number | undefined): TemplateTagResult {
  const shorthand = template.startsWith('<>', lt);
  const match = shorthand ? { full: '<>', name: 'Fragment', attrs: '', selfClose: '' } : scanTag(template, lt);
  if (!match) {
    return { kind: 'bail', what: 'a stray < or unclosed tag attribute' };
  }
  const { full, name, attrs, selfClose } = match;
  const attributes = tagFields(attrs, base === undefined || shorthand ? undefined : base + lt + 1 + name.length);
  if (attributes.problem !== undefined) {
    return { kind: 'bail', what: attributes.problem };
  }
  const { fields } = attributes;
  const isComponent = /^[A-Z]/.test(name);
  const kind = isComponent ? 'component' : 'element';
  const afterOpen = lt + full.length;

  if (selfClose === '/' || (!isComponent && VOID_ELEMENTS.has(name.toLowerCase()))) {
    return {
      kind: 'tag',
      node: parseTemplateAt(
        {
          id: makeId(),
          kind,
          name,
          ...fields,
          ...(selfClose === '/' && !/\s\/>$/.test(full) ? { tightClose: true } : {}),
          ...(selfClose !== '/' ? { openVoid: true } : {}),
          children: undefined,
        },
        base,
        lt,
        afterOpen,
      ),
      end: afterOpen,
    };
  }

  if (!isComponent && RAW_ELEMENTS.has(name.toLowerCase())) {
    const close = template.indexOf(`</${name}`, afterOpen);
    if (close === -1) {
      return { kind: 'bail', what: `an unclosed <${name}> block` };
    }
    const closeEnd = template.indexOf('>', close);
    if (closeEnd === -1) {
      return { kind: 'bail', what: `an unclosed <${name}> block` };
    }
    return {
      kind: 'tag',
      node: parseTemplateAt(
        {
          id: makeId(),
          kind: 'raw',
          name,
          ...fields,
          inner: template.slice(afterOpen, close),
        },
        base,
        lt,
        closeEnd + 1,
      ),
      end: closeEnd + 1,
    };
  }

  return parseTemplateTagPaired({ template, lt, base, name, attrs, fields, afterOpen, shorthand, kind });
}

function parseTemplateExpression(exprText: string, base: number | undefined): ParserNode {
  const jsxComment = exprText.match(/^\{\s*\/\*([\s\S]*?)\*\/\s*\}$/);
  if (jsxComment) {
    return {
      id: makeId(),
      kind: 'comment',
      value: required(jsxComment[1], 'JSX comment capture'),
      jsx: true,
    };
  }
  const structural = tryParseMapWithSource(exprText, base) || tryParseCond(exprText, base);
  return structural || { id: makeId(), kind: 'expr', value: exprText };
}

function parseTemplateMarkup(template: string, lt: number, base: number | undefined): TemplateTagResult {
  if (template.startsWith('<!--', lt)) {
    const end = template.indexOf('-->', lt + 4);
    if (end === -1) {
      return { kind: 'bail', what: 'an unclosed <!-- comment' };
    }
    return {
      kind: 'tag',
      end: end + 3,
      node: parseTemplateAt(
        {
          id: makeId(),
          kind: 'comment',
          value: template.slice(lt + 4, end),
        },
        base,
        lt,
        end + 3,
      ),
    };
  }
  if (/^<!doctype/i.test(template.slice(lt))) {
    const end = template.indexOf('>', lt);
    if (end === -1) {
      return { kind: 'bail', what: 'an unclosed <!doctype>' };
    }
    return {
      kind: 'tag',
      end: end + 1,
      node: parseTemplateAt(
        {
          id: makeId(),
          kind: 'raw-line',
          value: template.slice(lt, end + 1),
        },
        base,
        lt,
        end + 1,
      ),
    };
  }
  return parseTemplateTag(template, lt, base);
}

function parseTemplateGaps(
  nodes: ParserNode[],
  gaps: readonly { readonly index: number; readonly from: number; readonly to: number }[],
  base: number | undefined,
): void {
  if (gaps.length && isInlineRun(nodes, 0)) {
    for (let i = gaps.length - 1; i >= 0; i--) {
      const gap = required(gaps[i], 'Inline gap index is in bounds');
      if (gap.index >= nodes.length) {
        continue;
      }
      const space: ParserNode = { id: makeId(), kind: 'text', value: ' ' };
      nodes.splice(gap.index, 0, parseTemplateAt(space, base, gap.from, gap.to));
    }
  }
}
function parseTemplateTagPaired(open: TemplateTagOpen): TemplateTagResult {
  const { template, lt, base, name, fields, afterOpen, shorthand, kind } = open;
  const closeIndex = shorthand ? findMatchingFragmentClose(template, afterOpen) : findMatchingClose(template, afterOpen, name);
  if (closeIndex === -1) {
    return { kind: 'bail', what: `an unclosed <${shorthand ? '' : name}> tag` };
  }
  const inner = template.slice(afterOpen, closeIndex);
  const innerResult = parseTemplate(inner, base === undefined ? undefined : base + afterOpen);
  if (!innerResult.clean) {
    return { kind: 'child-bail' };
  }
  const source = inner.includes('\n') && (isInlineRun(innerResult.nodes, 0) || innerResult.nodes.length === 0) ? inner : undefined;
  const blankAfter = innerResult.trailingBlank || 0;
  const closeEnd = template.indexOf('>', closeIndex) + 1;
  const closeText = template.slice(closeIndex, closeEnd);
  return {
    kind: 'tag',
    node: parseTemplateAt(
      {
        id: makeId(),
        kind,
        name,
        ...(shorthand ? { shorthand: true } : {}),
        ...(source === undefined ? {} : { source }),
        ...(blankAfter ? { blankAfter } : {}),
        ...fields,
        ...(closeText.includes('\n') ? { closeSource: closeText } : {}),
        children: innerResult.nodes,
      },
      base,
      lt,
      closeEnd,
    ),
    end: closeEnd,
  };
}
