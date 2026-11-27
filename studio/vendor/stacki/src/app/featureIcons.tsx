import { centralIcon } from '../ui/central/CentralIcon';
import { gauge as centralGauge, roles as centralRoles, codeBrackets as centralCodeBrackets } from '../ui/central/centralGeometry';
import type { ComponentType } from 'react';
import type { IconProps } from '../ui/IconBase';
import {
  AppsIcon,
  AssetManagerIcon,
  BracesIcon,
  CmsIcon,
  ComponentEditIcon,
  ComponentFillIcon,
  DropletIcon,
  FolderIcon,
  GearIcon,
  GitHubIcon,
  HistoryIcon,
  AllBreakpointsIcon,
  InstructionsIcon,
  LayoutIcon,
  MoreIcon,
  NavigatorIcon,
  PagePanelIcon,
  PencilIcon,
  PlusIcon,
  SparkleIcon,
  StackiMarkIcon,
  TrashIcon,
  UploadCloudIcon,
  VariableIcon,
} from '../ui/Icons';
import { PropertiesIcon } from '../features/componentProperties/PropertiesIcon';
import { StyleSelectorsIcon } from '../features/selectors/SelectorIcons';
import { MarketplaceIcon, MarketplaceInstallIcon } from '../features/apps/marketplace/MarketplaceIcons';
import { APP_ACCESS_ALL, type StaticAccessFeature } from '../../shared/properties/projectRoles';
export type FeatureIconComponent = ComponentType<Pick<IconProps, 'size'>>;

const RolesIcon = centralIcon(centralRoles);

export const AuditsIcon = centralIcon(centralGauge, 20);

const RailCodeIcon = centralIcon(centralCodeBrackets, 20);

export const FEATURE_ICONS: Readonly<Record<StaticAccessFeature, FeatureIconComponent>> = {
  'panel:elements': PlusIcon,
  'panel:pages': PagePanelIcon,
  'panel:navigator': NavigatorIcon,
  'panel:properties': PropertiesIcon,
  'panel:components': ComponentFillIcon,
  'panel:assets': AssetManagerIcon,
  'panel:cms': CmsIcon,
  'panel:variables': VariableIcon,
  'panel:selectors': StyleSelectorsIcon,
  'panel:code': RailCodeIcon,
  'panel:history': HistoryIcon,
  'panel:apps': AppsIcon,
  'panel:ai': SparkleIcon,
  'panel:instructions': InstructionsIcon,
  'panel:audits': AuditsIcon,
  'panel:projectSettings': GearIcon,
  'panel:style': DropletIcon,
  'panel:settings': GearIcon,
  'page:create': PlusIcon,
  'page:delete': TrashIcon,
  'page:rename': PencilIcon,
  'page:layout': LayoutIcon,
  'component:create': ComponentFillIcon,
  'component:edit': ComponentEditIcon,
  'code:edit': BracesIcon,
  'instructions:edit': PencilIcon,
  publish: UploadCloudIcon,
  'marketplace:view': MarketplaceIcon,
  'marketplace:install': MarketplaceInstallIcon,
  'marketplace:publish': UploadCloudIcon,
  'apps:share': GitHubIcon,
  'settings:editor': GearIcon,
  'settings:folders': FolderIcon,
  'settings:cms': CmsIcon,
  'settings:studio': StackiMarkIcon,
  'settings:instructions': InstructionsIcon,
  'settings:audits': AuditsIcon,
  'settings:breakpoints': AllBreakpointsIcon,
  'settings:roles': RolesIcon,
  'cli:read': RailCodeIcon,
  'cli:config': GearIcon,
  'cli:guides': GearIcon,
  'cli:breakpoints': AllBreakpointsIcon,
  'cli:folders': FolderIcon,
  'cli:components': ComponentFillIcon,
  'cli:apps': AppsIcon,
  'cli:roles': RolesIcon,
};

export const RailMoreIcon: FeatureIconComponent = MoreIcon;

export const APP_GRANT_ICON: FeatureIconComponent = FEATURE_ICONS['panel:apps'];

export function FeatureIcon(props: { readonly feature: StaticAccessFeature | typeof APP_ACCESS_ALL; readonly size: number }) {
  const Icon = props.feature === APP_ACCESS_ALL ? APP_GRANT_ICON : FEATURE_ICONS[props.feature];
  return <Icon size={props.size} />;
}
