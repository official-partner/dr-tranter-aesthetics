import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import { APP_PERMISSION_LIMITS, parseAppPermissionId, type AppPermissionDeclaration } from './appPermissions';
import { parseComponentRules, storedComponentRule, type ComponentRule } from './componentAccess';
import { DescribedError } from './describedError';
import { identityKey, parseQualifiedIdentity, GITHUB_PROVIDER_ID, identityProvider, identitySubject } from './memberIdentity';
import { described, messageRef, type Described, type TypedMessageRef } from './i18n/messageRef';

export const ROLES_FILE = '.stacki/roles.json';

export const ROLE_LIMITS = {
  fileCharsMax: 262_144,
  rolesMax: 32,
  membersMax: 200,
  aliasesMax: 8,
  roleIdCharsMax: 40,
  roleNameCharsMax: 60,
  loginCharsMax: 39,
  appIdCharsMax: 64,
  accessMax: 256,
  appPermissionAppsMax: 64,
  pinnedAppsMax: 12,
} as const satisfies Record<string, number>;

export const ACCESS_FEATURES = [
  'panel:elements',
  'panel:pages',
  'panel:navigator',
  'panel:properties',
  'panel:components',
  'panel:assets',
  'panel:cms',
  'panel:variables',
  'panel:selectors',
  'panel:code',
  'panel:history',
  'panel:apps',
  'panel:ai',
  'panel:instructions',
  'panel:audits',
  'panel:projectSettings',
  'panel:style',
  'panel:settings',
  'page:create',
  'page:delete',
  'page:rename',
  'page:layout',
  'component:create',
  'component:edit',
  'code:edit',
  'instructions:edit',
  'publish',
  'marketplace:view',
  'marketplace:install',
  'marketplace:publish',
  'apps:share',
  'settings:editor',
  'settings:folders',
  'settings:cms',
  'settings:studio',
  'settings:instructions',
  'settings:audits',
  'settings:breakpoints',
  'settings:roles',
  'cli:read',
  'cli:config',
  'cli:guides',
  'cli:breakpoints',
  'cli:folders',
  'cli:components',
  'cli:apps',
  'cli:roles',
] as const;
export type StaticAccessFeature = (typeof ACCESS_FEATURES)[number];

export type AppAccessFeature = `app:${string}`;
export type AccessFeature = StaticAccessFeature | AppAccessFeature;
export const APP_ACCESS_ALL = 'app:*' satisfies AppAccessFeature;

export type AppPermissionGrants = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

export interface RoleView {
  readonly id: string;
  readonly name: string;
  readonly isAdmin: boolean;
  readonly features: ReadonlySet<AccessFeature>;
  readonly appPermissions: AppPermissionGrants;
  readonly pinnedApps: readonly string[];
  readonly componentRules: readonly ComponentRule[];
}

export function can(role: RoleView, feature: AccessFeature): boolean {
  assert(role.id.length > 0, 'A role view has an id');
  assert(role.isAdmin === (role.id === ADMIN_ROLE_ID), 'Only the admin role is admin');
  if (role.isAdmin) {
    return true;
  }
  if (feature === 'settings:roles' || feature === 'cli:roles') {
    return false;
  }
  if (isAppFeature(feature)) {
    if (role.features.has('panel:apps')) {
      return role.features.has(feature) || role.features.has(APP_ACCESS_ALL);
    }
    return false;
  }
  if (feature === 'marketplace:view' || feature === 'marketplace:install' || feature === 'marketplace:publish') {
    return canMarketplace(role, feature);
  }
  if (feature === 'instructions:edit') {
    return role.features.has('panel:instructions') && role.features.has(feature);
  }
  if (feature === 'apps:share') {
    return role.features.has('panel:apps') && role.features.has(feature);
  }
  if (feature === 'panel:elements') {
    return canElements(role);
  }
  return role.features.has(feature);
}

function canElements(role: RoleView): boolean {
  assert(!role.isAdmin, 'Admin is answered before the Elements rule');
  if (role.features.has('panel:elements')) {
    return true;
  }
  if (role.features.has('panel:navigator')) {
    return true;
  }
  return PAGE_EDIT_FEATURES.some((feature) => role.features.has(feature));
}

