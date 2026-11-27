
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import type { CanvasInsertSource, CanvasInsertTreeNode } from './canvasInsert';

const COMPARED_KINDS: ReadonlySet<string> = new Set(['element', 'component', 'text', 'expr']);

export function twinOf(roots: readonly CanvasInsertTreeNode[], source: CanvasInsertSource): string | undefined {
  const wanted = signatureOf(source);
  if (wanted === undefined) {
    return undefined;
  }
  const pending: (readonly CanvasInsertTreeNode[])[] = [roots];
  for (let visited = 0; visited < pending.length; visited += 1) {
    assert(visited < LIMITS.treeNodesMax, 'twinOf: a tree stays inside its node bound');
    const list = pending[visited];
    assert(list !== undefined, 'twinOf: the visit index lies inside the queue');
    for (const node of list) {
      if (node.kind === 'component' && node.name === source.name && node.id !== undefined) {
        if (signatureOf(node) === wanted) {
          return node.id;
        }
      }
      if (node.kind !== 'map' && node.children !== undefined) {
        pending.push(node.children);
      }
    }
  }
  return undefined;
}

function signatureOf(root: CanvasInsertSource): string | undefined {
  const parts: unknown[] = [];
  const pending: (CanvasInsertSource | 'close')[] = [root];
  for (let step = 0; pending.length > 0; step += 1) {
    assert(step <= LIMITS.treeNodesMax * 2, 'signatureOf: a tree stays inside its node bound');
    const node = pending.pop();
    assert(node !== undefined, 'signatureOf: the stack is not empty');
    if (node === 'close') {
      parts.push('close');
      continue;
    }
    if (!COMPARED_KINDS.has(node.kind)) {
      return undefined;
    }
    const props = Object.entries(node.props ?? {}).map(([name, attribute]) => [name, attribute.type, attribute.value ?? '']);
    if (props.every(([, type]) => type !== 'spread')) {
      props.sort(([left = ''], [right = '']) => left.localeCompare(right));
    }
    parts.push([node.kind, node.name ?? '', collapsed(node.value), props]);
    pending.push('close');
    const children = (node.children ?? []).filter((child) => child.kind !== 'comment' && !(child.kind === 'text' && collapsed(child.value) === ''));
    pending.push(...[...children].reverse());
  }
  return JSON.stringify(parts);
}

function collapsed(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
