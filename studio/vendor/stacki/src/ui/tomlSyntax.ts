import { StreamLanguage, type Language, type StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { assert } from '../../shared/core/assert';

const TOKEN_TAGS = {
  comment: t.comment,
  heading: t.heading,
  property: t.propertyName,
  string: t.string,
  number: t.number,
  bool: t.bool,
  punctuation: t.punctuation,
} as const;

type TokenName = keyof typeof TOKEN_TAGS;

interface TomlState {
  readonly openString: '"""' | "'''" | undefined;
  readonly beforeEquals: boolean;
}

const NUMBER_OR_DATE = /^[-+]?(?:0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.\d[\d_]*)?(?:e[-+]?\d+)?(?:[-:T ]\d[\d:.Z+-]*)?)/i;

const STRING_CLOSE = { '"""': /^.*?"""/, "'''": /^.*?'''/ } as const;

function step(stream: StringStream, previous: TomlState): { readonly style: TokenName | undefined; readonly state: TomlState } {
  if (previous.openString !== undefined) {
    if (stream.match(STRING_CLOSE[previous.openString])) {
      return { style: 'string', state: { ...previous, openString: undefined } };
    }
    stream.skipToEnd();
    return { style: 'string', state: previous };
  }
  const state: TomlState = stream.sol() ? { ...previous, beforeEquals: true } : previous;
  if (stream.eatSpace()) {
    return { style: undefined, state };
  }
  if (stream.match('#')) {
    stream.skipToEnd();
    return { style: 'comment', state };
  }
  if (state.beforeEquals && stream.sol() && stream.match(/^\[\[?[^\]]*\]\]?/)) {
    return { style: 'heading', state };
  }
  if (stream.match('"""') || stream.match("'''")) {
    const quote = stream.current() === '"""' ? '"""' : "'''";
    if (stream.match(STRING_CLOSE[quote])) {
      return { style: 'string', state };
    }
    stream.skipToEnd();
    return { style: 'string', state: { ...state, openString: quote } };
  }
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'[^']*'?/)) {
    return { style: state.beforeEquals ? 'property' : 'string', state };
  }
  if (stream.eat('=')) {
    return { style: 'punctuation', state: { ...state, beforeEquals: false } };
  }
  if (state.beforeEquals && stream.match(/^[A-Za-z0-9_-]+/)) {
    return { style: 'property', state };
  }
  if (!state.beforeEquals && stream.match(/^(?:true|false)\b/)) {
    return { style: 'bool', state };
  }
  if (!state.beforeEquals && stream.match(NUMBER_OR_DATE)) {
    return { style: 'number', state };
  }
  if (stream.match(/^[[\]{},.]/)) {
    return { style: 'punctuation', state };
  }
  stream.next();
  return { style: undefined, state };
}

export const tomlLanguage: Language = StreamLanguage.define<{ lexerState: TomlState }>({
  name: 'toml',
  startState: () => ({ lexerState: { openString: undefined, beforeEquals: true } }),
  copyState: (state) => ({ lexerState: state.lexerState }),
  token(stream, state) {
    const before = stream.pos;
    const next = step(stream, state.lexerState);
    assert(stream.pos > before, 'toml: every token moves forward');
    // eslint-disable-next-line no-param-reassign -- StreamParser advances its state in place.
    state.lexerState = next.state;
    // eslint-disable-next-line stacki/no-null -- StreamParser spells "no style" as null.
    return next.style ?? null;
  },
  tokenTable: TOKEN_TAGS,
});
