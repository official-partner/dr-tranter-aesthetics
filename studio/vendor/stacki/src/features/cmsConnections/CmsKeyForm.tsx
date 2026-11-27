import { useState } from 'react';
import Popup from '../../ui/Popup';
import Dropdown from '../../ui/Dropdown';
import { ErrorToast } from '../../ui/ErrorToast';
import { checkCmsConnection, saveCmsConnection } from '../../ipc/cmsConnectionsBridge';
import { useTranslate, useTranslateDescribed, useTranslateRef } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';
import {
  CmsInputError,
  parseCmsConnectionDraft,
  type CmsConnectionDraft,
  type PayloadAuthMode,
  type PayloadSummary,
} from '../../../shared/properties/cmsConnections';

export type CmsKeyKind = CmsConnectionDraft['kind'];

function defaultName(cms: CmsKeyKind, translate: Translator): string {
  switch (cms) {
    case 'sanity':
      return 'Sanity';
    case 'payload':
      return 'Payload';
    case 'custom':
      return translate('cmsConnections.kind.custom');
    default: {
      const exhaustive: never = cms;
      return exhaustive;
    }
  }
}

const TITLES: Readonly<Record<CmsKeyKind, MessageKey>> = {
  sanity: 'cmsConnections.form.title.sanity',
  payload: 'settings.cms.payload.connect',
  custom: 'cmsConnections.form.title.custom',
};

interface Fields {
  readonly label: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly baseUrl: string;
  readonly collection: string;
  readonly header: string;
  readonly secret: string;
  readonly auth: PayloadAuthMode;
  readonly email: string;
  readonly collections: string;
}
const EMPTY: Fields = {
  label: '',
  projectId: '',
  dataset: 'production',
  baseUrl: '',
  collection: 'users',
  header: 'Authorization',
  secret: '',
  auth: 'apiKey',
  email: '',
  collections: '',
};

export function CmsKeyForm(props: { readonly projectPath: string; readonly cms: CmsKeyKind; readonly close: () => void }) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState<DetectState>({ kind: 'idle' });
  const translate = useTranslate();
  const describe = useTranslateDescribed();
  const translateRef = useTranslateRef();
  const field = (name: keyof Fields) => ({
    value: fields[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [name]: event.target.value }),
  });
  const save = async () => {
    let draft: CmsConnectionDraft;
    try {
      draft = parseCmsConnectionDraft(draftOf(props.cms, fields, defaultName(props.cms, translate)));
    } catch (reason: unknown) {
      setError(inputProblem(reason, translateRef));
      return;
    }
    setBusy(true);
    const result = await saveCmsConnection(props.projectPath, draft);
    setBusy(false);
    if (result.ok) {
      props.close();
    } else {
      setError(describe(result));
    }
  };
  const detect = async () => {
    let draft: CmsConnectionDraft;
    try {
      draft = parseCmsConnectionDraft(draftOf(props.cms, fields, defaultName(props.cms, translate)));
    } catch (reason: unknown) {
      setError(inputProblem(reason, translateRef));
      return;
    }
    if (draft.kind !== 'payload') {
      return;
    }
    setError(undefined);
    setDetected({ kind: 'detecting' });
    const result = await checkCmsConnection(props.projectPath, { action: 'detect', draft });
    if (result.ok) {
      setDetected({ kind: 'found', summary: result.summary });
    } else {
      setDetected({ kind: 'idle' });
      setError(describe(result));
    }
  };
  const payload = props.cms === 'payload';
  const title = translate(TITLES[props.cms]);
  return (
    <Popup className="modal publish-settings" label={title} onClose={props.close} dismissible>
      {() => (
        <>
          <div className="modal-header">{title}</div>
          <form
            className="modal-body publish-fields"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {error && <ErrorToast message={error} />}
            <label>
              {translate('settings.cms.payload.name')}
              <input {...field('label')} placeholder={defaultName(props.cms, translate)} />
            </label>
            <KindFields cms={props.cms} field={field} fields={fields} setFields={setFields} detected={detected} onDetect={() => void detect()} />
            {payload ? (
              <PayloadSecretFields field={field} auth={fields.auth} />
            ) : (
              <label>
                {props.cms === 'custom' ? translate('cmsConnections.form.customKey') : translate('settings.cms.payload.apiKey')}
                <input {...field('secret')} type="password" autoComplete="off" spellCheck={false} />
              </label>
            )}
            <p className="hint-text">
              {payload
                ? translate(fields.auth === 'apiKey' ? 'settings.cms.payload.hint.apiKey' : 'settings.cms.payload.hint.password')
                : translate(KEY_HINTS[props.cms])}
            </p>
            <button type="submit" className="primary" disabled={busy}>
              {translate(busy ? 'settings.cms.payload.saving' : 'settings.cms.payload.save')}
            </button>
          </form>
        </>
      )}
    </Popup>
  );
}

const KEY_HINTS: Readonly<Record<CmsKeyKind, MessageKey>> = {
  sanity: 'cmsConnections.form.hint.sanity',
  payload: 'settings.cms.payload.hint.apiKey',
  custom: 'cmsConnections.form.hint.custom',
};

function inputProblem(reason: unknown, translateRef: ReturnType<typeof useTranslateRef>): string {
  if (reason instanceof CmsInputError) {
    return translateRef(reason.messageRef);
  }
  return reason instanceof Error ? reason.message : String(reason);
}

