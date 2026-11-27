import { ErrorToast } from '../../ui/ErrorToast';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import type { AppSummary } from '../../../shared/properties/apps';
import { missingRequiredSettings, type AppSettingDeclaration, type AppSettingValues } from '../../../shared/properties/appSettings';
import { readAppSettings, writeAppSettings } from '../../ipc/appPublishBridge';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { ChevronRightIcon, HideIcon, PreviewIcon } from '../../ui/Icons';
import { AppTile } from './AppTile';
import { emitToApp } from './appsRuntime';
import { AppDetailsRow, AppDetailsSection } from './AppDetailsLayout';
import './appSettings.css';

type SettingsLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'ready'; readonly values: AppSettingValues };

export function useAppSettings(projectPath: string, app: AppSummary): { readonly load: SettingsLoad; readonly reload: () => void } {
  const [load, setLoad] = useState<SettingsLoad>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const declared = app.manifest.settings.length > 0;
  useEffect(() => {
    if (!declared) {
      setLoad({ kind: 'ready', values: {} });
      return undefined;
    }
    let active = true;
    void readAppSettings(projectPath, app.manifest.id).then(
      (answer) =>
        active && setLoad(answer.ok ? { kind: 'ready', values: answer.value } : { kind: 'failed', message: answer.message, messageRef: answer.messageRef }),
      (error: unknown) => active && setLoad({ kind: 'failed', message: String(error) }),
    );
    return () => {
      active = false;
    };
  }, [projectPath, app.manifest.id, declared, tick]);
  return { load, reload: useCallback(() => setTick((count) => count + 1), []) };
}

export function AppSettingsSection({ projectPath, app }: { readonly projectPath: string; readonly app: AppSummary }) {
  const translate = useTranslate();
  const { load, reload } = useAppSettings(projectPath, app);
  if (app.manifest.settings.length === 0) {
    return undefined;
  }
  return (
    <AppDetailsSection title={translate('apps.settings.title')} hint={translate('apps.settings.hint')}>
      <SettingsBody projectPath={projectPath} app={app} load={load} layout="rows" onSaved={reload} />
    </AppDetailsSection>
  );
}

type SettingsLayout = 'rows' | 'stacked';

export function AppSetupGate({ projectPath, app, children }: { readonly projectPath: string; readonly app: AppSummary; readonly children: ReactNode }) {
  const translate = useTranslate();
  const { load, reload } = useAppSettings(projectPath, app);
  if (app.manifest.settings.length === 0) {
    return children;
  }
  if (load.kind === 'ready' && missingRequiredSettings(app.manifest.settings, load.values).length === 0) {
    return children;
  }
  return (
    <div className="apps-setup" role="region" aria-label={translate('apps.settings.setUp', { name: app.manifest.name })}>
      <div className="apps-setup-head">
        <AppTile manifest={app.manifest} size={32} />
        <p className="apps-setup-title">{translate('apps.settings.setUp', { name: app.manifest.name })}</p>
      </div>
      <p className="apps-note">{translate('apps.settings.needsBeforeStart', { name: app.manifest.name })}</p>
      <SettingsBody projectPath={projectPath} app={app} load={load} layout="stacked" onSaved={reload} />
    </div>
  );
}

function SettingsBody(props: {
  readonly projectPath: string;
  readonly app: AppSummary;
  readonly load: SettingsLoad;
  readonly layout: SettingsLayout;
  readonly onSaved: () => void;
}) {
  const { load } = props;
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  switch (load.kind) {
    case 'loading':
      return <p className="apps-note">{translate('apps.settings.reading')}</p>;
    case 'failed':
      return <ErrorToast message={translateDescribed(load)} />;
    case 'ready':
      return <SettingsForm key={JSON.stringify(load.values)} {...props} saved={load.values} />;
    default: {
      const exhaustive: never = load;
      return exhaustive;
    }
  }
}

