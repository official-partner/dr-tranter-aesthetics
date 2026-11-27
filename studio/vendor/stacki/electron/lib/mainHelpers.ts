
import { MAIN_LIMITS, readSource } from './mainLimits';
import { toArray } from '../../shared/core/record';
import { assert } from '../../shared/core/assert';
import * as path from 'path';
import { data, optional, record, text } from '../../shared/core/boundary';

export { data as parseData, record as parseRecord, text as parseString };
export const parseOptionalString = optional(text);

export const SHORT_COMMAND = {
  timeout: 10000,
  maxBuffer: MAIN_LIMITS.commandOutputBytesMax,
} as const;

export const isWin = process.platform === 'win32';

export function toPosix(filePath: string) {
  return filePath.split(path.sep).join('/');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  assert(value !== undefined, `Missing required regex group ${index}`);
  return value;
}
export function readJson(file: string): unknown {
  const input: unknown = JSON.parse(readSource(file));
  return input;
}
export function parseDataList(input: unknown): unknown[] {
  const values = toArray(input);
  if (!values) {
    throw new Error('Expected collection array');
  }
  return values;
}
