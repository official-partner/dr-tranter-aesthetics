
import { assert } from '../core/assert';

export const PREVIEW_QUEUE_LIMITS = {
  concurrencyMax: 3,
  queuedMax: 1024,
} as const;

export const PREVIEW_PRIORITIES = ['visible', 'near', 'background'] as const;
export type PreviewPriority = (typeof PREVIEW_PRIORITIES)[number];

export interface QueueEntry {
  readonly id: string;
  readonly priority: PreviewPriority;
  readonly order: number;
}

export interface PreviewQueue {
  readonly waiting: readonly QueueEntry[];
  readonly running: readonly string[];
}

export const EMPTY_PREVIEW_QUEUE: PreviewQueue = { waiting: [], running: [] };

function rank(priority: PreviewPriority): number {
  return PREVIEW_PRIORITIES.indexOf(priority);
}

function byTurn(left: QueueEntry, right: QueueEntry): number {
  return rank(left.priority) - rank(right.priority) || left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function enqueue(queue: PreviewQueue, entry: QueueEntry): PreviewQueue {
  if (queue.running.includes(entry.id)) {
    return queue;
  }
  const others = queue.waiting.filter((waiting) => waiting.id !== entry.id);
  if (others.length >= PREVIEW_QUEUE_LIMITS.queuedMax) {
    return queue;
  }
  return { ...queue, waiting: [...others, entry].sort(byTurn) };
}

export function cancel(queue: PreviewQueue, id: string): PreviewQueue {
  return queue.waiting.some((entry) => entry.id === id) ? { ...queue, waiting: queue.waiting.filter((entry) => entry.id !== id) } : queue;
}

export function cancelAll(queue: PreviewQueue): PreviewQueue {
  return { ...queue, waiting: [] };
}

export function reprioritize(queue: PreviewQueue, priorities: ReadonlyMap<string, PreviewPriority>): PreviewQueue {
  const waiting = queue.waiting.map((entry) => ({ ...entry, priority: priorities.get(entry.id) ?? ('background' as const) })).sort(byTurn);
  return { ...queue, waiting };
}

export function startNext(queue: PreviewQueue, concurrency: number): { readonly queue: PreviewQueue; readonly started: readonly QueueEntry[] } {
  assert(concurrency >= 1, 'The queue renders at least one at a time');
  assert(concurrency <= PREVIEW_QUEUE_LIMITS.concurrencyMax, 'The queue stays within its concurrency bound');
  const free = Math.max(0, concurrency - queue.running.length);
  const started = queue.waiting.slice(0, free);
  const next: PreviewQueue = { waiting: queue.waiting.slice(started.length), running: [...queue.running, ...started.map((entry) => entry.id)] };
  assert(next.running.length <= concurrency || queue.running.length > concurrency, 'Never more renders than the concurrency');
  return { queue: next, started };
}

export function finish(queue: PreviewQueue, id: string): PreviewQueue {
  return queue.running.includes(id) ? { ...queue, running: queue.running.filter((running) => running !== id) } : queue;
}
