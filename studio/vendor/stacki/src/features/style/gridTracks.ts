
export const NEW_COLUMN = 'minmax(0, 1fr)';
export const NEW_ROW = 'auto';

export const repeatTracks = (count: number, cell: string) => `repeat(${Math.max(1, count)}, ${cell})`;

export interface Flow {
  readonly direction: string;
  readonly dense: boolean;
}
export function parseFlow(value: string): Flow {
  const lowered = value.toLowerCase();
  return {
    direction: lowered.includes('column') ? 'column' : 'row',
    dense: lowered.includes('dense'),
  };
}
export const buildFlow = ({ direction, dense }: Flow) => (dense ? `${direction} dense` : direction);

export function isPresetFlow(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized.split(/\s+/).every((token) => token === 'row' || token === 'column' || token === 'dense');
}
