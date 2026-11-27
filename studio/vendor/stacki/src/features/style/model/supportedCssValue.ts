export function isSupportedCssValue(prop: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return true;
  }
  try {
    return CSS.supports(prop, trimmed);
  } catch {
    return false;
  }
}
