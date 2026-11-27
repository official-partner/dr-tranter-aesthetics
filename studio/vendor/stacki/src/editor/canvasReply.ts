import { boolean, count, dictionary, list, object, optional, text } from '../../shared/core/boundary';
import { parseCascadeProperty } from '../../shared/properties/cascadeOrigin';
import { parseStyleSource } from '../../shared/properties/styleSource';
import { parseWinningDeclaration, WINNING_NAMES_MAX } from '../../shared/properties/winningDeclaration';
import { parsePageImage, parsePageType } from '../../shared/properties/pageMetadata';
import { parsePageText, type PageText } from '../../shared/properties/pageText';
import { err, ok, type Result } from '../../shared/core/result';

const identity = object({
  tag: text,
  id: optional(text),
  classes: list(text),
  attributes: dictionary(text),
});
const boundedWinning = (input: unknown): ReturnType<ReturnType<typeof dictionary<ReturnType<typeof parseWinningDeclaration>>>> => {
  const parsed = dictionary(parseWinningDeclaration)(input);
  if (Object.keys(parsed).length > WINNING_NAMES_MAX) {
    throw new Error('Winning declarations exceed limit');
  }
  return parsed;
};
const reply = object({
  id: count,
  found: boolean,
  ready: optional(boolean),
  pageImage: optional(parsePageImage),
  pageType: optional(parsePageType),
  pageText: optional(parsePageText),
  identity: optional(identity),
  matched: optional(dictionary(optional(boolean))),
  computed: optional(dictionary(optional(text))),
  computedProps: optional(dictionary(optional(text))),
  authoredProps: optional(dictionary(optional(text))),
  inheritedSources: optional(dictionary(parseStyleSource)),
  authoredOrigins: optional(dictionary(optional(parseCascadeProperty))),
  winning: optional(boundedWinning),
  scoped: optional(boundedWinning),
});
export type CanvasReply = ReturnType<typeof reply>;
export type CanvasAnswer = {
  readonly pageText?: PageText | undefined;
  readonly pageImage?: string | undefined;
  readonly pageType?: string | undefined;
  readonly identity: CanvasReply['identity'];
  readonly matched: NonNullable<CanvasReply['matched']>;
  readonly computed: NonNullable<CanvasReply['computed']>;
  readonly computedProps: NonNullable<CanvasReply['computedProps']>;
  readonly authoredProps: NonNullable<CanvasReply['authoredProps']>;
  readonly inheritedSources: NonNullable<CanvasReply['inheritedSources']>;
  readonly authoredOrigins: NonNullable<CanvasReply['authoredOrigins']>;
  readonly winning: NonNullable<CanvasReply['winning']>;
  readonly scoped: NonNullable<CanvasReply['scoped']>;
};

export function parseCanvasReply(input: unknown): Result<CanvasReply> {
  try {
    return ok(reply(input));
  } catch (error: unknown) {
    return err({ code: 'invalid_canvas_reply', message: String(error) });
  }
}
