
import { assert } from '../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import { LIMITS } from '../../shared/core/limits';

const GLOBAL = [
  'accesskey',
  'autocapitalize',
  'autofocus',
  'class',
  'contenteditable',
  'dir',
  'draggable',
  'enterkeyhint',
  'hidden',
  'id',
  'inert',
  'inputmode',
  'is',
  'itemid',
  'itemprop',
  'itemref',
  'itemscope',
  'itemtype',
  'lang',
  'nonce',
  'part',
  'popover',
  'slot',
  'spellcheck',
  'style',
  'tabindex',
  'title',
  'translate',
  'role',
] as const;

const FORM_CONTROL = ['disabled', 'form', 'name'] as const;

const TAG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['download', 'href', 'hreflang', 'ping', 'referrerpolicy', 'rel', 'target', 'type'],
  area: ['alt', 'coords', 'download', 'href', 'ping', 'referrerpolicy', 'rel', 'shape', 'target'],
  audio: ['autoplay', 'controls', 'crossorigin', 'loop', 'muted', 'preload', 'src'],
  blockquote: ['cite'],
  button: [...FORM_CONTROL, 'formaction', 'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'popovertarget', 'popovertargetaction', 'type', 'value'],
  canvas: ['height', 'width'],
  col: ['span'],
  colgroup: ['span'],
  data: ['value'],
  del: ['cite', 'datetime'],
  details: ['name', 'open'],
  dialog: ['open'],
  embed: ['height', 'src', 'type', 'width'],
  fieldset: FORM_CONTROL,
  form: ['accept-charset', 'action', 'autocomplete', 'enctype', 'method', 'name', 'novalidate', 'rel', 'target'],
  iframe: ['allow', 'allowfullscreen', 'height', 'loading', 'name', 'referrerpolicy', 'sandbox', 'src', 'srcdoc', 'width'],
  img: ['alt', 'crossorigin', 'decoding', 'fetchpriority', 'height', 'ismap', 'loading', 'referrerpolicy', 'sizes', 'src', 'srcset', 'usemap', 'width'],
  input: [
    ...FORM_CONTROL,
    'accept',
    'alt',
    'autocomplete',
    'checked',
    'dirname',
    'formaction',
    'formenctype',
    'formmethod',
    'formnovalidate',
    'formtarget',
    'height',
    'list',
    'max',
    'maxlength',
    'min',
    'minlength',
    'multiple',
    'pattern',
    'placeholder',
    'popovertarget',
    'popovertargetaction',
    'readonly',
    'required',
    'size',
    'src',
    'step',
    'type',
    'value',
    'width',
  ],
  ins: ['cite', 'datetime'],
  label: ['for'],
  li: ['value'],
  link: ['as', 'crossorigin', 'fetchpriority', 'href', 'hreflang', 'integrity', 'media', 'referrerpolicy', 'rel', 'sizes', 'type'],
  map: ['name'],
  meta: ['charset', 'content', 'http-equiv', 'media', 'name'],
  meter: ['high', 'low', 'max', 'min', 'optimum', 'value'],
  object: ['data', 'form', 'height', 'name', 'type', 'width'],
  ol: ['reversed', 'start', 'type'],
  optgroup: ['disabled', 'label'],
  option: ['disabled', 'label', 'selected', 'value'],
  output: ['for', 'form', 'name'],
  progress: ['max', 'value'],
  q: ['cite'],
  script: ['async', 'crossorigin', 'defer', 'fetchpriority', 'integrity', 'nomodule', 'referrerpolicy', 'src', 'type'],
  select: [...FORM_CONTROL, 'autocomplete', 'multiple', 'required', 'size'],
  slot: ['name'],
  source: ['height', 'media', 'sizes', 'src', 'srcset', 'type', 'width'],
  style: ['media'],
  td: ['colspan', 'headers', 'rowspan'],
  template: ['shadowrootmode'],
  textarea: [...FORM_CONTROL, 'autocomplete', 'cols', 'dirname', 'maxlength', 'minlength', 'placeholder', 'readonly', 'required', 'rows', 'wrap'],
  th: ['abbr', 'colspan', 'headers', 'rowspan', 'scope'],
  time: ['datetime'],
  track: ['default', 'kind', 'label', 'src', 'srclang'],
  video: ['autoplay', 'controls', 'crossorigin', 'height', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src', 'width'],
};

const GLOBAL_ONLY = new Set([
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'body',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'kbd',
  'legend',
  'main',
  'mark',
  'menu',
  'nav',
  'noscript',
  'p',
  'picture',
  'pre',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'search',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'title',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
]);

const ASTRO_TYPED_TAGS: ReadonlySet<string> = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas caption cite code col colgroup data datalist dd del ' +
    'details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins ' +
    'kbd keygen label legend li link main map mark menu menuitem meta meter nav noindex noscript object ol optgroup option output p param picture pre ' +
    'progress q rp rt ruby s samp slot script section select small source span strong style sub summary sup table tbody td textarea tfoot th thead ' +
    'time title tr track u ul var video wbr svg animate circle defs desc ellipse filter g image line marker mask metadata path pattern polygon ' +
    'polyline rect stop switch symbol text tspan use view'
  ).split(' '),
);

export function astroTypesTag(tag: string): boolean {
  assert(tag.length <= LIMITS.attrCharsMax, 'astroTypesTag: a tag is bounded');
  const typed = ASTRO_TYPED_TAGS.has(tag);
  assert(!typed || !tag.includes('-'), 'astroTypesTag: a custom element is never an Astro typed tag');
  return typed;
}

const RESERVED = /^(class:list|set:html|set:text|slot|define:vars)$|^(is|client|server|transition):/;

const GLOBAL_SET: ReadonlySet<string> = new Set(GLOBAL);

export function attributeValidOn(name: string, tag: string): boolean {
  const lower = name.toLowerCase();
  assert(lower.length <= LIMITS.attrCharsMax, 'attributeValidOn: attribute name is bounded');
  if (GLOBAL_SET.has(lower) || /^(data|aria)-[\w.:-]+$/.test(lower) || /^on[a-z]+$/.test(lower)) {
    return true;
  }
  const own = TAG_ATTRIBUTES[tag];
  if (own !== undefined) {
    return own.includes(lower);
  }
  return !GLOBAL_ONLY.has(tag);
}

export interface AttributeNameContext {
  readonly tag: string | undefined;
  readonly passedTo?: string | undefined;
  readonly reserved: readonly string[];
  readonly own: string | undefined;
  readonly taken: readonly string[];
}

export function attributeNameNote(name: string, context: AttributeNameContext, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const clean = name.trim();
  if (clean === '' || clean === context.own) {
    return undefined;
  }
  assert(context.reserved.length <= LIMITS.propSchemaFieldsMax, 'attributeNameNote: reserved names are bounded');
  assert(context.taken.length <= LIMITS.attrsPerNodeMax, 'attributeNameNote: taken names are bounded');
  if (context.tag !== undefined && (clean === 'class' || clean === 'class:list')) {
    return translate('editor.htmlAttributes.useStylePanel');
  }
  if (context.taken.includes(clean)) {
    return translate('editor.htmlAttributes.taken', { name: clean });
  }
  if (RESERVED.test(clean) || context.reserved.includes(clean)) {
    return translate('editor.htmlAttributes.reserved');
  }
  const tag = context.tag ?? context.passedTo;
  if (tag === undefined || clean.startsWith('{')) {
    return undefined;
  }
  return attributeValidOn(clean, tag) ? undefined : translate('editor.htmlAttributes.notOnTag', { name: clean, tag });
}
