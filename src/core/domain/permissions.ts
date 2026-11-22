export const ALL_PERMISSION_KEYS = [
  'dashboard.view',
  'content.manage',
  'taxonomy.manage',
  'requests.manage',
  'comments.moderate',
  'users.manage',
  'layout.manage',
  'portals.manage',
  'settings.manage',
  'backup.manage',
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export interface StaffPermission {
  id?: number;
  userId: number;
  permissionKey: PermissionKey;
  /** ISO 8601 UTC timestamp */
  grantedAt: string;
  grantedById: number | null;
}
