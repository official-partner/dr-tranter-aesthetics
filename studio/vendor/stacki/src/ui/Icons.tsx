import { centralIcon, centralIconSize } from './central/CentralIcon';
import {
  add as centralAdd,
  arrowDown as centralArrowDown,
  arrowLeftRight as centralArrowLeftRight,
  arrowRotateClockwise as centralArrowRotateClockwise,
  asterisk as centralAsterisk,
  audio as centralAudio,
  braces as centralBraces,
  branch as centralBranch,
  bucket as centralBucket,
  calendar as centralCalendar,
  canvas as centralCanvas,
  devices as centralDevices,
  check as centralCheck,
  chevronDown as centralChevronDown,
  chevronLeft as centralChevronLeft,
  chevronRight as centralChevronRight,
  clock as centralClock,
  close as centralClose,
  code as centralCode,
  collapse as centralCollapse,
  collapseVertical as centralCollapseVertical,
  collection as centralCollection,
  comment as centralComment,
  cube as centralCube,
  marketplace as centralMarketplace,
  componentAdd as centralComponentAdd,
  componentEdit as centralComponentEdit,
  copy as centralCopy,
  corner as centralCorner,
  database as centralDatabase,
  macbookAir as centralMacbookAir,
  smartwatch1 as centralSmartwatch,
  studioDisplayXdr as centralStudioDisplayXdr,
  television as centralTelevision,
  studioDisplay as centralStudioDisplay,
  drag as centralDrag,
  droplet as centralDroplet,
  ease as centralEase,
  edit as centralEdit,
  expand as centralExpand,
  expandVertical as centralExpandVertical,
  external as centralExternal,
  eye as centralEye,
  eyeOff as centralEyeOff,
  file as centralFile,
  filter as centralFilter,
  folder as centralFolder,
  folderAdd as centralFolderAdd,
  folderOpen as centralFolderOpen,
  microphone as centralMicrophone,
  guide as centralGuide,
  help as centralHelp,
  history as centralHistory,
  image as centralImage,
  layers as centralLayers,
  layout as centralLayout,
  lock as centralLock,
  plug as centralPlug,
  barsThree as centralBarsThree,
  mail as centralMail,
  mapPin as centralMapPin,
  merge as centralMerge,
  more as centralMore,
  number as centralNumber,
  panelRight as centralPanelRight,
  paperclip as centralPaperclip,
  paragraph as centralParagraph,
  fileText as centralFileText,
  robot as centralRobot,
  phone as centralPhone,
  phoneCall as centralPhoneCall,
  pin as centralPin,
  play as centralPlay,
  properties as centralProperties,
  repeat as centralRepeat,
  search as centralSearch,
  moveFolder as centralMoveFolder,
  roles as centralRoles,
  settings as centralSettings,
  target as centralTarget,
  sort as centralSort,
  layoutGridTwo as centralLayoutGridTwo,
  listMenu as centralListMenu,
  textBlock as centralTextBlock,
  sparkle as centralSparkle,
  sync as centralSync,
  tablet as centralTablet,
  terminal as centralTerminal,
  text as centralText,
  textSize as centralTextSize,
  toggle as centralToggle,
  trashCanSimple as centralTrashCanSimple,
  undo as centralUndo,
  unlink as centralUnlink,
  upload as centralUpload,
  styles as centralStyles,
  variables as centralVariables,
  warning as centralWarning,
  documentSparkle as centralDocumentSparkle,
} from './central/centralGeometry';
import { type IconProps, ASTRO_ASSET_ACCENT, I, I24 } from './IconBase';
import * as paths from './iconPaths';
export {
  ElementComponentIcon,
  ElementSlotIcon,
  CustomElementIcon,
  ElementDivIcon,
  ElementImageIcon,
  ElementSectionIcon,
  ElementListDefaultIcon,
  ElementListItemIcon,
  ElementLinkIcon,
  ElementHeading1Icon,
  ElementHeading2Icon,
  ElementHeading3Icon,
  ElementHeading4Icon,
  ElementHeading5Icon,
  ElementHeading6Icon,
  ElementVideoIcon,
  ElementFormBlockIcon,
  ElementInputIcon,
  ElementSelectIcon,
  ElementButtonIcon,
  HomeIcon,
  elementIcon,
} from './ElementIcons';

export { type IconProps, ASTRO_ASSET_ACCENT } from './IconBase';

export const ComponentEditIcon = centralIcon(centralComponentEdit);

export const GitHubIcon = (props: IconProps) => (
  <I24 {...props}>
    <path fill="currentColor" d={paths.githubIconPath} />
  </I24>
);

export const GoogleIcon = (props: IconProps) => (
  <I24 {...props}>
    <path fill="currentColor" d={paths.googleIconPath} />
  </I24>
);

export const SanityIcon = (props: IconProps) => (
  <I24 {...props}>
    <path fill="currentColor" d={paths.sanityIconPath} />
  </I24>
);