const PAGE_EDIT_FEATURES = ['page:create', 'page:delete', 'page:rename', 'page:layout'] as const satisfies readonly StaticAccessFeature[];

function canMarketplace(role: RoleView, feature: 'marketplace:view' | 'marketplace:install' | 'marketplace:publish'): boolean {
  assert(!role.isAdmin, 'Admin is answered before the marketplace rules');
  if (!role.features.has('panel:apps')) {
    return false;
  }
  if (!role.features.has('marketplace:view')) {
    return false;
  }
  return role.features.has(feature);
}

export const ADMIN_ROLE_ID = 'admin';
export const CLIENT_ROLE_ID = 'client';
export const ADMIN_ROLE_ALIASES: readonly string[] = ['developer', 'designer'];

export const CLIENT_DEFAULT_ACCESS: readonly StaticAccessFeature[] = [
  'panel:elements',
  'panel:pages',
  'panel:navigator',
  'panel:components',
  'panel:assets',
  'panel:cms',
  'panel:history',
  'panel:settings',
  'page:create',
  'page:delete',
  'page:rename',
  'publish',
  'settings:editor',
  'cli:read',
];

export const ADMIN_VIEW: RoleView = {
  id: ADMIN_ROLE_ID,
  name: 'Admin',
  isAdmin: true,
  features: new Set(ACCESS_FEATURES),
  appPermissions: {},
  pinnedApps: [],
  componentRules: [],
};

export interface ProjectRole {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
  readonly access: readonly AccessFeature[];
  readonly appPermissions: AppPermissionGrants;
  readonly pinnedApps: readonly string[];
  readonly componentRules: readonly ComponentRule[];
}

export interface ProjectRoles {
  readonly version: 1;
  readonly defaultRole: string;
  readonly roles: readonly ProjectRole[];
}

export const DEFAULT_PROJECT_ROLES: ProjectRoles = {
  version: 1,
  defaultRole: ADMIN_ROLE_ID,
  roles: [
    { id: ADMIN_ROLE_ID, name: 'Admin', members: [], access: [], appPermissions: {}, pinnedApps: [], componentRules: [] },
    { id: CLIENT_ROLE_ID, name: 'Client', members: [], access: CLIENT_DEFAULT_ACCESS, appPermissions: {}, pinnedApps: [], componentRules: [] },
  ],
};

export const APPS_ACCESS_GROUP = 'Apps';

