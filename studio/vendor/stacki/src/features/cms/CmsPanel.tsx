import { usePanelData, type PanelData } from '../../lib/usePanelData';
import { PanelReadStatus } from '../../ui/PanelReadStatus';
import { cmsTransport } from '../../ipc/editorEnvironment';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Collection } from './cmsSchema';
import type { CmsPanelContent, CmsPanelFile } from './cmsPanelBridge';
import { collectionHasContent, collectionOf } from './cmsSchema';
import { createCmsCollection } from './cmsPanelBridge';
import { cmsCache, keptCmsConnections, readCmsCatalog } from './cmsCatalog';
import { assert } from '../../../shared/core/assert';
import { ChevronRightIcon, CmsIcon, FileIcon, FolderDefaultIcon, GearIcon, PlusIcon } from '../../ui/Icons';
import { listCmsConnections } from '../../ipc/cmsConnectionsBridge';
import type { CmsConnection } from '../../../shared/properties/cmsConnections';
import { ASTRO_CONTENT_ID, ASTRO_CONTENT_SOURCE, type CmsSource } from '../../../shared/properties/astroContent';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { RemoteCmsBrowser } from './RemoteCmsBrowser';
import { prefetchConnection } from './remoteCmsCache';
import { ConnectionLogo, type RemoteCmsSelection } from './remoteCmsShared';
import { PanelHeader } from '../../ui/PanelHeader';

