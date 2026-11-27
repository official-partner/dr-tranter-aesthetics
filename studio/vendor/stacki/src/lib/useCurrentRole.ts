import { useSyncExternalStore } from 'react';
import type { RoleView } from '../../shared/properties/projectRoles';
import { actualRole, currentRole, onRoleChange } from './currentRole';

export function useCurrentRole(): RoleView {
  return useSyncExternalStore(onRoleChange, currentRole, currentRole);
}

export function useActualRole(): RoleView {
  return useSyncExternalStore(onRoleChange, actualRole, actualRole);
}