export const ACCESS_GROUPS: readonly {
  readonly label: string;
  readonly labelRef: TypedMessageRef;
  readonly features: readonly { readonly feature: StaticAccessFeature; readonly label: string; readonly labelRef: TypedMessageRef }[];
}[] = [
  {
    label: 'Panels',
    labelRef: messageRef('roles.group.panels'),
    features: [
      { feature: 'panel:elements', label: 'Add elements', labelRef: messageRef('roles.feature.panelElements') },
      { feature: 'panel:pages', label: 'Pages', labelRef: messageRef('roles.feature.panelPages') },
      { feature: 'panel:navigator', label: 'Navigator', labelRef: messageRef('roles.feature.panelNavigator') },
      { feature: 'panel:properties', label: 'Component properties', labelRef: messageRef('roles.feature.panelProperties') },
      { feature: 'panel:components', label: 'Components', labelRef: messageRef('roles.feature.panelComponents') },
      { feature: 'panel:assets', label: 'Assets', labelRef: messageRef('roles.feature.panelAssets') },
      { feature: 'panel:cms', label: 'CMS', labelRef: messageRef('roles.feature.panelCms') },
      { feature: 'panel:variables', label: 'Variables', labelRef: messageRef('roles.feature.panelVariables') },
      { feature: 'panel:selectors', label: 'Style selectors', labelRef: messageRef('roles.feature.panelSelectors') },
      { feature: 'panel:code', label: 'Code', labelRef: messageRef('roles.feature.panelCode') },
      { feature: 'panel:history', label: 'Git', labelRef: messageRef('roles.feature.panelHistory') },
      { feature: 'panel:apps', label: 'Apps', labelRef: messageRef('roles.feature.panelApps') },
      { feature: 'panel:ai', label: 'AI chat', labelRef: messageRef('roles.feature.panelAi') },
      { feature: 'panel:instructions', label: 'Instructions (in Settings)', labelRef: messageRef('roles.feature.panelInstructions') },
      { feature: 'panel:audits', label: 'Audits', labelRef: messageRef('roles.feature.panelAudits') },
      { feature: 'panel:projectSettings', label: 'Project settings (secrets, MCP servers)', labelRef: messageRef('roles.feature.panelProjectSettings') },
      { feature: 'panel:style', label: 'Style panel', labelRef: messageRef('roles.feature.panelStyle') },
      { feature: 'panel:settings', label: 'Settings panel', labelRef: messageRef('roles.feature.panelSettings') },
    ],
  },
  {
    label: 'Pages',
    labelRef: messageRef('roles.group.pages'),
    features: [
      { feature: 'page:create', label: 'Create pages', labelRef: messageRef('roles.feature.pageCreate') },
      { feature: 'page:delete', label: 'Delete pages', labelRef: messageRef('roles.feature.pageDelete') },
      { feature: 'page:rename', label: 'Rename and move pages', labelRef: messageRef('roles.feature.pageRename') },
      { feature: 'page:layout', label: 'Edit the layout and outside it', labelRef: messageRef('roles.feature.pageLayout') },
    ],
  },
  {
    label: 'Components',
    labelRef: messageRef('roles.group.components'),
    features: [
      { feature: 'component:create', label: 'Create components', labelRef: messageRef('roles.feature.componentCreate') },
      { feature: 'component:edit', label: 'Edit component source', labelRef: messageRef('roles.feature.componentEdit') },
    ],
  },
  {
    label: 'Code and publishing',
    labelRef: messageRef('roles.group.codeAndPublishing'),
    features: [
      { feature: 'code:edit', label: 'Edit code', labelRef: messageRef('roles.feature.codeEdit') },
      { feature: 'instructions:edit', label: 'Edit instructions', labelRef: messageRef('roles.feature.instructionsEdit') },
      { feature: 'publish', label: 'Publish', labelRef: messageRef('roles.feature.publish') },
    ],
  },
  {
    label: APPS_ACCESS_GROUP,
    labelRef: messageRef('roles.group.apps'),
    features: [
      { feature: 'marketplace:view', label: 'See the marketplace', labelRef: messageRef('roles.feature.marketplaceView') },
      { feature: 'marketplace:install', label: 'Install from the marketplace', labelRef: messageRef('roles.feature.marketplaceInstall') },
      { feature: 'marketplace:publish', label: 'Publish to the marketplace', labelRef: messageRef('roles.feature.marketplacePublish') },
      { feature: 'apps:share', label: 'Share apps to GitHub', labelRef: messageRef('roles.feature.appsShare') },
    ],
  },
  {
    label: 'Settings',
    labelRef: messageRef('roles.group.settings'),
    features: [
      { feature: 'settings:editor', label: 'Editor settings', labelRef: messageRef('roles.feature.settingsEditor') },
      { feature: 'settings:folders', label: 'Folders', labelRef: messageRef('roles.feature.settingsFolders') },
      { feature: 'settings:cms', label: 'CMS and media connections', labelRef: messageRef('roles.feature.settingsCms') },
      { feature: 'settings:studio', label: 'Stacki Studio', labelRef: messageRef('roles.feature.settingsStudio') },
      { feature: 'settings:instructions', label: 'Hidden instructions', labelRef: messageRef('roles.feature.settingsInstructions') },
      { feature: 'settings:audits', label: 'Audit checks', labelRef: messageRef('roles.feature.settingsAudits') },
      { feature: 'settings:breakpoints', label: 'Breakpoints', labelRef: messageRef('roles.feature.settingsBreakpoints') },
    ],
  },
  {
    label: 'Command line',
    labelRef: messageRef('roles.group.cli'),
    features: [
      { feature: 'cli:read', label: 'Read settings', labelRef: messageRef('roles.feature.cliRead') },
      { feature: 'cli:config', label: 'Change settings files', labelRef: messageRef('roles.feature.cliConfig') },
      { feature: 'cli:guides', label: 'Edit column guides', labelRef: messageRef('roles.feature.cliGuides') },
      { feature: 'cli:breakpoints', label: 'Edit breakpoints', labelRef: messageRef('roles.feature.cliBreakpoints') },
      { feature: 'cli:folders', label: 'Edit folders', labelRef: messageRef('roles.feature.cliFolders') },
      { feature: 'cli:components', label: 'Manage components', labelRef: messageRef('roles.feature.cliComponents') },
      { feature: 'cli:apps', label: 'Manage apps', labelRef: messageRef('roles.feature.cliApps') },
    ],
  },
];

