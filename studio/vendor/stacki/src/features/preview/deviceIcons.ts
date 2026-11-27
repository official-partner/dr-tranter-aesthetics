import type { ComponentType } from 'react';
import type { IconProps } from '../../ui/Icons';
import { AllBreakpointsIcon, DesktopIcon, LaptopIcon, PhoneIcon, SmartwatchIcon, StudioDisplayXdrIcon, TabletIcon, TelevisionIcon } from '../../ui/Icons';
import type { DeviceIconKind } from './breakpointDevices';

const DEVICE_ICONS: Readonly<Record<DeviceIconKind, ComponentType<IconProps>>> = {
  desktop: DesktopIcon,
  laptop: LaptopIcon,
  tablet: TabletIcon,
  phone: PhoneIcon,
  studioDisplayXdr: StudioDisplayXdrIcon,
  television: TelevisionIcon,
  smartwatch: SmartwatchIcon,
  canvas: AllBreakpointsIcon,
};

export function deviceIconComponent(kind: DeviceIconKind): ComponentType<IconProps> {
  return DEVICE_ICONS[kind];
}
