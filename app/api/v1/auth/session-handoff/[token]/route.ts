// app/api/v1/auth/session-handoff/[token]/route.ts
//
// GET — redeem a one-time hand-off token. Validates + consumes atomically,
// mints the ordinary session cookie, and redirects to the destination pinned in
// the token's row.
//
// ── Things this route deliberately does NOT do ─────────────────────────────
//
//  • It never reads a destination from the request on the SUCCESS path. The
//    redirect target comes from the consumed row, so there is no open-redirect
//    surface here at all — the allowlist ran at issuance.
//  • It never tells the caller why a token failed. Malformed, unknown, expired,
//    already-used, wrong-secret and revoked-session all produce the SAME
//    redirect to `/login?from=…`. A caller cannot use this endpoint as an
//    oracle for whether a token id exists or a session is still live.
//  • It does not duplicate the session mint. `createActiveToken` +
//    `setSessionCookie` are the exact pair POST /auth/refresh uses, so a web
//    session created this way is byte-identical in shape to a logged-in one.
//
// A GET that mutates state is unusual, and correct here: a browser navigation
// is the only thing that can be handed a cookie, and the mutation is the
// single-use burn of a credential the user themselves just minted. It is
// unreachable without the secret, and re-following the URL is a no-op refusal
// rather than a repeated effect.

import { NextResponse } from 'next/server'