export function isAppFeature(feature: AccessFeature): feature is AppAccessFeature {
  assert(feature.length > 0, 'A feature id is never empty');
  const app = feature.startsWith('app:');
  assert(!app || feature.length > 'app:'.length, 'An app grant names an app');
  return app;
}

export function sameLogin(left: string, right: string): boolean {
  assert(left.length > 0, 'A login to compare is never empty');
  assert(right.length > 0, 'A login to compare is never empty');
  return left.toLowerCase() === right.toLowerCase();
}

export function parseGitHubLogin(input: unknown): string {
  const login = text(input).trim();
  if (login.length === 0 || login.length > ROLE_LIMITS.loginCharsMax) {
    throw new DescribedError(described('roles.error.loginLength', { max: ROLE_LIMITS.loginCharsMax }));
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/.test(login)) {
    throw new DescribedError(described('roles.error.loginInvalid', { login }));
  }
  assert(login.length <= ROLE_LIMITS.loginCharsMax, 'A parsed login is within the GitHub limit');
  return login;
}

export function parseGitHubLoginQuery(input: unknown): string {
  const query = text(input).trim();
  if (query.length === 0 || query.length > ROLE_LIMITS.loginCharsMax) {
    throw new Error(`A GitHub username search is 1 to ${ROLE_LIMITS.loginCharsMax} characters`);
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]|$))*$/.test(query)) {
    throw new Error(`"${query}" cannot start a GitHub username`);
  }
  assert(query.length <= ROLE_LIMITS.loginCharsMax, 'A parsed login query is within the GitHub limit');
  return query;
}

export function parseProjectRolesSource(source: string): ProjectRoles {
  if (source.length > ROLE_LIMITS.fileCharsMax) {
    throw new Error(`${ROLES_FILE} exceeds ${ROLE_LIMITS.fileCharsMax} characters`);
  }
  const input: unknown = JSON.parse(source);
  const roles = parseProjectRoles(input);
  assert(roles.roles.length >= 2, 'A parsed file always holds admin and client');
  return roles;
}

export function parseProjectRoles(input: unknown): ProjectRoles {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Roles file version must be 1');
  }
  const items = toArray(value['roles']);
  if (items === undefined) {
    throw new Error('Roles file needs a roles list');
  }
  if (items.length > ROLE_LIMITS.rolesMax) {
    throw new Error(`A project has at most ${ROLE_LIMITS.rolesMax} roles`);
  }
  const parsed = items.map(parseRole);
  const roles = withBuiltInRoles(parsed);
  assertUnique(roles);
  const refusal = adminMembershipRefusal(roles);
  if (refusal !== undefined) {
    throw new DescribedError(refusal);
  }
  const defaultRole = value['defaultRole'] === undefined ? ADMIN_ROLE_ID : canonicalRoleId(roleId(value['defaultRole']));
  if (!roles.some((role) => role.id === defaultRole)) {
    throw new Error(`Default role "${defaultRole}" is not a role`);
  }
  return { version: 1, defaultRole, roles };
}

export function rolesClaimed(roles: ProjectRoles): boolean {
  assert(roles.roles.length >= 2, 'Roles always hold admin and client');
  const claimed = roles.roles.some((role) => role.members.length > 0);
  const admin = roles.roles.find((role) => role.id === ADMIN_ROLE_ID);
  assert(admin !== undefined, 'Roles always hold admin');
  assert(!claimed || admin.members.length > 0, 'A claimed roles file names an admin');
  return claimed;
}