interface CmsPanelProps {
  readonly project: { readonly path: string };
  readonly selectedRel: string | undefined;
  readonly selectedContent: string | undefined;
  readonly currentFile: string | undefined;
  readonly refreshKey: string | number;
  readonly onSelect: (rel: string | undefined) => void;
  readonly onSelectContent: (name: string | undefined) => void;
  readonly selectedRemote?: RemoteCmsSelection | undefined;
  readonly onSelectRemote?: ((selection: RemoteCmsSelection | undefined) => void) | undefined;
  readonly onOpenSettings: (rel: string) => void;
  readonly onConnect?: (() => void) | undefined;
  readonly showToast: (message: string, kind: 'error') => void;
  readonly onOpenFileSettings?: ((file: CmsFileSettingsTarget) => void) | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

export interface CmsFileSettingsTarget {
  readonly fileRel: string;
  readonly label: string;
}

interface CollectionGroup {
  readonly key: string;
  readonly kind: 'file' | 'folder';
  readonly label: string;
  readonly path: string;
  readonly items: readonly Collection[];
  readonly current: boolean;
  readonly badge: 'this page' | 'open' | undefined;
}

interface CmsPanelData {
  readonly state: PanelData<unknown>;
  readonly files: readonly CmsPanelFile[];
  readonly content: CmsPanelContent;
  readonly refresh: () => Promise<void>;
}

const EMPTY_CONTENT: CmsPanelContent = {
  collections: [],
  covered: { files: [], dirs: [] },
};

export default function CmsPanel(props: CmsPanelProps) {
  return <ProjectCmsPanel key={props.project.path} {...props} />;
}

function ProjectCmsPanel(props: CmsPanelProps) {
  const connections = useCmsConnections(props.project.path, props.refreshKey);
  const [remote, setRemote] = useState<CmsSource | undefined>(props.selectedRemote?.connection);
  if (remote) {
    return (
      <RemoteCmsBrowser
        projectPath={props.project.path}
        connection={remote}
        selected={props.selectedRemote}
        onOpen={props.onSelectRemote ?? (() => undefined)}
        onClose={() => setRemote(undefined)}
      />
    );
  }
  const openRemote = (source: CmsSource) => {
    props.onNavigate?.();
    props.onSelect(undefined);
    props.onSelectContent(undefined);
    setRemote(source);
  };
  return <LocalCmsPanel {...props} connections={connections} onOpenRemote={openRemote} />;
}

function LocalCmsPanel(
  props: CmsPanelProps & {
    readonly connections: readonly CmsConnection[];
    readonly onOpenRemote: (source: CmsSource) => void;
  },
) {
  const translate = useTranslate();
  const { files, content, refresh, state } = useCmsPanelData(props.project.path, props.refreshKey);
  const [creating, setCreating] = useState(false);
  const collections = useMemo(() => visibleCollections(files, content), [files, content]);
  const [openKey, setOpenKey] = useState<string | undefined>(() => selectedGroupKey(props.selectedRel, collections));
  const groups = useMemo(() => collectionGroups(collections, props.currentFile), [collections, props.currentFile]);
  useSelectedGroup(props.selectedRel, openKey, collections, setOpenKey);
  const open = openKey === undefined ? undefined : groups.find((group) => group.key === openKey);
  const create = useCreateCollection(props, setCreating, setOpenKey, refresh);
  const onOpenFileSettings = props.onOpenFileSettings;
  return (
    <div className="panel-section grow">
      <CmsPanelHeader
        open={open}
        openKey={openKey}
        onBack={() => {
          props.onNavigate?.();
          closeGroup(props, setOpenKey);
        }}
        onCreate={() => setCreating(true)}
        onConnect={props.onConnect}
      />
      <div className="panel-body">
        {creating && <CreateRow onCreate={create} />}
        {!open && (
          <>
            <ConnectionRows connections={props.connections} content={content} onOpen={props.onOpenRemote} />
            <GroupList
              groups={groups}
              selectedRel={props.selectedRel}
              onOpen={(key) => {
                props.onNavigate?.();
                openGroup(groups, key, { select: props.onSelect, open: setOpenKey });
              }}
              onSettings={
                onOpenFileSettings === undefined
                  ? undefined
                  : (group) => {
                      assert(group.kind === 'file', 'CmsPanel: only a file has file settings');
                      onOpenFileSettings({ fileRel: group.key, label: group.label });
                    }
              }
            />
          </>
        )}
        {open && <JsonCollectionList collections={open.items} selected={props.selectedRel} onSelect={props.onSelect} onOpenSettings={props.onOpenSettings} />}
        {}
        <PanelReadStatus state={state} label={translate('cms.panel.collections')} retry={refresh} />
      </div>
    </div>
  );
}

const EMPTY_FILES: readonly CmsPanelFile[] = [];
function useCmsPanelData(projectPath: string, refreshKey: string | number): CmsPanelData {
  const read = useCallback(() => readCmsCatalog(projectPath), [projectPath]);
  const { state, refresh } = usePanelData(cmsCache, projectPath, read, cmsTransport.onCmsChanged);
  const previous = useRef(refreshKey);
  useEffect(() => {
    if (previous.current !== refreshKey) {
      previous.current = refreshKey;
      void refresh();
    }
  }, [refresh, refreshKey]);
  return {
    state,
    files: state.kind === 'ready' ? state.value.files : EMPTY_FILES,
    content: state.kind === 'ready' ? state.value.content : EMPTY_CONTENT,
    refresh,
  };
}
function useCreateCollection(
  props: CmsPanelProps,
  setCreating: React.Dispatch<React.SetStateAction<boolean>>,
  setOpenKey: React.Dispatch<React.SetStateAction<string | undefined>>,
  refresh: () => Promise<void>,
): (name: string) => Promise<void> {
  return useCallback(
    async (name: string): Promise<void> => {
      setCreating(false);
      if (name.trim().length === 0) {
        return;
      }
      const result = await createCmsCollection(props.project.path, name);
      if (!result.ok) {
        props.showToast(result.error, 'error');
        return;
      }
      await refresh();
      setOpenKey(groupIdentity(result.value.rel, directoryOf(result.value.rel)).key);
      props.onSelect(result.value.rel);
    },
    [props, refresh, setCreating, setOpenKey],
  );
}

function useSelectedGroup(
  selectedRel: string | undefined,
  openKey: string | undefined,
  collections: readonly Collection[],
  setOpenKey: React.Dispatch<React.SetStateAction<string | undefined>>,
): void {
  useEffect(() => {
    if (openKey !== undefined) {
      return;
    }
    const key = selectedGroupKey(selectedRel, collections);
    if (key !== undefined) {
      setOpenKey(key);
    }
  }, [collections, openKey, selectedRel, setOpenKey]);
}

export function selectedGroupKey(selectedRel: string | undefined, collections: readonly Collection[]): string | undefined {
  if (selectedRel === undefined) {
    return undefined;
  }
  const selected = collections.find((collection) => collection.rel === selectedRel);
  if (!selected) {
    return undefined;
  }
  const key = groupIdentity(selected.rel, selected.dir).key;
  const siblings = collections.filter((collection) => groupIdentity(collection.rel, collection.dir).key === key);
  assert(siblings.includes(selected), 'selectedGroupKey: the selected collection is in its own group');
  return siblings.length > 1 ? key : undefined;
}

function visibleCollections(files: readonly CmsPanelFile[], content: CmsPanelContent): readonly Collection[] {
  return files
    .filter((file) => !ownedByContent(file.rel.split('#')[0] ?? '', content.covered))
    .map(collectionOf)
    .filter(collectionHasContent);
}

function ownedByContent(rel: string, covered: CmsPanelContent['covered']): boolean {
  if (covered.files.includes(`src/${rel}`)) {
    return true;
  }
  return covered.dirs.some((directory) => `src/${rel}`.startsWith(`${directory}/`));
}

function collectionGroups(collections: readonly Collection[], currentFile: string | undefined): readonly CollectionGroup[] {
  const mutableGroups = new Map<string, { readonly identity: GroupIdentity; items: Collection[] }>();
  for (const collection of collections) {
    const identity = groupIdentity(collection.rel, collection.dir);
    if (identity.key.toLowerCase().endsWith('.astro') && identity.key !== currentFile) {
      continue;
    }
    const existing = mutableGroups.get(identity.key);
    if (existing) {
      existing.items.push(collection);
    } else {
      mutableGroups.set(identity.key, { identity, items: [collection] });
    }
  }
  return Array.from(mutableGroups.values(), ({ identity, items }) => {
    const current = currentFile !== undefined && identity.key === currentFile;
    const badge: CollectionGroup['badge'] = current ? (identity.key.startsWith('pages/') ? 'this page' : 'open') : undefined;
    return {
      ...identity,
      items,
      current,
      badge,
    };
  }).sort((left, right) => Number(right.current) - Number(left.current));
}

interface GroupIdentity {
  readonly key: string;
  readonly kind: 'file' | 'folder';
  readonly label: string;
  readonly path: string;
}

function groupIdentity(rel: string, directory: string): GroupIdentity {
  if (rel.includes('#')) {
    const base = directory.split('/').at(-1) ?? directory;
    return {
      key: directory,
      kind: 'file',
      label: base.charAt(0).toUpperCase() + base.slice(1),
      path: `src/${directory}`,
    };
  }
  return {
    key: directory,
    kind: 'folder',
    label: directory ? (directory.split('/').at(-1) ?? directory) : 'src',
    path: directory ? `src/${directory}` : 'src',
  };
}

function directoryOf(rel: string): string {
  return rel.split('/').slice(0, -1).join('/');
}

function openGroup(
  groups: readonly CollectionGroup[],
  key: string,
  to: {
    readonly select: (rel: string | undefined) => void;
    readonly open: (key: string) => void;
  },
): void {
  const group = groups.find((entry) => entry.key === key);
  const only = group?.items.length === 1 ? group.items[0] : undefined;
  if (only) {
    to.select(only.rel);
  } else {
    to.open(key);
  }
}

function closeGroup(props: Pick<CmsPanelProps, 'onSelect' | 'onSelectContent'>, setOpenKey: React.Dispatch<React.SetStateAction<string | undefined>>): void {
  setOpenKey(undefined);
  props.onSelect(undefined);
  props.onSelectContent(undefined);
}


function useCmsConnections(projectPath: string, refreshKey: string | number) {
  const [connections, setConnections] = useState<readonly CmsConnection[]>(() => {
    const kept = keptCmsConnections.get(projectPath);
    return kept?.kind === 'ready' ? kept.value : [];
  });
  useEffect(() => {
    let active = true;
    let sanity: readonly CmsConnection[] = [];
    const readAhead = () => {
      for (const connection of sanity) {
        prefetchConnection(projectPath, connection.id);
      }
    };
    window.addEventListener('online', readAhead);
    listCmsConnections(projectPath).then(
      (list) => {
        keptCmsConnections.set(projectPath, list.connections);
        sanity = list.connections.filter((connection) => connection.kind === 'sanity');
        readAhead();
        prefetchConnection(projectPath, ASTRO_CONTENT_ID);
        if (active) {
          setConnections(list.connections);
        }
      },
      () => active && setConnections([]),
    );
    return () => {
      active = false;
      window.removeEventListener('online', readAhead);
    };
  }, [projectPath, refreshKey]);
  return connections;
}

function ConnectionRows(props: {
  readonly connections: readonly CmsConnection[];
  readonly content: CmsPanelContent;
  readonly onOpen: (source: CmsSource) => void;
}) {
  const translate = useTranslate();
  return (
    <>
      {props.connections.map((connection) => (
        <GroupRow
          key={connection.id}
          label={connectionKindLabel(connection.kind, translate)}
          title={connection.label}
          onClick={() => props.onOpen(connection)}
          icon={<ConnectionLogo kind={connection.kind} />}
        />
      ))}
      <GroupRow
        label={translate('cms.panel.contentCollections')}
        title={props.content.configPath ? translate('cms.panel.declaredIn', { path: props.content.configPath }) : translate('cms.panel.astroContent')}
        onClick={() => props.onOpen(ASTRO_CONTENT_SOURCE)}
        icon={<ConnectionLogo kind="astro" />}
      />
    </>
  );
}

function connectionKindLabel(kind: CmsConnection['kind'], translate: Translator): string {
  switch (kind) {
    case 'sanity':
      return 'Sanity';
    case 'payload':
      return 'Payload';
    case 'custom':
      return translate('cms.panel.kindCustom');
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function CmsPanelHeader({
  open,
  openKey,
  onBack,
  onCreate,
  onConnect,
}: {
  readonly open: CollectionGroup | undefined;
  readonly openKey: string | undefined;
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onConnect: (() => void) | undefined;
}) {
  const translate = useTranslate();
  const title = open?.label ?? translate('cms.panel.title');
  const connect = openKey === undefined ? onConnect : undefined;
  return (
    <PanelHeader
      title={title}
      titleHint={open?.path}
      back={open ? { label: translate('cms.panel.back'), onBack } : undefined}
      actions={
        connect ? (
          <button className="ghost" title={translate('cms.panel.connect')} onClick={connect}>
            <PlusIcon size={14} />
          </button>
        ) : (
          <button className="ghost" title={translate('cms.panel.newCollection')} onClick={onCreate}>
            <PlusIcon size={14} />
          </button>
        )
      }
    />
  );
}

function CreateRow({ onCreate }: { readonly onCreate: (name: string) => Promise<void> }) {
  const translate = useTranslate();
  return (
    <div className="cms-collection">
      <CmsIcon size={14} />
      <input
        autoFocus
        placeholder={translate('cms.panel.collectionName')}
        onBlur={(event) => void onCreate(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setInputText(event.currentTarget, '');
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function setInputText(inputElement: HTMLInputElement, text: string): void {
  inputElement.value = text;
}

function GroupList({
  groups,
  selectedRel,
  onOpen,
  onSettings,
}: {
  readonly groups: readonly CollectionGroup[];
  readonly selectedRel: string | undefined;
  readonly onOpen: (key: string) => void;
  readonly onSettings: ((group: CollectionGroup) => void) | undefined;
}) {
  return (
    <>
      {groups.map((group) => (
        <GroupRow
          key={group.key}
          label={group.label}
          title={group.path}
          badge={group.badge}
          selected={group.items.some((item) => item.rel === selectedRel)}
          onClick={() => onOpen(group.key)}
          onSettings={group.kind === 'file' && onSettings !== undefined ? () => onSettings(group) : undefined}
          icon={group.kind === 'file' ? <FileIcon size={14} /> : <FolderDefaultIcon size={14} />}
        />
      ))}
    </>
  );
}

function GroupRow({
  label,
  title,
  badge,
  selected,
  onClick,
  onSettings,
  icon,
}: {
  readonly label: string;
  readonly title?: string | undefined;
  readonly badge?: CollectionGroup['badge'];
  readonly selected?: boolean | undefined;
  readonly onClick: () => void;
  readonly onSettings?: (() => void) | undefined;
  readonly icon: React.ReactNode;
}) {
  const translate = useTranslate();
  return (
    <div className={`cms-collection ${selected ? 'on' : ''}`} onClick={onClick} title={title}>
      {icon}
      <span className="cms-collection-name">{label}</span>
      {badge && <span className="badge">{badge === 'this page' ? translate('cms.panel.badgeThisPage') : translate('cms.panel.badgeOpen')}</span>}
      {}
      <span className="cms-collection-end">
        <span className="cms-collection-chevron">
          <ChevronRightIcon size={10} />
        </span>
        {onSettings !== undefined && (
          <button
            type="button"
            className="ghost cms-collection-settings"
            title={translate('cms.panel.fileSettings')}
            onClick={(event) => {
              event.stopPropagation();
              onSettings();
            }}
          >
            <GearIcon size={13} />
          </button>
        )}
      </span>
    </div>
  );
}

function JsonCollectionList({
  collections,
  selected,
  onSelect,
  onOpenSettings,
}: {
  readonly collections: readonly Collection[];
  readonly selected: string | undefined;
  readonly onSelect: (rel: string | undefined) => void;
  readonly onOpenSettings: (rel: string) => void;
}) {
  const translate = useTranslate();
  return collections.map((collection) => (
    <div
      key={collection.rel}
      className={collectionClass({
        selected: collection.rel === selected,
        broken: collection.error !== undefined,
      })}
      onClick={() => onSelect(collection.rel)}
      title={`src/${collection.rel}`}
    >
      <CmsIcon size={14} />
      <span className="cms-collection-name">{collection.label}</span>
      <span className="cms-collection-count">{jsonItemCount(collection, translate)}</span>
      {}
      <span className="cms-collection-end">
        <span className="cms-collection-chevron">
          <ChevronRightIcon size={10} />
        </span>
        <button
          type="button"
          className="ghost cms-collection-settings"
          title={translate('cms.panel.collectionSettings')}
          onClick={(event) => {
            event.stopPropagation();
            if (collection.error === undefined) {
              onOpenSettings(collection.rel);
            }
          }}
          disabled={collection.error !== undefined}
        >
          <GearIcon size={13} />
        </button>
      </span>
    </div>
  ));
}

function collectionClass(state: { readonly selected: boolean; readonly broken: boolean }): string {
  return `cms-collection ${state.selected ? 'on' : ''} ${state.broken ? 'broken' : ''}`;
}

function jsonItemCount(collection: Collection, translate: Translator): string {
  if (collection.error !== undefined) {
    return translate('cms.collection.unreadable');
  }
  return translate('cms.itemCount', { count: collection.single ? 1 : collection.items.length });
}
