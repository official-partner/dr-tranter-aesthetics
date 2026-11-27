
import type { CanvasTextEdit } from '../../features/preview/canvasTextSource';
import type { CanvasTextDocument } from '../../features/preview/useCanvasText';
import { CANVAS_TEXT_LIMIT } from '../../../shared/properties/canvasText';
import type { Attr, ImportDecl } from '../../../shared/page/pageNode';
import type { ScanComponent } from '../../../shared/properties/projectScan';
import { assert } from '../../../shared/core/assert';
import { componentReference } from './componentReference';
import type { BoundPropText } from './canvasBoundText';
import {
  REPEATS,
  SITES_MAX,
  childrenOf,
  isInstance,
  propSiteReader,
  type InstanceNode,
  type PropNode,
  type PropSiteContext,
  type PropTextSite,
} from './canvasPropSites';
import { domToNodes, isInlineOnly, nodesToHtml } from '../../features/props/richContentModel';
import type { InlineNode } from '../../features/props/richContentModel';
import { formatInlineSelection, inlineStatesAt, inlineWithValue } from './canvasTextFormat';

export { propName, type ComponentSource } from './canvasPropSites';

export interface PropTextContext extends PropSiteContext {
  readonly label: string;
  readonly file: string;
  readonly nodes: readonly PropNode[];
  readonly imports: readonly ImportDecl[];
  readonly setProp: (nodeId: string, prop: string, value: Attr) => void;
  readonly bound?: ((expression: string) => Promise<BoundPropText | undefined>) | undefined;
}

const INSTANCES_MAX = 4_000;
const EDITS_MAX = 1_000;

export async function canvasPropEdits(document: CanvasTextDocument, context: PropTextContext): Promise<CanvasTextEdit[]> {
  const sites = propSiteReader(context);
  const edits: CanvasTextEdit[] = [];
  for (const { instance, repeated } of pageInstances(context.nodes).slice(0, INSTANCES_MAX)) {
    if (edits.length >= EDITS_MAX) {
      break;
    }
    const component = componentReference({
      name: instance.name,
      project: context.projectPath,
      file: context.file,
      imports: context.imports,
      components: context.components,
    });
    const scope = document.pathFor(instance.id);
    if (!component || component.origin?.kind === 'package' || !scope) {
      continue;
    }
    for (const site of await sites(component)) {
      if (repeated) {
        const looped = loopedBinding(instance, site);
        if (looped !== undefined) {
          edits.push(boundPropEdit({ instance, site, followed: looped, scope, label: context.label }));
        }
        continue;
      }
      const followed = await followedBinding(instance, site, context);
      if (followed !== undefined) {
        edits.push(boundPropEdit({ instance, site, followed, scope, label: context.label }));
        continue;
      }
      const value = shownValue(instance, component, site.prop);
      if (value === undefined) {
        continue;
      }
      const shown = { instance, site, value, scope, setProp: context.setProp, label: context.label };
      edits.push(...(site.kind === 'text' ? [textEdit(shown, site)] : htmlEdits(shown, site)));
    }
  }
  assert(edits.length <= EDITS_MAX + SITES_MAX * 8, 'Prop text stays within its bounds');
  return edits;
}

function loopedBinding(instance: InstanceNode, site: PropTextSite): BoundPropText | undefined {
  const attr = 'props' in instance ? instance.props?.[site.prop] : undefined;
  if (attr?.type !== 'expr') {
    return undefined;
  }
  assert(attr.value.trim() !== '', 'An expression prop names its expression');
  return {
    value: '',
    bound: { kind: 'blocked', expression: attr.value, file: '', reason: 'loop' },
    apply: () => Promise.reject(new Error('Text from a loop is edited in its collection')),
  };
}

async function followedBinding(instance: InstanceNode, site: PropTextSite, context: PropTextContext): Promise<BoundPropText | undefined> {
  const attr = 'props' in instance ? instance.props?.[site.prop] : undefined;
  if (attr?.type !== 'expr' || context.bound === undefined) {
    return undefined;
  }
  const followed = await context.bound(attr.value);
  if (followed === undefined || site.kind !== 'html') {
    return followed;
  }
  const { bound } = followed;
  if (bound.kind === 'source' && !/[<&]/.test(followed.value)) {
    return { ...followed, apply: (typed) => followed.apply(escapedHTML(typed)) };
  }
  return {
    value: '',
    bound: bound.kind === 'source' ? { kind: 'blocked', expression: bound.expression, file: bound.file, reason: 'computed' } : bound,
    apply: () => Promise.reject(new Error('HTML from data is edited in its source')),
  };
}

