import type { Breakpoint, ResolvedBreakpoint } from '../../../shared/properties/projectBreakpoints';
import { activeDeviceFor, deviceForWidth, iconFor, type DeviceIconKind } from '../../../shared/properties/breakpointIcon';

export { activeDeviceFor, deviceForWidth, iconFor, type DeviceIconKind };

export type PreviewDevice = string;

export interface BarDevice {
  readonly key: PreviewDevice;
  readonly icon: DeviceIconKind;
  readonly breakpoint: ResolvedBreakpoint | undefined;
}

export const SHORTCUTS_MAX = 9;

export function barDevices(resolved: readonly ResolvedBreakpoint[]): readonly BarDevice[] {
  const device = (breakpoint: ResolvedBreakpoint): BarDevice => ({ key: breakpoint.id, icon: iconFor(breakpoint, resolved), breakpoint });
  return [
    ...resolved.filter((breakpoint) => breakpoint.direction === 'up').map(device),
    { key: 'desktop', icon: 'desktop', breakpoint: undefined },
    ...resolved.filter((breakpoint) => breakpoint.direction === 'down').map(device),
    { key: 'canvas', icon: 'canvas', breakpoint: undefined },
  ];
}

export function deviceWidth(device: PreviewDevice, resolved: readonly ResolvedBreakpoint[]): number | undefined {
  return resolved.find((breakpoint) => breakpoint.id === device)?.widthPx;
}

export function deviceForShortcut(key: string, resolved: readonly ResolvedBreakpoint[]): PreviewDevice | undefined {
  if (!/^[1-9]$/.test(key)) {
    return undefined;
  }
  return barDevices(resolved)[Number(key) - 1]?.key;
}

export function shortcutOf(device: BarDevice, devices: readonly BarDevice[]): number | undefined {
  const position = devices.findIndex((other) => other.key === device.key) + 1;
  return position >= 1 && position <= SHORTCUTS_MAX ? position : undefined;
}

export type BreakpointNameSource = Pick<Breakpoint, 'id' | 'name'>;
