import { assert } from '../../shared/core/assert';
interface Tone {
  readonly cutoff: number;
  readonly gain: number;
  readonly attack: number;
  readonly decay: number;
}
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}


const SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const ROOT_HZ = 196;
const LAST = SEMITONES.length - 1;

const FLOOR_MS = 25;

const BITE_LEVELS = 5;

const MUTED = { cutoff: 420, gain: 0.55, attack: 0.014, decay: 0.2 };
const SHARP = { cutoff: 2200, gain: 1, attack: 0.002, decay: 0.09 };
const mix = (from: number, to: number, fraction: number): number => from + (to - from) * fraction;

const VOICES_MAX = 32;
let activeVoices = 0;
let enabled = false;
let context: AudioContext | undefined;
let input: GainNode | undefined;
let lastKey = '';
let lastAt = Number.NEGATIVE_INFINITY;

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on: unknown): void {
  enabled = !!on;
  lastKey = '';
}

function bench(): AudioContext | undefined {
  if (context) {
    return context;
  }
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) {
    return undefined;
  }
  context = new Ctor();
  const master = context.createGain();
  master.gain.value = 0.06;
  master.connect(context.destination);
  input = master;
  return context;
}

function note(hz: number, tone: Tone): void {
  if (activeVoices >= VOICES_MAX) {
    return;
  }
  const audio = bench();
  if (!audio) {
    return;
  }
  if (audio.state === 'suspended') {
    void audio.resume();
  }
  const at = audio.currentTime;
  const osc = audio.createOscillator();
  const mute = audio.createBiquadFilter();
  const env = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(hz, at);
  mute.type = 'lowpass';
  mute.frequency.setValueAtTime(Math.max(tone.cutoff, hz * 1.25), at);
  mute.Q.setValueAtTime(0.7, at);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(tone.gain, at + tone.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + tone.attack + tone.decay);
  osc.connect(mute);
  mute.connect(env);
  assert(input !== undefined, 'Audio context must have a master gain');
  env.connect(input);
  osc.start(at);
  osc.stop(at + tone.attack + tone.decay + 0.02);
  activeVoices++;
  assert(activeVoices <= VOICES_MAX, 'Audio voice count exceeds limit');
  osc.onended = () => {
    assert(activeVoices > 0, 'An ending voice must be active');
    activeVoices--;
    osc.disconnect();
    mute.disconnect();
    env.disconnect();
  };
}

export function dragNote(fraction: unknown, verticalFraction?: unknown): void {
  if (!enabled) {
    return;
  }
  const position = Number(fraction);
  if (!Number.isFinite(position)) {
    return;
  }
  const step = Math.max(0, Math.min(LAST, Math.round(position * LAST)));
  const level = biteLevel(verticalFraction);
  const key = `${step}:${level}`;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (key === lastKey || now - lastAt < FLOOR_MS) {
    return;
  }
  lastKey = key;
  lastAt = now;
  note(ROOT_HZ * Math.pow(2, (SEMITONES[step] ?? NaN) / 12), toneFor(level));
}

export function noteHzFor(fraction: unknown): number {
  const position = Math.max(0, Math.min(1, Number(fraction) || 0));
  return ROOT_HZ * Math.pow(2, (SEMITONES[Math.round(position * LAST)] ?? NaN) / 12);
}

function biteLevel(verticalFraction: unknown): number {
  const y = Number(verticalFraction);
  if (!Number.isFinite(y)) {
    return (BITE_LEVELS - 1) / 2;
  }
  const up = 1 - Math.max(0, Math.min(1, y));
  return Math.round(up * (BITE_LEVELS - 1));
}

function toneFor(level: number): Tone {
  const sharpness = level / (BITE_LEVELS - 1);
  return {
    cutoff: mix(MUTED.cutoff, SHARP.cutoff, sharpness),
    gain: mix(MUTED.gain, SHARP.gain, sharpness),
    attack: mix(MUTED.attack, SHARP.attack, sharpness),
    decay: mix(MUTED.decay, SHARP.decay, sharpness),
  };
}

export function noteToneFor(verticalFraction: unknown): Tone {
  return toneFor(biteLevel(verticalFraction));
}

const HOVER = { cutoff: 1200, gain: 0.5, attack: 0.003, decay: 0.075 };

export function hoverNote(index: unknown, count: unknown): void {
  if (!enabled) {
    return;
  }
  const rows = Math.max(1, Math.floor(Number(count)) || 1);
  const row = Math.max(0, Math.min(rows - 1, Math.floor(Number(index)) || 0));
  const key = `row:${row}/${rows}`;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (key === lastKey || now - lastAt < FLOOR_MS) {
    return;
  }
  lastKey = key;
  lastAt = now;
  const from = rows > 1 ? row / (rows - 1) : 0;
  const step = Math.round((1 - from) * LAST);
  note(ROOT_HZ * Math.pow(2, (SEMITONES[step] ?? NaN) / 12), HOVER);
}

export function rowHzFor(index: unknown, count: unknown): number {
  const rows = Math.max(1, Math.floor(Number(count)) || 1);
  const row = Math.max(0, Math.min(rows - 1, Math.floor(Number(index)) || 0));
  const from = rows > 1 ? row / (rows - 1) : 0;
  return ROOT_HZ * Math.pow(2, (SEMITONES[Math.round((1 - from) * LAST)] ?? NaN) / 12);
}

const TAP = { hz: 174, cutoff: 900, gain: 0.5, attack: 0.001, decay: 0.055 };

export function clickNote() {
  if (!enabled) {
    return;
  }
  note(TAP.hz, TAP);
}

export function endDragNotes() {
  lastKey = '';
}
