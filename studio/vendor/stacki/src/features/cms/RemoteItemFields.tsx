import { NoticeToast } from '../../ui/NoticeToast';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeftIcon } from '../../ui/Icons';
import { ErrorToast } from '../../ui/ErrorToast';
import { useFormat, useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { remoteDocument, renameContentEntry, writeRemoteDocument } from '../../ipc/remoteSource';
import type { RemoteAsset, RemoteDocument, RemoteDocumentField } from '../../../shared/properties/cmsRemote';
import { RemoteItemActions } from './RemoteItemActions';
import type { RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import { RemoteFieldList } from './RemoteFieldList';
import type { RemoteEditContext } from './RemoteValueEditor';
import { STATUS_KEYS } from './RemoteCmsBrowser';
import { FieldChecksContext, Loading, useRemote, type FieldChecks, type RemoteCmsSelection } from './remoteCmsShared';
import { entryShown, useEntryLoad, type EntryLoad } from './entryLoad';
import { DOCUMENTS, documentKey } from './remoteCmsCache';
import { RemoteDocumentActions } from './RemoteDocumentActions';
import { isAstroContent } from '../../../shared/properties/astroContent';
import { relativeTime } from './remoteTime';
import { saveRefused } from './remoteValidation';
import { EntrySlugField } from './EntrySlugField';
import type { EntrySlug } from '../../../shared/properties/entrySlug';

export function RemoteItemFields(props: {
  readonly projectPath: string;
  readonly selection: RemoteCmsSelection;
  readonly onBack: (() => void) | undefined;
  readonly onRemoved: () => void;
  readonly onSaved: () => void;
  readonly onDuplicate: (document: RemoteDocument) => void;
  readonly onRenamed: (item: { readonly id: string; readonly title: string }) => void;
}) {
  const { projectPath, selection } = props;
  const { connection } = selection;
  const translateDescribed = useTranslateDescribed();
  const id = selection.item?.id ?? '';
  const { result, retry, replace, replaceAt } = useRemote(DOCUMENTS, documentKey(connection.id, id), () => remoteDocument(projectPath, connection.id, id));
  const load = useEntryLoad(id, result);
  const [error, setError] = useState<{ readonly id: string; readonly message: string } | undefined>(undefined);
  const enforced = isAstroContent(connection);
  const save = async (target: RemoteDocument, field: RemoteDocumentField, value: RemoteValue | undefined) => {
    setError(undefined);
    if (enforced && saveRefused(field, value)) {
      return;
    }
    const write = { id: target.id, field: field.name, value };
    const written = await writeRemoteDocument(projectPath, connection.id, write);
    if (written.ok) {
      replaceAt(documentKey(connection.id, target.id), written.value);
      props.onSaved();
    } else {
      setError({ id: target.id, message: translateDescribed(written) });
    }
  };
  const rename = async (target: RemoteDocument, slug: EntrySlug, to: string) => {
    setError(undefined);
    const renamed = await renameContentEntry(projectPath, target.id, to);
    if (renamed.ok) {
      const before = `${slug.folder}${slug.value}`;
      const title = selection.item?.title ?? before;
      props.onRenamed({ id: renamed.value.id, title: title === before ? `${slug.folder}${to}` : title });
    } else {
      setError({ id: target.id, message: translateDescribed(renamed) });
    }
  };
  const renameTo = (target: RemoteDocument, to: string) => {
    if (target.slug !== undefined) {
      void rename(target, target.slug, to);
    }
  };
  const document = load.kind === 'ready' ? load.document : undefined;
  const context = useEditContext(projectPath, connection.id, entryShown(load));
  const form = (shown: RemoteDocument, checks: FieldChecks) => (
    <EntryForm
      {...props}
      document={shown}
      checks={checks}
      context={context}
      error={error?.id === shown.id ? error.message : undefined}
      enforced={enforced}
      onSave={(field, value) => void save(shown, field, value)}
      onRename={(to) => renameTo(shown, to)}
    />
  );
  return (
    <div className="cms-detail remote-cms-item">
      <ItemHeader
        {...props}
        document={document}
        onChanged={(changed) => {
          props.onSaved();
          if (changed === undefined) {
            props.onRemoved();
          } else {
            replace(changed);
          }
        }}
      />
      <div className="cms-detail-body">
        <EntryBody load={load} retry={retry}>
          {form}
        </EntryBody>
      </div>
    </div>
  );
}

function EntryBody(props: {
  readonly load: EntryLoad;
  readonly retry: () => void;
  readonly children: (document: RemoteDocument, checks: FieldChecks) => ReactNode;
}) {
  const { load, retry } = props;
  switch (load.kind) {
    case 'loading':
      if (load.held === undefined) {
        return (
          <Loading result={undefined} retry={retry}>
            {() => undefined}
          </Loading>
        );
      }
      return props.children(load.held, 'held');
    case 'failed':
      return (
        <Loading result={{ ok: false, message: load.message }} retry={retry}>
          {() => undefined}
        </Loading>
      );
    case 'ready':
      return props.children(load.document, 'shown');
    default: {
      const exhaustive: never = load;
      return exhaustive;
    }
  }
}

const HELD_FORM = { inert: '' };

function EntryForm(props: {
  readonly projectPath: string;
  readonly selection: RemoteCmsSelection;
  readonly document: RemoteDocument;
  readonly checks: FieldChecks;
  readonly context: RemoteEditContext;
  readonly error: string | undefined;
  readonly enforced: boolean;
  readonly onSave: (field: RemoteDocumentField, value: RemoteValue | undefined) => void;
  readonly onRename: (to: string) => void;
  readonly onSaved: () => void;
  readonly onRemoved: () => void;
  readonly onDuplicate: (document: RemoteDocument) => void;
}) {
  const { document, enforced } = props;
  const translate = useTranslate();
  const requiredShown = enforced ? new Set(document.fields.filter((field) => field.required).map((field) => field.name)) : undefined;
  return (
    <FieldChecksContext.Provider value={props.checks}>
      <div className="remote-cms-fields" {...(props.checks === 'held' ? HELD_FORM : {})}>
        {props.error && <ErrorToast message={props.error} />}
        {document.appliesLive === true && <NoticeToast message={translate('settings.cms.payload.liveNotice')} kind="warning" />}
        {document.slug && <EntrySlugField key={document.id} slug={document.slug} onCommit={props.onRename} />}
        <RemoteFieldList document={document} context={props.context} requiredShown={requiredShown} onSave={props.onSave} />
        <RemoteItemActions
          projectPath={props.projectPath}
          selection={props.selection}
          document={document}
          onChanged={props.onSaved}
          onRemoved={props.onRemoved}
          onDuplicate={props.onDuplicate}
        />
      </div>
    </FieldChecksContext.Provider>
  );
}

export function useEditContext(projectPath: string, connectionId: string, document: RemoteDocument | undefined): RemoteEditContext {
  const [uploaded, setUploaded] = useState<readonly RemoteAsset[]>([]);
  const loaded = document?.assets;
  const folder = document?.file?.split('/').slice(0, -1).join('/');
  return useMemo(
    () => ({
      projectPath,
      connectionId,
      assets: new Map([...(loaded ?? []), ...uploaded].map((asset) => [asset.id, asset])),
      addAsset: (asset: RemoteAsset) => setUploaded((known) => [...known, asset]),
      folder,
      depth: 0,
    }),
    [projectPath, connectionId, loaded, uploaded, folder],
  );
}

function ItemHeader(props: {
  readonly projectPath: string;
  readonly selection: RemoteCmsSelection;
  readonly onBack: (() => void) | undefined;
  readonly document: RemoteDocument | undefined;
  readonly onChanged: (document: RemoteDocument | undefined) => void;
}) {
  const { document } = props;
  const translate = useTranslate();
  const files = isAstroContent(props.selection.connection);
  return (
    <div className="cms-detail-head remote-cms-item-head">
      {props.onBack && (
        <button className="ghost cms-back" title={translate('cmsRemote.item.backToList')} onClick={props.onBack}>
          <ChevronLeftIcon size={13} />
        </button>
      )}
      <span className="cms-detail-title">{props.selection.item?.title}</span>
      {document && (
        <div className="remote-cms-item-meta">
          <DocumentState document={document} shows={files ? 'times' : 'status'} />
          {!files && document.appliesLive !== true && (
            <RemoteDocumentActions
              projectPath={props.projectPath}
              connectionId={props.selection.connection.id}
              document={document}
              onChanged={props.onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DocumentState(props: {
  readonly document: RemoteDocument;
  readonly shows: 'status' | 'times';
}) {
  const { status, editedAt, publishedAt } = props.document;
  const translate = useTranslate();
  const format = useFormat();
  const text = { translate, format };
  const times = [
    editedAt === undefined ? undefined : translate('cmsRemote.item.edited', { time: relativeTime(editedAt, Date.now(), text) }),
    publishedAt === undefined ? undefined : translate('cmsRemote.item.publishedAt', { time: relativeTime(publishedAt, Date.now(), text) }),
  ].filter((part): part is string => part !== undefined);
  return (
    <>
      {}
      {props.shows === 'status' && (
        <span className={`remote-cms-status is-${status}`} title={times.join(' · ')}>
          {translate(STATUS_KEYS[status])}
        </span>
      )}
      {times.length > 0 && <span className="remote-cms-times">{times.join(' · ')}</span>}
    </>
  );
}
