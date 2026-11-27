
export function isNodeInDocument(value: unknown, document: Document): value is Node {
  const NodeConstructor = document.defaultView?.Node;
  return NodeConstructor !== undefined && value instanceof NodeConstructor;
}

export function isHTMLElementInDocument(value: unknown, document: Document): value is HTMLElement {
  const HTMLElementConstructor = document.defaultView?.HTMLElement;
  return HTMLElementConstructor !== undefined && value instanceof HTMLElementConstructor;
}
