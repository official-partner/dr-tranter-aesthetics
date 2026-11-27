import { useCallback, useEffect, useState } from 'react';
import { APPS_DIRECTORY, type AppSummary } from '../../../shared/properties/apps';
import type { AppFolderBroken } from '../../../shared/properties/appFolders';
import { APP_FOLDER_REVEAL, revealAppFolder } from '../../ipc/appFoldersBridge';
import { scanAppSecrets } from '../../ipc/appPublishBridge';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { CodeInline } from '../../ui/CodeBlock';
import { FolderIcon, WarningTriangleIcon } from '../../ui/Icons';
import { AppDetailsItem, AppDetailsList, AppDetailsSection } from './AppDetailsLayout';
import { SecretScanStatus, type ScanLoad } from './SecretScanReport';
import './publish.css';

export function BrokenAppRow({ broken, projectPath }: { readonly broken: AppFolderBroken; readonly projectPath: string }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  return (
    <li className="apps-row apps-row-broken">
      <div className="apps-row-main">
        <span className="apps-row-select">
          <span className="apps-tile lettered apps-tile-broken" aria-hidden="true">
            <WarningTriangleIcon size={16} />
          </span>
          <span className="apps-row-text">
            <span className="apps-row-name">
              <span className="apps-row-title">{broken.folder}</span>
            </span>
            <span className="apps-row-description" title={translateDescribed(broken)}>
              {translateDescribed(broken)}
            </span>
          </span>
        </span>
        {APP_FOLDER_REVEAL && (
          <span className="apps-row-actions">
            <button
              type="button"
              className="apps-icon-button"
              title={translate('apps.folder.showInFinder')}
              aria-label={translate('apps.folder.showNamedInFinder', { name: broken.folder })}
              onClick={() => void revealAppFolder(projectPath, broken.folder)}
            >
              <FolderIcon size={14} />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

export function AppFolderScanSection({ projectPath, app }: { readonly projectPath: string; readonly app: AppSummary }) {
  if (app.lock.source.kind !== 'local') {
    return undefined;
  }
  return <AppFolderScan projectPath={projectPath} app={app} />;
}

function AppFolderScan({ projectPath, app }: { readonly projectPath: string; readonly app: AppSummary }) {
  const translate = useTranslate();
  const id = app.manifest.id;
  const [scan, setScan] = useState<ScanLoad>({ kind: 'loading' });
  const runScan = useCallback(() => {
    setScan({ kind: 'loading' });
    void scanAppSecrets(projectPath, { kind: 'installed', id }).then(
      (answer) => setScan(answer.ok ? { kind: 'ready', scan: answer.value } : { kind: 'failed', message: answer.message, messageRef: answer.messageRef }),
      (error: unknown) => setScan({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  }, [projectPath, id]);
  useEffect(() => runScan(), [runScan, app.lock.sha256]);
  return (
    <AppDetailsSection title={translate('apps.folder.scanTitle')} hint={translate('apps.folder.scanHint', { folder: `${APPS_DIRECTORY}/${id}/` })}>
      <SecretScanStatus load={scan} onRescan={runScan} />
    </AppDetailsSection>
  );
}

export function AppServicesSection({ app }: { readonly app: AppSummary }) {
  const translate = useTranslate();
  const { network, auth } = app.manifest;
  if (network.length === 0 && auth.length === 0) {
    return undefined;
  }
  return (
    <AppDetailsSection title={translate('apps.services.title')} hint={translate('apps.services.hint')}>
      <AppDetailsList label={translate('apps.services.listLabel', { name: app.manifest.name })}>
        {network.map((entry) => (
          <AppDetailsItem key={`host:${entry.host}`} label={<CodeInline text={entry.host} />} title={entry.host} tone="warning">
            <span className="apps-details-muted" title={entry.purpose}>
              {entry.purpose}
            </span>
          </AppDetailsItem>
        ))}
        {auth.map((provider) => (
          <AppDetailsItem key={`auth:${provider.id}`} label={provider.label}>
            <span className="apps-details-muted">{translate('apps.services.ownAccount')}</span>
          </AppDetailsItem>
        ))}
      </AppDetailsList>
    </AppDetailsSection>
  );
}
