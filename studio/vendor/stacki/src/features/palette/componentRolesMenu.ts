import { assert } from '../../../shared/core/assert';
import { componentAccessIndex, resolveComponent, type ComponentState, type ComponentTarget } from '../../../shared/properties/componentAccess';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import type { ProjectRoles } from '../../../shared/properties/projectRoles';
import type { MenuEntry, MenuSubmenu, MenuToggle } from '../../ui/menuModel';

export interface PaletteRoleRules {
  readonly roles: ProjectRoles;
  readonly editable: boolean;
  readonly setVisibility: (roleId: string, target: ComponentTarget, state: ComponentState) => void;
}

export function rolesSubmenu(rules: PaletteRoleRules, target: ComponentTarget, files: readonly string[], translate: Translator): MenuSubmenu {
  assert(target.path.length > 0, 'A target names a path');
  assert(target.kind === 'folder' || files.length === 1, 'A component target has exactly its own file');
  const entries: MenuEntry[] = rules.roles.roles.map((role) => roleToggle(rules, role.id, role.name, target, files, translate));
  assert(entries.length === rules.roles.roles.length, 'Every role has a row');
  return { kind: 'submenu', id: 'roles', label: translate('palette.roles.menu'), entries, disabled: false };
}

function roleToggle(
  rules: PaletteRoleRules,
  roleId: string,
  name: string,
  target: ComponentTarget,
  files: readonly string[],
  translate: Translator,
): MenuToggle {
  const role = rules.roles.roles.find((item) => item.id === roleId);
  assert(role !== undefined, 'The role of a row exists');
  const index = componentAccessIndex(role.componentRules);
  const resolved = files.map((file) => resolveComponent(index, file));
  const visible = resolved.filter((item) => item.state === 'visible').length;
  const on = visible === files.length && files.length > 0;
  const next: ComponentState = on ? 'hidden' : 'visible';
  const first = resolved[0];
  let description: string | undefined;
  if (target.kind === 'component' && first !== undefined && first.state === 'hidden' && first.decision.kind === 'folder') {
    description = translate('palette.roles.hiddenByFolder', { folder: first.decision.folder });
  } else if (target.kind === 'folder' && visible > 0 && visible < files.length) {
    description = translate('palette.roles.someVisible', { visible, total: files.length });
  }
  return {
    kind: 'toggle',
    id: `role:${roleId}`,
    label: name,
    ...(description === undefined ? {} : { description }),
    on,
    disabled: !rules.editable,
    onChange: () => rules.setVisibility(roleId, target, next),
  };
}