export const PayloadIcon = (props: IconProps) => (
  <I24 {...props}>
    <path fill="currentColor" d={paths.payloadIconPath} />
  </I24>
);

export const EmDashIcon = (props: IconProps) => (
  <I24 {...props}>
    <g fill="currentColor" transform={`scale(${24 / paths.EMDASH_GRID_UNITS})`}>
      <path d={paths.emDashFramePath} />
      <path d={paths.emDashDashPath} />
    </g>
  </I24>
);

export const CloudflareIcon = (props: IconProps) => (
  <I24 {...props}>
    <path fill="currentColor" d="M16.9 18.5H6.6a4.1 4.1 0 0 1-.7-8.15 5.9 5.9 0 0 1 11.2-1.6 4.9 4.9 0 0 1-.2 9.75Z" />
  </I24>
);

export const BunnyIcon = (props: IconProps) => (
  <I24 {...props}>
    <g fill="currentColor">
      <ellipse cx="8.8" cy="6.6" rx="2" ry="4.9" transform="rotate(-12 8.8 6.6)" />
      <ellipse cx="15.2" cy="6.6" rx="2" ry="4.9" transform="rotate(12 15.2 6.6)" />
      <circle cx="12" cy="15.4" r="6.1" />
    </g>
  </I24>
);

export const BucketIcon = centralIcon(centralBucket);

export const AudioFileIcon = centralIcon(centralAudio);

export const LumosIcon = ({ size = 16, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 123 120"
    fill="currentColor"
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style, pointerEvents: 'none' }}
    aria-hidden="true"
  >
    <path d={paths.lumosIconPath} />
  </svg>
);

export const AstroIcon = ({ size = 16, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 370 467"
    fill="currentColor"
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style, pointerEvents: 'none' }}
    aria-hidden="true"
  >
    <path d={paths.astroIconFlamePath} />
    <path d={paths.astroIconLetterPath} />
  </svg>
);

export const FileIcon = centralIcon(centralFile);

export const InstructionsIcon = centralIcon(centralFileText);

export const AgentIcon = centralIcon(centralRobot);

export const SkillIcon = centralIcon(centralDocumentSparkle);

export const EaseIcon = centralIcon(centralEase);

export const ComponentIcon = centralIcon(centralCube);

export const GuideIcon = centralIcon(centralGuide);

export const LayoutIcon = centralIcon(centralLayout);

function mirroredInRightToLeft(Icon: ReturnType<typeof centralIcon>): ReturnType<typeof centralIcon> {
  return function MirroredIcon(props: IconProps & { readonly title?: string }) {
    const className = props.className === undefined ? 'icon-mirror-rtl' : `icon-mirror-rtl ${props.className}`;
    return <Icon {...props} className={className} />;
  };
}

export const PanelRightIcon = mirroredInRightToLeft(centralIcon(centralPanelRight));

export const TextIcon = centralIcon(centralText);

export const CommentIcon = centralIcon(centralComment);

export const CodeIcon = centralIcon(centralCode);

export const PseudoElementIcon = (props: IconProps) => (
  <I {...props}>
    <path d="M5.5 5.25h.01M5.5 10.75h.01M10.5 5.25h.01M10.5 10.75h.01" strokeWidth={2.4} />
  </I>
);

export const PencilIcon = centralIcon(centralEdit);

export const TagIcon = centralIcon(centralCode);

export const ChevronLeftIcon = mirroredInRightToLeft(centralIcon(centralChevronLeft));

export const ChevronRightIcon = mirroredInRightToLeft(centralIcon(centralChevronRight));

export const PinIcon = centralIcon(centralPin);

export const ChevronDownIcon = centralIcon(centralChevronDown);

export const PlusIcon = centralIcon(centralAdd);

export const RefreshIcon = centralIcon(centralArrowRotateClockwise);

export const SyncIcon = centralIcon(centralSync);

export const CloseIcon = centralIcon(centralClose);

export const ComponentPropertiesIcon = centralIcon(centralProperties);

export const VariableTextSizeIcon = centralIcon(centralTextSize);

export const FieldNumberIcon = centralIcon(centralNumber);

export const ComponentPlusIcon = centralIcon(centralComponentAdd);

export const ExpandVerticalIcon = centralIcon(centralExpandVertical);

export const CollapseVerticalIcon = centralIcon(centralCollapseVertical);

export const RepeatIcon = centralIcon(centralRepeat);

export const PreviewIcon = centralIcon(centralEye);

export const LockIcon = centralIcon(centralLock);
export const PlugIcon = centralIcon(centralPlug);

export const PlayIcon = centralIcon(centralPlay);

export const FolderIcon = centralIcon(centralFolder);

export const FolderDefaultIcon = centralIcon(centralFolder);

export const CollectionIcon = centralIcon(centralCollection);

export const FolderPlusIcon = centralIcon(centralFolderAdd);

export const UploadCloudIcon = centralIcon(centralUpload);

export const BracesIcon = centralIcon(centralBraces);

