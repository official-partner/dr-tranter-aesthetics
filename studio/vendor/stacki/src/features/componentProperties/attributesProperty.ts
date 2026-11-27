
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { Attr } from '../../../shared/page/pageNode';
import { readAttributesBinding } from '../../editor/attributesBinding';
import type { EditorNode } from '../../editor/pageView';
import { readRestBinding, restTooltip, type AttributeDefault } from '../../editor/propDeclaration';

export interface AttributesConnection {
  readonly id: string;
  readonly tag: string;
  readonly label: string;
  readonly props: Readonly<Record<string, Attr>>;
  readonly defaults: readonly AttributeDefault[];
}

export interface AttributesProperty {
  readonly local: string;
  readonly tooltip: string;
  readonly connections: readonly AttributesConnection[];
}

export function readAttributesProperty(frontmatter: string, nodes: readonly EditorNode[] | undefined): AttributesProperty | undefined {
  const rest = readRestBinding(frontmatter);
  if (rest === undefined) {
    return undefined;
  }
  assert(/^[A-Za-z_$][\w$]*$/.test(rest.local), 'readAttributesProperty: a rest binding is an identifier');
  const connections: AttributesConnection[] = [];
  const pending: EditorNode[] = [...(nodes ?? [])].reverse();
  for (let visited = 0; pending.length > 0; visited += 1) {
    assert(visited <= LIMITS.treeNodesMax, 'readAttributesProperty: the page model is bounded');
    const node = pending.pop();
    assert(node !== undefined, 'readAttributesProperty: a pending node exists');
    const binding = node.kind === 'element' ? readAttributesBinding(node.props, rest.local) : undefined;
    if (binding !== undefined && node.props !== undefined) {
      connections.push({ id: node.id, tag: node.name ?? '', label: elementLabel(node), props: node.props, defaults: binding.defaults });
    }
    for (const child of [...(node.children ?? [])].reverse()) {
      pending.push(child);
    }
  }
  return { local: rest.local, tooltip: restTooltip(frontmatter), connections };
}

export function defaultsAgree(connections: readonly AttributesConnection[]): boolean {
  const first = connections[0];
  if (first === undefined) {
    return true;
  }
  return connections.every((connection) => sameDefaults(connection.defaults, first.defaults));
}

export function sameDefaults(left: readonly AttributeDefault[], right: readonly AttributeDefault[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry.name === right[index]?.name && entry.value === right[index]?.value);
}

function elementLabel(node: EditorNode): string {
  const tag = node.name ?? 'element';
  const classValue = node.props?.['class'];
  const first = classValue?.type === 'string' ? classValue.value.trim().split(/\s+/)[0] : undefined;
  return first === undefined || first === '' ? tag : `${tag}.${first}`;
}
