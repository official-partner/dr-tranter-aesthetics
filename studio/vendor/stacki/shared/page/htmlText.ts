import { assert } from '../core/assert';

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  shy: '­',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  middot: '·',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  sect: '§',
  para: '¶',
  permil: '‰',
  prime: '′',
  Prime: '″',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  curren: '¤',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  infin: '∞',
  radic: '√',
  sum: '∑',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  ouml: 'ö',
  ooslash: 'ø',
  oslash: 'ø',
  uuml: 'ü',
  auml: 'ä',
  ccedil: 'ç',
  ntilde: 'ñ',
  szlig: 'ß',
  aring: 'å',
  ae: 'æ',
  oelig: 'œ',
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

function decodeEntities(text: unknown): string {
  return String(text ?? '').replace(ENTITY, (whole: string, body: string): string => {
    if (body.charAt(0) === '#') {
      const second = body.charAt(1);
      const code = second === 'x' || second === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) {
        return whole;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    if (Object.hasOwn(NAMED, body)) {
      return NAMED[body] ?? whole;
    }
    const lower = body.toLowerCase();
    if (Object.hasOwn(NAMED, lower)) {
      return NAMED[lower] ?? whole;
    }
    return whole;
  });
}

function encodeText(text: unknown): string {
  return String(text ?? '').replace(/[&<>{}    ‌‍­]/g, (character: string): string => {
    if (character === '&') {
      return '&amp;';
    }
    if (character === '<') {
      return '&lt;';
    }
    if (character === '>') {
      return '&gt;';
    }
    const code = character.codePointAt(0);
    if (code === undefined) {
      return character;
    }
    return `&#${code};`;
  });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}|[^\S ]/g, ' ').trim();
}

function collapseText(raw: string): string {
  return (/^\s/.test(raw) ? ' ' : '') + collapseWhitespace(raw) + (/\s$/.test(raw) ? ' ' : '');
}

function textValue(raw: string): string {
  const collapsed = collapseText(raw);
  return collapsed.includes('&') ? decodeEntities(collapsed) : collapsed;
}

function textValueCanonical(value: string): string {
  const written = encodeText(value);
  if (written.trim().length === 0) {
    return value.length === 0 ? '' : ' ';
  }
  const canonical = textValue(written);
  assert(canonical.length <= value.length, 'Canonical text never grows');
  assert(textValue(encodeText(canonical)) === canonical, 'Canonical text is a fixed point of write-then-read');
  return canonical;
}

export { collapseText, decodeEntities, encodeText, textValue, textValueCanonical };