export const ResetIcon = centralIcon(centralUndo);

export const DragIcon = centralIcon(centralDrag);

export const HideIcon = centralIcon(centralEyeOff);

export const RequiredIcon = centralIcon(centralAsterisk);

export const PointerEventsNoneIcon = (props: IconProps) => (
  <I {...props} size={centralIconSize(props.size ?? 16)} strokeWidth={1}>
    <path d="M8.6 5.3 3 3l2.3 5.6m5.5-2.4 2.7 1.1-4.8 1.4-1.4 4.8-1.1-2.7M2.5 13.5l11-11" />
  </I>
);

export const CheckIcon = centralIcon(centralCheck);
export const MicrophoneIcon = centralIcon(centralMicrophone);

export const CornerIcon = centralIcon(centralCorner);

export const BranchIcon = centralIcon(centralBranch);

export const HistoryIcon = centralIcon(centralHistory);

export const MergeIcon = centralIcon(centralMerge);

export const ExternalIcon = centralIcon(centralExternal);

export const MaximizeIcon = centralIcon(centralExpand);

export const MinimizeIcon = centralIcon(centralCollapse);

export const DesktopIcon = centralIcon(centralStudioDisplay);

export const LaptopIcon = centralIcon(centralMacbookAir);

export const StudioDisplayXdrIcon = centralIcon(centralStudioDisplayXdr);

export const SmartwatchIcon = centralIcon(centralSmartwatch);

export const TelevisionIcon = centralIcon(centralTelevision);

export const TabletIcon = centralIcon(centralTablet);

export const PhoneIcon = centralIcon(centralPhone);

export const AssetManagerIcon = centralIcon(centralImage, 20);

export const CmsIcon = centralIcon(centralDatabase, 20);

export const AppsIcon = centralIcon(centralMarketplace, 20);

export const StackiMarkIcon = ({ size = 16, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 458 458"
    fill="none"
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path d={paths.stackiMarkPath} fill="currentColor" />
  </svg>
);

export const PagePanelIcon = centralIcon(centralFile, 20);

export const NavigatorIcon = centralIcon(centralBarsThree, 20);

export const ComponentFillIcon = centralIcon(centralCube, 20);

export const LayersIcon = centralIcon(centralLayers);

export const CanvasIcon = centralIcon(centralCanvas);

export const AllBreakpointsIcon = centralIcon(centralDevices);

export const MoreIcon = centralIcon(centralMore);

export const CopyIcon = centralIcon(centralCopy);


export const ParagraphIcon = centralIcon(centralParagraph);

export const SwitchIcon = centralIcon(centralToggle);

export const CalendarIcon = centralIcon(centralCalendar);

export const ClockIcon = centralIcon(centralClock);

export const MapPinIcon = centralIcon(centralMapPin);

export const PaperclipIcon = centralIcon(centralPaperclip);

export const MailIcon = centralIcon(centralMail);

export const PhoneCallIcon = centralIcon(centralPhoneCall);

export const DropletIcon = centralIcon(centralDroplet);

export const HelpCircleIcon = centralIcon(centralHelp);

export const WarningTriangleIcon = centralIcon(centralWarning);

export const GearIcon = centralIcon(centralSettings);
export const MoveFolderIcon = centralIcon(centralMoveFolder);
export const TargetIcon = centralIcon(centralTarget);
export const UsersIcon = centralIcon(centralRoles);

export const TrashIcon = centralIcon(centralTrashCanSimple);

export const FolderOpenIcon = centralIcon(centralFolderOpen);

export const SparkleIcon = centralIcon(centralSparkle);

export const UploadIcon = centralIcon(centralUpload);

export const SearchIcon = centralIcon(centralSearch);

export const FilterIcon = centralIcon(centralFilter);

export const SortIcon = centralIcon(centralSort);

export const GridViewIcon = centralIcon(centralLayoutGridTwo);
export const ListViewIcon = centralIcon(centralTextBlock);
export const CompactListViewIcon = centralIcon(centralListMenu);

export const UnlinkIcon = centralIcon(centralUnlink);

export const TerminalIcon = centralIcon(centralTerminal);

export const ArrowDownIcon = centralIcon(centralArrowDown);
export const ReplaceIcon = centralIcon(centralArrowLeftRight);

const AstroImageIcon = centralIcon(centralImage);
const AstroPictureIcon = centralIcon(centralLayers);

export function astroAssetIcon(name: unknown, size = 16, className?: string, tint: 'astro' | 'inherit' = 'astro') {
  const Icon = name === 'Picture' ? AstroPictureIcon : AstroImageIcon;
  return <Icon size={size} className={className} style={tint === 'astro' ? { color: ASTRO_ASSET_ACCENT } : undefined} />;
}

export const FieldSwitchIcon = centralIcon(centralToggle);

export const VariableIcon = centralIcon(centralVariables, 20);
export const PaintBrushIcon = centralIcon(centralStyles, 20);
