import type { ReactNode } from 'react';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { ruler as centralRuler } from '../../../ui/central/centralGeometry';
import { DesktopIcon, LaptopIcon, PhoneIcon, SmartwatchIcon, StudioDisplayXdrIcon, TabletIcon, TelevisionIcon } from '../../../ui/Icons';
import type { DeviceIconKind } from '../../../../shared/properties/breakpointIcon';

export const WidthIcon = centralIcon(centralRuler);

const DEVICE_ICONS: Readonly<Record<DeviceIconKind, () => ReactNode>> = {
  desktop: () => <DesktopIcon />,
  laptop: () => <LaptopIcon />,
  tablet: () => <TabletIcon />,
  phone: () => <PhoneIcon />,
  studioDisplayXdr: () => <StudioDisplayXdrIcon />,
  television: () => <TelevisionIcon />,
  smartwatch: () => <SmartwatchIcon />,
  canvas: () => <DesktopIcon />,
};
export const deviceIcon = (kind: DeviceIconKind): ReactNode => DEVICE_ICONS[kind]();