export function adminMembershipRefusal(roles: readonly ProjectRole[]): Described | undefined {
  assert(roles.length <= ROLE_LIMITS.rolesMax, 'Roles are bounded');
  const admin = roles.find((role) => role.id === ADMIN_ROLE_ID);
  assert(admin !== undefined, 'Roles always hold admin');
  if (admin.members.length > 0) {
    return undefined;
  }
  if (roles.some((role) => role.members.length > 0)) {
    return described('roles.error.adminFirst');
  }
  return undefined;
}

export function serializeProjectRoles(roles: ProjectRoles): string {
  const copy: unknown = JSON.parse(JSON.stringify(roles));
  const checked = parseProjectRoles(copy);
  assert(checked.roles.length === roles.roles.length, 'Serializing never adds or drops roles');
  const body = {
    version: 1,
    defaultRole: checked.defaultRole,
    roles: checked.roles.map((role) => {
      const pinned = role.pinnedApps.length > 0 ? { pinnedApps: role.pinnedApps } : {};
      const components = role.componentRules.length > 0 ? { componentRules: role.componentRules.map(storedComponentRule) } : {};
      if (role.id === ADMIN_ROLE_ID) {
        return { id: role.id, name: role.name, members: role.members, ...pinned, ...components };
      }
      const stored = Object.keys(role.appPermissions).length > 0 ? { appPermissions: role.appPermissions } : {};
      return { id: role.id, name: role.name, members: role.members, access: role.access, ...stored, ...pinned, ...components };
    }),
  };
  const source = `${JSON.stringify(body, undefined, 2)}\n`;
  if (source.length > ROLE_LIMITS.fileCharsMax) {
    throw new Error(`The roles file would exceed ${ROLE_LIMITS.fileCharsMax} characters`);
  }
  assert(source.length > 0, 'A serialized roles file is never empty');
  return source;
}

export function roleViewOf(roles: ProjectRoles, id: string): RoleView {
  const role = roles.roles.find((item) => item.id === canonicalRoleId(id));
  if (role === undefined) {
    throw new Error(`"${id}" is not a role in this project`);
  }
  return roleView(role);
}

export function roleView(role: ProjectRole): RoleView {
  if (role.id === ADMIN_ROLE_ID) {
    return role.pinnedApps.length === 0 && role.componentRules.length === 0
      ? ADMIN_VIEW
      : { ...ADMIN_VIEW, pinnedApps: role.pinnedApps, componentRules: role.componentRules };
  }
  const view: RoleView = {
    id: role.id,
    name: role.name,
    isAdmin: false,
    features: new Set(role.access),
    appPermissions: role.appPermissions,
    pinnedApps: role.pinnedApps,
    componentRules: role.componentRules,
  };
  assert(!view.features.has('settings:roles'), 'No role but admin edits roles');
  assert(!view.features.has('cli:roles'), 'No role but admin edits roles from the command line');
  assert(!view.isAdmin, 'Only the admin role is admin');
  return view;
}

export function appPermissionsFor(role: RoleView, appId: string, declarations: readonly AppPermissionDeclaration[]): Readonly<Record<string, boolean>> {
  assert(appId.length > 0, 'App permissions belong to an app');
  assert(declarations.length <= APP_PERMISSION_LIMITS.permissionsMax, 'Permission declarations are bounded');
  const usable = can(role, `app:${appId}`);
  const resolved: Record<string, boolean> = {};
  for (const declaration of declarations) {
    if (role.isAdmin) {
      resolved[declaration.id] = true;
    } else if (usable) {
      resolved[declaration.id] = configuredAppPermission(role.appPermissions, appId, declaration);
    } else {
      resolved[declaration.id] = false;
    }
  }
  assert(Object.keys(resolved).length === declarations.length, 'Every declared permission resolves');
  return resolved;
}

