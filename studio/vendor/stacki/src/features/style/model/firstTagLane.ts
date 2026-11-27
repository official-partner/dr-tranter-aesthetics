
import { assert } from '../../../../shared/core/assert';

export type LaneWrite = { readonly prop: string; readonly value: string; readonly important: boolean };

export type LaneBatch = { readonly selector: string; readonly writes: readonly LaneWrite[] };

export type LaneScanOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'drain';
      readonly tagKey: string | undefined;
      readonly batches: readonly LaneBatch[];
    };

export const LANE_SCANS_WITHOUT_TAG_MAX = 8;

type Phase = 'collecting' | 'writing' | 'landed';

type Lane = {
  readonly filePath: string;
  readonly requested: string;
  readonly selector: string;
  readonly knownKeys: ReadonlySet<string>;
  phase: Phase;
  scansWithoutTag: number;
  readonly queue: Map<string, { readonly selector: string; readonly write: LaneWrite }>;
};

export class FirstTagLane {
  private lane: Lane | undefined = undefined;

  holds(filePath: string | undefined): boolean {
    const lane = this.lane;
    if (lane === undefined) {
      return false;
    }
    if (lane.filePath === filePath) {
      return true;
    }
    this.lane = undefined;
    return false;
  }

  phase(): Phase | undefined {
    return this.lane?.phase;
  }

  open(input: { readonly filePath: string; readonly requested: string; readonly selector: string; readonly knownKeys: Iterable<string> }): void {
    assert(this.lane === undefined, 'FirstTagLane.open: one tag is created at a time');
    assert(input.selector.length > 0, 'FirstTagLane.open: the new rule has a selector');
    this.lane = {
      filePath: input.filePath,
      requested: input.requested,
      selector: input.selector,
      knownKeys: new Set(input.knownKeys),
      phase: 'collecting',
      scansWithoutTag: 0,
      queue: new Map(),
    };
  }

  join(requested: string, write: LaneWrite): void {
    const lane = this.lane;
    assert(lane !== undefined, 'FirstTagLane.join: a lane is open');
    assert(write.prop.length > 0, 'FirstTagLane.join: a write names a property');
    const selector = requested === lane.requested ? lane.selector : requested;
    const key = `${selector}\u0000${write.prop}`;
    lane.queue.delete(key);
    lane.queue.set(key, { selector, write });
  }

  supersede(requested: string, prop: string): 'dropped' | 'none-waiting' {
    const lane = this.lane;
    assert(lane !== undefined, 'FirstTagLane.supersede: a lane is open');
    assert(prop.length > 0, 'FirstTagLane.supersede: a write names a property');
    const selector = requested === lane.requested ? lane.selector : requested;
    const dropped = lane.queue.delete(`${selector}\u0000${prop}`);
    assert(!lane.queue.has(`${selector}\u0000${prop}`), 'FirstTagLane.supersede: nothing older waits for this property');
    return dropped ? 'dropped' : 'none-waiting';
  }

  takeFirstWrites(): readonly LaneWrite[] {
    const lane = this.lane;
    assert(lane !== undefined, 'FirstTagLane.takeFirstWrites: a lane is open');
    assert(lane.phase === 'collecting', 'FirstTagLane.takeFirstWrites: taken once, before the tag is written');
    const writes: LaneWrite[] = [];
    for (const [key, entry] of lane.queue) {
      if (entry.selector === lane.selector) {
        writes.push(entry.write);
        lane.queue.delete(key);
      }
    }
    assert(writes.length > 0, 'FirstTagLane.takeFirstWrites: the opening write is among them');
    lane.phase = 'writing';
    return writes;
  }

  settle(outcome: 'written' | 'failed'): void {
    const lane = this.lane;
    if (lane === undefined) {
      return;
    }
    assert(lane.phase === 'writing', 'FirstTagLane.settle: only a tag being written settles');
    if (outcome === 'failed') {
      this.lane = undefined;
      return;
    }
    lane.phase = 'landed';
  }

  afterScan(filePath: string | undefined, nodeKeys: readonly string[]): LaneScanOutcome {
    const lane = this.lane;
    if (lane === undefined || !this.holds(filePath)) {
      return { kind: 'idle' };
    }
    if (lane.phase !== 'landed') {
      return { kind: 'waiting' };
    }
    const tagKey = nodeKeys.find((key) => !lane.knownKeys.has(key));
    if (tagKey !== undefined) {
      return this.release(tagKey);
    }
    lane.scansWithoutTag += 1;
    if (lane.scansWithoutTag < LANE_SCANS_WITHOUT_TAG_MAX) {
      return { kind: 'waiting' };
    }
    return this.release(undefined);
  }

  private release(tagKey: string | undefined): LaneScanOutcome {
    const lane = this.lane;
    assert(lane !== undefined, 'FirstTagLane.release: a lane is open');
    this.lane = undefined;
    const bySelector = new Map<string, LaneWrite[]>();
    for (const entry of lane.queue.values()) {
      const writes = bySelector.get(entry.selector) ?? [];
      writes.push(entry.write);
      bySelector.set(entry.selector, writes);
    }
    const batches = [...bySelector].map(([selector, writes]) => ({ selector, writes }));
    assert(
      batches.reduce((total, batch) => total + batch.writes.length, 0) === lane.queue.size,
      'FirstTagLane.release: every waiting write is handed back once',
    );
    return { kind: 'drain', tagKey, batches };
  }
}
