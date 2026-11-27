
export function stripTemplateMarkers(root: ParentNode): void {
  const gone = root.querySelectorAll('template[data-avb-s],template[data-avb-e]');
  for (let i = 0; i < gone.length; i++) {
    const node = gone[i];
    if (node) {
      node.remove();
    }
  }
}

export function inertNoscripts(page: ParentNode): void {
  const found = page.querySelectorAll('noscript');
  for (let index = 0; index < found.length; index++) {
    const element = found[index];
    if (element !== undefined) {
      const markup = element.innerHTML;
      element.textContent = markup;
      if (element.childNodes.length > 1) {
        throw new Error('a <noscript> kept more than its text');
      }
    }
  }
  const left = page.querySelectorAll('noscript *');
  if (left.length > 0) {
    throw new Error('a <noscript> still holds elements');
  }
}

export const isAnchor = (node: Node | undefined): boolean => {
  const comment = node !== undefined && asComment(node) ? node : undefined;
  return comment !== undefined && /^avb-[sedi]:/.test(comment.data);
};

export const MORPH_LIMITS = { domDepthMax: 512 } as const;

export const isStamp = (node: Node | undefined): boolean => {
  const comment = node !== undefined && asComment(node) ? node : undefined;
  return comment !== undefined && comment.data.startsWith('avb-d:');
};

export const asElement = (node: Node): node is Element => node.nodeType === 1;
export const asText = (node: Node): node is Text => node.nodeType === 3;
export const asComment = (node: Node): node is Comment => node.nodeType === 8;
export const asDocument = (node: Node): node is Document => node.nodeType === 9;
