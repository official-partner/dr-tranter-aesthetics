
import { createLiveValue } from '../../ui/liveValue';

const refreshes = createLiveValue<number>(0);
const COUNT_WRAP = 1_000_000;

export function requestCanvasTextRefresh(): void {
  refreshes.set((refreshes.get() + 1) % COUNT_WRAP);
}

export function onCanvasTextRefresh(listener: () => void): () => void {
  return refreshes.subscribe(listener);
}
