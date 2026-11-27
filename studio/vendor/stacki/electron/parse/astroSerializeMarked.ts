
import type { Attr } from '../../shared/page/pageNode';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { PREVIEW_STAMP_ATTRIBUTE, PREVIEW_UNMARKED_ATTRIBUTE, stampData, type PreviewStamp } from '../../shared/page/previewToken';
import type { ParserNode, MapNode, CondNode } from './astroParserTypes';
import { serializeAttrs } from './astroAttrs';
import { blockHead } from './astroScan';
import { isInlineRun, loopBodyWrapper, tagInlineRun, serializeNode } from './astroSerialize';
import { serializeMapCallback } from './astroMapSerialize';
import { iterationMarkerExpression } from '../../shared/page/previewIteration';

interface MarkedPlace {
  readonly path: string;
  readonly inSlot: boolean;
  readonly atRoot: boolean;
  readonly depth: number;
  readonly stamp: PreviewStamp | undefined;
  readonly source: MarkedSource;
}

export type MarkedSource = string | undefined;

export interface MarkedRoots {
  readonly pathOf: (index: number) => string;
  readonly atRoot: boolean;
  readonly stamp: PreviewStamp | undefined;
  readonly source: MarkedSource;
}

export function serializeNodesMarked(nodes: readonly ParserNode[], roots: MarkedRoots): string {
  assert(nodes.length <= LIMITS.treeNodesMax, 'serializeNodesMarked: node limit');
  const printed = markedSiblings(nodes, { indent: '', outerIndent: '', edges: 'none' }, (index) => ({
    path: roots.pathOf(index),
    inSlot: false,
    atRoot: roots.atRoot,
    depth: 0,
    stamp: roots.stamp,
    source: roots.source,
  }));
  assert(nodes.length > 0 || printed === '', 'serializeNodesMarked: no roots print nothing');
  return printed;
}

const markerFor = (path: string, kind: 's' | 'e', { inSlotContent, slotAttr = '' }: { readonly inSlotContent: boolean; readonly slotAttr?: string }) =>
  inSlotContent || slotAttr ? `<Fragment${slotAttr} set:html={${JSON.stringify(`<!--avb-${kind}:${path}-->`)}} />` : `<!--avb-${kind}:${path}-->`;

function markedText(node: ParserNode, indent: string, place: MarkedPlace): string {
  const { path, inSlot } = place;
  assert(place.depth <= LIMITS.treeDepthMax, 'markedText: depth limit');
  assert(node.kind !== 'chunk-group', 'markedText: a chunk group is synthetic and is never printed');
  const route = serializeNodeMarkedRoute(node, place);
  const body = markedBody(node, indent, place, route);
  if (route.tagInPlace || route.markWithin) {
    return body;
  }
  const slotAttr = route.slotAttr;
  return markedGlue(body, markerFor(path, 's', { inSlotContent: inSlot, slotAttr }), markerFor(path, 'e', { inSlotContent: inSlot, slotAttr }));
}

type MarkedRoute = ReturnType<typeof serializeNodeMarkedRoute>;

