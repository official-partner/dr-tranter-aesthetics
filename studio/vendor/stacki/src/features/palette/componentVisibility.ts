import { useMemo } from 'react';
import { assert } from '../../../shared/core/assert';
import { componentAddable, componentOffers, componentRuleFile, offeredComponents, type ComponentSurface } from '../../../shared/properties/componentAccess';
import { DescribedError } from '../../../shared/properties/describedError';
import { described } from '../../../shared/properties/i18n/messageRef';
import type { RoleView } from '../../../shared/properties/projectRoles';
import { useCurrentRole } from '../../lib/useCurrentRole';

export interface InsertableComponent {
  readonly file?: string | undefined;
  readonly folder?: string | undefined;
  readonly name: string;
  readonly isLayout?: boolean | undefined;
  readonly origin?: { readonly kind: string } | undefined;
}

const NONE: readonly never[] = [];

export function componentsOfferedTo<T extends InsertableComponent>(role: RoleView, surface: ComponentSurface, components: readonly T[]): readonly T[] {
  const kept = offeredComponents(role, surface, components, componentRuleFile);
  assert(kept.length <= components.length, 'A role never gains components');
  return kept;
}

export function searchHidden(role: RoleView, component: InsertableComponent): boolean {
  return componentOffers(role)(componentRuleFile(component)) === 'browse-only';
}

export function canAddComponent(role: RoleView, component: InsertableComponent): boolean {
  return componentAddable(role, componentRuleFile(component));
}

export function assertCanAddComponent(role: RoleView, component: InsertableComponent): void {
  if (!canAddComponent(role, component)) {
    throw new DescribedError(described('roles.error.componentHidden', { role: role.name, name: component.name }));
  }
}

export function useOfferedComponents<T extends InsertableComponent>(surface: ComponentSurface, components: readonly T[] | undefined): readonly T[] {
  const role = useCurrentRole();
  return useMemo(() => componentsOfferedTo(role, surface, components ?? NONE), [role, surface, components]);
}