function SettingsForm(props: {
  readonly projectPath: string;
  readonly app: AppSummary;
  readonly saved: AppSettingValues;
  readonly layout: SettingsLayout;
  readonly onSaved: () => void;
}) {
  const { app } = props;
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const [draft, setDraft] = useState<AppSettingValues>(props.saved);
  const [state, setState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'saving' }
    | { readonly kind: 'failed'; readonly message: string; readonly messageRef?: MessageRef | undefined }
  >({
    kind: 'idle',
  });
  const missing = missingRequiredSettings(app.manifest.settings, draft);
  const rows = props.layout === 'rows';
  const main = rows ? app.manifest.settings.filter((setting) => !setting.advanced) : app.manifest.settings;
  const advanced = rows ? app.manifest.settings.filter((setting) => setting.advanced) : [];
  assert(main.length + advanced.length === app.manifest.settings.length, 'Every setting is shown exactly once');
  const field = (setting: AppSettingDeclaration) => (
    <SettingField
      key={setting.id}
      appId={app.manifest.id}
      setting={setting}
      layout={props.layout}
      value={draft[setting.id] ?? ''}
      onChange={(value) => setDraft((current) => ({ ...current, [setting.id]: value }))}
    />
  );
  const changed = app.manifest.settings.some((setting) => (draft[setting.id] ?? '') !== (props.saved[setting.id] ?? ''));
  const save = () => {
    setState({ kind: 'saving' });
    void writeAppSettings(props.projectPath, app.manifest.id, draft).then(
      (answer) => {
        if (answer.ok) {
          setState({ kind: 'idle' });
          const ids = app.manifest.settings.filter((setting) => (draft[setting.id] ?? '') !== (props.saved[setting.id] ?? '')).map((setting) => setting.id);
          if (ids.length > 0) {
            emitToApp(app.manifest.id, 'settings.change', { ids });
          }
          props.onSaved();
        } else {
          setState({ kind: 'failed', message: answer.message, messageRef: answer.messageRef });
        }
      },
      (error: unknown) => setState({ kind: 'failed', message: String(error) }),
    );
  };
  return (
    <form
      className="apps-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {main.map(field)}
      {advanced.length > 0 && (
        <AdvancedSettings openInitially={missingRequiredSettings(advanced, props.saved).length > 0}>{advanced.map(field)}</AdvancedSettings>
      )}
      <ErrorToast message={state.kind === 'failed' ? translateDescribed(state) : undefined} />
      <div className={props.layout === 'rows' ? 'apps-details-section-footer' : 'apps-actions'}>
        <button type="submit" className="apps-button primary" disabled={!changed || state.kind === 'saving'}>
          {state.kind === 'saving' ? translate('apps.settings.saving') : translate('apps.settings.save')}
        </button>
        {missing.length > 0 && <span className="apps-note">{translate('apps.settings.requiredEmpty', { count: missing.length })}</span>}
      </div>
    </form>
  );
}

function AdvancedSettings(props: { readonly openInitially: boolean; readonly children: ReactNode }) {
  const translate = useTranslate();
  const [open, setOpen] = useState(props.openInitially);
  const bodyId = useId();
  assert(bodyId.length > 0, 'The disclosure body has an id for aria-controls');
  return (
    <div className="apps-settings-advanced" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="apps-settings-advanced-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon size={11} className="apps-settings-advanced-chevron" />
        <span>{translate('apps.settings.advanced')}</span>
      </button>
      {}
      <div id={bodyId} className="apps-settings-advanced-body" hidden={!open}>
        {open && props.children}
      </div>
    </div>
  );
}

function SettingField(props: {
  readonly appId: string;
  readonly setting: AppSettingDeclaration;
  readonly layout: SettingsLayout;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const { setting } = props;
  const translate = useTranslate();
  const [revealed, setRevealed] = useState(false);
  const id = `app-setting-${props.appId}-${setting.id}`;
  assert(setting.label.length > 0, 'A setting has a label');
  const secret = setting.kind === 'secret';
  const label = (
    <label htmlFor={id} className="apps-setting-label">
      {setting.label}
      {setting.required && <span className="apps-setting-required"> {translate('apps.settings.required')}</span>}
    </label>
  );
  const input = (
    <span className="apps-setting-input">
      <input
        id={id}
        type={secret && !revealed ? 'password' : setting.kind === 'url' ? 'url' : 'text'}
        value={props.value}
        placeholder={setting.placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
      />
      {secret && (
        <button
          type="button"
          className="apps-icon-button"
          aria-label={revealed ? translate('apps.settings.hideNamed', { name: setting.label }) : translate('apps.settings.showNamed', { name: setting.label })}
          aria-pressed={revealed}
          title={revealed ? translate('apps.settings.hide') : translate('apps.settings.show')}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? <HideIcon size={13} /> : <PreviewIcon size={13} />}
        </button>
      )}
    </span>
  );
  const notes = [setting.description, secret ? translate('apps.settings.secretKept') : undefined].filter((note): note is string => note !== undefined);
  switch (props.layout) {
    case 'rows':
      return (
        <AppDetailsRow label={label} description={notes.length === 0 ? undefined : notes.join(' ')}>
          {input}
        </AppDetailsRow>
      );
    case 'stacked':
      return (
        <div className="apps-setting">
          {label}
          {input}
          {notes.map((note) => (
            <span key={note} className="apps-note">
              {note}
            </span>
          ))}
        </div>
      );
    default: {
      const exhaustive: never = props.layout;
      return exhaustive;
    }
  }
}
