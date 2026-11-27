import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, NODE_KEY_ATTRIBUTE, parseNodeKey, type AppNodeKeyOutcome, type AppNodeView } from '../../../shared/properties/appsRpc';

export interface NodeKeyHost {
  readonly node: (nodeId: string) => AppNodeView | undefined;
  readonly tree: () => readonly AppNodeView[];
  readonly setAttribute: (
    nodeId: string,
    name: string,
    value: string,
  ) => Promise<{ readonly applied: true } | { readonly applied: false; readonly reason: string }>;
}

const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const KEY_RANDOM_CHARS = 12;

export function mintNodeKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_RANDOM_CHARS));
  let key = 'k';
  for (const byte of bytes) {
    key += KEY_ALPHABET[byte % KEY_ALPHABET.length] ?? '0';
  }
  assert(key.length === KEY_RANDOM_CHARS + 1, 'A key has its fixed length');
  assert(parseNodeKey(key) === key, 'A minted key is one find accepts');
  return key;
}

export async function nodeKey(host: NodeKeyHost, nodeId: string): Promise<AppNodeKeyOutcome> {
  const node = host.node(nodeId);
  if (node === undefined) {
    return { applied: false, reason: 'No element has that id on the open page' };
  }
  if (node.kind !== 'element' && node.kind !== 'component') {
    return { applied: false, reason: 'Only an element or a component carries a key; text and expressions hold no attributes' };
  }
  const existing = ownKey(node);
  if (existing !== undefined && keyHolders(host.tree(), existing)[0] === nodeId) {
    return { applied: true, key: existing };
  }
  const key = mintNodeKey();
  const outcome = await host.setAttribute(nodeId, NODE_KEY_ATTRIBUTE, key);
  if (!outcome.applied) {
    return outcome;
  }
  assert(key !== existing, 'A written key is a new one');
  return { applied: true, key };
}

export function findNodeByKey(roots: readonly AppNodeView[], key: string): string | undefined {
  return keyHolders(roots, key)[0];
}

export function keyHolders(roots: readonly AppNodeView[], key: string): readonly string[] {
  const holders: string[] = [];
  const stack = [...roots].reverse();
  for (let visited = 0; stack.length > 0; visited += 1) {
    assert(visited < APP_RPC_LIMITS.treeNodesMax * 2, 'A key search is bounded by the reply bound');
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (ownKey(node) === key) {
      holders.push(node.id);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return holders;
}

export function ownKey(node: AppNodeView): string | undefined {
  const value = Object.hasOwn(node.attributes, NODE_KEY_ATTRIBUTE) ? node.attributes[NODE_KEY_ATTRIBUTE] : undefined;
  if (value === undefined) {
    return undefined;
  }
  try {
    return parseNodeKey(value);
  } catch {
    return undefined;
  }
}
