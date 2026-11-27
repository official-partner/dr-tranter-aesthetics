import { useEffect, useMemo, useRef, useState } from 'react';
import type { Result } from '../../../shared/core/result';
import type { ComponentOpError } from '../../../shared/properties/componentOps';
import type { ComponentRenameRequest, ComponentRenameSummary, RenameNoticeKind } from '../../../shared/properties/componentRename';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import Dropdown from '../../ui/Dropdown';
import { ErrorToast } from '../../ui/ErrorToast';
import { reportErrorToast } from '../../ui/errorNotices';
import Popup from '../../ui/Popup';
import TipAnchor from '../../ui/TipAnchor';
import { detectFolderStyle, detectNamingStyle } from '../../../shared/properties/componentNaming';
import { folderInput, renameAvailability, type RenameCandidate } from './renameAvailability';
import './renameComponent.css';

export const RENAME_PREVIEW_DELAY_MS = 100;
const NEW_FOLDER = '\u0000new-folder';

export interface RenameComponentDialogProps {
  readonly file: string;
  readonly name: string;
  readonly components: readonly RenameCandidate[];
  readonly roots: readonly string[];
  readonly focus: 'name' | 'folder';
  readonly plan: (request: ComponentRenameRequest) => Promise<Result<ComponentRenameSummary, ComponentOpError>>;
  readonly onClose: () => void;
  readonly onApply: (request: ComponentRenameRequest, change: 'rename' | 'move' | 'both') => void;
}

type Preview =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: ComponentRenameSummary }
  | { readonly kind: 'error'; readonly message: string };

const NOTICE_KEYS: Readonly<
  Record<
    RenameNoticeKind,
    'palette.rename.notice.mention' | 'palette.rename.notice.unparsed' | 'palette.rename.notice.keptLocalName' | 'palette.rename.notice.namespace'
  >
> = {
  mention: 'palette.rename.notice.mention',
  unparsed: 'palette.rename.notice.unparsed',
  'kept-local-name': 'palette.rename.notice.keptLocalName',
  namespace: 'palette.rename.notice.namespace',
};

export function RenameComponentDialog(props: RenameComponentDialogProps) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const currentFolder = props.file.slice(0, props.file.lastIndexOf('/'));
  const root = props.roots.find((candidate) => props.file.startsWith(`${candidate}/`)) ?? currentFolder;
  const [name, setName] = useState(props.name);
  const [folder, setFolder] = useState(currentFolder);
  const [newFolder, setNewFolder] = useState('');
  const folders = useMemo(() => folderChoices(props.roots, props.components, currentFolder), [props.roots, props.components, currentFolder]);
  const creatingFolder = folder === NEW_FOLDER;
  const style = useMemo(() => detectNamingStyle(props.components.map((component) => baseOf(component.file))), [props.components]);
  const folderStyle = useMemo(() => detectFolderStyle(folderLevels(folders, props.roots)), [folders, props.roots]);
  const belowRoot = useMemo(() => folders.filter((value) => value.startsWith(`${root}/`)).map((value) => value.slice(root.length + 1)), [folders, root]);
  const typedFolder = folderInput(newFolder, folderStyle, belowRoot);
  const folderProblem = creatingFolder ? typedFolder.problem : undefined;
  const chosenFolder = creatingFolder ? `${root}/${typedFolder.path}` : folder;
  const availability = renameAvailability({ current: props.file, name, folder: chosenFolder, style, components: props.components });
  const request: ComponentRenameRequest | undefined =
    availability.kind === 'available' && folderProblem === undefined ? { from: props.file, to: availability.path } : undefined;
  const preview = usePreview(request, props.plan);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    if (props.focus === 'name') {
      nameRef.current?.select();
    }
  }, [props.focus]);
  const ready = request !== undefined && preview.kind === 'ready';
  const nameChanged = availability.kind === 'available' && availability.fileName !== baseOf(props.file);
  const change = nameChanged ? (chosenFolder === currentFolder ? 'rename' : 'both') : 'move';
  const blockedReason =
    availability.kind === 'taken'
      ? translate('palette.rename.taken', { file: availability.by })
      : availability.kind === 'same'
        ? translate('palette.rename.unchanged')
        : availability.kind === 'invalid'
          ? translateDescribed(availability.problem)
          : folderProblem !== undefined && newFolder.trim() !== ''
            ? translateDescribed(folderProblem)
            : undefined;
  const nameInvalid = availability.kind === 'taken' || availability.kind === 'invalid';
  const folderInvalid = folderProblem !== undefined && newFolder.trim() !== '';
  const pathNotes = [
    availability.kind === 'available' && availability.change !== undefined
      ? translate(availability.change === 'spaces' ? 'palette.rename.spacesRemoved' : 'palette.rename.normalized', { name: availability.fileName })
      : undefined,
    availability.kind === 'available' && availability.sameNameIn !== undefined
      ? translate('palette.rename.sameNameElsewhere', { name: availability.fileName, file: availability.sameNameIn })
      : undefined,
  ].filter((note): note is string => note !== undefined);
  const submit = (): void => {
    if (ready) {
      props.onApply(request, change);
    } else if (blockedReason !== undefined) {
      reportErrorToast(blockedReason);
    }
  };
  return (
    <Popup className="modal rename-component" onClose={props.onClose} dismissible={true}>
      {({ close }) => (
        <>
          <div className="modal-header">{translate('palette.rename.title', { name: props.name })}</div>
          <div className="modal-body">
            <label>{translate('palette.rename.name')}</label>
            <input
              ref={nameRef}
              aria-invalid={nameInvalid || undefined}
              value={name}
              spellCheck={false}
              placeholder="Card"
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submit();
                } else if (event.key === 'Escape') {
                  close();
                }
              }}
            />
            <label>{translate('palette.rename.folder')}</label>
            <Dropdown
              value={folder}
              ariaLabel={translate('palette.rename.folder')}
              options={[...folders.map((value) => ({ value, label: value })), { value: NEW_FOLDER, label: translate('palette.rename.newFolder') }]}
              onChange={setFolder}
            />
            {creatingFolder && (
              <>
                <input
                  value={newFolder}
                  spellCheck={false}
                  aria-label={translate('palette.rename.newFolderName')}
                  aria-invalid={folderInvalid || undefined}
                  onChange={(event) => setNewFolder(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      submit();
                    }
                  }}
                />
              </>
            )}
            <TipAnchor text={pathNotes.length === 0 ? undefined : pathNotes.join(' ')}>
              <div className="rename-path">
                <span>{translate('palette.rename.path')}</span>
                <code>{previewPath(availability, chosenFolder, props.file)}</code>
              </div>
            </TipAnchor>
            <PreviewSummary preview={preview} active={request !== undefined} />
          </div>
          <div className="modal-footer">
            <button onClick={close}>{translate('ui.cancel')}</button>
            <TipAnchor text={ready ? undefined : blockedReason}>
              <button className="primary" disabled={!ready} onClick={submit}>
                {translate(change === 'rename' ? 'palette.rename.submitRename' : change === 'move' ? 'palette.rename.submitMove' : 'palette.rename.submitBoth')}
              </button>
            </TipAnchor>
          </div>
        </>
      )}
    </Popup>
  );
}

