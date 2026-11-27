
import { PROBE_ATTR } from './frameBasics';

const GUIDE_VARIABLES = {
  margin: '--site-margin',
  gutter: '--site-gutter',
  widthMax: '--max-width-main',
} as const;
const COLUMN_COUNT_PATTERN = /^\d{1,3}$/;
const MENU_VARIABLES_MAX = 5;
const MENU_VARIABLE_CHARS_MAX = 64;
const MENU_VARIABLE_PATTERN = /^--[A-Za-z0-9_-]+$/;

export type GuidePost = (message: unknown) => void;

export interface GuideFrame {
  readonly receive: (data: unknown) => void;
}

let lastSent = '';
let measureQueued = false;
let menuVariables: readonly string[] = [];
let post: GuidePost = () => undefined;

export function startGuide(send: GuidePost): GuideFrame {
  post = send;
  queueGuide();
  window.addEventListener('load', queueGuide);
  window.addEventListener('resize', queueGuide);
  document.addEventListener('avb:morphed', queueGuide);
  watchStyles();
  return { receive: receiveGuideMessage };
}

function receiveGuideMessage(data: unknown): void {
  if (messageType(data) === 'avb:guide-variables') {
    menuVariables = parseMenuVariables(data);
    lastSent = '';
    queueGuide();
  }
}

function watchStyles(): void {
  try {
    new MutationObserver(queueGuide).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    new ResizeObserver(queueGuide).observe(document.documentElement);
  } catch {
  }
}

function queueGuide(): void {
  if (measureQueued) {
    return;
  }
  measureQueued = true;
  requestAnimationFrame(() => {
    measureQueued = false;
    sendGuide();
  });
}

function sendGuide(): void {
  const body = document.body;
  if (!body) {
    return;
  }
  const message = measureGuide(body);
  const key = JSON.stringify(message);
  if (key === lastSent) {
    return;
  }
  lastSent = key;
  try {
    post(message);
  } catch {
  }
}

function measureGuide(body: HTMLElement) {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  return {
    type: 'avb:guide',
    viewportWidth: root.clientWidth,
    rootFontSize: Number.parseFloat(rootStyle.fontSize),
    margin: lengthOf(body, rootStyle, GUIDE_VARIABLES.margin),
    gutter: lengthOf(body, rootStyle, GUIDE_VARIABLES.gutter),
    widthMax: lengthOf(body, rootStyle, GUIDE_VARIABLES.widthMax),
    variables: Object.fromEntries(menuVariables.map((name) => [name, lengthOf(body, rootStyle, name)])),
    counts: Object.fromEntries(menuVariables.map((name) => [name, countOf(rootStyle.getPropertyValue(name))])),
  };
}

function lengthOf(body: HTMLElement, rootStyle: CSSStyleDeclaration, variable: string): number | undefined {
  const declared = rootStyle.getPropertyValue(variable).trim();
  if (declared === '' || declared === 'none') {
    return undefined;
  }
  const probe = appendProbe(body, `width:var(${variable})`);
  try {
    const width = probe.getBoundingClientRect().width;
    return Number.isFinite(width) ? width : undefined;
  } finally {
    probe.remove();
  }
}

function appendProbe(body: HTMLElement, style: string): HTMLElement {
  const probe = document.createElement('div');
  probe.setAttribute(PROBE_ATTR, '');
  probe.setAttribute(
    'style',
    'position:absolute;left:0;top:0;height:0;margin:0;padding:0;border:0;' + 'box-sizing:content-box;visibility:hidden;pointer-events:none;' + style,
  );
  body.appendChild(probe);
  return probe;
}

function countOf(declared: string): number | undefined {
  const value = declared.trim();
  return COLUMN_COUNT_PATTERN.test(value) ? Number.parseInt(value, 10) : undefined;
}

function messageType(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  return 'type' in input ? input.type : undefined;
}

function parseMenuVariables(input: unknown): readonly string[] {
  if (typeof input !== 'object' || input === null) {
    return [];
  }
  const names: unknown = 'names' in input ? input.names : undefined;
  if (!Array.isArray(names)) {
    return [];
  }
  if (names.length > MENU_VARIABLES_MAX) {
    return [];
  }
  const valid = names.filter(isMenuVariable);
  return valid.length === names.length ? valid : [];
}

function isMenuVariable(name: unknown): name is string {
  if (typeof name !== 'string') {
    return false;
  }
  if (name.length > MENU_VARIABLE_CHARS_MAX) {
    return false;
  }
  return MENU_VARIABLE_PATTERN.test(name);
}
