import { assert } from '../../../shared/core/assert';

export const CHIP_CHARACTER = '￼';

export const CHIP_COUNT_MAX = 127;
export const SEGMENTS_MAX = 2 * CHIP_COUNT_MAX + 1;
export const TRIGGER_QUERY_CHARS_MAX = 64;

export type Segment<Chip> = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'chip'; readonly chip: Chip };

export interface ChipDocument<Chip> {
  readonly text: string;
  readonly chips: readonly Chip[];
}

export function segmentsToDocument<Chip>(segments: readonly Segment<Chip>[]): ChipDocument<Chip> {
  assert(segments.length <= SEGMENTS_MAX, 'chip editor: too many segments');
  let text = '';
  const chips: Chip[] = [];
  for (const segment of segments) {
    if (segment.kind === 'chip') {
      text += CHIP_CHARACTER;
      chips.push(segment.chip);
    } else {
      assert(!segment.text.includes(CHIP_CHARACTER), 'chip editor: text segments hold no placeholder character');
      text += segment.text;
    }
  }
  assert(chips.length <= CHIP_COUNT_MAX, 'chip editor: too many chips');
  return { text, chips };
}

export function documentToSegments<Chip>(document: ChipDocument<Chip>): readonly Segment<Chip>[] {
  const pieces = document.text.split(CHIP_CHARACTER);
  assert(pieces.length - 1 === document.chips.length, 'chip editor: one chip per placeholder');
  const segments: Segment<Chip>[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const text = pieces[index];
    if (text !== undefined && text.length > 0) {
      segments.push({ kind: 'text', text });
    }
    const chip = document.chips[index];
    if (index < document.chips.length && chip !== undefined) {
      segments.push({ kind: 'chip', chip });
    }
  }
  assert(segments.length <= SEGMENTS_MAX, 'chip editor: segments within bounds');
  return segments;
}

export interface TriggerMatch {
  readonly offset: number;
  readonly query: string;
}

export function findTrigger(textBeforeCursor: string, trigger: string): TriggerMatch | undefined {
  assert(trigger.length === 1, 'findTrigger: the trigger is one character');
  let start = textBeforeCursor.length;
  while (start > 0) {
    const previous = textBeforeCursor.charAt(start - 1);
    if (/\s/u.test(previous) || previous === CHIP_CHARACTER) {
      break;
    }
    start -= 1;
  }
  const word = textBeforeCursor.slice(start);
  if (!word.startsWith(trigger)) {
    return undefined;
  }
  const query = word.slice(1);
  if (query.length > TRIGGER_QUERY_CHARS_MAX) {
    return undefined;
  }
  return { offset: start, query };
}
