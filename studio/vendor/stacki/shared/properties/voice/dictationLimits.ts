import { assert } from '../../core/assert';

export const DICTATION_LIMITS = {
  sampleRateHz: 16_000,
  windowMsMax: 30_000,
  interimIntervalMsMin: 800,
  interimRestShare: 0.5,
  interimWindowMsMax: 12_000,
  partialAudioMsMin: 600,
  commitAudioMsMin: 8_000,
  pauseMsMin: 550,
  frameMs: 30,
  speechRmsMin: 0.012,
  speechRmsMax: 0.06,
  noiseFloorFactor: 3,
  speechMsMin: 300,
  speechPaddingMs: 150,
  noiseMeasureMs: 300,
  vadStartProbability: 0.5,
  vadKeepProbability: 0.35,
  shortResultWordsMax: 4,
  shortResultSpeechRatioMin: 0.6,
  shortResultProbabilityMin: 0.7,
  crossingRateMax: 0.35,
  releaseFactor: 0.6,
  hangoverFrames: 4,
  onsetFrames: 3,
  captureChunkSamples: 1_600,
  segmentCharsMax: 4_000,
  segmentsMax: 400,
  workerIdleMs: 120_000,
  modelLoadMsMax: 90_000,
  decodeMsMax: 60_000,
  threadsMax: 4,
  realTimeFactorMax: 1.5,
  rtfAudioMsMin: 4_000,
  detailCharsMax: 240,
  downloadBytesMax: 700 * 1024 * 1024,
  redirectsMax: 5,
  connectMsMax: 20_000,
  stallMsMax: 30_000,
  progressEventsPerSecondMax: 10,
} as const satisfies Record<string, number>;

export function samplesOf(ms: number): number {
  assert(Number.isFinite(ms), 'samplesOf: a finite duration');
  assert(ms >= 0, 'samplesOf: a duration is never negative');
  return Math.floor((ms * DICTATION_LIMITS.sampleRateHz) / 1000);
}

export function msOf(samples: number): number {
  assert(Number.isSafeInteger(samples), 'msOf: a whole number of samples');
  assert(samples >= 0, 'msOf: a sample count is never negative');
  return Math.floor((samples * 1000) / DICTATION_LIMITS.sampleRateHz);
}
