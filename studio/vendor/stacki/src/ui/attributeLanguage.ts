
export type AttributeLanguage =
  'declarations' | 'javascript' | 'json' | 'keyValues' | 'mediaQuery' | 'pathData' | 'regex' | 'sourceSet' | 'svgNumbers' | 'tokens';

const BY_NAME: Readonly<Record<string, AttributeLanguage>> = {
  accept: 'tokens',
  allow: 'tokens',
  d: 'pathData',
  gradienttransform: 'svgNumbers',
  imagesizes: 'mediaQuery',
  imagesrcset: 'sourceSet',
  media: 'mediaQuery',
  patterntransform: 'svgNumbers',
  pattern: 'regex',
  points: 'svgNumbers',
  rel: 'tokens',
  sandbox: 'tokens',
  sizes: 'mediaQuery',
  srcset: 'sourceSet',
  strokedasharray: 'svgNumbers',
  style: 'declarations',
  transform: 'svgNumbers',
  type: 'tokens',
  viewbox: 'svgNumbers',
};

const BY_ELEMENT_AND_NAME: Readonly<Record<string, AttributeLanguage>> = {
  'meta.content': 'keyValues',
};

const NAME_CHARS_MAX = 128;

export function attributeLanguage(name: string, element?: string | undefined): AttributeLanguage | undefined {
  if (name.length === 0 || name.length > NAME_CHARS_MAX) {
    return undefined;
  }
  const key = name.toLowerCase().replace(/[-_]/g, '');
  const scoped = element === undefined ? undefined : BY_ELEMENT_AND_NAME[`${element.toLowerCase()}.${key}`];
  if (scoped !== undefined) {
    return scoped;
  }
  if (Object.hasOwn(BY_NAME, key)) {
    return BY_NAME[key];
  }
  if (/^on[a-z]{3,}$/.test(key) && EVENT_NAMES.has(key.slice(2))) {
    return 'javascript';
  }
  return undefined;
}

export function dataLanguage(name: string, text: string): AttributeLanguage | undefined {
  if (!/^data-./i.test(name)) {
    return undefined;
  }
  return /^\s*[[{]/.test(text) ? 'json' : undefined;
}

export function attributeLanguageOf(name: string, text: string, element?: string | undefined): AttributeLanguage | undefined {
  return attributeLanguage(name, element) ?? dataLanguage(name, text);
}

const EVENT_NAMES: ReadonlySet<string> = new Set([
  'abort',
  'animationend',
  'animationiteration',
  'animationstart',
  'auxclick',
  'beforeinput',
  'beforeunload',
  'blur',
  'cancel',
  'canplay',
  'canplaythrough',
  'change',
  'click',
  'close',
  'contextmenu',
  'copy',
  'cut',
  'dblclick',
  'drag',
  'dragend',
  'dragenter',
  'dragleave',
  'dragover',
  'dragstart',
  'drop',
  'durationchange',
  'ended',
  'error',
  'focus',
  'focusin',
  'focusout',
  'formdata',
  'gotpointercapture',
  'hashchange',
  'input',
  'invalid',
  'keydown',
  'keypress',
  'keyup',
  'load',
  'loadeddata',
  'loadedmetadata',
  'loadstart',
  'lostpointercapture',
  'message',
  'mousedown',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'offline',
  'online',
  'pagehide',
  'pageshow',
  'paste',
  'pause',
  'play',
  'playing',
  'pointercancel',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'popstate',
  'progress',
  'ratechange',
  'reset',
  'resize',
  'scroll',
  'scrollend',
  'securitypolicyviolation',
  'seeked',
  'seeking',
  'select',
  'selectionchange',
  'slotchange',
  'stalled',
  'storage',
  'submit',
  'suspend',
  'timeupdate',
  'toggle',
  'touchcancel',
  'touchend',
  'touchmove',
  'touchstart',
  'transitionend',
  'transitionrun',
  'transitionstart',
  'unload',
  'volumechange',
  'waiting',
  'wheel',
]);
