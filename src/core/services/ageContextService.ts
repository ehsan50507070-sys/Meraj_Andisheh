import type { IAgePreferenceStorage } from '../abstractions/agePreferenceStorage';
import type { AppUser } from '../domain/auth';
import type { AgeGroup } from '../domain/taxonomy';
import { resolveThemeKey, type ThemeKey } from './themeService';

export const AGE_COOKIE_NAME = 'ma_age';
export const AGE_COOKIE_MAX_AGE_SECONDS = 31536000; // 365 days

export interface SelectAgeGroupInput {
  ageGroupId: number;
  currentUser: AppUser | null;
  activeAgeGroups: readonly AgeGroup[];
  storage: IAgePreferenceStorage;
  updateUserAgeGroup: (userId: number, ageGroupId: number) => Promise<void>;
}

export interface SelectAgeGroupResult {
  ok: boolean;
  ageGroup?: AgeGroup;
  themeKey?: ThemeKey;
  errorCode?: 'INVALID_AGE_GROUP';
}

function normalizeHashPath(rawHashPath: string): string {
  const trimmed = (rawHashPath ?? '').trim();
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const queryIdx = withoutHash.indexOf('?');
  const pathOnly = queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx);
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const clean =
    withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
  return (clean || '/').toLowerCase();
}

/**
 * Resolves effective AgeGroup per Section 3.1:
 * Priority 1: Authenticated user's profile ageGroupId (always overrides ma_age cookie)
 * Priority 2: Stored ma_age cookie / preference matching an active AgeGroup key
 * Otherwise: null (first-visit age gate required on public routes)
 */
export function resolveEffectiveAgeGroup(
  currentUser: AppUser | null,
  activeAgeGroups: readonly AgeGroup[],
  storage: IAgePreferenceStorage,
): AgeGroup | null {
  const activeOnly = activeAgeGroups.filter((group) => group.isActive);

  if (currentUser && currentUser.ageGroupId !== null) {
    const profileMatch = activeOnly.find((group) => group.id === currentUser.ageGroupId);
    if (profileMatch) {
      return profileMatch;
    }
  }

  const storedKey = storage.getAgeKey()?.trim().toLowerCase() ?? '';
  if (storedKey.length > 0) {
    const cookieMatch = activeOnly.find((group) => group.key.toLowerCase() === storedKey);
    if (cookieMatch) {
      return cookieMatch;
    }
  }

  return null;
}

/**
 * Returns true ONLY when no effective age group is resolved AND the current route is public
 * (never interrupts admin, initial setup, auth account routes, or health diagnostics).
 */
export function shouldShowAgeGate(
  resolvedAgeGroup: AgeGroup | null,
  currentHashPath: string,
): boolean {
  if (resolvedAgeGroup !== null) {
    return false;
  }

  const path = normalizeHashPath(currentHashPath);

  if (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/setup/initial-admin' ||
    path.startsWith('/setup/') ||
    path === '/account/change-password' ||
    path === '/account/login' ||
    path === '/account/register' ||
    path.startsWith('/account/') ||
    path === '/health' ||
    path.startsWith('/media/')
  ) {
    return false;
  }

  return true;
}

/**
 * Selects and persists an active AgeGroup to ma_age (1 year) and, when signed in,
 * immediately updates the user's profile ageGroupId without ending the active session.
 */
export async function selectAgeGroupAsync(
  input: SelectAgeGroupInput,
): Promise<SelectAgeGroupResult> {
  const target = input.activeAgeGroups.find(
    (group) => group.id === input.ageGroupId && group.isActive,
  );
  if (!target) {
    return {
      ok: false,
      errorCode: 'INVALID_AGE_GROUP',
    };
  }

  input.storage.setAgeKey(target.key, AGE_COOKIE_MAX_AGE_SECONDS);

  if (input.currentUser !== null) {
    await input.updateUserAgeGroup(input.currentUser.id, target.id);
  }

  return {
    ok: true,
    ageGroup: target,
    themeKey: resolveThemeKey(target.themeKey),
  };
}
