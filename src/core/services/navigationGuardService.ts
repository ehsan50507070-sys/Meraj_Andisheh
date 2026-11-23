import type { AppUser } from '../domain/auth';

export function sanitizeReturnHash(rawReturnUrl?: string | null): string | null {
  if (!rawReturnUrl || typeof rawReturnUrl !== 'string') {
    return null;
  }

  const trimmed = rawReturnUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Block external URLs, protocol-relative URLs, backslashes, or unsafe schemes
  const lower = trimmed.toLowerCase();
  if (
    trimmed.includes('\\') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('//') ||
    lower.startsWith('#//')
  ) {
    return null;
  }

  const withHash = trimmed.startsWith('#/')
    ? trimmed
    : trimmed.startsWith('/')
      ? `#${trimmed}`
      : null;

  if (!withHash) {
    return null;
  }

  const pathOnly = withHash.slice(1).split('?')[0].toLowerCase();
  if (
    pathOnly === '/admin' ||
    pathOnly.startsWith('/admin/') ||
    pathOnly === '/account/login' ||
    pathOnly === '/account/register'
  ) {
    return null;
  }

  return withHash;
}

export function canAccessAdminRoute(user: AppUser | null): boolean {
  if (!user || !user.isActive) {
    return false;
  }
  return user.role === 'Staff' || user.role === 'SuperAdmin';
}

export function resolvePostLoginRedirect(
  user: AppUser,
  returnUrl?: string | null,
): string {
  if (user.mustChangePassword) {
    return '#/account/change-password';
  }

  if (user.role === 'Staff' || user.role === 'SuperAdmin') {
    return '#/admin';
  }

  const safeMemberReturn = sanitizeReturnHash(returnUrl);
  return safeMemberReturn ?? '#/';
}
