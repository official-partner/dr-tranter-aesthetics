import { assert } from '../core/assert';
import { BREAKPOINT_DEFAULTS, BREAKPOINT_LIMITS, type ResolvedBreakpoint } from './projectBreakpoints';

export type DeviceIconKind = 'desktop' | 'laptop' | 'tablet' | 'phone' | 'studioDisplayXdr' | 'television' | 'smartwatch' | 'canvas';

const FIXED_WIDTH_ICONS: ReadonlyArray<{ readonly minWidthPx: number; readonly icon: DeviceIconKind }> = [
  { minWidthPx: 895, icon: 'laptop' },
  { minWidthPx: 623, icon: 'tablet' },
  { minWidthPx: 0, icon: 'phone' },
];

export function iconFor(breakpoint: ResolvedBreakpoint, resolved: readonly ResolvedBreakpoint[]): DeviceIconKind {
  if (breakpoint.direction === 'up') {
    const ups = resolved.filter((other) => other.direction === 'up');
    const closest = ups[ups.length - 1];
    return closest !== undefined && closest.id === breakpoint.id ? 'studioDisplayXdr' : 'television';
  }
  if (breakpoint.id === 'laptop' || breakpoint.id === 'tablet' || breakpoint.id === 'phone') {
    return breakpoint.id;
  }
  const phone = resolved.find((other) => other.id === 'phone');
  const phoneWidthPx = phone?.widthPx ?? BREAKPOINT_DEFAULTS.find((other) => other.id === 'phone')?.widthPx ?? 479;
  if (breakpoint.widthPx < phoneWidthPx) {
    return 'smartwatch';
  }
  return FIXED_WIDTH_ICONS.find((entry) => breakpoint.widthPx >= entry.minWidthPx)?.icon ?? 'phone';
}


export function deviceForWidth(px: number, resolved: readonly ResolvedBreakpoint[]): string | undefined {
  assert(resolved.length <= BREAKPOINT_LIMITS.countMax, 'deviceForWidth: the breakpoint list is within its bound');
  if (!Number.isFinite(px) || px <= 0) {
    return undefined;
  }
  for (const breakpoint of resolved) {
    if (breakpoint.direction === 'up' && px >= breakpoint.widthPx) {
      return breakpoint.id;
    }
  }
  const downs = resolved.filter((breakpoint) => breakpoint.direction === 'down');
  for (const breakpoint of [...downs].reverse()) {
    if (px <= breakpoint.widthPx) {
      return breakpoint.id;
    }
  }
  return 'desktop';
}

export function activeDeviceFor(device: string, widthPx: number, resolved: readonly ResolvedBreakpoint[]): string {
  assert(device.length > 0, 'activeDeviceFor: a device is named');
  if (device === 'canvas') {
    return device;
  }
  return deviceForWidth(widthPx, resolved) ?? device;
}

export function deviceIconOf(device: string, resolved: readonly ResolvedBreakpoint[]): DeviceIconKind | undefined {
  if (device === 'desktop' || device === 'canvas') {
    return device;
  }
  assert(resolved.length <= BREAKPOINT_LIMITS.countMax, 'deviceIconOf: the breakpoint list is within its bound');
  const breakpoint = resolved.find((candidate) => candidate.id === device);
  return breakpoint === undefined ? undefined : iconFor(breakpoint, resolved);
}
