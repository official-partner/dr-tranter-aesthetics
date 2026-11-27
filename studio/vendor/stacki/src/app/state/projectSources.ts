
import { useEffect, useMemo, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { isPickerShown, type ProjectFolders } from '../../../shared/properties/projectFolders';
import { readCmsFiles, readContentCollections } from '../../features/cms/cmsPanelBridge';
import { readContentEntries } from '../../features/content/contentViewBridge';
import { readProjectFolderSettings } from '../../ipc/projectFolderSettings';
import { cmsTransport } from '../../ipc/editorEnvironment';
import type { ImportLike } from '../../editor/dataSource';
import { entrySampleKey, type TreeNode } from '../../editor/dataSample';
import {
  aliasProbeFor,
  dataFileExports,
  importedProjectData,
  projectSourceNodes,
  type DataFileExport,
  type ImportStyle,
} from '../../features/props/projectDataSources';

export const PROJECT_SOURCES_CHANGED = 'stacki:project-sources-changed';

export function notifyProjectSourcesChanged(): void {
  window.dispatchEvent(new Event(PROJECT_SOURCES_CHANGED));
}

export interface ProjectSourcesHost {
  readonly projectPath: string | undefined;
  readonly file: string | undefined;
  readonly frontmatter: string;
  readonly imports: readonly ImportLike[];
  readonly resolveSpec: (spec: string) => Promise<string | undefined>;
}

export interface ProjectSources {
  readonly nodes: readonly TreeNode[];
  readonly imported: Readonly<Record<string, string>>;
  readonly config: ProjectFolders | undefined;
}

interface Catalog {
  readonly key: string;
  readonly exports: readonly DataFileExport[];
  readonly config: ProjectFolders | undefined;
}

const NO_EXPORTS: readonly DataFileExport[] = [];

export function useProjectSources(host: ProjectSourcesHost): ProjectSources {
  const catalog = useCatalog(host.projectPath);
  const style = useImportStyle(host, catalog?.exports ?? NO_EXPORTS);
  const { file, frontmatter, imports } = host;
  const exports = catalog?.exports ?? NO_EXPORTS;
  const config = catalog?.config;
  const nodes = useMemo(() => projectSourceNodes({ exports, config, style, file, frontmatter, imports }), [exports, config, style, file, frontmatter, imports]);
  const imported = useMemo(() => importedProjectData({ exports, file, imports }), [exports, file, imports]);
  return { nodes, imported, config };
}

export function shownPickerCollections<T extends { readonly name: string }>(collections: readonly T[], config: ProjectFolders | undefined): readonly T[] {
  const shown = collections.filter((collection) => isPickerShown(config, { kind: 'collection', name: collection.name }));
  assert(shown.length <= collections.length, 'shownPickerCollections: leaving out only removes');
  return shown;
}

function useCatalog(projectPath: string | undefined): Catalog | undefined {
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((current) => current + 1);
    const stopCms = cmsTransport.onCmsChanged(bump);
    window.addEventListener(PROJECT_SOURCES_CHANGED, bump);
    return () => {
      stopCms();
      window.removeEventListener(PROJECT_SOURCES_CHANGED, bump);
    };
  }, []);
  useEffect(() => {
    if (projectPath === undefined || projectPath === '') {
      return undefined;
    }
    let live = true;
    const settings = readProjectFolderSettings(projectPath).catch((): undefined => undefined);
    const catalog = readCmsFiles(projectPath)
      .then((files) => (files.ok ? dataFileExports(files.value) : NO_EXPORTS))
      .catch(() => NO_EXPORTS);
    void Promise.all([catalog, settings]).then(([exports, config]) => {
      if (live) {
        setCatalog({ key: projectPath, exports, config });
      }
    });
    return () => {
      live = false;
    };
  }, [projectPath, version]);
  return catalog?.key === projectPath ? catalog : undefined;
}

function useImportStyle(host: ProjectSourcesHost, exports: readonly DataFileExport[]): ImportStyle {
  const target = exports[0]?.file;
  const probe = target === undefined ? undefined : aliasProbeFor(target);
  const key = JSON.stringify([host.projectPath ?? '', host.file ?? '', probe ?? '']);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly style: ImportStyle } | undefined>(undefined);
  const { resolveSpec } = host;
  useEffect(() => {
    if (probe === undefined || target === undefined || host.file === undefined) {
      return undefined;
    }
    let live = true;
    void resolveSpec(probe)
      .catch((): undefined => undefined)
      .then((resolved) => {
        if (live) {
          setAnswer({ key, style: resolved === target ? { kind: 'alias' } : { kind: 'relative' } });
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the project, the file and the probe; the resolver is new on every render.
  }, [key]);
  return answer?.key === key ? answer.style : RELATIVE;
}

const RELATIVE: ImportStyle = { kind: 'relative' };

export interface FileCollections {
  readonly collections: readonly { readonly name: string; readonly count: number }[];
  readonly samples: Record<string, unknown>;
  readonly requestSample: (collection: string, index?: number) => void;
}

const FILE_SAMPLES_MAX = 512;

export function useFileCollections(projectPath: string | undefined): FileCollections {
  const [collections, setCollections] = useState<FileCollections['collections']>([]);
  const [samples, setSamples] = useState<Record<string, unknown>>({});
  const [asked] = useState(() => new Set<string>());
  useEffect(() => {
    if (projectPath === undefined) {
      return undefined;
    }
    let live = true;
    void readContentCollections(projectPath)
      .then((content) => {
        if (live && content.ok) {
          setCollections(content.value.collections.map((collection) => ({ name: collection.name, count: collection.count })));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectPath]);
  const requestSample = (collection: string, index?: number): void => {
    const key = index === undefined ? collection : entrySampleKey(collection, index);
    if (projectPath === undefined || asked.has(key) || asked.size >= FILE_SAMPLES_MAX) {
      return;
    }
    asked.add(key);
    void readContentEntries(projectPath, collection)
      .then((read) => (read.ok ? read.value.entries[index ?? 0] : undefined))
      .catch(() => undefined)
      .then((entry) => {
        if (entry === undefined) {
          asked.delete(key);
          return;
        }
        setSamples((previous) => ({ ...previous, [key]: { id: entry.id, collection, data: entry.data } }));
      });
  };
  return { collections, samples, requestSample };
}
