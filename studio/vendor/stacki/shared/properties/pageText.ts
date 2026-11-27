import { object, optional, text } from '../core/boundary';

export const parsePageText = object({ title: optional(text), description: optional(text) });
export type PageText = Readonly<ReturnType<typeof parsePageText>>;