function escapedHTML(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function boundPropEdit(shown: {
  readonly instance: InstanceNode;
  readonly site: PropTextSite;
  readonly followed: BoundPropText;
  readonly scope: string;
  readonly label: string;
}): CanvasTextEdit {
  const { instance, site, followed, scope } = shown;
  const run = site.kind === 'html' && followed.bound.kind === 'source';
  const path = run ? `${site.parent}#0` : site.path;
  return {
    target: {
      kind: site.parentKind,
      key: `prop:${instance.id}:${site.prop}:${path}`,
      path,
      parent: site.parent,
      value: followed.value,
      label: shown.label,
      tag: site.tag,
      siblings: site.kind === 'text' ? site.siblings : [],
      nested: false,
      scope,
      from: 'prop',
      ...(run ? { segment: 0 } : {}),
    },
    bound: followed.bound,
    apply: (typed) => followed.apply(typed),
  };
}

interface ShownProp {
  readonly instance: InstanceNode;
  readonly site: PropTextSite;
  readonly value: string;
  readonly scope: string;
  readonly setProp: PropTextContext['setProp'];
  readonly label: string;
}

function textEdit(shown: ShownProp, site: PropTextSite & { readonly kind: 'text' }) {
  const { instance, value, scope } = shown;
  const save = (typed: string) => typed.trim();
  return {
    target: {
      kind: site.parentKind,
      key: `prop:${instance.id}:${site.prop}:${site.path}`,
      path: site.path,
      parent: site.parent,
      value,
      label: shown.label,
      tag: site.tag,
      siblings: site.siblings,
      nested: false,
      scope,
      from: 'prop',
    },
    prop: { nodeID: instance.id, name: site.prop, value: save },
    apply: async (typed: string) => {
      if (save(typed) !== value) {
        shown.setProp(instance.id, site.prop, { type: 'string', value: save(typed) });
      }
    },
  } satisfies CanvasTextEdit;
}

function htmlEdits(shown: ShownProp, site: PropTextSite & { readonly kind: 'html' }): CanvasTextEdit[] {
  const children = inlineContent(shown.value);
  if (!children) {
    return [];
  }
  const { instance, scope } = shown;
  const before = nodesToHtml(children);
  const write = (html: string) => {
    if (html !== before) {
      shown.setProp(instance.id, site.prop, { type: 'string', value: html });
    }
  };
  return textRuns(children).flatMap(({ trail, value }, segment) => {
    if (value.trim() === '') {
      return [];
    }
    const own = site.parentKind === 'component' ? { lead: /^\s*/.exec(value)?.[0] ?? '', tail: /\s*$/.exec(value)?.[0] ?? '' } : undefined;
    const settled = (typed: string) => (own === undefined ? typed : `${own.lead}${typed.trim()}${own.tail}`);
    const typedHTML = (typed: string) => nodesToHtml(inlineWithValue(children, trail, settled(typed)));
    const path = `${site.parent}#${segment}`;
    const edit: CanvasTextEdit = {
      target: {
        kind: site.parentKind,
        key: `prop:${instance.id}:${site.prop}:${path}`,
        path,
        parent: site.parent,
        value,
        label: shown.label,
        tag: site.tag,
        siblings: [],
        nested: trail.length > 1,
        scope,
        from: 'prop',
        segment,
      },
      prop: { nodeID: instance.id, name: site.prop, value: typedHTML },
      apply: async (typed) => write(typedHTML(typed)),
      format: {
        states: () => inlineStatesAt(children, trail),
        apply: (selection, action) => {
          const typed = inlineWithValue(children, trail, selection.value);
          const next = formatInlineSelection(typed, { ...selection, trail }, action);
          if (next) {
            write(nodesToHtml(next));
          }
          return next !== undefined;
        },
      },
    };
    return [edit];
  });
}

function inlineContent(html: string): readonly InlineNode[] | undefined {
  const host = document.createElement('div');
  host.innerHTML = html;
  const nodes = domToNodes(host);
  return isInlineOnly(nodes) ? nodes : undefined;
}

function textRuns(children: readonly InlineNode[]) {
  const runs: { readonly trail: readonly number[]; readonly value: string }[] = [];
  const stack: {
    readonly list: readonly InlineNode[];
    readonly trail: readonly number[];
    at: number;
  }[] = [{ list: children, trail: [], at: 0 }];
  for (let visited = 0; stack.length > 0 && visited < CANVAS_TEXT_LIMIT; visited++) {
    const level = stack[stack.length - 1];
    assert(level !== undefined, 'A pending inline list exists');
    const node = level.list[level.at];
    if (node === undefined) {
      stack.pop();
      continue;
    }
    const trail = [...level.trail, level.at];
    level.at += 1;
    if (node.kind === 'text') {
      runs.push({ trail, value: node.value });
    } else if (node.kind === 'element') {
      stack.push({ list: node.children ?? [], trail, at: 0 });
    }
  }
  return runs;
}

function pageInstances(nodes: readonly PropNode[]): { readonly instance: InstanceNode; readonly repeated: boolean }[] {
  type Place = 'once' | 'loop' | 'code';
  const found: { readonly instance: InstanceNode; readonly repeated: boolean }[] = [];
  const queue: { readonly node: PropNode; readonly place: Place }[] = nodes.map((node) => ({ node, place: 'once' }));
  for (let index = 0; index < queue.length && index < 10_000; index++) {
    const entry = queue[index];
    if (!entry) {
      continue;
    }
    if (isInstance(entry.node) && entry.place !== 'code') {
      found.push({ instance: entry.node, repeated: entry.place === 'loop' });
    }
    const place: Place = entry.node.kind === 'map' || entry.place === 'loop' ? 'loop' : REPEATS.includes(entry.node.kind) ? 'code' : entry.place;
    queue.push(...childrenOf(entry.node).map((node) => ({ node, place })));
  }
  return found;
}

function shownValue(instance: InstanceNode, component: ScanComponent, prop: string): string | undefined {
  const attr = 'props' in instance ? instance.props?.[prop] : undefined;
  if (attr !== undefined) {
    return attr.type === 'string' && usable(attr.value) ? attr.value : undefined;
  }
  const fallback = component.schema?.find((field) => field.name === prop)?.default;
  return typeof fallback === 'string' && usable(fallback) ? fallback : undefined;
}

function usable(value: string): boolean {
  return value.trim() !== '' && value.length <= CANVAS_TEXT_LIMIT;
}
