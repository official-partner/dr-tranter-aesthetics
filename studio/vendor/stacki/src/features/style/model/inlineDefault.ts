export type InlineDefault = 'selector' | 'inline';

let preferred: InlineDefault = 'selector';

export function inlineDefault(): InlineDefault {
  return preferred;
}

export function setInlineDefault(next: InlineDefault): void {
  preferred = next;
}
