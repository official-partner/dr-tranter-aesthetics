

import { stripTemplateMarkers, asDocument, inertNoscripts } from './morphNodes';
import { parsePreviewRoute } from '../../shared/properties/previewRoute';
import { dismissErrorOverlay, previewHost, stripAnchors, stripPreviewInstrumentation, syncAnchors, syncStamps } from './morphAnchors';
import { patchAttrs, patchChildren } from './morphPatch';
import { addedScripts, describeScriptChange, noteScripts, runScripts, noteStyles, loadStyles, refreshDevStyles } from './morphAssets';
import { createVariantPreview } from './morphVariant';

declare global {
  interface ImportMeta {
    readonly hot?: {
      readonly on: (event: string, handler: () => void) => void;
    };
  }
}

interface FetchedDocument {
  readonly withAnchors: Document;
  readonly clean: Document;
}

const host = previewHost(location.hash);
if (host === 'browser') {
  stripPreviewInstrumentation(document);
}

const variantPreview = createVariantPreview({ paint: paintRendering, restore: () => void update(), supersede: () => activePull?.abort() });

class HeldRendering extends Error {
  constructor(readonly status: number) {
    super('dev server answered ' + status);
  }
}

function fetchDocument(initialHTML?: string, signal?: AbortSignal): Promise<FetchedDocument> {
  const rendering =
    initialHTML === undefined
      ?
        fetch(location.href, { cache: 'no-store', headers: variantPreview.headers(), ...(signal ? { signal } : {}) }).then((response) => {
          const html404 = response.status === 404 && response.headers.get('content-type')?.includes('text/html');
          if (!response.ok && !html404) {
            throw new HeldRendering(response.status);
          }
          return response.text();
        })
      : Promise.resolve(initialHTML);
  return rendering.then((html) => {
    const withAnchors = new DOMParser().parseFromString(html, 'text/html');
    inertNoscripts(withAnchors);
    withAnchors.getElementById('studio-render-baseline')?.remove();
    stripTemplateMarkers(withAnchors);
    const clone = withAnchors.cloneNode(true);
    if (!asDocument(clone)) {
      throw new Error('cloned rendering is not a document');
    }
    const clean = clone;
    stripAnchors(clean);
    return { withAnchors, clean };
  });
}

function initialRendering(): string | undefined {
  const element = document.getElementById('studio-render-baseline');
  if (!element) {
    return undefined;
  }
  const value: unknown = JSON.parse(element.textContent || 'null');
  element.remove();
  return typeof value === 'string' ? value : undefined;
}
let previousDocument: Document | undefined = undefined;
const ready =
  host === 'stacki'
    ? fetchDocument(initialRendering()).then(
        (fetched) => {
          previousDocument = fetched.clean;
          noteStyles(fetched.clean);
          noteScripts(fetched.clean);
        },
        () => {
          previousDocument = undefined;
        },
      )
    : Promise.resolve();

type ReloadReason = 'scripts-changed' | 'patch-failed';

const RELOAD_DETAIL_CHARS_MAX = 240;
function logToDevServer(line: string): void {
  try {
    fetch('/__avb/reload?r=' + encodeURIComponent(line.slice(0, RELOAD_DETAIL_CHARS_MAX)), { cache: 'no-store', keepalive: true }).catch(() => undefined);
  } catch {
  }
}
function reloadFor(reason: ReloadReason, detail: string): void {
  try {
    window.parent.postMessage({ type: 'avb:preview-reload', reason }, '*');
  } catch {
  }
  logToDevServer('reloaded instead of patching (' + reason + ': ' + detail + ')');
  location.reload();
}

let busy = false;
let again = false;
let pushedHTML: string | undefined;
let pushReady = false;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
let activePull: AbortController | undefined;
let renderDeadline: number | undefined;

function clearFallback(): void {
  clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
  renderDeadline = undefined;
}

