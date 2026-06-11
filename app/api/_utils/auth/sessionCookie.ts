// app/api/_utils/auth/sessionCookie.ts
//
// Shared session-cookie attribute logic for auth routes that mint or upgrade
// tovis_token. Mirrors the behavior in register/phone-verify/email-verify
// (host-derived domain, protocol-derived secure flag).

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

export function setSessionCookie(args: {
  response: CookieWritableResponse
  request: Request
  token: string
}): void {
  const hostname = getRequestHostname(args.request)
  const cookieDomain = resolveCookieDomain(hostname)
  const isHttps = resolveIsHttps(args.request)

  args.response.cookies.set('tovis_token', args.token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}
