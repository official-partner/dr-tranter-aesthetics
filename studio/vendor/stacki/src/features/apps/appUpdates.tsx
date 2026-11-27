import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import { APP_LIMITS, type AppAvailableUpdate, type AppSummary, type AppUpdateOutcome } from '../../../shared/properties/apps';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { Switch } from '../../ui/Switch';
import { AppsRailCount } from './appBadges';
import { AppDetailsItem } from './AppDetailsLayout';
import './marketplace/marketplace.css';

let waiting: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  assert(next.size <= APP_LIMITS.appsMax, 'Waiting updates are bounded by the installed apps');
  waiting = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function noteInstalledApps(apps: readonly AppSummary[]): void {
  assert(apps.length <= APP_LIMITS.appsMax, 'Installed apps are bounded');
  publish(new Set(apps.filter((app) => appUpdateStatus(app.lock).kind !== 'none').map((app) => app.manifest.id)));
}

export function noteUpdateOutcomes(outcomes: readonly AppUpdateOutcome[]): void {
  assert(outcomes.length <= APP_LIMITS.appsMax, 'Outcomes are bounded by the installed apps');
  const next = new Set(waiting);
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'available':
        next.add(outcome.id);
        break;
      case 'needs-approval':
        next.add(outcome.id);
        break;
      case 'updated':
        next.delete(outcome.id);
        break;
      case 'current':
        next.delete(outcome.id);
        break;
      case 'failed':
        break;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }
  publish(next);
}

export function waitingUpdateCount(): number {
  return waiting.size;
}

export function useWaitingUpdateCount(): number {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, waitingUpdateCount);
}

export function AppsRailBadge({ admin }: { readonly admin: boolean }) {
  return (
    <>
      <AppsRailCount />
      {admin && <UpdateDot />}
    </>
  );
}

function UpdateDot() {
  const translate = useTranslate();
  const count = useWaitingUpdateCount();
  if (count === 0) {
    return undefined;
  }
  return <span className="apps-rail-badge" role="status" aria-label={translate('apps.updates.available', { count })} />;
}

export function updateAvailableLabel(update: AppAvailableUpdate, translate: Translator): string {
  assert(update.version.length > 0, 'An update names its version');
  return translate('apps.updates.availableVersion', { version: update.version });
}

export type AppUpdateStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly update: AppAvailableUpdate }
  | { readonly kind: 'needs-approval'; readonly update: AppAvailableUpdate };

export function appUpdateStatus(lock: AppSummary['lock']): AppUpdateStatus {
  if (!appUpdatable(lock.source)) {
    return { kind: 'none' };
  }
  const { update } = lock;
  if (update === undefined) {
    return { kind: 'none' };
  }
  if (lock.autoUpdate) {
    if (update.additions.length > 0) {
      return { kind: 'needs-approval', update };
    }
  }
  return { kind: 'available', update };
}

export function updateStatusLabel(status: Exclude<AppUpdateStatus, { readonly kind: 'none' }>, translate: Translator): string {
  assert(status.update.version.length > 0, 'An update names its version');
  switch (status.kind) {
    case 'available':
      return updateAvailableLabel(status.update, translate);
    case 'needs-approval':
      return translate('apps.updates.needsApproval', { version: status.update.version });
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function updateAdditionsNote(update: AppAvailableUpdate, translate: Translator): string | undefined {
  if (update.additions.length === 0) {
    return undefined;
  }
  return translate('apps.updates.additions', { version: update.version, additions: update.additions.join(', ') });
}

export function AutoUpdateSetting({
  app,
  admin,
  busy,
  onChange,
}: {
  readonly app: AppSummary;
  readonly admin: boolean;
  readonly busy: boolean;
  readonly onChange: (policy: { readonly autoUpdate: boolean }) => void;
}) {
  const translate = useTranslate();
  const { lock } = app;
  if (!appUpdatable(lock.source)) {
    return undefined;
  }
  return (
    <AppDetailsItem label={translate('apps.updates.automatically')} hint={translate('apps.updates.automaticallyHint')}>
      <Switch
        label={translate('apps.updates.automaticallyNamed', { name: app.manifest.name })}
        checked={lock.autoUpdate}
        disabled={!admin || busy}
        onToggle={() => onChange({ autoUpdate: !lock.autoUpdate })}
      />
    </AppDetailsItem>
  );
}

export function appUpdatable(source: AppSummary['lock']['source']): boolean {
  switch (source.kind) {
    case 'github':
    case 'marketplace':
      return true;
    case 'file':
    case 'local':
      return false;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}
