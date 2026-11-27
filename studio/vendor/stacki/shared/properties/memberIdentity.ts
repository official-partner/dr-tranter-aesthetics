import { err, ok, type Result } from '../core/result';
import type { Brand } from '../core/brand';

export const IDENTITY_LIMITS = {
  providerCharsMax: 32,
  subjectCharsMax: 200,
  identityCharsMax: 233,
} as const satisfies Record<string, number>;

export const GITHUB_PROVIDER_ID = 'github';

export type ProviderId = Brand<string, 'ProviderId'>;
export type QualifiedIdentity = Brand<string, 'QualifiedIdentity'>;

export interface IdentityError {
  readonly code: 'not-text' | 'provider' | 'subject' | 'length' | 'shape';
  readonly message: string;
}

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]*$/;
const SUBJECT_PATTERN = /^[^\s,\u0000-\u001f\u007f]+$/u;

export function parseProviderId(input: unknown): Result<ProviderId, IdentityError> {
  if (typeof input !== 'string') {
    return err({ code: 'not-text', message: 'A provider id is text' });
  }
  if (input.length === 0 || input.length > IDENTITY_LIMITS.providerCharsMax) {
    return err({ code: 'length', message: `A provider id is 1 to ${IDENTITY_LIMITS.providerCharsMax} characters` });
  }
  if (!PROVIDER_PATTERN.test(input)) {
    return err({ code: 'provider', message: 'A provider id is lowercase letters, digits and hyphens, starting with a letter' });
  }
  return ok(input as ProviderId);
}

export function parseQualifiedIdentity(input: unknown): Result<QualifiedIdentity, IdentityError> {
  if (typeof input !== 'string') {
    return err({ code: 'not-text', message: 'An identity is text' });
  }
  if (input.length === 0 || input.length > IDENTITY_LIMITS.identityCharsMax) {
    return err({ code: 'length', message: `An identity is 1 to ${IDENTITY_LIMITS.identityCharsMax} characters` });
  }
  const colon = input.indexOf(':');
  if (colon < 1) {
    return err({ code: 'shape', message: 'An identity is <provider>:<subject>' });
  }
  const provider = parseProviderId(input.slice(0, colon));
  if (!provider.ok) {
    return provider;
  }
  const subject = input.slice(colon + 1);
  if (subject.length === 0 || subject.length > IDENTITY_LIMITS.subjectCharsMax) {
    return err({ code: 'length', message: `An identity subject is 1 to ${IDENTITY_LIMITS.subjectCharsMax} characters` });
  }
  if (!SUBJECT_PATTERN.test(subject)) {
    return err({ code: 'subject', message: 'An identity subject has no spaces, commas or control characters' });
  }
  return ok(input as QualifiedIdentity);
}

export function identityProvider(identity: QualifiedIdentity): ProviderId {
  const colon = identity.indexOf(':');
  const provider = parseProviderId(identity.slice(0, colon));
  if (!provider.ok) {
    throw new Error('Assertion failed: a qualified identity starts with a valid provider id');
  }
  return provider.value;
}

export function identitySubject(identity: QualifiedIdentity): string {
  return identity.slice(identity.indexOf(':') + 1);
}

export function githubIdentity(login: string): Result<QualifiedIdentity, IdentityError> {
  return parseQualifiedIdentity(`${GITHUB_PROVIDER_ID}:${login}`);
}

export function identityKey(identityOrLogin: string): string {
  const colon = identityOrLogin.indexOf(':');
  if (colon < 0) {
    return `${GITHUB_PROVIDER_ID}:${identityOrLogin.toLowerCase()}`;
  }
  const provider = identityOrLogin.slice(0, colon);
  const subject = identityOrLogin.slice(colon + 1);
  return provider === GITHUB_PROVIDER_ID ? `${provider}:${subject.toLowerCase()}` : identityOrLogin;
}