type FieldProps = (name: keyof Fields) => {
  readonly value: string;
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

type DetectState = { readonly kind: 'idle' } | { readonly kind: 'detecting' } | { readonly kind: 'found'; readonly summary: PayloadSummary };

function KindFields(props: {
  readonly cms: CmsKeyKind;
  readonly field: FieldProps;
  readonly fields: Fields;
  readonly setFields: (next: Fields) => void;
  readonly detected: DetectState;
  readonly onDetect: () => void;
}) {
  const { field } = props;
  const translate = useTranslate();
  switch (props.cms) {
    case 'sanity':
      return (
        <>
          <label>
            {translate('cmsConnections.form.projectId')}
            <input {...field('projectId')} spellCheck={false} />
          </label>
          <label>
            {translate('cmsConnections.form.dataset')}
            <input {...field('dataset')} spellCheck={false} />
          </label>
        </>
      );
    case 'payload':
      return <PayloadFields {...props} />;
    case 'custom':
      return (
        <>
          <label>
            {translate('cmsConnections.form.draftEndpoint')}
            <input {...field('baseUrl')} placeholder="https://cms.example.com/stacki/drafts" />
          </label>
          <label>
            {translate('cmsConnections.form.keyHeader')}
            <input {...field('header')} spellCheck={false} />
          </label>
        </>
      );
    default: {
      const exhaustive: never = props.cms;
      return exhaustive;
    }
  }
}

export function collectionList(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0),
    ),
  ];
}

function PayloadFields(props: {
  readonly field: FieldProps;
  readonly fields: Fields;
  readonly setFields: (next: Fields) => void;
  readonly detected: DetectState;
  readonly onDetect: () => void;
}) {
  const translate = useTranslate();
  const { field, fields } = props;
  return (
    <>
      <label>
        {translate('settings.cms.payload.address')}
        <input {...field('baseUrl')} placeholder="https://cms.example.com" spellCheck={false} />
      </label>
      <p className="hint-text">{translate('settings.cms.payload.addressHint')}</p>
      <div className="cms-form-row">
        <span>{translate('settings.cms.payload.mode')}</span>
        <Dropdown<PayloadAuthMode>
          ariaLabel={translate('settings.cms.payload.mode')}
          value={fields.auth}
          options={[
            { value: 'apiKey', label: translate('settings.cms.payload.mode.apiKey') },
            { value: 'password', label: translate('settings.cms.payload.mode.password') },
          ]}
          onChange={(auth) => props.setFields({ ...fields, auth })}
        />
      </div>
      <label>
        {translate('settings.cms.payload.authCollection')}
        <input {...field('collection')} spellCheck={false} />
      </label>
      <label>
        {translate('settings.cms.payload.collections')}
        {}
        <input {...field('collections')} placeholder="posts, pages" spellCheck={false} />
      </label>
      <p className="hint-text">{translate('settings.cms.payload.collectionsHint')}</p>
      <div className="cms-form-row">
        <button type="button" disabled={props.detected.kind === 'detecting'} onClick={props.onDetect}>
          {translate(props.detected.kind === 'detecting' ? 'settings.cms.payload.detecting' : 'settings.cms.payload.detect')}
        </button>
        {props.detected.kind === 'found' && <DetectedCollections summary={props.detected.summary} />}
      </div>
    </>
  );
}

function DetectedCollections({ summary }: { readonly summary: PayloadSummary }) {
  const translate = useTranslate();
  const live = summary.collections.filter((collection) => !collection.drafts && !collection.upload);
  return (
    <span className="cms-detected" role="status">
      {translate('settings.cms.payload.detected', { count: summary.collections.length })}
      {summary.collections.length > 0 && `: ${summary.collections.map((collection) => collection.slug).join(', ')}.`}
      {live.length > 0 && ' ' + translate('settings.cms.payload.liveIn', { names: live.map((collection) => collection.slug).join(', ') })}
    </span>
  );
}

function PayloadSecretFields(props: { readonly field: FieldProps; readonly auth: PayloadAuthMode }) {
  const translate = useTranslate();
  const { field } = props;
  if (props.auth === 'apiKey') {
    return (
      <label>
        {translate('settings.cms.payload.apiKey')}
        <input {...field('secret')} type="password" autoComplete="off" spellCheck={false} />
      </label>
    );
  }
  return (
    <>
      <label>
        {translate('settings.cms.payload.email')}
        <input {...field('email')} type="email" autoComplete="off" spellCheck={false} />
      </label>
      <label>
        {translate('settings.cms.payload.password')}
        <input {...field('secret')} type="password" autoComplete="off" spellCheck={false} />
      </label>
    </>
  );
}

function draftOf(cms: CmsKeyKind, fields: Fields, defaultLabel: string): Record<string, unknown> {
  const label = fields.label.trim() || defaultLabel;
  switch (cms) {
    case 'sanity':
      return {
        kind: cms,
        label,
        projectId: fields.projectId.trim(),
        dataset: fields.dataset.trim(),
        secret: fields.secret,
      };
    case 'payload':
      return {
        kind: cms,
        label,
        baseUrl: fields.baseUrl.trim(),
        collection: fields.collection.trim(),
        auth: fields.auth,
        ...(fields.auth === 'password' ? { email: fields.email.trim() } : {}),
        collections: collectionList(fields.collections),
        secret: fields.secret,
      };
    case 'custom':
      return {
        kind: cms,
        label,
        baseUrl: fields.baseUrl.trim(),
        header: fields.header.trim(),
        secret: fields.secret,
      };
    default: {
      const exhaustive: never = cms;
      return exhaustive;
    }
  }
}
