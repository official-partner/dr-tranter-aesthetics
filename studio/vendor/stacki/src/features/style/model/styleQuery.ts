import { findNode, getHost } from './host';

export function textStyleContext(path: string, nodeId: string | undefined): { readonly textParentPath?: string } {
  const host = getHost();
  const selected = nodeId ? findNode(host.nodes, nodeId) : undefined;
  if (selected?.kind !== 'text') {
    return {};
  }
  if (host.pathOf?.(selected.id) !== path) {
    return {};
  }
  if (!selected.value?.trim()) {
    return {};
  }
  const separator = path.lastIndexOf('.');
  if (separator <= path.lastIndexOf('|')) {
    return {};
  }
  return { textParentPath: path.slice(0, separator) };
}
