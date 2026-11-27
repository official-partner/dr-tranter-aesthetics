import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import type { AppDetailsSectionId } from './AppDetails';

export interface AppDetailsRequest {
  readonly appId: string;
  readonly section: AppDetailsSectionId;
  readonly serial: number;
}

const SERIAL_MAX = Number.MAX_SAFE_INTEGER;

let pending: AppDetailsRequest | undefined;
let serial = 0;
let reveal: (() => void) | undefined;
const listeners = new Set<() => void>();

export function requestAppDetails(appId: string, section: AppDetailsSectionId): void {
  assert(appId.length > 0, 'A details request names its app');
  assert(serial < SERIAL_MAX, 'Request serials stay safe integers');
  serial += 1;
  pending = { appId, section, serial };
  reveal?.();
  notify();
}

export function setAppDetailsReveal(next: (() => void) | undefined): void {
  reveal = next;
}

export function useAppDetailsRequest(): { readonly request: AppDetailsRequest | undefined; readonly handled: (request: AppDetailsRequest) => void } {
  const current = useSyncExternalStore(subscribe, () => pending);
  return { request: current, handled: handleAppDetailsRequest };
}

export function handleAppDetailsRequest(request: AppDetailsRequest): void {
  if (pending?.serial === request.serial) {
    pending = undefined;
    notify();
  }
  assert(pending?.serial !== request.serial, 'A handled request is no longer pending');
}

export function pendingAppDetailsRequest(): AppDetailsRequest | undefined {
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
