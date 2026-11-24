import type { AppUser } from '../../core/domain/auth';
import type { PermissionKey } from '../../core/domain/permissions';
import type { ResourceKey } from '../resources/fa';

export type AdminAccessRequirement =
  | 'shell'
  | 'superadmin'
  | PermissionKey
  | readonly PermissionKey[];

export interface AdminRouteSpec {
  id: string;
  path: string;
  hash: string;
  labelKey: ResourceKey;
  requirement: AdminAccessRequirement;
  permissionDescKey?: ResourceKey;
  isPlaceholder?: boolean;
}

export const ADMIN_ROUTES: readonly AdminRouteSpec[] = [
  {
    id: 'home',
    path: '/admin',
    hash: '#/admin',
    labelKey: 'admin.nav.home',
    requirement: 'shell',
  },
  {
    id: 'dashboard',
    path: '/admin/dashboard',
    hash: '#/admin/dashboard',
    labelKey: 'admin.nav.dashboard',
    requirement: 'dashboard.view',
    permissionDescKey: 'permissions.dashboard.view.desc',
  },
  {
    id: 'content',
    path: '/admin/content',
    hash: '#/admin/content',
    labelKey: 'admin.nav.content',
    requirement: 'content.manage',
    permissionDescKey: 'permissions.content.manage.desc',
  },
  {
    id: 'taxonomy',
    path: '/admin/taxonomy',
    hash: '#/admin/taxonomy',
    labelKey: 'admin.nav.taxonomy',
    requirement: 'taxonomy.manage',
    permissionDescKey: 'permissions.taxonomy.manage.desc',
  },
  {
    id: 'requests',
    path: '/admin/requests',
    hash: '#/admin/requests',
    labelKey: 'admin.nav.requests',
    requirement: 'requests.manage',
    permissionDescKey: 'permissions.requests.manage.desc',
  },
  {
    id: 'comments',
    path: '/admin/comments',
    hash: '#/admin/comments',
    labelKey: 'admin.nav.comments',
    requirement: 'comments.moderate',
    permissionDescKey: 'permissions.comments.moderate.desc',
  },
  {
    id: 'users',
    path: '/admin/users',
    hash: '#/admin/users',
    labelKey: 'admin.nav.users',
    requirement: 'users.manage',
    permissionDescKey: 'permissions.users.manage.desc',
  },
  {
    id: 'layout',
    path: '/admin/layout',
    hash: '#/admin/layout',
    labelKey: 'admin.nav.layout',
    requirement: 'layout.manage',
    permissionDescKey: 'permissions.layout.manage.desc',
  },
  {
    id: 'portals',
    path: '/admin/portals',
    hash: '#/admin/portals',
    labelKey: 'admin.nav.portals',
    requirement: 'portals.manage',
    permissionDescKey: 'permissions.portals.manage.desc',
  },
  {
    id: 'settings',
    path: '/admin/settings',
    hash: '#/admin/settings',
    labelKey: 'admin.nav.settings',
    requirement: 'settings.manage',
    permissionDescKey: 'permissions.settings.manage.desc',
  },
  {
    id: 'storage-test',
    path: '/admin/storage-test',
    hash: '#/admin/storage-test',
    labelKey: 'admin.nav.storageTest',
    requirement: ['content.manage', 'settings.manage'],
    permissionDescKey: 'admin.home.storageTestDesc',
  },
  {
    id: 'backup',
    path: '/admin/backup',
    hash: '#/admin/backup',
    labelKey: 'admin.nav.backup',
    requirement: 'backup.manage',
    permissionDescKey: 'permissions.backup.manage.desc',
  },
  {
    id: 'staff',
    path: '/admin/staff',
    hash: '#/admin/staff',
    labelKey: 'admin.nav.staff',
    requirement: 'superadmin',
    permissionDescKey: 'admin.home.superAdminSectionDesc',
  },
] as const;

export function findAdminRouteSpec(normalizedPath: string): AdminRouteSpec | null {
  const lower = normalizedPath.toLowerCase();
  const exact = ADMIN_ROUTES.find((item) => item.path.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  if (
    lower === '/admin/content/new' ||
    lower === '/admin/content/smart-import' ||
    /^\/admin\/content\/edit\/\d+$/.test(lower)
  ) {
    return ADMIN_ROUTES.find((item) => item.id === 'content') ?? null;
  }
  return null;
}

export function canSeeAdminNavItem(
  user: AppUser | null,
  userPermissions: readonly PermissionKey[],
  requirement: AdminAccessRequirement,
): boolean {
  if (!user || !user.isActive) {
    return false;
  }
  if (user.role === 'Member') {
    return false;
  }
  if (requirement === 'shell') {
    return true;
  }
  if (user.role === 'SuperAdmin') {
    return true;
  }
  if (requirement === 'superadmin') {
    return false;
  }
  if (Array.isArray(requirement)) {
    return requirement.some((key) => userPermissions.includes(key));
  }
  return userPermissions.includes(requirement as PermissionKey);
}

export function getPermissionLabelKey(key: PermissionKey): ResourceKey {
  return `permissions.${key}.label` as ResourceKey;
}

export function getPermissionDescKey(key: PermissionKey): ResourceKey {
  return `permissions.${key}.desc` as ResourceKey;
}
