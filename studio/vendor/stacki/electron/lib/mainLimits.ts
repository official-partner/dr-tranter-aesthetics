import * as fs from 'fs';
import * as path from 'path';
import { assert } from '../../shared/core/assert';
import { LIMITS, PLATFORM_LIMITS } from '../../shared/core/limits';

export const MAIN_LIMITS = {
  directoryDepthMax: Math.floor(LIMITS.ipcPathCharsMax / 2),
  portAttemptsMax: 100,
  previewServersMax: 16,
  logChunkCharsMax: 64000,
  runnerLineCharsMax: LIMITS.ipcFieldCharsMax,
  runnerInputsMax: 10_000,
  runnerStderrCharsMax: 4000,
  commandOutputBytesMax: 1024 * 1024,
  gitOutputBytesMax: 64 * 1024 * 1024,
  gitMessageCharsMax: 4000,
  commitMessageCharsMax: 50_000,
  pathspecArgumentsMax: 200,
  statusFilesMax: 20_000,
  logPageMax: 500,
  commitTimeoutMs: 5 * 60 * 1000,
  publishCleanupAttemptsMax: 6,
  publishCleanupRetryDelayMs: 200,
  publishSweepEntriesMax: 64,
  publishSweepStaleAgeMs: 24 * 60 * 60 * 1000,
} as const;

export function readSource(file: string): string {
  return readSourceBytes(file).toString('utf8');
}

export function readSourceBytes(file: string): Buffer {
  const size = fs.statSync(file).size;
  if (size > LIMITS.sourceBytesMax) {
    throw new Error(`Source file exceeds the ${LIMITS.sourceBytesMax} byte platform string limit`);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length > LIMITS.sourceBytesMax) {
    throw new Error(`Source file exceeds the ${LIMITS.sourceBytesMax} byte platform string limit`);
  }
  return bytes;
}

export function directoryBudget(root: string): (directory: string, entries: number) => void {
  let visited = 0;
  return (directory, entries) => {
    assert(Number.isSafeInteger(entries), 'Directory entry count must be an integer');
    assert(entries >= 0, 'Directory entry count must be nonnegative');
    const depth = path.relative(root, directory).split(path.sep).length;
    if (depth > MAIN_LIMITS.directoryDepthMax) {
      throw new Error('Directory depth exceeds limit');
    }
    visited += entries + 1;
    assert(visited <= PLATFORM_LIMITS.safeIntegerMax, 'The visited count stays an exact integer');
  };
}
