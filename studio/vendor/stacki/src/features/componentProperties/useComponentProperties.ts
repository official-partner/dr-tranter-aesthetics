import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ComponentProperties, PropertyChange } from '../../../shared/properties/propertyEditing';
import type { PropertyError } from '../../../shared/properties/propertyErrors';
import { onPropertyFilesChanged as onFilesChanged } from '../../ipc/editorEnvironment';
import { onWindowReturn } from '../../lib/windowReturn';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { err, ok } from '../../../shared/core/result';
import { editComponentProperties, readComponentProperties } from './propertiesBridge';
import { confirmPropertyRemoval } from './propertyRemovalDialog';
import { propertyErrorTextFor } from '../../lib/i18n/propertyErrorText';
import { refusalOf, savePhaseOf, type PropertySaveHost, type PropertySaveOutcome } from './propertyAutosave';

export interface ComponentPropertiesPanelProps {
  readonly projectPath: string;
  readonly file: string;
  readonly name: string;
  readonly flushSave: () => Promise<unknown>;
  readonly onSavePhase: (phase: 'idle' | 'saving' | 'autosaving') => void;
  readonly onSaved: () => Promise<void>;
  readonly onRecordUndo?: (token: string) => void;
  readonly onFieldMoved?: ((from: string, to: string | undefined) => void) | undefined;
}
type PanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly error?: PropertyError | undefined }
  | { readonly kind: 'ready'; readonly data: ComponentProperties };
type LoadReason = 'initial' | 'external';
interface Snapshot {
  readonly state: PanelState;
  readonly revision: number;
}

export function useComponentProperties(props: ComponentPropertiesPanelProps) {
  const translate = useTranslate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const snapshot = usePropertySnapshot(props, pending, setError);
  const run = async (change: PropertyChange, reports: 'panel' | 'form'): Promise<PropertySaveOutcome> => {
    const current = snapshot.latest.current;
    if (current.kind !== 'ready' || pending.current) {
      return { kind: 'refused', message: translate('componentProps.panel.saveBusy') };
    }
    pending.current = true;
    snapshot.invalidate();
    props.onSavePhase(reports === 'panel' ? 'saving' : savePhaseOf(change));
    if (reports === 'panel') {
      setBusy(true);
      setError('');
    }
    const tell = (message: string): void => {
      if (reports === 'panel' && snapshot.active.current) {
        setError(message);
      }
    };
    try {
      await props.flushSave();
      const result = await editComponentProperties(props.projectPath, props.file, current.data.source, change);
      if (!result.ok) {
        const conflict = result.error.code === 'conflict';
        if (conflict && reports === 'panel' && snapshot.active.current) {
          snapshot.requestRefresh();
        }
        tell(propertyErrorTextFor(result.error, translate));
        return refusalOf(result.error, translate);
      }
      if (snapshot.active.current) {
        snapshot.accept(result.value);
      }
      props.onRecordUndo?.(result.value.undo);
      await props.onSaved();
      if (change.kind === 'remove') {
        props.onFieldMoved?.(change.name, undefined);
      } else if (change.kind === 'save' && change.originalName !== '' && change.originalName !== change.property.name) {
        props.onFieldMoved?.(change.originalName, change.property.name);
      }
      return { kind: 'saved', source: result.value.source };
    } catch (caught: unknown) {
      tell(String(caught));
      return { kind: 'refused', message: String(caught) };
    } finally {
      pending.current = false;
      props.onSavePhase('idle');
      if (snapshot.active.current) {
        setBusy(false);
        snapshot.flushExternal();
      }
    }
  };
  const save = async (change: PropertyChange): Promise<boolean> => {
    if (change.kind === 'remove' && !(await confirmPropertyRemoval({ projectPath: props.projectPath, file: props.file, name: change.name, translate }))) {
      return false;
    }
    return (await run(change, 'panel')).kind === 'saved';
  };
  const saveHost: PropertySaveHost = {
    save: (change) => run(change, 'form'),
    reload: async (name) => {
      const read = await readComponentProperties(props.projectPath, props.file);
      if (!read.ok) {
        return err(propertyErrorTextFor(read.error, translate));
      }
      snapshot.accept(read.value);
      const property = read.value.properties.find((candidate) => candidate.name === name);
      return property === undefined ? err(translate('componentProps.panel.propertyGone', { name })) : ok(property);
    },
  };
  const shown = snapshot.state;
  const state: PanelState = shown.kind === 'error' && shown.error !== undefined ? { ...shown, message: propertyErrorTextFor(shown.error, translate) } : shown;
  return { state, revision: snapshot.revision, busy, error, save, saveHost };
}

