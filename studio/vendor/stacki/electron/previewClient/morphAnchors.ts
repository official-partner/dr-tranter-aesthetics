
import { isAnchor, MORPH_LIMITS, isStamp, asElement, asText, asComment } from './morphNodes';

export type PreviewHost = 'stacki' | 'browser';

export function previewHost(hash: string): PreviewHost {
  return hash === '#avb-design' ? 'stacki' : 'browser';
}

export function stripAnchors(root: ParentNode): void {
  const gone: Comment[] = [];
  const walk = (parent: ParentNode, depth: number): void => {
    if (depth > MORPH_LIMITS.domDepthMax) {
      throw new Error('the page nests deeper than the patch walks');
    }
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (asComment(node) && isAnchor(node)) {
        gone.push(node);
      } else if (asElement(node)) {
        walk(node, depth + 1);
      }
    }
  };
  walk(root, 0);
  for (const node of gone) {
    node.remove();
  }
}

export function stripPreviewInstrumentation(root: ParentNode): void {
  stripAnchors(root);
  const marked = root.querySelectorAll('[data-avb-p],[data-avb-d]');
  for (let index = 0; index < marked.length; index += 1) {
    marked[index]?.removeAttribute('data-avb-p');
    marked[index]?.removeAttribute('data-avb-d');
  }
}

export function syncAnchors(liveRoot: ParentNode, serverRoot: ParentNode): void {
  stripAnchors(liveRoot);

  const blank = (node: Node): boolean => (asText(node) ? node.data.trim() === '' : false);
  const sameKind = (left: Node, right: Node): boolean => {
    if (left.nodeType !== right.nodeType) {
      return false;
    }
    if (right.nodeType !== 1) {
      return true;
    }
    return asElement(left) && asElement(right) && left.tagName === right.tagName;
  };

  const walk = (live: ParentNode, server: ParentNode, depth: number): void => {
    if (depth > MORPH_LIMITS.domDepthMax) {
      throw new Error('the page nests deeper than the patch walks');
    }
    let cursor = live.firstChild;
    for (let sv = server.firstChild; sv; sv = sv.nextSibling) {
      const marker = asComment(sv) && isAnchor(sv) ? sv : undefined;
      if (marker) {
        if (!isStamp(marker)) {
          live.insertBefore(document.createComment(marker.data), cursor);
        }
        continue;
      }
      if (blank(sv)) {
        continue;
      }
      let candidate = cursor;
      while (candidate && (blank(candidate) || !sameKind(candidate, sv))) {
        candidate = candidate.nextSibling;
      }
      if (!candidate) {
        continue;
      }
      if (asElement(candidate) && asElement(sv)) {
        walk(candidate, sv, depth + 1);
      }
      cursor = candidate.nextSibling;
    }
  };
  walk(liveRoot, serverRoot, 0);
}

export function syncStamps(liveDocument: Document, serverDocument: Document): void {
  const gone: Comment[] = [];
  const found: string[] = [];
  const collect = (root: Node, into: (comment: Comment) => void): void => {
    const stack: Node[] = [root];
    while (stack.length) {
      const parent = stack.pop();
      if (!parent) {
        break;
      }
      for (let node = parent.firstChild; node; node = node.nextSibling) {
        if (asComment(node) && isStamp(node)) {
          into(node);
        } else if (asElement(node)) {
          stack.push(node);
        }
      }
    }
  };
  collect(liveDocument, (comment) => gone.push(comment));
  collect(serverDocument, (comment) => found.push(comment.data));
  for (const node of gone) {
    node.remove();
  }
  for (const data of found) {
    liveDocument.appendChild(liveDocument.createComment(data));
  }
}

export function dismissErrorOverlay(body: HTMLElement): boolean {
  let removed = false;
  for (const child of Array.from(body.children)) {
    if (child.localName === 'vite-error-overlay') {
      child.remove();
      removed = true;
    }
  }
  return removed;
}