function baseOf(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1).replace(/\.astro$/, '');
}

function folderLevels(folders: readonly string[], roots: readonly string[]): readonly string[] {
  return folders.filter((folder) => !roots.includes(folder)).map((folder) => folder.slice(folder.lastIndexOf('/') + 1));
}

function previewPath(availability: ReturnType<typeof renameAvailability>, folder: string, current: string): string {
  if (availability.kind === 'same') {
    return current;
  }
  return availability.path ?? `${folder}/…`;
}

function folderChoices(roots: readonly string[], components: readonly RenameCandidate[], current: string): readonly string[] {
  const found = new Set<string>([...roots, current]);
  for (const component of components) {
    const directory = component.file.slice(0, component.file.lastIndexOf('/'));
    const root = roots.find((candidate) => directory === candidate || directory.startsWith(`${candidate}/`));
    if (root === undefined) {
      continue;
    }
    const segments = directory
      .slice(root.length + 1)
      .split('/')
      .filter((segment) => segment !== '');
    for (let depth = 0; depth <= segments.length; depth += 1) {
      found.add([root, ...segments.slice(0, depth)].join('/'));
    }
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}

function usePreview(request: ComponentRenameRequest | undefined, plan: RenameComponentDialogProps['plan']): Preview {
  const [preview, setPreview] = useState<Preview>({ kind: 'idle' });
  const from = request?.from;
  const to = request?.to;
  useEffect(() => {
    if (from === undefined || to === undefined) {
      setPreview({ kind: 'idle' });
      return undefined;
    }
    let current = true;
    setPreview({ kind: 'loading' });
    const timer = setTimeout(() => {
      void plan({ from, to }).then(
        (result) => {
          if (current) {
            setPreview(result.ok ? { kind: 'ready', summary: result.value } : { kind: 'error', message: result.error.message });
          }
        },
        (error: unknown) => {
          if (current) {
            setPreview({ kind: 'error', message: String(error) });
          }
        },
      );
    }, RENAME_PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [from, to, plan]);
  return preview;
}

function PreviewSummary({ preview, active }: { readonly preview: Preview; readonly active: boolean }) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  if (!active || preview.kind === 'idle') {
    return undefined;
  }
  if (preview.kind === 'loading') {
    return <div className="rename-files panel-loading-label">{translate('palette.rename.checking')}</div>;
  }
  if (preview.kind === 'error') {
    return <ErrorToast message={preview.message} />;
  }
  const { files, notices } = preview.summary;
  return (
    <div className="rename-files">
      <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {files.length === 0 ? translate('palette.rename.onlyFile') : translate('palette.rename.files', { count: files.length })}
        {files.length > 0 && ` · ${translate(open ? 'palette.rename.hideFiles' : 'palette.rename.showFiles')}`}
      </button>
      {open && (
        <ul className="rename-file-list">
          {files.map((entry) => (
            <li key={entry.file}>
              <code>{entry.file}</code>
            </li>
          ))}
        </ul>
      )}
      {notices.length > 0 && (
        <div className="rename-notices">
          <div className="rename-notices-title">{translate('palette.rename.notices')}</div>
          <ul className="rename-file-list">
            {notices.map((notice) => (
              <li key={`${notice.file}:${notice.kind}`}>{translate(NOTICE_KEYS[notice.kind], { file: notice.file })}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
