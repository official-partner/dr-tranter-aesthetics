
import { assert } from '../core/assert';
import type { Brand } from '../core/brand';
import { err, ok, type AppError, type Result } from '../core/result';
import { HTML_VOID_TAGS } from './htmlTags';
import type { PseudoLayer } from './pseudoPath';

export const PSEUDO_ELEMENTS = ['before', 'after', 'marker', 'placeholder', 'first-line', 'first-letter'] as const;
export type PseudoElementName = (typeof PSEUDO_ELEMENTS)[number];

export type PseudoValidity = 'valid' | 'invalid' | 'display-dependent';

export interface PseudoHostNode {
  readonly kind: string;
  readonly name?: string | undefined;
  readonly dynamicTag?: boolean | undefined;
}

export type PseudoLayerTarget = Brand<{ readonly nodeId: string; readonly pseudo: PseudoLayer }, 'PseudoLayerTarget'>;

const NO_GENERATED_CONTENT_TAGS: ReadonlySet<string> = new Set([
  ...HTML_VOID_TAGS,
  'audio',
  'canvas',
  'head',
  'iframe',
  'math',
  'meter',
  'noscript',
  'object',
  'progress',
  'script',
  'select',
  'slot',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'video',
]);

const SVG_TAGS: ReadonlySet<string> = new Set([
  'circle',
  'clippath',
  'defs',
  'desc',
  'ellipse',
  'filter',
  'foreignobject',
  'g',
  'image',
  'line',
  'mask',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'rect',
  'stop',
  'symbol',
  'text',
  'tspan',
  'use',
  'view',
]);

const LIST_ITEM_TAGS: ReadonlySet<string> = new Set(['li', 'summary']);

const PLACEHOLDER_TAGS: ReadonlySet<string> = new Set(['input', 'textarea']);

const BLOCK_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'td',
  'th',
  'ul',
]);

const HTML_TAG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9-]+)?$/;

export function pseudoElementValidity(node: PseudoHostNode, pseudo: PseudoElementName): PseudoValidity {
  assert(PSEUDO_ELEMENTS.includes(pseudo), 'pseudoElementValidity: a known pseudo-element');
  const tag = htmlTagOf(node);
  if (tag === undefined) {
    return 'invalid';
  }
  const validity = pseudoValidityForTag(tag, pseudo);
  assert(validity === 'invalid' || !SVG_TAGS.has(tag), 'pseudoElementValidity: an SVG element owns no pseudo-element');
  return validity;
}

export function pseudoValidityForTag(tag: string, pseudo: PseudoElementName): PseudoValidity {
  assert(tag.length > 0, 'pseudoValidityForTag: a tag has a name');
  if (SVG_TAGS.has(tag)) {
    return 'invalid';
  }
  switch (pseudo) {
    case 'before':
    case 'after':
      return NO_GENERATED_CONTENT_TAGS.has(tag) ? 'invalid' : 'valid';
    case 'marker':
      if (LIST_ITEM_TAGS.has(tag)) {
        return 'valid';
      }
      return NO_GENERATED_CONTENT_TAGS.has(tag) ? 'invalid' : 'display-dependent';
    case 'placeholder':
      return PLACEHOLDER_TAGS.has(tag) ? 'valid' : 'invalid';
    case 'first-line':
    case 'first-letter':
      if (BLOCK_CONTAINER_TAGS.has(tag)) {
        return 'valid';
      }
      return NO_GENERATED_CONTENT_TAGS.has(tag) ? 'invalid' : 'display-dependent';
    default: {
      const exhaustive: never = pseudo;
      return exhaustive;
    }
  }
}

export function pseudoLayerAllowed(node: PseudoHostNode | undefined, pseudo: PseudoLayer): boolean {
  if (node === undefined) {
    return false;
  }
  return pseudoElementValidity(node, pseudo) === 'valid';
}

export function parsePseudoLayerTarget(node: (PseudoHostNode & { readonly id: string }) | undefined, pseudo: PseudoLayer): Result<PseudoLayerTarget, AppError> {
  if (node === undefined) {
    return err({ code: 'pseudo-host-missing', message: `::${pseudo}: the node is not in the page` });
  }
  assert(node.id.length > 0, 'parsePseudoLayerTarget: a node has an id');
  if (pseudoLayerAllowed(node, pseudo)) {
    const target = { nodeId: node.id, pseudo } as PseudoLayerTarget;
    assert(target.nodeId === node.id, 'parsePseudoLayerTarget: the target names its node');
    return ok(target);
  }
  return err({ code: 'pseudo-host-invalid', message: `::${pseudo} belongs to an HTML element, not ${describeHost(node)}` });
}

export function assertPseudoLayerHost(node: PseudoHostNode, pseudo: PseudoLayer, where: string): void {
  assert(where.length > 0, 'assertPseudoLayerHost: the caller names itself');
  assert(pseudoLayerAllowed(node, pseudo), `${where}: ::${pseudo} belongs to an HTML element, not ${describeHost(node)}`);
}

function htmlTagOf(node: PseudoHostNode): string | undefined {
  if (node.kind !== 'element') {
    return undefined;
  }
  if (node.dynamicTag === true) {
    return undefined;
  }
  const name = node.name ?? '';
  return HTML_TAG_RE.test(name) ? name : undefined;
}

function describeHost(node: PseudoHostNode): string {
  if (node.kind === 'element' || node.kind === 'component') {
    return `${node.kind} <${node.name ?? ''}>`;
  }
  return `a ${node.kind} node`;
}
