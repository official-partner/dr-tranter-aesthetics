import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import { cmsTransport } from '../../ipc/editorEnvironment';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';
import './remoteCms.css';
import { AstroIcon, ChevronRightIcon, CmsIcon, GearIcon, PlusIcon } from '../../ui/Icons';
import { SanityTypeIcon } from './SanityTypeIcon';
import { createContentCollection, remoteCollections, remoteDocuments } from '../../ipc/remoteSource';
import { isAstroContent, type CmsSource } from '../../../shared/properties/astroContent';
import type { RemoteCollection, RemoteStatus } from '../../../shared/properties/cmsRemote';
import { labelize } from './cmsSchema';
import { ConnectionLogo, Loading, useRemote, type RemoteCmsSelection } from './remoteCmsShared';
import { COLLECTIONS, DOCUMENT_LISTS, listKey } from './remoteCmsCache';
import { PanelHeader } from '../../ui/PanelHeader';

interface Props {
  readonly projectPath: string;
  readonly connection: CmsSource;
  readonly selected: RemoteCmsSelection | undefined;
  readonly onOpen: (selection: RemoteCmsSelection | undefined) => void;
  readonly onClose: () => void;
}

export function RemoteCmsBrowser(props: Props) {
  const { projectPath, connection } = props;
  const [opening, setOpening] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const collections = useRemote(COLLECTIONS, connection.id, () => remoteCollections(projectPath, connection.id));
  useProjectChanges(connection, collections.retry);
  const open = async (entry: RemoteCollection) => {
    if (props.selected?.collection === entry.name) {
      props.onOpen(undefined);
      return;
    }
    let item: RemoteCmsSelection['item'];
    if (entry.count === 1 && !isAstroContent(connection)) {
      setOpening(entry.name);
      item = await onlyItem(projectPath, connection.id, entry.name);
      setOpening(undefined);
    }
    props.onOpen({ connection, collection: entry.name, item });
  };
  const created = (entry: RemoteCollection) => {
    setCreating(false);
    const kept = collections.result?.ok ? collections.result.value : [];
    collections.replace([...kept, entry]);
    collections.retry();
    props.onOpen({ connection, collection: entry.name, item: undefined });
  };
  return (
    <div className="panel-section grow">
      <BrowserHeader
        connection={connection}
        onBack={() => {
          props.onOpen(undefined);
          props.onClose();
        }}
        onCreate={isAstroContent(connection) ? () => setCreating(true) : undefined}
      />
      <div className="panel-body">
        {creating && <CreateCollectionRow projectPath={projectPath} onCreated={created} onCancel={() => setCreating(false)} />}
        <Loading result={collections.result} retry={collections.retry}>
          {(loaded) =>
            loaded.length === 0 && isAstroContent(connection) ? (
              !creating && <EmptyContent onCreate={() => setCreating(true)} />
            ) : (
              <CollectionList
                files={isAstroContent(connection)}
                collections={loaded}
                selected={opening ?? props.selected?.collection}
                onOpen={(entry) => void open(entry)}
                onSettings={(entry) => props.onOpen(settingsOf(connection, entry))}
              />
            )
          }
        </Loading>
      </div>
    </div>
  );
}

async function onlyItem(projectPath: string, connectionId: string, collection: string): Promise<RemoteCmsSelection['item']> {
  const key = listKey(connectionId, collection);
  const kept = DOCUMENT_LISTS.get(key);
  const listed = kept?.ok ? kept : await DOCUMENT_LISTS.load(key, () => remoteDocuments(projectPath, connectionId, collection));
  const only = listed.ok && listed.value.documents.length === 1 ? listed.value.documents[0] : undefined;
  return only && { id: only.id, title: only.title === only.id ? labelize(collection) : only.title };
}

function useProjectChanges(connection: CmsSource, reread: () => void): void {
  const files = isAstroContent(connection);
  useEffect(() => (files ? cmsTransport.onCmsChanged(reread) : undefined), [files, reread]);
}

function settingsOf(connection: CmsSource, entry: RemoteCollection): RemoteCmsSelection {
  return { connection, collection: entry.name, item: undefined, mode: 'settings' };
}

