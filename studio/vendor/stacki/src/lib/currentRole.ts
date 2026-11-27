import { assert } from '../../shared/core/assert';
import { sameComponentRules } from '../../shared/properties/componentAccess';
import { ADMIN_VIEW, sameAppPermissions, type RoleView } from '../../shared/properties/projectRoles';

const LISTENERS_MAX = 500;

let actual: RoleView = ADMIN_VIEW;
let viewAs: RoleView | undefined;
const listeners = new Set<(role: RoleView) => void>();

export function currentRole(): RoleView {
  const role = viewAs ?? actual;
  assert(viewAs === undefined || actual.isAdmin, 'Only an admin can view as another role');
  return role;
}

export function onRoleChange(listener: (role: RoleView) => void): () => void {
  assert(listeners.size < LISTENERS_MAX, 'Role listeners are bounded');
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function actualRole(): RoleView {
  assert(actual.id.length > 0, 'The actual role has an id');
  return actual;
}

export function viewingAs(): RoleView | undefined {
  assert(viewAs === undefined || actual.isAdmin, 'Only an admin can view as another role');
  return viewAs;
}

export function setActualRole(role: RoleView): void {
  assert(role.id.length > 0, 'A role has an id');
  const before = currentRole();
  actual = role;
  if (!role.isAdmin) {
    viewAs = undefined;
  }
  notify(before);
}

export function setViewAs(role: RoleView | undefined): void {
  assert(role === undefined || actual.isAdmin, 'Only an admin can view as another role');
  const before = currentRole();
  viewAs = role === undefined || role.isAdmin ? undefined : role;
  notify(before);
}

function notify(before: RoleView): void {
  const after = currentRole();
  if (sameView(before, after)) {
    return;
  }
  assert(listeners.size <= LISTENERS_MAX, 'Role listeners are bounded');
  for (const listener of [...listeners]) {
    listener(after);
  }
}

function sameView(left: RoleView, right: RoleView): boolean {
  if (left === right) {
    return true;
  }
  if (left.id !== right.id || left.name !== right.name || left.features.size !== right.features.size) {
    return false;
  }
  if (![...left.features].every((feature) => right.features.has(feature))) {
    return false;
  }
  return (
    sameAppPermissions(left.appPermissions, right.appPermissions) &&
    samePins(left.pinnedApps, right.pinnedApps) &&
    sameComponentRules(left.componentRules, right.componentRules)
  );
}

function samePins(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((appId, index) => right[index] === appId);
}
