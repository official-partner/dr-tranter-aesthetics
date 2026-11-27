
export function isStyleModule(source: string): boolean {
  return /[?&]astro&type=style|\.(css|s[ac]ss|less|pcss|styl)(\?|$)/.test(source || '');
}

const MARKER_ATTRIBUTE_PREFIX = 'data-avb-';

interface ScriptInfo {
  readonly src: string;
  readonly type: string;
  readonly attrs: readonly [name: string, value: string][];
  readonly signature: string;
}

function scriptsOf(page: Document): ScriptInfo[] {
  const out: ScriptInfo[] = [];
  const list = page.getElementsByTagName('script');
  for (let i = 0; i < list.length; i++) {
    const script = list[i];
    if (!script) {
      continue;
    }
    const source = script.getAttribute('src') || '';
    if (isStyleModule(source)) {
      continue;
    }
    let attrs: [string, string][] = Array.from(script.attributes, (attribute) => [attribute.name, attribute.value]);
    attrs = attrs.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    out.push({
      src: source,
      type: script.getAttribute('type') || '',
      attrs,
      signature: JSON.stringify([attrs.filter(([name]) => !name.startsWith(MARKER_ATTRIBUTE_PREFIX)), script.textContent]),
    });
  }
  return out;
}

export function scriptSignature(page: Document): string {
  return JSON.stringify(scriptsOf(page).map((script) => script.signature));
}

export function addedScripts(previousDocument: Document, nextDocument: Document): ScriptInfo[] | undefined {
  const before = scriptsOf(previousDocument);
  const after = scriptsOf(nextDocument);
  const modulesBefore = new Set(before.filter(isExternalModule).map((script) => script.signature));
  const modulesAfter = new Set(after.filter(isExternalModule).map((script) => script.signature));
  for (const signature of modulesBefore) {
    if (!modulesAfter.has(signature)) {
      return undefined;
    }
  }
  const ordered = before.filter((script) => !isExternalModule(script));
  const had = new Set(ordered.map((script) => script.signature));
  const added: ScriptInfo[] = [];
  const addedModules = new Set<string>();
  let i = 0;
  for (const script of after) {
    if (isExternalModule(script)) {
      if (!modulesBefore.has(script.signature) && !addedModules.has(script.signature)) {
        addedModules.add(script.signature);
        added.push(script);
      }
    } else if (script.signature === ordered[i]?.signature) {
      i++;
    } else if (had.has(script.signature) || !script.src) {
      return undefined;
    } else {
      added.push(script);
    }
  }
  return i === ordered.length ? added : undefined;
}

export function describeScriptChange(previousDocument: Document, nextDocument: Document): string {
  const label = (script: ScriptInfo): string => (script.src === '' ? 'inline script "' + script.signature.slice(0, 60) + '"' : script.src.slice(0, 120));
  const before = scriptsOf(previousDocument);
  const after = scriptsOf(nextDocument);
  const afterSignatures = new Set(after.map((script) => script.signature));
  const beforeSignatures = new Set(before.map((script) => script.signature));
  const gone = before.find((script) => !afterSignatures.has(script.signature));
  if (gone !== undefined) {
    return 'script changed or gone: ' + label(gone);
  }
  const arrived = after.find((script) => !beforeSignatures.has(script.signature) && script.src === '');
  if (arrived !== undefined) {
    return 'an inline script arrived: ' + label(arrived);
  }
  return 'scripts reordered or repeated';
}

function isExternalModule(script: ScriptInfo): boolean {
  return script.src !== '' && script.type === 'module';
}

const loadedScripts = new Set<string>();
export function noteScripts(page: Document): void {
  for (const { src: source } of scriptsOf(page)) {
    if (source) {
      loadedScripts.add(source);
    }
  }
}
export function runScripts(added: readonly ScriptInfo[]): void {
  for (const { src: source, attrs } of added) {
    if (!source || loadedScripts.has(source)) {
      continue;
    }
    loadedScripts.add(source);
    const element = document.createElement('script');
    element.async = false;
    for (const [name, value] of attrs) {
      element.setAttribute(name, value);
    }
    document.head.appendChild(element);
  }
}

const loadedStyles = new Set<string>();
export function noteStyles(page: Document): void {
  const list = page.getElementsByTagName('script');
  for (let i = 0; i < list.length; i++) {
    const script = list[i];
    if (!script) {
      continue;
    }
    const source = script.getAttribute('src');
    if (source !== null && isStyleModule(source)) {
      loadedStyles.add(source);
    }
  }
}
export function loadStyles(page: Document): void {
  const list = page.getElementsByTagName('script');
  for (let i = 0; i < list.length; i++) {
    const script = list[i];
    if (!script) {
      continue;
    }
    const source = script.getAttribute('src');
    if (source === null || !isStyleModule(source) || loadedStyles.has(source)) {
      continue;
    }
    loadedStyles.add(source);
    const element = document.createElement('script');
    element.type = 'module';
    element.src = source;
    document.head.appendChild(element);
  }
}

export function refreshDevStyles(previous: Document, next: Document): void {
  const before = devStyleTexts(previous);
  const fresh = devStyleTexts(next);
  const live = document.querySelectorAll('style[data-vite-dev-id]');
  for (let i = 0; i < live.length; i++) {
    const style = live[i];
    const id = style?.getAttribute('data-vite-dev-id') ?? '';
    const text = fresh.get(id);
    if (style === undefined || text === undefined) {
      continue;
    }
    if (before.get(id) === text) {
      continue;
    }
    if (style.textContent !== text) {
      style.textContent = text;
    }
  }
}

function devStyleTexts(page: Document): Map<string, string> {
  const texts = new Map<string, string>();
  const served = page.querySelectorAll('style[data-vite-dev-id]');
  for (let i = 0; i < served.length; i++) {
    const id = served[i]?.getAttribute('data-vite-dev-id');
    if (id !== null && id !== undefined) {
      texts.set(id, served[i]?.textContent ?? '');
    }
  }
  return texts;
}
