import { assert } from '../../core/assert';
import { count, object, pathText, record, text } from '../../core/boundary';
import { DICTATION_LIMITS } from './dictationLimits';
import { modelTotalBytes, parseWhisperModelId, WHISPER_MODELS, type WhisperModelId } from './whisperModels';

export type ModelInstall =
  | { readonly kind: 'notInstalled' }
  | { readonly kind: 'partial'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly kind: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly kind: 'installed'; readonly sizeBytes: number };

export interface DictationModelEntry {
  readonly id: WhisperModelId;
  readonly install: ModelInstall;
}

export interface DictationStatus {
  readonly models: readonly DictationModelEntry[];
  readonly directory: string;
}

export const DOWNLOAD_FAILURES = [
  'offline',
  'timeout',
  'hostRefused',
  'httpStatus',
  'tooLarge',
  'hashMismatch',
  'diskFull',
  'writeFailed',
  'cancelled',
  'busy',
] as const;
export type DownloadFailure = (typeof DOWNLOAD_FAILURES)[number];

export type DownloadOutcome = { readonly kind: 'installed'; readonly sizeBytes: number } | { readonly kind: 'failed'; readonly failure: DownloadFailure };

export interface DownloadProgress {
  readonly id: WhisperModelId;
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

const WHISPER_MODELS_COUNT = Object.keys(WHISPER_MODELS).length;

export const parseModelRequest = object({ modelId: parseWhisperModelId });
export type ModelRequest = { readonly modelId: WhisperModelId };

export function parseDownloadFailure(input: unknown): DownloadFailure {
  const found = DOWNLOAD_FAILURES.find((failure) => failure === input);
  if (found === undefined) {
    throw new Error('Expected a download failure code');
  }
  return found;
}

function boundedBytes(input: unknown, id: WhisperModelId): number {
  const value = count(input);
  const totalBytes = modelTotalBytes(WHISPER_MODELS[id]);
  if (value > totalBytes) {
    throw new Error('Expected bytes within the model size');
  }
  assert(value <= DICTATION_LIMITS.downloadBytesMax, 'boundedBytes: within the download bound');
  return value;
}

export function parseModelInstall(input: unknown, id: WhisperModelId): ModelInstall {
  const source = record(input);
  const kind = source['kind'];
  switch (kind) {
    case 'notInstalled':
      return { kind };
    case 'partial':
    case 'downloading': {
      const totalBytes = boundedBytes(source['totalBytes'], id);
      const receivedBytes = boundedBytes(source['receivedBytes'], id);
      if (receivedBytes > totalBytes) {
        throw new Error('Expected received bytes within the total');
      }
      return { kind, receivedBytes, totalBytes };
    }
    case 'installed':
      return { kind, sizeBytes: boundedBytes(source['sizeBytes'], id) };
    default:
      throw new Error('Expected a model install state');
  }
}

export function parseDictationStatus(input: unknown): DictationStatus {
  const source = record(input);
  const directory = pathText(source['directory']);
  const models = source['models'];
  if (!Array.isArray(models)) {
    throw new Error('Expected a model list');
  }
  if (models.length > WHISPER_MODELS_COUNT) {
    throw new Error('Expected at most one entry per model');
  }
  const parsed = models.map((entry: unknown): DictationModelEntry => {
    const fields = record(entry);
    const id = parseWhisperModelId(fields['id']);
    return { id, install: parseModelInstall(fields['install'], id) };
  });
  if (new Set(parsed.map((entry) => entry.id)).size !== parsed.length) {
    throw new Error('Expected each model once');
  }
  return { models: parsed, directory };
}

export function parseDownloadOutcome(input: unknown, id: WhisperModelId): DownloadOutcome {
  const source = record(input);
  if (source['kind'] === 'installed') {
    return { kind: 'installed', sizeBytes: boundedBytes(source['sizeBytes'], id) };
  }
  if (source['kind'] === 'failed') {
    return { kind: 'failed', failure: parseDownloadFailure(source['failure']) };
  }
  throw new Error('Expected a download outcome');
}

export function parseDownloadProgress(input: unknown): DownloadProgress {
  const source = record(input);
  const id = parseWhisperModelId(source['id']);
  const totalBytes = boundedBytes(source['totalBytes'], id);
  const receivedBytes = boundedBytes(source['receivedBytes'], id);
  if (receivedBytes > totalBytes) {
    throw new Error('Expected received bytes within the total');
  }
  return { id, receivedBytes, totalBytes };
}

export const parseModelRemoved = object({
  kind: (input: unknown): 'removed' => {
    if (text(input) !== 'removed') {
      throw new Error('Expected removed');
    }
    return 'removed';
  },
});

export function installOf(status: DictationStatus | undefined, id: WhisperModelId): ModelInstall {
  const entry = status?.models.find((candidate) => candidate.id === id);
  assert(entry === undefined || entry.id === id, 'installOf: the entry is the model asked for');
  return entry?.install ?? { kind: 'notInstalled' };
}
