import { assert } from '../core/assert';
import { record } from '../core/boundary';
import { englishText, messageRef, type TypedMessageRef } from './i18n/messageRef';

export const MICROPHONE_STATUSES = ['granted', 'not-determined', 'denied', 'restricted', 'unknown'] as const;
export type MicrophoneStatus = (typeof MICROPHONE_STATUSES)[number];

export interface MicrophoneReport {
  readonly status: MicrophoneStatus;
  readonly appName: string;
  readonly settingsAvailable: boolean;
}

export const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

const APP_NAME_CHARS_MAX = 80;

export function parseMicrophoneReport(input: unknown): MicrophoneReport {
  const value = record(input);
  const status = MICROPHONE_STATUSES.find((candidate) => candidate === value['status']);
  if (status === undefined) {
    throw new Error('microphone.status: unknown status');
  }
  const appName = value['appName'];
  if (typeof appName !== 'string' || appName.length === 0 || appName.length > APP_NAME_CHARS_MAX) {
    throw new Error('microphone.appName: expected a short name');
  }
  if (typeof value['settingsAvailable'] !== 'boolean') {
    throw new Error('microphone.settingsAvailable: expected a boolean');
  }
  return { status, appName, settingsAvailable: value['settingsAvailable'] };
}

export function parseMicrophoneOpened(input: unknown): true {
  const value = record(input);
  if (value['ok'] !== true) {
    throw new Error('microphone.opened: expected ok');
  }
  return true;
}

export function microphoneAdvice(report: MicrophoneReport): MicrophoneAdvice {
  assert(report.appName.length > 0, 'microphoneAdvice: the application has a name');
  const restricted = report.status === 'restricted';
  const messageReference = messageRef(restricted ? 'ai.dictation.restricted' : 'ai.dictation.off');
  const hintReference = restricted ? messageRef('ai.dictation.restrictedHint') : messageRef('ai.dictation.offHint', { app: report.appName });
  return { message: englishText(messageReference), hint: englishText(hintReference), messageRef: messageReference, hintRef: hintReference };
}

export interface MicrophoneAdvice {
  readonly message: string;
  readonly hint: string;
  readonly messageRef: TypedMessageRef;
  readonly hintRef: TypedMessageRef;
}
