// app/api/_utils/auth/sessionCookie.ts
//
// Shared session-cookie attribute logic for every auth route that mints,
// upgrades or clears tovis_token: host-derived cookie domain, protocol-derived
// secure flag.
//
// This is the ONLY place the cookie's attributes are written. Login, register,
// logout, phone-verify and email-verify each carried their own copy of this
// file's four functions; a cookie whose Domain or Secure flag differs between
// the route that sets it and the route that clears it leaves a session the
// user cannot log out of, and nothing in the type system connects them.

type CookieWritableResponse = {
  cookies: {
    set: (
      name: string,
      value: string,
      options: {
        httpOnly: boolean
        secure: boolean
        sameSite: 'lax'
        path: string
        maxAge: number
        domain?: string
      },
    ) => unknown
  }
}

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null

  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
}

export function getRequestHostname(request: Request): string | null {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return hostToHostname(host)
}

export function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined

  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) {
    return '.tovis.app'
  }
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) {
    return '.tovis.me'
  }

  return undefined
}

export function resolveIsHttps(request: Request): boolean {
  const xfProto = request.headers
    .get('x-forwarded-proto')
    ?.trim()
    .toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function writeSessionCookie(
  args: { response: CookieWritableResponse; request: Request },
  value: string,
  maxAge: number,
): void {
  const cookieDomain = resolveCookieDomain(getRequestHostname(args.request))

  args.response.cookies.set('tovis_token', value, {
    httpOnly: true,
    secure: resolveIsHttps(args.request),
    sameSite: 'lax',
    path: '/',
    maxAge,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export function setSessionCookie(args: {
  response: CookieWritableResponse
  request: Request
  token: string
}): void {
  writeSessionCookie(args, args.token, SESSION_MAX_AGE_SECONDS)
}

/**
 * Expire tovis_token. The attributes must match `setSessionCookie` exactly —
 * a browser treats a cookie with a different Domain as a different cookie, so
 * clearing with the wrong one leaves the session live.
 */
export function clearSessionCookie(args: {
  response: CookieWritableResponse
  request: Request
}): void {
  writeSessionCookie(args, '', 0)
}
