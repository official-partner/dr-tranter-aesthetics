import { prefetchAstroHighlighter } from '../../ui/astroHighlight';
import { prewarmVariables } from '../../features/variables/variableCache';
import { prewarmCmsCatalog, prewarmCmsConnections } from '../../features/cms/cmsCatalog';
import { prewarmAssetListing } from '../../features/assets/assetListingCache';
import { prewarmTimeline } from '../../features/history/timelineCache';
import { assert } from '../../../shared/core/assert';

const PREFETCH_DELAY_MS = 1_500;
export const PREFETCH_HOST_READS_MAX = 6;
const PREFETCH_STEPS_MAX = 6 + PREFETCH_HOST_READS_MAX;
const IDLE_WAIT_MS_MAX = 2_000;

export interface PanelPrefetch {
  readonly projectPath: string;
  readonly preloadChunks: (() => Promise<void>) | undefined;
  readonly hostReads: ReadonlyArray<() => Promise<void>>;
}

export function prefetchPanels({ projectPath, preloadChunks, hostReads }: PanelPrefetch): () => void {
  assert(projectPath.length > 0, 'prefetchPanels: a project is open');
  assert(hostReads.length <= PREFETCH_HOST_READS_MAX, 'prefetchPanels: the host reads are bounded');
  let active = true;
  const steps: ReadonlyArray<() => Promise<void>> = [
    ...(preloadChunks === undefined ? [] : [preloadChunks]),
    prefetchAstroHighlighter,
    () => prewarmVariables(projectPath),
    () => prewarmAssetListing(projectPath),
    () => prewarmCmsCatalog(projectPath),
    () => prewarmCmsConnections(projectPath),
    ...hostReads,
  ];
  assert(steps.length <= PREFETCH_STEPS_MAX, 'prefetchPanels: the pass is bounded');
  const timer = setTimeout(() => {
    void runSteps(steps, () => active);
  }, PREFETCH_DELAY_MS);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

export function prefetchTimeline(projectPath: string, branch: string | undefined, head: string | undefined): () => void {
  assert(projectPath.length > 0, 'prefetchTimeline: a project is open');
  let active = true;
  const timer = setTimeout(() => {
    void runSteps([() => prewarmTimeline(projectPath, branch, head)], () => active);
  }, PREFETCH_DELAY_MS);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

async function runSteps(steps: ReadonlyArray<() => Promise<void>>, isActive: () => boolean): Promise<void> {
  assert(steps.length > 0, 'prefetch: there is something to fetch');
  for (const step of steps) {
    await idleMoment();
    if (!isActive()) {
      return;
    }
    try {
      await step();
    } catch (error: unknown) {
      console.warn('Panel prefetch failed', error);
    }
  }
}

function idleMoment(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: IDLE_WAIT_MS_MAX });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