function BrowserHeader(props: {
  readonly connection: CmsSource;
  readonly onBack: () => void;
  readonly onCreate: (() => void) | undefined;
}) {
  const { connection } = props;
  const translate = useTranslate();
  return (
    <PanelHeader
      back={{ label: translate('cmsRemote.collection.allCollections'), onBack: props.onBack }}
      lead={
        <span className="remote-cms-logo">
          <ConnectionLogo kind={connection.kind} />
        </span>
      }
      title={sourceName(connection, translate)}
      titleHint={connection.label}
      actions={
        props.onCreate && (
          <button className="ghost" title={translate('cmsRemote.collection.new')} onClick={props.onCreate}>
            <PlusIcon size={14} />
          </button>
        )
      }
    />
  );
}

function CollectionList(props: {
  readonly files: boolean;
  readonly collections: readonly RemoteCollection[];
  readonly selected: string | undefined;
  readonly onOpen: (collection: RemoteCollection) => void;
  readonly onSettings: (collection: RemoteCollection) => void;
}) {
  const translate = useTranslate();
  return props.collections.map((collection) => (
    <div
      key={collection.name}
      className={`cms-collection is-counted ${collection.name === props.selected ? 'on' : ''}`}
      onClick={() => props.onOpen(collection)}
    >
      {props.files ? <CmsIcon size={14} /> : <SanityTypeIcon symbol={collection.icon} size={14} />}
      {}
      <span className="cms-collection-label">
        <span className="cms-collection-name">{labelize(collection.name)}</span>
        <span className="cms-collection-count">{translate('cmsRemote.collection.itemCount', { count: collection.count })}</span>
      </span>
      {}
      <span className="cms-collection-end">
        <span className="cms-collection-chevron">
          <ChevronRightIcon size={10} />
        </span>
        {props.files && (
          <button
            type="button"
            className="ghost cms-collection-settings"
            title={translate('cmsRemote.collection.settings')}
            onClick={(event) => {
              event.stopPropagation();
              props.onSettings(collection);
            }}
          >
            <GearIcon size={13} />
          </button>
        )}
      </span>
    </div>
  ));
}

function CreateCollectionRow(props: {
  readonly projectPath: string;
  readonly onCreated: (collection: RemoteCollection) => void;
  readonly onCancel: () => void;
}) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const submit = async () => {
    if (name.trim().length === 0) {
      props.onCancel();
      return;
    }
    setBusy(true);
    const made = await createContentCollection(props.projectPath, name);
    setBusy(false);
    if (made.ok) {
      props.onCreated(made.value);
    } else {
      setFailure(translateDescribed(made));
    }
  };
  return (
    <>
      <div className="cms-collection">
        <AstroIcon size={14} />
        <input
          autoFocus
          value={name}
          disabled={busy}
          placeholder={translate('cmsRemote.collection.name')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit();
            } else if (event.key === 'Escape') {
              props.onCancel();
            }
          }}
        />
      </div>
      <ErrorToast message={failure || undefined} />
    </>
  );
}

function EmptyContent(props: { readonly onCreate: () => void }) {
  const translate = useTranslate();
  return (
    <div className="props-empty">
      <div className="cms-empty-icon" aria-hidden="true">
        <AstroIcon size={24} />
      </div>
      <h3 className="cms-empty-title">{translate('cmsRemote.collection.noneTitle')}</h3>
      <p>{translate('cmsRemote.collection.noneBody')}</p>
      <div className="cms-empty-action">
        <button className="primary" onClick={props.onCreate}>
          {translate('cmsRemote.collection.new')}
        </button>
      </div>
    </div>
  );
}

function sourceName(connection: CmsSource, translate: Translator): string {
  switch (connection.kind) {
    case 'sanity':
      return 'Sanity';
    case 'payload':
      return 'Payload';
    case 'custom':
      return translate('cmsRemote.source.custom');
    case 'astro':
      return translate('cmsRemote.source.astro');
    default: {
      const exhaustive: never = connection;
      return exhaustive;
    }
  }
}

export const STATUS_KEYS: Readonly<Record<RemoteStatus, MessageKey>> = {
  draft: 'cmsRemote.status.draft',
  changed: 'cmsRemote.status.changed',
  published: 'cmsRemote.status.published',
};