export function configuredAppPermission(grants: AppPermissionGrants, appId: string, declaration: AppPermissionDeclaration): boolean {
  assert(appId.length > 0, 'A permission belongs to an app');
  assert(declaration.id.length > 0, 'A permission has an id');
  const app = Object.hasOwn(grants, appId) ? grants[appId] : undefined;
  if (app === undefined) {
    return declaration.default;
  }
  const stored = Object.hasOwn(app, declaration.id) ? app[declaration.id] : undefined;
  return stored ?? declaration.default;
}

export function sameAppPermissions(left: AppPermissionGrants, right: AppPermissionGrants): boolean {
  const apps = Object.keys(left);
  assert(apps.length <= ROLE_LIMITS.appPermissionAppsMax, 'Stored apps are bounded');
  if (apps.length !== Object.keys(right).length) {
    return false;
  }
  return apps.every((appId) => {
    const leftValues = left[appId] ?? {};
    const rightValues = Object.hasOwn(right, appId) ? right[appId] : undefined;
    if (rightValues === undefined) {
      return false;
    }
    const ids = Object.keys(leftValues);
    return ids.length === Object.keys(rightValues).length && ids.every((id) => Object.hasOwn(rightValues, id) && rightValues[id] === leftValues[id]);
  });
}

export function memberRole(roles: ProjectRoles, login: string, aliases: readonly string[] = []): ProjectRole | undefined {
  assert(login.length > 0, 'A member lookup names a login');
  assert(aliases.length <= ROLE_LIMITS.aliasesMax, 'A person has a bounded number of aliases');
  const keys = [login, ...aliases].map(identityKey);
  const found = roles.roles.find((role) => role.members.some((member) => keys.includes(identityKey(member))));
  assert(found === undefined || found.members.length > 0, 'A matching role has members');
  return found;
}

export function resolveRole(
  roles: ProjectRoles | undefined,
  login: string | undefined,
  fallback: 'default' | 'admin',
  aliases: readonly string[] = [],
): RoleView {
  if (roles === undefined) {
    return ADMIN_VIEW;
  }
  if (login === undefined) {
    return roleViewOf(roles, ADMIN_ROLE_ID);
  }
  if (!rolesClaimed(roles)) {
    return roleViewOf(roles, ADMIN_ROLE_ID);
  }
  const member = memberRole(roles, login, aliases);
  if (member !== undefined) {
    return roleViewOf(roles, member.id);
  }
  switch (fallback) {
    case 'admin':
      return roleViewOf(roles, ADMIN_ROLE_ID);
    case 'default':
      return roleViewOf(roles, roles.defaultRole);
    default: {
      const exhaustive: never = fallback;
      return exhaustive;
    }
  }
}

export function canonicalRoleId(id: string): string {
  assert(id.length > 0, 'A role id is never empty');
  const canonical = ADMIN_ROLE_ALIASES.includes(id) ? ADMIN_ROLE_ID : id;
  assert(canonical.length <= ROLE_LIMITS.roleIdCharsMax, 'A canonical role id is within the id bound');
  return canonical;
}

export function roleIdFor(name: string, taken: readonly string[]): string {
  assert(taken.length <= ROLE_LIMITS.rolesMax, 'Taken ids are bounded by the role limit');
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, ROLE_LIMITS.roleIdCharsMax - 3) || 'role';
  let id = base;
  for (let suffix = 2; suffix <= ROLE_LIMITS.rolesMax + 2; suffix += 1) {
    if (!taken.includes(id) && !reservedRoleId(id)) {
      break;
    }
    id = `${base}-${suffix}`;
  }
  assert(!taken.includes(id), 'A generated role id is unique');
  return id;
}

function reservedRoleId(id: string): boolean {
  assert(id.length > 0, 'A role id is never empty');
  const reserved = id === ADMIN_ROLE_ID || id === CLIENT_ROLE_ID || ADMIN_ROLE_ALIASES.includes(id);
  assert(typeof reserved === 'boolean', 'Reserved is a plain answer');
  return reserved;
}

