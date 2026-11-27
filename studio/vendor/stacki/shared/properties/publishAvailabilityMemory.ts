import { assert } from '../core/assert';
import { UNKNOWN_PUBLISH_AVAILABILITY, type PublishAvailability, type PublishDestinationState } from './publishState';


export interface PublishAvailabilityMemory {
  readonly confirmed: PublishAvailability | undefined;
  readonly held: PublishAvailability | undefined;
}

export type PublishAvailabilityEvent =
  | { readonly kind: 'checked'; readonly result: PublishAvailability }
  | { readonly kind: 'failed' };

export const EMPTY_PUBLISH_AVAILABILITY_MEMORY: PublishAvailabilityMemory = { confirmed: undefined, held: undefined };

export const PUBLISH_CONFIRM_DELAY_MS = 250;

export function reducePublishAvailability(memory: PublishAvailabilityMemory, event: PublishAvailabilityEvent): PublishAvailabilityMemory {
  switch (event.kind) {
    case 'failed':
      return memory;
    case 'checked':
      return reduceChecked(memory, event.result);
  }
}

export function shownPublishAvailability(memory: PublishAvailabilityMemory): PublishAvailability {
  return memory.confirmed ?? UNKNOWN_PUBLISH_AVAILABILITY;
}

function reduceChecked(memory: PublishAvailabilityMemory, result: PublishAvailability): PublishAvailabilityMemory {
  const merged = mergeConfirmed(memory.confirmed, result);
  const previous = memory.confirmed;
  if (previous === undefined) {
    return { confirmed: merged, held: undefined };
  }
  if (flipsToPending(previous, merged)) {
    if (memory.held === undefined) {
      return { confirmed: previous, held: merged };
    }
    assert(flipsToPending(previous, memory.held), 'A held answer is always a flip to pending');
  }
  return { confirmed: merged, held: undefined };
}

function mergeConfirmed(previous: PublishAvailability | undefined, result: PublishAvailability): PublishAvailability {
  const github = result.github === 'unknown' ? (previous?.github ?? 'unknown') : result.github;
  const hosting = keepUnknown(previous?.hosting, result.hosting);
  const githubPush = result.github === 'unknown' ? previous?.githubPush : result.githubPush;
  return githubPush === undefined ? { github, hosting } : { github, hosting, githubPush };
}

function keepUnknown(previous: PublishDestinationState | undefined, next: PublishDestinationState): PublishDestinationState {
  return next === 'unknown' ? (previous ?? 'unknown') : next;
}

function flipsToPending(previous: PublishAvailability, next: PublishAvailability): boolean {
  if (previous.github === 'current') {
    if (next.github === 'pending') {
      return true;
    }
  }
  if (previous.hosting === 'current') {
    if (next.hosting === 'pending') {
      return true;
    }
  }
  return false;
}

export const PUBLISH_EVENT_QUIET_MS = 200;

const GENERATED_SEGMENTS: readonly (readonly string[])[] = [['node_modules'], ['.astro'], ['.stacki', 'preview']];
const EDITOR_TEMPORARY = /(^\.DS_Store$|~$|^\.#|^#.*#$|\.sw[a-p]$|^4913$|\.tmp$)/;

export function publishRelevantChange(files: readonly string[]): boolean {
  if (files.length === 0) {
    return true;
  }
  return files.some((file) => !publishIrrelevantFile(file));
}

function publishIrrelevantFile(file: string): boolean {
  const segments = file.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const name = segments[segments.length - 1];
  if (name !== undefined) {
    if (EDITOR_TEMPORARY.test(name)) {
      return true;
    }
  }
  return GENERATED_SEGMENTS.some((generated) => containsRun(segments, generated));
}

function containsRun(segments: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= segments.length; start += 1) {
    if (run.every((segment, offset) => segments[start + offset] === segment)) {
      return true;
    }
  }
  return false;
}
