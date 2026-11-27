
export type CodeIndentStyle = 'spaces' | 'tabs';

export function codeIndentStyleFor(path: string): CodeIndentStyle {
  return /\.ya?ml$/i.test(path) ? 'spaces' : 'tabs';
}
