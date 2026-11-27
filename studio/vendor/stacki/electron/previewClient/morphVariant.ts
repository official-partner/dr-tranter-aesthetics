
import { assert } from '../../shared/core/assert';
import { parseVariantMessage, VARIANT_HEADER, variantHeaderValue, type VariantOverride } from '../../shared/page/variantOverride';

export const VARIANT_PREVIEW_LIMITS = {
  rendersMax: 32,
  htmlCharsMax: 4_000_000,
  holdMs: 2_500,
} as const;

export interface VariantPreviewHost {
  readonly paint: (html: string) => void;
  readonly restore: () => void;
  readonly supersede?: () => void;
  readonly schedule?: (delayMs: number, run: () => void) => () => void;
}

const timerSchedule = (delayMs: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

export function createVariantPreview(host: VariantPreviewHost) {
  const renders = new Map<string, string>();
  let generation = 0;
  let shown = false;
  let current: string | undefined;
  let endHold: (() => void) | undefined;
  const schedule = host.schedule ?? timerSchedule;
  const dropHold = (): void => {
    endHold?.();
    endHold = undefined;
  };
  let flight: { readonly header: string; readonly abort: AbortController; asked: number } | undefined;
  let waiting: string | undefined;
  const fly = (header: string, landed: () => void): void => {
    assert(flight === undefined, 'variant preview: one render on its way at most');
    const abort = new AbortController();
    const trip = { header, abort, asked: generation };
    flight = trip;
    void fetch(location.href, { cache: 'no-store', headers: { [VARIANT_HEADER]: header }, signal: abort.signal })
      .then((response) => (response.ok ? response.text() : undefined))
      .then((html) => {
        if (html === undefined || html.length > VARIANT_PREVIEW_LIMITS.htmlCharsMax) {
          return;
        }
        if (flight !== trip) {
          return;
        }
        if (renders.size < VARIANT_PREVIEW_LIMITS.rendersMax) {
          renders.set(header, html);
        }
        if (trip.asked === generation) {
          shown = true;
          host.paint(html);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (flight !== trip) {
          return;
        }
        flight = undefined;
        landed();
      });
  };
  const flyWaiting = (): void => {
    const next = waiting;
    waiting = undefined;
    if (next === undefined) {
      return;
    }
    assert(next === current, 'variant preview: only the option on show waits');
    fly(next, flyWaiting);
  };
  const land = (): void => {
    waiting = undefined;
    flight?.abort.abort();
    flight = undefined;
  };

  const end = (): void => {
    dropHold();
    land();
    generation++;
    current = undefined;
    renders.clear();
    if (shown) {
      shown = false;
      host.restore();
    }
  };

  const show = (override: VariantOverride): void => {
    dropHold();
    generation++;
    const header = variantHeaderValue(override);
    current = header;
    const cached = renders.get(header);
    if (cached !== undefined) {
      waiting = undefined;
      shown = true;
      host.paint(cached);
      return;
    }
    if (flight === undefined) {
      fly(header, flyWaiting);
      return;
    }
    if (flight.header === header) {
      flight.asked = generation;
      waiting = undefined;
    } else {
      waiting = header;
    }
    assert(waiting === undefined || waiting === current, 'variant preview: only the option on show waits');
  };

  return {
    receive(data: unknown): boolean {
      const message = parseVariantMessage(data);
      if (message === undefined) {
        return false;
      }
      switch (message.kind) {
        case 'show':
          show(message.override);
          return true;
        case 'cancel':
          end();
          return true;
        case 'commit':
          assert(current !== undefined || !shown, 'a preview on show has its override');
          if (current !== undefined) {
            dropHold();
            host.supersede?.();
            endHold = schedule(VARIANT_PREVIEW_LIMITS.holdMs, () => {
              endHold = undefined;
              end();
            });
          }
          return true;
        default: {
          const exhaustive: never = message;
          return exhaustive;
        }
      }
    },
    headers(): Readonly<Record<string, string>> {
      return current === undefined ? {} : { [VARIANT_HEADER]: current };
    },
    forget(): void {
      renders.clear();
    },
  };
}
