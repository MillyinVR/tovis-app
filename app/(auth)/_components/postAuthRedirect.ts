// app/(auth)/_components/postAuthRedirect.ts
//
// Shared post-authentication navigation logic for the web auth surfaces.
// Both password login (LoginClient) and social sign-in (SocialSignIn) receive
// the same AuthLoginResponseDTO shape and must route identically: honor a
// server/query `next`, fall back to a role home, and divert un-verified users
// to phone verification. Consolidated here so the two callers can't drift.

import { isRecord } from '@/lib/guards'
import { readStringField } from '@/lib/http'

export type UserRole = 'ADMIN' | 'PRO' | 'CLIENT'

export const PRO_HOME = '/pro/calendar'

export function sanitizeInternalPath(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function isAuthPath(path: string): boolean {
  return (
    path === '/login' ||
    path.startsWith('/login?') ||
    path === '/signup' ||
    path.startsWith('/signup?') ||
    path === '/forgot-password' ||
    path.startsWith('/forgot-password?')
  )
}

export function sanitizeRedirectTarget(path: string | null): string | null {
  if (!path) return null
  if (isAuthPath(path)) return null
  return path
}

export function readUserRole(data: unknown): UserRole | null {
  if (!isRecord(data)) return null
  const user = data.user
  if (!isRecord(user)) return null
  const role = user.role
  return role === 'ADMIN' || role === 'PRO' || role === 'CLIENT' ? role : null
}

function readBooleanField(data: unknown, key: string): boolean {
  if (!isRecord(data)) return false
  return data[key] === true
}

export function roleIntentFromPath(path: string | null): UserRole | null {
  if (!path) return null
  if (path === '/admin' || path.startsWith('/admin/')) return 'ADMIN'
  if (path === '/pro' || path.startsWith('/pro/')) return 'PRO'
  return null
}

function normalizeLanding(path: string, role: UserRole): string {
  if (role === 'PRO') {
    if (path === '/pro' || path.startsWith('/pro?')) return PRO_HOME
  }
  return path
}

export function buildVerificationHref(nextPath: string): string {
  return `/verify-phone?next=${encodeURIComponent(nextPath)}`
}

export type PostAuthNavigation =
  | { kind: 'navigate'; url: string }
  | { kind: 'error'; message: string }
  | { kind: 'missing-role' }

/**
 * Given a successful auth response and the sanitized query fallbacks, decide
 * where the browser should go next. Returns a `missing-role` sentinel when the
 * response lacks a usable role, and an `error` when a not-fully-verified ADMIN
 * tries to sign in (admins can't clear phone/email verification in-app).
 */
export function resolvePostAuthNavigation(
  data: unknown,
  opts: { nextSafe: string | null; fromSafe: string | null },
): PostAuthNavigation {
  const role = readUserRole(data)
  if (!role) return { kind: 'missing-role' }

  const nextUrl = sanitizeRedirectTarget(
    sanitizeInternalPath(readStringField(data, 'nextUrl') ?? null),
  )

  const roleDefault =
    role === 'ADMIN' ? '/admin' : role === 'PRO' ? PRO_HOME : '/looks'

  const rawDest = nextUrl ?? opts.nextSafe ?? opts.fromSafe ?? roleDefault
  const dest = normalizeLanding(rawDest, role)

  const isPhoneVerified = readBooleanField(data, 'isPhoneVerified')
  const isEmailVerified = readBooleanField(data, 'isEmailVerified')
  const isFullyVerified = readBooleanField(data, 'isFullyVerified')

  if (!isFullyVerified) {
    if (role === 'ADMIN') {
      return {
        kind: 'error',
        message:
          'This account is not fully verified yet. Full app access is blocked until phone and email verification are complete.',
      }
    }

    if (!isPhoneVerified || !isEmailVerified) {
      return { kind: 'navigate', url: buildVerificationHref(dest) }
    }
  }

  return { kind: 'navigate', url: dest }
}