function usePropertySnapshot(props: ComponentPropertiesPanelProps, pending: MutableRefObject<boolean>, setError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: { kind: 'loading' }, revision: 0 });
  const latest = useRef<PanelState>(snapshot.state);
  latest.current = snapshot.state;
  const active = useRef(false);
  const version = useRef(0);
  const invalidateReads = useCallback(() => {
    version.current++;
  }, []);
  const queued = useRef(false);
  const reading = useRef<LoadReason>();
  const currentProps = useRef(props);
  currentProps.current = props;
  const reload = useCallback(
    async (reason: LoadReason): Promise<void> => {
      const request = ++version.current;
      if (pending.current) {
        queued.current = true;
        return;
      }
      queued.current = false;
      reading.current = reason;
      const next = await loadPropertiesPanel(currentProps.current, reason);
      if (!active.current || request !== version.current) {
        return;
      }
      reading.current = undefined;
      setSnapshot((previous) => refreshSnapshot(previous, next));
      setError('');
    },
    [pending, setError],
  );
  usePropertyWatcher(props, { active, invalidateReads, reload });
  return {
    ...snapshot,
    active,
    latest,
    accept: (data: ComponentProperties) => {
      latest.current = { kind: 'ready', data };
      setSnapshot((previous) => ({
        ...previous,
        state: { kind: 'ready', data },
      }));
    },
    invalidate: () => {
      invalidateReads();
      queued.current = queued.current || reading.current === 'external';
      reading.current = undefined;
    },
    requestRefresh: () => {
      void reload('external');
    },
    flushExternal: () => {
      if (queued.current) {
        void reload('external');
      }
    },
  };
}

function usePropertyWatcher(
  props: Pick<ComponentPropertiesPanelProps, 'file' | 'projectPath'>,
  {
    active: activeRef,
    invalidateReads,
    reload,
  }: {
    readonly active: MutableRefObject<boolean>;
    readonly invalidateReads: () => void;
    readonly reload: (reason: LoadReason) => Promise<void>;
  },
): void {
  useEffect(() => {
    activeRef.current = true;
    const off = onFilesChanged(({ files }) => {
      if (files.length === 0 || files.includes(props.file)) {
        void reload('external');
      }
    });
    const offFocus = onWindowReturn(() => void reload('external'));
    void reload('initial');
    return () => {
      activeRef.current = false;
      invalidateReads();
      off();
      offFocus();
    };
  }, [props.file, props.projectPath, reload, invalidateReads, activeRef]);
}

function refreshSnapshot(previous: Snapshot, state: PanelState): Snapshot {
  if (previous.state.kind === 'ready' && state.kind === 'ready') {
    if (previous.state.data.source === state.data.source) {
      return previous;
    }
  }
  return { state, revision: previous.revision + 1 };
}

async function loadPropertiesPanel(props: ComponentPropertiesPanelProps, reason: LoadReason): Promise<PanelState> {
  try {
    if (reason === 'initial') {
      await props.flushSave();
    }
    const result = await readComponentProperties(props.projectPath, props.file);
    return result.ok ? { kind: 'ready', data: result.value } : { kind: 'error', message: result.error.message, error: result.error };
  } catch (caught: unknown) {
    return { kind: 'error', message: String(caught) };
  }
}