function parseRole(input: unknown): ProjectRole {
  const value = record(input);
  const id = canonicalRoleId(roleId(value['id']));
  const name = value['name'] === undefined ? builtInName(id) : roleName(value['name']);
  const members = parseMembers(value['members']);
  const pinnedApps = parsePinnedApps(value['pinnedApps']);
  const componentRules = parseComponentRules(value['componentRules']);
  if (id === ADMIN_ROLE_ID) {
    return { id, name: 'Admin', members, access: [], appPermissions: {}, pinnedApps, componentRules };
  }
  const access = value['access'] === undefined && id === CLIENT_ROLE_ID ? CLIENT_DEFAULT_ACCESS : parseAccess(value['access']);
  assert(!access.includes('settings:roles'), 'parseAccess refuses the roles tab');
  assert(!access.includes('cli:roles'), 'parseAccess refuses the command line roles edit');
  return { id, name, members, access, appPermissions: parseAppPermissionGrants(value['appPermissions']), pinnedApps, componentRules };
}

export function parsePinnedApps(input: unknown): readonly string[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Pinned apps must be a list of app ids');
  }
  if (items.length > ROLE_LIMITS.pinnedAppsMax) {
    throw new Error(`A role pins at most ${ROLE_LIMITS.pinnedAppsMax} apps`);
  }
  const pinned = [...new Set(items.map(parseAppGrantId))];
  assert(pinned.length <= items.length, 'Deduplication never adds pins');
  return pinned;
}

export function parseAppPermissionGrants(input: unknown): AppPermissionGrants {
  if (input === undefined) {
    return {};
  }
  const apps = Object.entries(record(input));
  if (apps.length > ROLE_LIMITS.appPermissionAppsMax) {
    throw new Error(`A role holds app permissions for at most ${ROLE_LIMITS.appPermissionAppsMax} apps`);
  }
  const grants: Record<string, Readonly<Record<string, boolean>>> = {};
  for (const [appId, values] of apps) {
    const permissions = Object.entries(record(values));
    if (permissions.length > APP_PERMISSION_LIMITS.permissionsMax) {
      throw new Error(`A role holds at most ${APP_PERMISSION_LIMITS.permissionsMax} permissions for one app`);
    }
    const parsed: Record<string, boolean> = {};
    for (const [permissionId, value] of permissions) {
      if (typeof value !== 'boolean') {
        throw new Error(`App permission "${parseAppPermissionId(permissionId)}" is true or false`);
      }
      parsed[parseAppPermissionId(permissionId)] = value;
    }
    grants[parseAppGrantId(appId)] = parsed;
  }
  assert(Object.keys(grants).length === apps.length, 'Every stored app parsed');
  return grants;
}

export function parseAppGrantId(input: unknown): string {
  const app = text(input);
  if (app.length === 0 || app.length > ROLE_LIMITS.appIdCharsMax) {
    throw new Error(`An app id is 1 to ${ROLE_LIMITS.appIdCharsMax} characters`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(app)) {
    throw new Error(`"${app}" is not an app id`);
  }
  assert(app.length <= ROLE_LIMITS.appIdCharsMax, 'A parsed app id is within its bound');
  return app;
}

function builtInName(id: string): string {
  assert(id.length > 0, 'A role id is never empty');
  if (id === CLIENT_ROLE_ID) {
    return 'Client';
  }
  if (id === ADMIN_ROLE_ID) {
    return 'Admin';
  }
  throw new Error(`Role "${id}" needs a name`);
}

function roleId(input: unknown): string {
  const id = text(input);
  if (id.length === 0 || id.length > ROLE_LIMITS.roleIdCharsMax) {
    throw new Error(`A role id is 1 to ${ROLE_LIMITS.roleIdCharsMax} characters`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`Role id "${id}" must be lowercase letters, digits and hyphens`);
  }
  return id;
}

function roleName(input: unknown): string {
  const name = text(input).trim();
  if (name.length === 0 || name.length > ROLE_LIMITS.roleNameCharsMax) {
    throw new Error(`A role name is 1 to ${ROLE_LIMITS.roleNameCharsMax} characters`);
  }
  assert(name === name.trim(), 'A role name carries no outer spaces');
  return name;
}

function parseMember(input: unknown): string {
  const member = text(input).trim();
  if (!member.includes(':')) {
    return parseGitHubLogin(member);
  }
  const identity = parseQualifiedIdentity(member);
  if (!identity.ok) {
    throw new Error(`"${member}" is not a member: ${identity.error.message}`);
  }
  if (identityProvider(identity.value) === GITHUB_PROVIDER_ID) {
    parseGitHubLogin(identitySubject(identity.value));
  }
  return identity.value;
}

function parseMembers(input: unknown): readonly string[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Role members must be a list of GitHub usernames or provider-qualified identities');
  }
  if (items.length > ROLE_LIMITS.membersMax) {
    throw new Error(`A role has at most ${ROLE_LIMITS.membersMax} members`);
  }
  const members = items.map(parseMember);
  assert(members.length === items.length, 'Every member parsed');
  return members;
}

