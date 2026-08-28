// app/_components/boundaries/errorHomeHref.ts
//
// Where the "Home" button on an error boundary should send THIS viewer.
//
// The root not-found previously hardcoded "/", so a signed-in client who hit any
// bad URL was dropped on the public marketing hero — out of the app entirely,
// with no way back to their own home but the browser's back button. The client
// area's own not-found already got this right (homeHref="/client"); anything
// outside /client fell through to the global one.
//
// Deliberately reads ONLY the session JWT — no database round-trip. A 404 is
// hit by crawlers, stale links and probes, and none of those should cost a
// query. The token already carries `role` and `sessionKind`, which is every
// input this decision needs.
//
// NOT shared with postAuthRedirect's role landing: that sends a client to
// /looks (the discovery feed you want after signing in), whereas an error page
// wants the client's own home. Same shape, different intent — folding them
// together would silently change one of the two.
//
// SERVER ONLY. The destinations themselves live in ./errorHome so that client
// boundaries (every error.tsx) can reuse them without pulling next/headers and
// @/lib/auth into the browser bundle.

import { cookies, headers } from 'next/headers'

import { parseBearerToken } from '@/lib/auth/bearerToken'

import {
  ADMIN_HOME,
  CLIENT_HOME,
  GUEST_HOME,
  PRO_HOME,
  type ErrorHome,
} from './errorHome'

export {
  ADMIN_HOME_HREF,
  CLIENT_HOME_HREF,
  GUEST_HOME,
  GUEST_HOME_HREF,
  PRO_HOME_HREF,
  type ErrorHome,
} from './errorHome'

/**
 * Resolve the viewer's home from the session token. Falls back to the guest
 * home for anyone unauthenticated, mid-verification, or carrying a token we
 * can't verify — an error page must never throw, so every failure degrades to
 * the public home rather than propagating.
 */
export async function resolveErrorHome(): Promise<ErrorHome> {
  try {
    const cookieStore = await cookies()
    let token = cookieStore.get('tovis_token')?.value ?? null

    if (!token) {
      const headerStore = await headers()
      token = parseBearerToken(headerStore.get('authorization'))
    }

    if (!token) return GUEST_HOME

    // Imported lazily, INSIDE the try, on purpose: lib/auth throws at module
    // load when JWT_SECRET is unset. A static import would make that throw at
    // the top of the 404 page — turning every not-found into a 500 on the one
    // page whose whole job is to survive. Here it degrades to the guest home.
    const { verifyToken } = await import('@/lib/auth')
    const payload = verifyToken(token)

    // A VERIFICATION session is mid-signup, not signed in — it has no home yet.
    if (!payload || payload.sessionKind !== 'ACTIVE') return GUEST_HOME

    switch (payload.role) {
      case 'ADMIN':
        return ADMIN_HOME
      case 'PRO':
        return PRO_HOME
      case 'CLIENT':
        return CLIENT_HOME
      default:
        return GUEST_HOME
    }
  } catch {
    return GUEST_HOME
  }
}
