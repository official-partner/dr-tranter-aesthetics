import { assert } from '../../shared/core/assert';

export interface CoalescedRun<T> {
  readonly request: () => Promise<T>;
  readonly superseded: () => boolean;
}

interface Waiting<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

type Phase<T> = { readonly tag: 'idle' } | { readonly tag: 'running'; readonly waiting: Waiting<T> | undefined };

export function createCoalescedRun<T>(run: () => Promise<T>): CoalescedRun<T> {
  let phase: Phase<T> = { tag: 'idle' };
  // eslint-disable-next-line stacki/bounded-recursion -- promise re-entry, not recursion
  const start = (answer: Waiting<T>): void => {
    phase = { tag: 'running', waiting: undefined };
    void Promise.resolve()
      .then(run)
      .then(answer.resolve, answer.reject)
      .finally(() => {
        assert(phase.tag === 'running', 'Only a started run ends');
        const next = phase.waiting;
        if (next === undefined) {
          phase = { tag: 'idle' };
        } else {
          start(next);
        }
      });
  };
  return {
    request: () => {
      if (phase.tag === 'idle') {
        const answer = waiting<T>();
        start(answer);
        return answer.promise;
      }
      const next = phase.waiting ?? waiting<T>();
      phase = { tag: 'running', waiting: next };
      assert(phase.waiting === next, 'A request joins the one waiting run');
      return next.promise;
    },
    superseded: () => phase.tag === 'running' && phase.waiting !== undefined,
  };
}

function waiting<T>(): Waiting<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  assert(resolve !== undefined, 'The executor ran synchronously');
  assert(reject !== undefined, 'The executor ran synchronously');
  return { promise, resolve, reject };
}
