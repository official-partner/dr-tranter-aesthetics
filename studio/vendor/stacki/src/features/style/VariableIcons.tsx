import { centralIcon } from '../../ui/central/CentralIcon';
import {
  add as centralAdd,
  check as centralCheck,
  chevronRight as centralChevronRight,
  droplet as centralDroplet,
  font as centralFont,
  number as centralNumber,
  pieChartOne as centralPieChartOne,
  ruler as centralRuler,
} from '../../ui/central/centralGeometry';

export const CheckIcon = centralIcon(centralCheck);


export const PlusIcon = centralIcon(centralAdd);

export const ColorTypeIcon = centralIcon(centralDroplet);
export const NumberTypeIcon = centralIcon(centralNumber);
export const PercentageTypeIcon = centralIcon(centralPieChartOne);
export const FontFamilyTypeIcon = centralIcon(centralFont);
export const SizeTypeIcon = centralIcon(centralRuler);
export function VariableTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'Color':
      return <ColorTypeIcon />;
    case 'Number':
      return <NumberTypeIcon />;
    case 'Percentage':
      return <PercentageTypeIcon />;
    case 'FontFamily':
      return <FontFamilyTypeIcon />;
    default:
      return <SizeTypeIcon />;
  }
}
export const ChevronRightIcon = centralIcon(centralChevronRight);
