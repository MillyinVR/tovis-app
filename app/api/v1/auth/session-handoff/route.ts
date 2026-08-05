// app/api/v1/auth/session-handoff/route.ts
//
// POST — an authenticated NATIVE session asks for a one-time URL that will sign
// the same user into a BROWSER and land them on an allowlisted /pro page.
//
// This exists because SFSafariViewController shares Safari's cookie jar, not
// the app's session: without it, "Manage plan on the web" drops a signed-in pro
// on the login wall. See lib/auth/sessionHandoff.ts for the security shape.
//
// The response is the ABSOLUTE exchange URL, not the raw token. The client
// therefore never assembles an auth URL, and the exchange path can move without
// an app release.

import {
  jsonFail,
  jsonOk,
  pickString,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { getAppUrlFromRequest } from '@/lib/appUrl'
import {
  DEFAULT_SESSION_HANDOFF_PATH,
  buildSessionHandoffExchangeUrl,
  createSessionHandoffToken,
  isSessionHandoffDisabled,
  sanitizeSessionHandoffPath,
} from '@/lib/auth/sessionHandoff'
import type { AuthSessionHandoffResponseDTO } from '@/lib/dto/auth'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = 'auth.sessionHandoff.issue'

type Body = {
  redirectPath?: unknown
}

export async function POST(request: Request) {
  try {
    // Kill switch, checked BEFORE auth so flipping it costs nothing and leaks
    // nothing. 404 (not 403) is the repo's convention for a route that is off,
    // and it is what the iOS caller already degrades on — it falls back to the
    // plain page URL, so the pro still gets to their plan via the login wall.
    if (isSessionHandoffDisabled()) {
      return jsonFail(404, 'Not found', { code: 'NOT_FOUND' })
    }

    // Acting role PRO only — the destination allowlist is the /pro workspace,
    // so a session acting as CLIENT has nowhere this token could legitimately
    // take them. requireUser also enforces an ACTIVE, fully-verified session,
    // which is what makes the minted web session a legitimate continuation
    // rather than an upgrade.
    const auth = await requireUser({ roles: [Role.PRO] })
    if (!auth.ok) return auth.res

    const { user } = auth

    const rlRes = await enforceRateLimit({
      bucket: 'auth:session-handoff:issue',
      identity: await rateLimitIdentity(user.id),
    })
    if (rlRes) return rlRes

    const body = (await request.json().catch(() => ({}))) as Body

    // An ABSENT destination defaults; a PRESENT one must pass the allowlist,
    // and a 400 is the right answer when it does not. Silently substituting the
    // default would turn "take me to /admin" into a WORKING link to somewhere
    // else — a refusal is the honest response. The `undefined` test is on the
    // raw field, not on pickString's output, so a present-but-junk value
    // (`""`, `42`, `null`) is refused rather than quietly defaulted.
    const redirectPath =
      body.redirectPath === undefined
        ? DEFAULT_SESSION_HANDOFF_PATH
        : sanitizeSessionHandoffPath(pickString(body.redirectPath))

    if (redirectPath === null) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.session_handoff.issue.rejected',
        route: ROUTE,
        code: 'REDIRECT_NOT_ALLOWED',
        userId: user.id,
      })

      return jsonFail(400, 'That destination is not available.', {
        code: 'REDIRECT_NOT_ALLOWED',
      })
    }

    const appUrl = getAppUrlFromRequest(request)
    if (!appUrl) {
      // Without a resolvable origin we cannot build a URL the browser can
      // reach, and a relative one would be useless to a native caller. Refuse
      // rather than mint a token that can never be redeemed.
      logAuthEvent({
        level: 'error',
        event: 'auth.session_handoff.issue.failed',
        route: ROUTE,
        code: 'APP_URL_UNRESOLVED',
        userId: user.id,
      })

      return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
    }

    const issued = await createSessionHandoffToken({
      userId: user.id,
      actingRole: user.role,
      authVersion: user.authVersion,
      redirectPath,
      ip: getTrustedClientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    })

    logAuthEvent({
      level: 'info',
      event: 'auth.session_handoff.issued',
      route: ROUTE,
      userId: user.id,
      // `verificationId` is this repo's existing field for "the token row this
      // event is about" (see lib/auth/passwordReset.ts). The SECRET half is
      // never logged — only the row id, which grants nothing on its own.
      verificationId: issued.id,
      meta: {
        redirectPath: issued.redirectPath,
        actingRole: user.role,
        expiresAt: issued.expiresAt.toISOString(),
      },
    })

    // `jsonOk` already pins `Cache-Control: no-store`, which is what this body
    // needs — it carries a live credential for the next 60 seconds.
    return jsonOk(
      {
        url: buildSessionHandoffExchangeUrl({
          appUrl,
          token: issued.token,
          fallbackPath: issued.redirectPath,
        }),
        redirectPath: issued.redirectPath,
        expiresAt: issued.expiresAt.toISOString(),
      } satisfies AuthSessionHandoffResponseDTO,
      200,
    )
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.session_handoff.issue.failed',
      route: ROUTE,
      code: 'INTERNAL',
      error: err,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
