const LITERALS = '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|url\\([^)]*\\)';
const DIMENSION = '(?<![\\w-])([-+]?(?:\\d*\\.)?\\d+(?:e[-+]?\\d+)?)(?:s|l|d)?vh\\b';
const VIEWPORT_UNITS = new RegExp(`(${LITERALS})|${DIMENSION}`, 'gi');

export function freezeViewportValue(value: string): string {
  return value.replace(VIEWPORT_UNITS, (match: string, literal: string | undefined, amount: string | undefined): string => {
    if (literal !== undefined || amount === undefined) {
      return match;
    }
    return `calc(${amount} * var(--avb-vh))`;
  });
}

export function parseViewportHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value > 0 && value <= 30_000 ? value : undefined;
}