function markedBody(node: ParserNode, indent: string, place: MarkedPlace, route: MarkedRoute): string {
  const { path, atRoot, depth, stamp, source } = place;
  assert(depth <= LIMITS.treeDepthMax, 'markedBody: depth limit');
  if (
    (node.kind === 'component' || node.kind === 'element') &&
    !node.chunkFile &&
    !node.chunkAggregate &&
    Array.isArray(node.children) &&
    !(node.children.length > 0 && isInlineRun(node.children, depth + 1))
  ) {
    const children = node.children;
    const open = `<${node.name}${serializeAttrs(route.markedProps, route.attrOrder)}>`;
    const close = `</${node.name}>`;
    const inner =
      children.length === 0
        ? emptyInner(node, source)
        : markedSiblings(children, { indent: indent + '  ', outerIndent: indent, edges: 'markup' }, (i) => ({
            path: `${path}.${i}`,
            inSlot: node.kind === 'component',
            atRoot: node.name === 'Fragment' && atRoot,
            depth: depth + 1,
            stamp,
            source,
          }));
    if (route.markWithin) {
      return open + markedGlue(inner, markerFor(path, 's', { inSlotContent: true }), markerFor(path, 'e', { inSlotContent: true })) + close;
    }
    return open + inner + close;
  }
  switch (node.kind) {
    case 'map':
      return markedMap(node, indent, place);
    case 'cond':
      return markedCond(node, indent, place);
    case 'branch':
      return markedSiblings(node.children || [], { indent, outerIndent: indent, edges: 'none' }, (i) => ({ ...place, path: `${path}.${i}`, depth: depth + 1 }));
    case 'component':
    case 'element':
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'raw': {
      const base = route.carryPath ? { ...node, props: route.markedProps, attrOrder: route.attrOrder } : node;
      return markedLeaf(base, indent, place);
    }
    case 'chunk-group':
      assert(false, 'markedBody: a chunk group is never printed');
      return '';
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

type SiblingEdges = 'markup' | 'none';

function markedSiblings(
  nodes: readonly ParserNode[],
  layout: { readonly indent: string; readonly outerIndent: string; readonly edges: SiblingEdges },
  placeOf: (index: number) => MarkedPlace,
): string {
  assert(nodes.length <= LIMITS.treeNodesMax, 'markedSiblings: node limit');
  const printed = nodes.flatMap((node, index) => (node.kind === 'chunk-group' ? [] : [{ node, text: markedText(node, layout.indent, placeOf(index)) }]));
  if (printed.length === 0) {
    return '';
  }
  const first = printed[0];
  const last = printed[printed.length - 1];
  assert(first !== undefined, 'markedSiblings: a non-empty list has a first sibling');
  assert(last !== undefined, 'markedSiblings: a non-empty list has a last sibling');
  const source = placeOf(0).source;
  const gaps = locatedGaps(
    printed.map(({ node }) => node),
    source,
  );
  if (gaps !== undefined) {
    const lead = layout.edges === 'markup' ? gaps.lead : '';
    const trail = layout.edges === 'markup' ? gaps.trail : '';
    return lead + printed.map(({ text }, index) => (index === 0 ? text : (gaps.between[index - 1] ?? '') + text)).join('') + trail;
  }
  const lead = layout.edges === 'markup' ? `\n${layout.indent}` : '';
  const trail = layout.edges === 'markup' ? `\n${layout.outerIndent}` : '';
  return lead + printed.map(({ text }) => text).join(`\n${layout.indent}`) + trail;
}

function markedMap(node: MapNode, indent: string, place: MarkedPlace): string {
  const { path, atRoot, depth, stamp, source } = place;
  assert(depth <= LIMITS.treeDepthMax, 'markedMap: depth limit');
  if (node.bodyParts !== undefined) {
    const text = serializeMapCallback(node, (child, index) => {
      const marked =
        child.kind === 'chunk-group' ? '' : markedText(child, '', { path: `${path}.${index}`, inSlot: true, atRoot, depth: depth + 1, stamp, source });
      return '<Fragment>' + marked + '</Fragment>';
    });
    assert(text.startsWith('{'), 'markedMap: a callback loop is written in braces');
    return text;
  }
  const children = node.children || [];
  const wrapped = children.length > 0 && (source === undefined ? loopBodyWrapper(node) !== undefined : node.fragment !== undefined);
  const bodyIndent = indent + (node.body && node.body.length ? '      ' : '    ');
  const inner = markedSiblings(children, { indent: bodyIndent + '  ', outerIndent: bodyIndent, edges: wrapped ? 'markup' : 'none' }, (i) => ({
    path: `${path}.${i}`,
    inSlot: true,
    atRoot,
    depth: depth + 1,
    stamp,
    source,
  }));
  const expression = iterationMarkerExpression(node.head, path);
  const marker = expression === undefined ? '' : `<Fragment set:html={${expression}} />`;
  const body = `<Fragment>${marker}${inner}</Fragment>`;
  if (node.body && node.body.length) {
    const statements = node.body.map((line) => `${indent}    ${line}`);
    return [
      '{',
      `${indent}  ${blockHead(node.head)}`,
      ...statements,
      `${indent}    return (`,
      bodyIndent + body,
      `${indent}    );`,
      `${indent}  })`,
      `${indent}}`,
    ].join('\n');
  }
  return ['{', `${indent}  ${node.head}`, bodyIndent + body, `${indent}  ))`, `${indent}}`].join('\n');
}

function markedCond(node: CondNode, indent: string, place: MarkedPlace): string {
  const { path, atRoot, depth, stamp, source } = place;
  assert(depth <= LIMITS.treeDepthMax, 'markedCond: depth limit');
  const branches = node.children || [];
  const inner = indent + '    ';
  const branchOut = (branch: ParserNode | undefined, i: number): string =>
    inner +
    '<Fragment>' +
    (branch === undefined ? '' : markedText(branch, inner + '  ', { path: `${path}.${i}`, inSlot: true, atRoot, depth: depth + 1, stamp, source })) +
    '</Fragment>';
  const lines = ['{', indent + '  ' + node.test + (node.op === '&&' ? ' && (' : ' ? ('), branchOut(branches[0], 0)];
  if (node.op === '&&') {
    lines.push(indent + '  )');
  } else {
    lines.push(indent + '  ) : (', branchOut(branches[1], 1), indent + '  )');
  }
  lines.push(indent + '}');
  assert(node.op === '&&' || branches.length <= 2, 'markedCond: a ternary has two branches');
  return lines.join('\n');
}

function serializeNodeMarkedRoute(node: ParserNode, { path, atRoot, depth, stamp }: MarkedPlace) {
  const slotValue = node.props?.['slot'];
  const slotted = slotValue && slotValue.type === 'string' && !!slotValue.value;
  const tagInPlace = (slotted && node.kind === 'element') || (node.kind === 'element' && node.props?.[PREVIEW_UNMARKED_ATTRIBUTE] !== undefined);
  const slotAttr = slotted ? ` slot="${slotValue.value}"` : '';
  const markWithin =
    slotted &&
    (node.name === 'Fragment' || node.name === 'slot') &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    !isInlineRun(node.children, depth + 1);
  const unmarked = node.kind === 'element' && node.props?.[PREVIEW_UNMARKED_ATTRIBUTE] !== undefined;
  const carryPath = (node.kind === 'element' || node.kind === 'component') && node.name !== 'Fragment' && node.name !== 'slot' && !unmarked;
  const forwards = Object.keys(node.props || {}).some((key) => key.startsWith('...'));
  const carriesCaller = forwards || atRoot;
  const pathProp: Attr = carriesCaller
    ? {
        type: 'expr',
        value: `[${JSON.stringify(path)}, Astro.props["data-avb-p"]].filter(Boolean).join(" ")`,
      }
    : { type: 'string', value: path };
  const carriesStamp = carryPath && atRoot && stamp !== undefined;
  const stampProp: Attr | undefined = carriesStamp
    ? {
        type: 'expr',
        value: `[${JSON.stringify(stampData(stamp))}, ` + `Astro.props[${JSON.stringify(PREVIEW_STAMP_ATTRIBUTE)}]]` + '.filter(Boolean).join("\\n")',
      }
    : undefined;
  const markerNames = carriesStamp ? ['data-avb-p', PREVIEW_STAMP_ATTRIBUTE] : ['data-avb-p'];
  const markerProps = stampProp ? { 'data-avb-p': pathProp, [PREVIEW_STAMP_ATTRIBUTE]: stampProp } : { 'data-avb-p': pathProp };
  const attrOrder =
    !carryPath || !node.attrOrder
      ? node.attrOrder
      : forwards && node.kind === 'element'
        ? [...markerNames, ...node.attrOrder]
        : [...node.attrOrder, ...markerNames];
  const markedProps = !carryPath ? node.props : forwards && node.kind === 'element' ? { ...markerProps, ...node.props } : { ...node.props, ...markerProps };
  return {
    tagInPlace,
    markWithin,
    slotAttr,
    carryPath,
    markedProps,
    attrOrder,
  };
}

function markedLeaf(base: ParserNode, indent: string, { path, atRoot, depth, source }: MarkedPlace): string {
  assert(depth <= LIMITS.treeDepthMax, 'markedLeaf: depth limit');
  const span = spanOf(base, source);
  if (span !== undefined && writtenVerbatim(base)) {
    return span.text;
  }
  const inlineKids =
    (base.kind === 'component' || base.kind === 'element') &&
    !base.chunkFile &&
    !base.chunkAggregate &&
    Array.isArray(base.children) &&
    base.children.length > 0 &&
    isInlineRun(base.children, depth + 1);
  if (inlineKids && (base.kind === 'element' || base.kind === 'component')) {
    assert(base.children !== undefined, 'Inline run has children');
    const tagged = tagInlineRun(base.children, path, {
      atRoot: base.name === 'Fragment' && atRoot,
      depth: depth + 1,
    });
    const located = inlineRunLocated(tagged, source, depth + 1);
    if (located !== undefined) {
      return `<${base.name}${serializeAttrs(base.props, base.attrOrder)}>${located}</${base.name}>`;
    }
    return printed({ ...base, source: undefined, children: tagged }, indent, depth);
  }
  return printed(base, indent, depth);
}

function writtenVerbatim(node: ParserNode): boolean {
  switch (node.kind) {
    case 'text':
    case 'raw':
      return true;
    case 'expr':
    case 'comment':
    case 'raw-line':
    case 'component':
    case 'element':
    case 'map':
    case 'cond':
    case 'branch':
    case 'chunk-group':
      return false;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function inlineRunLocated(nodes: readonly ParserNode[], source: MarkedSource, depth: number): string | undefined {
  assert(depth <= LIMITS.treeDepthMax, 'inlineRunLocated: depth limit');
  const gaps = locatedGaps(nodes, source);
  if (gaps === undefined) {
    return undefined;
  }
  let out = gaps.lead;
  for (const [index, node] of nodes.entries()) {
    if (index > 0) {
      out += gaps.between[index - 1] ?? '';
    }
    const text = inlineNodeLocated(node, source, depth);
    if (text === undefined) {
      return undefined;
    }
    out += text;
  }
  assert(out.length > 0, 'inlineRunLocated: a run with children prints them');
  return out + gaps.trail;
}

function inlineNodeLocated(node: ParserNode, source: MarkedSource, depth: number): string | undefined {
  const span = spanOf(node, source);
  if (span === undefined) {
    return undefined;
  }
  if (node.kind === 'text') {
    return span.text;
  }
  if (node.kind === 'expr') {
    return node.value;
  }
  assert(node.kind === 'element', 'inlineNodeLocated: an inline run holds text, expressions and elements');
  const open = `<${node.name}${serializeAttrs(node.props, node.attrOrder)}`;
  if (node.children === undefined) {
    return `${open} />`;
  }
  if (node.children.length === 0) {
    return `${open}>${emptyInner(node, source)}</${node.name}>`;
  }
  const inner = inlineRunLocated(node.children, source, depth + 1);
  return inner === undefined ? undefined : `${open}>${inner}</${node.name}>`;
}

function emptyInner(node: ParserNode, source: MarkedSource): string {
  const span = spanOf(node, source);
  if (span === undefined) {
    return node.source !== undefined && node.source.trim() === '' ? node.source : '';
  }
  const close = span.text.lastIndexOf('</');
  assert(close > 0, 'emptyInner: a paired element ends with its closing tag');
  return whitespaceBefore(span.text, close);
}

function printed(node: ParserNode, indent: string, depth: number): string {
  const lines: string[] = [];
  serializeNode(node, indent, lines, depth);
  const text = lines.join('\n');
  return text.startsWith(indent) ? text.slice(indent.length) : text;
}

function spanOf(node: ParserNode, source: MarkedSource): { readonly start: number; readonly end: number; readonly text: string } | undefined {
  if (source === undefined) {
    return undefined;
  }
  const { start, end } = node;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  assert(start <= end, 'spanOf: a node starts before it ends');
  assert(end <= source.length, 'spanOf: offsets index the text they were read from');
  return { start, end, text: source.slice(start, end) };
}

function locatedGaps(
  nodes: readonly ParserNode[],
  source: MarkedSource,
): { readonly lead: string; readonly between: readonly string[]; readonly trail: string } | undefined {
  if (source === undefined) {
    return undefined;
  }
  const spans = nodes.map((node) => spanOf(node, source));
  const located = spans.filter((span) => span !== undefined);
  if (located.length < nodes.length) {
    return undefined;
  }
  const first = located[0];
  const last = located[located.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const between: string[] = [];
  for (let index = 1; index < located.length; index++) {
    const left = located[index - 1];
    const right = located[index];
    assert(left !== undefined, 'locatedGaps: index is in bounds');
    assert(right !== undefined, 'locatedGaps: index is in bounds');
    if (right.start < left.end) {
      return undefined;
    }
    const gap = source.slice(left.end, right.start);
    if (whitespaceBefore(gap, gap.length) !== gap) {
      return undefined;
    }
    between.push(gap);
  }
  return { lead: whitespaceBefore(source, first.start), between, trail: whitespaceAfter(source, last.end) };
}

const HTML_WHITESPACE = new Set([' ', '\t', '\n', '\f', '\r']);

function whitespaceBefore(text: string, offset: number): string {
  assert(offset <= text.length, 'whitespaceBefore: offset is in the text');
  let start = offset;
  while (start > 0 && HTML_WHITESPACE.has(text[start - 1] ?? '')) {
    start--;
  }
  return text.slice(start, offset);
}

function whitespaceAfter(text: string, offset: number): string {
  assert(offset <= text.length, 'whitespaceAfter: offset is in the text');
  let end = offset;
  while (end < text.length && HTML_WHITESPACE.has(text[end] ?? '')) {
    end++;
  }
  return text.slice(offset, end);
}

export function markedGlue(text: string, start: string, end: string): string {
  const lead = whitespaceAfter(text, 0);
  if (lead.length === text.length) {
    return start + text + end;
  }
  const trail = whitespaceBefore(text, text.length);
  const content = text.slice(lead.length, text.length - trail.length);
  assert(content.length > 0, 'markedGlue: text with something besides whitespace keeps it');
  return lead + start + content + end + trail;
}
