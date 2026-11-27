import { object, optional, pathText, text } from '../core/boundary';

export const parseStyleSource = object({ label: text, path: optional(pathText) });
export type StyleSource = ReturnType<typeof parseStyleSource>;
