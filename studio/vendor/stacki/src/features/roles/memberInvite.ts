import { err, ok, type Result } from '../../../shared/core/result';
import { described, type Described } from '../../../shared/properties/i18n/messageRef';
import { IDENTITY_LIMITS, identityKey, parseProviderId, parseQualifiedIdentity } from '../../../shared/properties/memberIdentity';
import { assert } from '../../../shared/core/assert';
import {
  ADMIN_ROLE_ID,
  ROLE_LIMITS,
  adminMembershipRefusal,
  parseGitHubLogin,
  type ProjectRole,
  type ProjectRoles,
} from '../../../shared/properties/projectRoles';

export type InviteForm =
  | { readonly kind: 'github-login' }
  | { readonly kind: 'email'; readonly provider: 'access' | 'google' | 'oidc' }
  | { readonly kind: 'passkey-handle' }
  | { readonly kind: 'custom'; readonly provider: string; readonly displayName: string; readonly hint: string | undefined };

export function inviteFormFor(
  provider: string,
  custom: { readonly displayName: string; readonly hint: string | undefined } | undefined,
): InviteForm | undefined {
  if (custom !== undefined) {
    return parseProviderId(provider).ok ? { kind: 'custom', provider, displayName: custom.displayName, hint: custom.hint } : undefined;
  }
  switch (provider) {
    case 'github':
      return { kind: 'github-login' };
    case 'access':
    case 'google':
    case 'oidc':
      return { kind: 'email', provider };
    case 'passkey':
      return { kind: 'passkey-handle' };
    default:
      return undefined;
  }
}

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EMAIL_CHARS_MAX = 200;

export type InviteIdentifierError = Described;

export function parseInviteIdentifier(
  form: InviteForm,
  input: string,
  customParser?: (input: string) => string | undefined,
): Result<string, InviteIdentifierError> {
  const typed = input.trim();
  if (typed.length === 0 || typed.length > IDENTITY_LIMITS.identityCharsMax) {
    return err(described('roles.invite.error.identifier'));
  }
  switch (form.kind) {
    case 'github-login': {
      try {
        return ok(parseGitHubLogin(typed.replace(/^@/, '')));
      } catch {
        return err(described('roles.invite.error.login'));
      }
    }
    case 'email': {
      const email = typed.toLowerCase();
      return email.length <= EMAIL_CHARS_MAX && EMAIL.test(email) ? ok(`${form.provider}:${email}`) : err(described('roles.invite.error.email'));
    }
    case 'passkey-handle': {
      const handle = typed.toLowerCase();
      return HANDLE.test(handle) ? ok(`passkey:${handle}`) : err(described('roles.invite.error.handle'));
    }
    case 'custom': {
      const subject = customParser === undefined ? typed : customParser(typed);
      const identity = subject === undefined ? undefined : parseQualifiedIdentity(`${form.provider}:${subject}`);
      return identity?.ok === true ? ok(identity.value) : err(described('roles.invite.error.identifier'));
    }
  }
}

export function addInvitedMember(roles: ProjectRoles, roleId: string, member: string): Result<ProjectRoles, Described> {
  const target = roles.roles.find((role) => role.id === roleId);
  if (target === undefined) {
    return err(described('roles.invite.error.role'));
  }
  const key = identityKey(member);
  if (target.members.some((existing) => identityKey(existing) === key)) {
    return err(described('roles.error.memberListed', { login: member, role: target.name }));
  }
  if (target.members.length >= ROLE_LIMITS.membersMax) {
    return err(described('roles.error.membersMax', { count: ROLE_LIMITS.membersMax }));
  }
  const without = roles.roles.map((role) => ({ ...role, members: role.members.filter((existing) => identityKey(existing) !== key) }));
  const previous = roles.roles.find((role) => role.members.some((existing) => identityKey(existing) === key));
  if (previous?.id === ADMIN_ROLE_ID && (without.find((role) => role.id === ADMIN_ROLE_ID)?.members.length ?? 0) === 0) {
    return err(described('roles.error.lastAdmin'));
  }
  const next = without.map((role) => (role.id === roleId ? { ...role, members: [...role.members, member] } : role));
  const refusal = adminMembershipRefusal(next);
  if (refusal !== undefined) {
    return err(refusal);
  }
  assert(
    next.some((role) => role.members.includes(member)),
    'The invited member is in a role',
  );
  return ok({ ...roles, roles: next });
}

export function removeInvitedMember(roles: ProjectRoles, member: string): Result<ProjectRoles, Described> {
  const key = identityKey(member);
  const holder: ProjectRole | undefined = roles.roles.find((role) => role.members.some((existing) => identityKey(existing) === key));
  if (holder === undefined) {
    return err(described('roles.invite.error.notMember'));
  }
  const next = roles.roles.map((role) =>
    role.id === holder.id ? { ...role, members: role.members.filter((existing) => identityKey(existing) !== key) } : role,
  );
  if (adminMembershipRefusal(next) !== undefined) {
    return err(described('roles.error.lastAdmin'));
  }
  assert(next.length === roles.roles.length, 'Removing a member keeps every role');
  return ok({ ...roles, roles: next });
}

export type RolesChange =
  | { readonly kind: 'invite'; readonly member: string; readonly role: string }
  | { readonly kind: 'remove'; readonly member: string }
  | { readonly kind: 'move'; readonly member: string; readonly role: string };

export function rolesChangeMessage(change: RolesChange): string {
  const clean = (text: string) => text.replace(/[^\x20-\x7e]/g, '').slice(0, 100);
  switch (change.kind) {
    case 'invite':
      return `Invite ${clean(change.member)} as ${clean(change.role)}`;
    case 'move':
      return `Move ${clean(change.member)} to ${clean(change.role)}`;
    case 'remove':
      return `Remove ${clean(change.member)} from roles`;
  }
}

export type InviteResult =
  | {
      readonly kind: 'sign-in-link';
      readonly link: string;
      readonly provider: 'github' | 'google' | 'oidc' | 'access' | 'custom';
      readonly accessReminder: boolean;
    }
  | { readonly kind: 'passkey-link'; readonly link: string; readonly expiresAt: number };

export function signInLink(origin: string): string {
  return `${origin.replace(/\/$/, '')}/studio`;
}
