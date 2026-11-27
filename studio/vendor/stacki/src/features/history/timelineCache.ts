import { createPanelCache, prewarmPanelCache } from '../../lib/usePanelData';
import { readHistoryLog, type HistoryLog } from './historyBridge';

export const timelineCache = createPanelCache<HistoryLog>();

export function timelineKey(projectPath: string, branch: string | undefined, head: string | undefined, reference: string | undefined): string {
  return JSON.stringify([projectPath, branch, head, reference]);
}

export function prewarmTimeline(projectPath: string, branch: string | undefined, head: string | undefined): Promise<void> {
  return prewarmPanelCache(timelineCache, timelineKey(projectPath, branch, head, undefined), () => readHistoryLog(projectPath, 0));
}
