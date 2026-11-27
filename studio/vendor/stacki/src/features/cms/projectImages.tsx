import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WireAssetEntry } from '../../../shared/ipc/ipcResults';
import { isAstroContent, type CmsSource } from '../../../shared/properties/astroContent';
import { useAssetEntries } from '../../ui/AssetField';
import AssetThumb from '../../ui/AssetThumb';
import { ElementImageIcon } from '../../ui/Icons';

type AssetFile = Extract<WireAssetEntry, { readonly isDir: false }>;
const ProjectImages = createContext<ReadonlyMap<string, AssetFile>>(new Map());

export function ProjectImagesScope(props: { readonly projectPath: string; readonly source: CmsSource; readonly children: ReactNode }) {
  if (!isAstroContent(props.source)) {
    return props.children;
  }
  return <ProjectImagesProvider projectPath={props.projectPath}>{props.children}</ProjectImagesProvider>;
}

export function useProjectImage(file: string | undefined): AssetFile | undefined {
  const images = useContext(ProjectImages);
  return file === undefined ? undefined : images.get(file);
}

export const OPTION_IMAGE_MENU = 'option-image-menu';

export function hasOptionImage(options: readonly { readonly imageFile?: string }[]): boolean {
  return options.some((option) => option.imageFile !== undefined);
}

export function OptionImage(props: { readonly file: string | undefined; readonly placeholder: boolean }) {
  const asset = useProjectImage(props.file);
  if (asset !== undefined) {
    return <AssetThumb file={asset} className="option-image" />;
  }
  if (props.placeholder) {
    return (
      <span className="option-image is-placeholder">
        <ElementImageIcon size={12} />
      </span>
    );
  }
  return undefined;
}

function ProjectImagesProvider(props: { readonly projectPath: string; readonly children: ReactNode }) {
  const entries = useAssetEntries(props.projectPath);
  const images = useMemo(() => new Map(entries.filter(isAssetFile).map((entry) => [entry.rel, entry])), [entries]);
  return <ProjectImages.Provider value={images}>{props.children}</ProjectImages.Provider>;
}

function isAssetFile(entry: WireAssetEntry): entry is AssetFile {
  return !entry.isDir;
}
