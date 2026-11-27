import {
  EMDASH_INSTALL_LIMITS,
  type EmDashInstallFailure,
  type EmDashInstallRefusal,
  type EmDashInstallWarning,
} from '../../../shared/properties/emdashInstall';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';

export const INSTALL_LOG_LINES_SHOWN = 200;

export const REFUSAL_KEYS: Readonly<Record<EmDashInstallRefusal, MessageKey>> = {
  alreadyInstalled: 'emdash.install.refusal.alreadyInstalled',
  astroTooOld: 'emdash.install.refusal.astroTooOld',
  busy: 'emdash.install.refusal.busy',
  noPackageJson: 'emdash.install.refusal.noPackageJson',
  notAstro: 'emdash.install.refusal.notAstro',
  notConfirmed: 'emdash.install.refusal.notConfirmed',
};

export const FAILURE_KEYS: Readonly<Record<EmDashInstallFailure, MessageKey>> = {
  engineMismatch: 'emdash.install.failure.engineMismatch',
  managerMissing: 'emdash.install.failure.managerMissing',
  noNetwork: 'emdash.install.failure.noNetwork',
  other: 'emdash.install.failure.other',
  peerConflict: 'emdash.install.failure.peerConflict',
  saveFailed: 'emdash.install.failure.saveFailed',
  permission: 'emdash.install.failure.permission',
  timeout: 'emdash.install.failure.timeout',
};

export const WARNING_KEYS: Readonly<Record<EmDashInstallWarning, MessageKey>> = {
  otherAdapter: 'emdash.install.warning.otherAdapter',
};

export function logTail(log: string): string {
  const lines = log.split('\n');
  const shown = lines.length > INSTALL_LOG_LINES_SHOWN ? lines.slice(lines.length - INSTALL_LOG_LINES_SHOWN) : lines;
  return shown
    .join('\n')
    .slice(-EMDASH_INSTALL_LIMITS.logCharsMax)
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}