function parseAccess(input: unknown): readonly AccessFeature[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Role access must be a list of features');
  }
  if (items.length > ROLE_LIMITS.accessMax) {
    throw new Error(`A role has at most ${ROLE_LIMITS.accessMax} grants`);
  }
  const access = [...new Set(items.map(parseFeature))];
  assert(access.length <= items.length, 'Deduplication never adds grants');
  return access;
}

function parseFeature(input: unknown): AccessFeature {
  const feature = text(input);
  if (feature === 'settings:roles' || feature === 'cli:roles') {
    throw new Error('Only admin can edit roles');
  }
  const known = ACCESS_FEATURES.find((item) => item === feature);
  if (known !== undefined) {
    return known;
  }
  if (feature.startsWith('app:')) {
    const app = feature.slice('app:'.length);
    if (app.length === 0 || app.length > ROLE_LIMITS.appIdCharsMax) {
      throw new Error(`An app id is 1 to ${ROLE_LIMITS.appIdCharsMax} characters`);
    }
    if (app !== '*' && !/^[a-z0-9][a-z0-9._-]*$/.test(app)) {
      throw new Error(`"${feature}" is not an app grant`);
    }
    return `app:${app}`;
  }
  throw new Error(`Unknown access feature "${feature}"`);
}

function withBuiltInRoles(parsed: readonly ProjectRole[]): readonly ProjectRole[] {
  const admin = parsed.find((role) => role.id === ADMIN_ROLE_ID) ?? {
    id: ADMIN_ROLE_ID,
    name: 'Admin',
    members: [],
    access: [],
    appPermissions: {},
    pinnedApps: [],
    componentRules: [],
  };
  const client = parsed.find((role) => role.id === CLIENT_ROLE_ID) ?? {
    id: CLIENT_ROLE_ID,
    name: 'Client',
    members: [],
    access: CLIENT_DEFAULT_ACCESS,
    appPermissions: {},
    pinnedApps: [],
    componentRules: [],
  };
  const custom = parsed.filter((role) => role.id !== ADMIN_ROLE_ID && role.id !== CLIENT_ROLE_ID);
  for (const id of [ADMIN_ROLE_ID, CLIENT_ROLE_ID]) {
    if (parsed.filter((role) => role.id === id).length > 1) {
      throw new Error(`Role "${id}" is listed twice`);
    }
  }
  const roles = [admin, client, ...custom];
  if (roles.length > ROLE_LIMITS.rolesMax) {
    throw new Error(`A project has at most ${ROLE_LIMITS.rolesMax} roles`);
  }
  assert(roles[0]?.id === ADMIN_ROLE_ID, 'Admin is first');
  assert(roles[1]?.id === CLIENT_ROLE_ID, 'Client is second');
  return roles;
}

function assertUnique(roles: readonly ProjectRole[]): void {
  assert(roles.length <= ROLE_LIMITS.rolesMax, 'Roles are bounded before the uniqueness check');
  const ids = new Set<string>();
  const logins = new Map<string, string>();
  for (const role of roles) {
    if (ids.has(role.id)) {
      throw new Error(`Role "${role.id}" is listed twice`);
    }
    ids.add(role.id);
    for (const member of role.members) {
      const key = member.toLowerCase();
      const other = logins.get(key);
      if (other !== undefined) {
        throw new Error(other === role.id ? `${member} is listed twice in ${role.name}` : `${member} is in more than one role`);
      }
      logins.set(key, role.id);
    }
  }
  assert(ids.size === roles.length, 'Every role id is unique');
}
