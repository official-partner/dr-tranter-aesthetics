
export function toRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  return input as Record<string, unknown>;
}

export function toArray(input: unknown): unknown[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input as unknown[];
}
