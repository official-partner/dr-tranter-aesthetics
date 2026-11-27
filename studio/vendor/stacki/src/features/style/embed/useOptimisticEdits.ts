
import { useCallback, useEffect, useRef, useState } from 'react';
import { assert } from '../../../../shared/core/assert';
import { writtenValue } from '../model/lengthUnit';
import { withCleared, withCommitted } from '../model/optimisticProp';
import type { ResolvedProp } from '../model/resolved';
import type { WriteSettle } from './EditorBasics';

const HELD_PER_CLEAR_MAX = 64;
const HOLDS_MAX = 1024;
const HOLD_MS_MAX = 20_000;

type Model = ReadonlyMap<string, ResolvedProp>;

type Release = { readonly kind: 'save' } | { readonly kind: 'model'; readonly model: Model };

type Hold =
  | {
      readonly kind: 'committed';
      readonly revision: number;
      readonly value: string;
      readonly important: boolean;
      readonly selector: string;
      readonly release: Release;
    }
  | { readonly kind: 'cleared'; readonly revision: number; readonly release: Release };

export type SettlingSet = (prop: string, value: string, important: boolean) => WriteSettle;
export type CommitProp = (prop: string, value: string, important: boolean) => void;
export type SettlingClear = (prop: string | string[]) => WriteSettle;

export function useOptimisticEdits(
  props: Model,
  writes: { readonly setProp: SettlingSet; readonly clearProp: SettlingClear; readonly selector: string },
): {
  readonly read: (prop: string) => ResolvedProp | undefined;
  readonly setProp: CommitProp;
  readonly clearProp: (prop: string | string[]) => void;
} {
  const [holds, setHolds] = useState<ReadonlyMap<string, Hold>>(new Map());
  const revisionRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const forgetTimer = useCallback((revision: number) => {
    const timer = timersRef.current.get(revision);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(revision);
    }
  }, []);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const release = useCallback(
    (names: readonly string[], revision: number) => {
      forgetTimer(revision);
      setHolds((previous) => {
        const next = new Map(previous);
        for (const name of names) {
          if (next.get(name)?.revision === revision) {
            next.delete(name);
          }
        }
        return next.size === previous.size ? previous : next;
      });
    },
    [forgetTimer],
  );

  const hold = (names: readonly string[], settled: WriteSettle, make: (revision: number, release: Release) => Hold): void => {
    if (settled === undefined) {
      return;
    }
    revisionRef.current += 1;
    const revision = revisionRef.current;
    assert(Number.isSafeInteger(revision), 'useOptimisticEdits: revisions stay safe integers');
    const until: Release = settled === 'until-model' ? { kind: 'model', model: props } : { kind: 'save' };
    setHolds((previous) => {
      const next = new Map(previous);
      for (const name of names) {
        next.set(name, make(revision, until));
      }
      assert(next.size <= HOLDS_MAX, 'useOptimisticEdits: holds stay bounded');
      return next;
    });
    if (settled !== 'until-model') {
      void settled.finally(() => release(names, revision));
    }
    timersRef.current.set(
      revision,
      window.setTimeout(() => release(names, revision), HOLD_MS_MAX),
    );
    assert(timersRef.current.size <= HOLDS_MAX, 'useOptimisticEdits: hold timers stay bounded');
  };

  useEffect(() => {
    const heard = (entry: Hold): boolean => entry.release.kind === 'model' && entry.release.model !== props;
    for (const entry of holds.values()) {
      if (heard(entry)) {
        forgetTimer(entry.revision);
      }
    }
    setHolds((previous) => {
      const next = new Map([...previous].filter(([, entry]) => !heard(entry)));
      return next.size === previous.size ? previous : next;
    });
  }, [props, holds, forgetTimer]);

  const setProp: CommitProp = (prop, value, important) => {
    const settled = writes.setProp(prop, value, important);
    const shown = writtenValue(prop, value);
    hold([prop], settled, (revision, until) => ({ kind: 'committed', revision, value: shown, important, selector: writes.selector, release: until }));
  };

  const clearProp = (prop: string | string[]): void => {
    const names = Array.isArray(prop) ? prop : [prop];
    assert(names.length <= HELD_PER_CLEAR_MAX, 'useOptimisticEdits: one clear holds a bounded group');
    const settled = writes.clearProp(prop);
    hold(names, settled, (revision, until) => ({ kind: 'cleared', revision, release: until }));
  };

  const read = (prop: string): ResolvedProp | undefined => {
    const model = props.get(prop);
    const entry = holds.get(prop);
    if (entry === undefined) {
      return model;
    }
    if (entry.release.kind === 'model' && entry.release.model !== props) {
      return model;
    }
    switch (entry.kind) {
      case 'committed':
        return withCommitted(model, { prop, value: entry.value, important: entry.important, selector: entry.selector });
      case 'cleared':
        return withCleared(model);
      default: {
        const exhaustive: never = entry;
        return exhaustive;
      }
    }
  };

  return { read, setProp, clearProp };
}