function requestUpdate(): void {
  if (!pushReady) {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
    void update();
  } else if (!fallbackTimer) {
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined;
      void update();
    }, 1500);
  }
}
document.addEventListener('studio:render-push', (event) => {
  pushReady = event instanceof CustomEvent && event.detail === true;
  if (!pushReady && fallbackTimer !== undefined) {
    clearFallback();
    void update();
  }
});
document.addEventListener('studio:render-pending', () => {
  if (!pushReady || renderDeadline !== undefined) {
    return;
  }
  renderDeadline = performance.now() + 20_000;
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    clearFallback();
    void update();
  }, 20_000);
});
function paintRendering(html: string): void {
  clearFallback();
  pushedHTML = html;
  activePull?.abort();
  void update();
}
document.addEventListener('studio:render-html', (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || event.detail.length > 4_000_000) {
    return;
  }
  paintRendering(event.detail);
});
document.addEventListener('studio:render-fallback', () => {
  clearFallback();
  void update();
});
document.dispatchEvent(new window.Event('studio:render-listening'));

// eslint-disable-next-line stacki/bounded-recursion -- Event re-entry after settling.
async function update(): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  let pull: AbortController | undefined;
  try {
    await ready;
    if (!previousDocument) {
      throw new Error('no baseline rendering to compare against');
    }
    const html = pushedHTML;
    pushedHTML = undefined;
    if (html !== undefined) {
      again = false;
    }
    const renderingURL = location.href;
    pull = html === undefined ? new AbortController() : undefined;
    activePull = pull;
    const next = await fetchDocument(html, pull?.signal);
    if (pushedHTML === undefined && location.href === renderingURL) {
      applyRendering(next);
    } else {
      again = true;
    }
  } catch (error: unknown) {
    if (error instanceof HeldRendering && error.status >= 500 && previousDocument !== undefined) {
      logToDevServer('kept the page (the rendering failed: ' + error.message + ')');
    } else if (pull?.signal.aborted) {
      again = true;
    } else {
      console.error('[stacki] could not patch the page, reloading:', error);
      reloadFor('patch-failed', error instanceof Error ? error.message : String(error));
      return;
    }
  } finally {
    activePull = undefined;
    busy = false;
  }
  if (again) {
    again = false;
    void update();
  }
}

function applyRendering(next: FetchedDocument): void {
  if (!previousDocument) {
    throw new Error('no baseline rendering to compare against');
  }
  const added = addedScripts(previousDocument, next.clean);
  if (added === undefined) {
    reloadFor('scripts-changed', describeScriptChange(previousDocument, next.clean));
    return;
  }
  const liveRoot = document.documentElement;
  const previousRoot = previousDocument.documentElement;
  const nextRoot = next.clean.documentElement;
  if (!liveRoot || !previousRoot || !nextRoot) {
    throw new Error('missing <html> in one of the renderings');
  }
  document.dispatchEvent(new CustomEvent('avb:before-morph', { detail: next.withAnchors }));
  patchAttrs(liveRoot, previousRoot, nextRoot);
  patchChildren(document.head, previousDocument.head, next.clean.head);
  patchChildren(document.body, previousDocument.body, next.clean.body);
  const renderedBefore = previousDocument;
  previousDocument = next.clean;
  loadStyles(next.clean);
  refreshDevStyles(renderedBefore, next.clean);
  runScripts(added);
  const liveBody = document.body;
  const serverBody = next.withAnchors.body;
  if (!liveBody || !serverBody) {
    throw new Error('missing <body> in one of the renderings');
  }
  syncAnchors(liveBody, serverBody);
  syncStamps(document, next.withAnchors);
  dismissErrorOverlay(liveBody);
  document.dispatchEvent(new CustomEvent('avb:after-patch', { detail: next.withAnchors }));
  document.dispatchEvent(new CustomEvent('avb:morphed', { detail: next.withAnchors }));
}

if (import.meta.hot) {
  import.meta.hot.on('avb:page-changed', () => {
    variantPreview.forget();
    if (host === 'stacki') {
      requestUpdate();
    } else {
      location.reload();
    }
  });
}
window.addEventListener('message', (event: MessageEvent) => {
  if (host === 'browser') {
    return;
  }
  const data: unknown = event.data;
  if (event.source === window.parent) {
    if (variantPreview.receive(data)) {
      return;
    }
    const route = parsePreviewRoute(data, location.href);
    if (route && route !== location.pathname + location.search + location.hash) {
      pushedHTML = undefined;
      clearFallback();
      activePull?.abort();
      history.replaceState(history.state, '', route);
      document.dispatchEvent(new Event('avb:preview-route'));
      void update();
      return;
    }
  }
  if (typeof data === 'object' && data !== null && 'type' in data && data['type'] === 'avb:patch-now') {
    requestUpdate();
  }
});