import {
  enforceRateLimit,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import { getAppUrlFromRequest } from '@/lib/appUrl'
import { createActiveToken } from '@/lib/auth'
import { parseCompositeToken } from '@/lib/auth/compositeToken'
import {
  buildSessionHandoffLoginPath,
  consumeSessionHandoffToken,
  isSessionHandoffDisabled,
  sanitizeSessionHandoffPath,
  type SessionHandoffRejection,
} from '@/lib/auth/sessionHandoff'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { currentUserSelect, resolveActingRole } from '@/lib/currentUser'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = 'auth.sessionHandoff.exchange'

/**
 * Absolute base for the redirect.
 *
 * `getAppUrlFromRequest` (NEXT_PUBLIC_APP_URL, else the FORWARDED host) rather
 * than `request.url`: behind Vercel's proxy `request.url` can carry the internal
 * host, and redirecting there would send the browser to an origin the session
 * cookie was not scoped to — the pro would arrive at /pro/membership signed out,
 * which is the exact failure this feature exists to remove. Falls back to
 * `request.url` only if no origin can be resolved at all.
 */
function redirectBase(request: Request): string {
  return getAppUrlFromRequest(request) ?? request.url
}

/**
 * A redirect response that is never cached and never leaks the token onward.
 *
 * 303 rather than 307: the browser must issue a fresh GET for the destination,
 * and 307 would preserve the method — harmless for a GET today, but it is the
 * wrong semantic for "your request was consumed, go look over there".
 */
function redirectTo(target: URL): NextResponse {
  const res = NextResponse.redirect(target, 303)
  // Defence in depth. A browser following a redirect already carries the
  // ORIGINAL referrer forward rather than the redirecting URL, so the token is
  // not exposed as a Referer either way — this makes that independent of
  // engine behaviour.
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.headers.set('Pragma', 'no-cache')
  return res
}

/**
 * The single refusal path. Every failure reason lands here with the same
 * observable result; `reason` is recorded for the audit log only.
 */
function refuse(args: {
  request: Request
  fallbackPath: string | null
  reason:
    | SessionHandoffRejection
    | 'rate_limited'
    | 'session_revoked'
    | 'redirect_not_allowed'
    | 'disabled'
  userId?: string | null
  tokenId?: string | null
}): NextResponse {
  logAuthEvent({
    level: 'warn',
    event: 'auth.session_handoff.rejected',
    route: ROUTE,
    code: args.reason,
    userId: args.userId ?? null,
    verificationId: args.tokenId ?? null,
  })

  return redirectTo(
    new URL(
      buildSessionHandoffLoginPath(args.fallbackPath),
      redirectBase(args.request),
    ),
  )
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  // Declared outside the try so the catch-all can still build a sane redirect,
  // but PARSED inside it: an unparseable `request.url` here would otherwise
  // throw past the very handler that exists to keep this endpoint's failures
  // uniform. Null simply falls back to the default destination.
  let fallbackPath: string | null = null

  try {
    fallbackPath = new URL(request.url).searchParams.get('from')

    // Kill switch. Redemption refuses too, not just issuance — otherwise a
    // token minted seconds before the flip would still hand out a session, and
    // a switch you cannot trust to have stopped everything is not a kill
    // switch. The pro lands on the login wall, which still returns them to
    // their destination.
    if (isSessionHandoffDisabled()) {
      return refuse({ request, fallbackPath, reason: 'disabled' })
    }

    const { token: rawToken } = await ctx.params

    // Cap guessing attempts against a specific token id. Keyed on the ID HALF
    // only — the secret half must never reach a cache key, a log, or Redis.
    const parsed = parseCompositeToken(rawToken)
    if (parsed) {
      const rlRes = await enforceRateLimit({
        bucket: 'auth:session-handoff:exchange',
        identity: tokenRateLimitIdentity(parsed.tokenId),
      })
      if (rlRes) {
        return refuse({
          request,
          fallbackPath,
          reason: 'rate_limited',
          tokenId: parsed.tokenId,
        })
      }
    }

    const consumed = await consumeSessionHandoffToken({ rawToken })

    if (!consumed.ok) {
      return refuse({
        request,
        fallbackPath,
        reason: consumed.reason,
        tokenId: consumed.tokenId,
      })
    }

    // The token is now burnt — every path below refuses rather than re-issuing,
    // so a user whose session was revoked mid-window cannot retry it.
    const user = await prisma.user.findUnique({
      where: { id: consumed.userId },
      select: currentUserSelect,
    })

    // Deleted user, or the session that authorized this hand-off was revoked
    // inside the window (sign out everywhere / password reset both bump
    // authVersion). A hand-off must not outlive the session that minted it.
    if (!user || user.authVersion !== consumed.authVersionAtIssue) {
      return refuse({
        request,
        fallbackPath,
        reason: 'session_revoked',
        userId: consumed.userId,
        tokenId: consumed.tokenId,
      })
    }

    // Re-check the stored acting role against LIVE entitlement using the same
    // function every authenticated request runs on the role in its JWT. A pro
    // whose licence was withdrawn between issuance and redemption drops back to
    // their home role here rather than walking into the pro workspace.
    const actingRole = resolveActingRole(user, consumed.actingRole)

    const sessionToken = createActiveToken({
      userId: user.id,
      role: actingRole,
      authVersion: user.authVersion,
      // No deviceId: this mints a BROWSER session. Carrying the app's device id
      // across would bind a Safari cookie to the phone's device record, so
      // signing the device out would silently kill the browser session too (and
      // vice versa). Web sessions carry no deviceId — see lib/currentUser.ts.
      deviceId: null,
    })

    // Re-run the allowlist on the STORED path before it becomes a Location
    // header. It already passed at issuance, so this can only fire if the row
    // was tampered with directly in the database — which is exactly when you
    // want a redirect that mints a session to refuse rather than obey. Cheap,
    // and it means no code path can put an unvalidated string in `Location`.
    const target = sanitizeSessionHandoffPath(consumed.redirectPath)
    if (target === null) {
      return refuse({
        request,
        fallbackPath,
        reason: 'redirect_not_allowed',
        userId: user.id,
        tokenId: consumed.tokenId,
      })
    }

    const response = redirectTo(new URL(target, redirectBase(request)))
    setSessionCookie({ response, request, token: sessionToken })

    logAuthEvent({
      level: 'info',
      event: 'auth.session_handoff.consumed',
      route: ROUTE,
      userId: user.id,
      verificationId: consumed.tokenId,
      meta: {
        redirectPath: consumed.redirectPath,
        actingRole,
        // Surfaces a downgrade (issued acting as PRO, redeemed as CLIENT
        // because entitlement changed) rather than letting it pass silently.
        actingRoleDowngraded: actingRole !== consumed.actingRole,
      },
    })

    return response
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.session_handoff.exchange.failed',
      route: ROUTE,
      code: 'INTERNAL',
      error: err,
    })

    // Same destination as every other failure — an internal error must not be
    // distinguishable from a bad token either.
    return redirectTo(
      new URL(buildSessionHandoffLoginPath(fallbackPath), redirectBase(request)),
    )
  }
}
