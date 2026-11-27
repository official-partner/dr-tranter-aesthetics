
import { boolean, count, list, object, optional, text } from '../core/boundary';

export const parseCascadeOrigin = object({
  selector: text,
  file: optional(text),
  value: text,
  important: boolean,
  layer: optional(text),
  conditions: list(text),
  order: count,
});
export type CascadeOrigin = ReturnType<typeof parseCascadeOrigin>;

export const parseCascadeProperty = object({
  used: text,
  winner: optional(parseCascadeOrigin),
  candidates: list(parseCascadeOrigin),
});
export type CascadeProperty = ReturnType<typeof parseCascadeProperty>;

export const CASCADE_CANDIDATES_MAX = 64;
export const CASCADE_PROPERTIES_MAX = 512;
