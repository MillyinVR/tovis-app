// proxy.ts
import { NextResponse, type NextRequest } from 'next/server'

import { parseBearerToken } from '@/lib/auth/bearerToken'
import { verifyMiddlewareToken } from '@/lib/auth/middlewareToken'

const ALLOWED_VERIFICATION_PAGE_PATHS = new Set([
  '/verify-phone',
  '/verify-email',
])

const ALLOWED_VERIFICATION_API_PATHS = new Set([
  '/api/v1/auth/phone/send',
  '/api/v1/auth/phone/verify',
  '/api/v1/auth/email/send',
  '/api/v1/auth/email/verify',
  '/api/v1/auth/verification/status',
  '/api/v1/auth/logout',
])

const STATE_CHANGING_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

const ORIGIN_CHECK_EXEMPT_PATH_PREFIXES = [
  '/api/health',
  '/api/webhooks',
  '/api/internal/jobs',
] as const

const ORIGIN_CHECK_EXEMPT_PATHS = new Set([
  '/api/v1/auth/logout',
])

function normalizePathname(pathname: string): string {
  if (!pathname) return '/'
  if (pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
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

function getSubdomain(host: string, root: string): string | null {
  if (!host || !root) return null
  if (host === root) return null
  if (!host.endsWith(`.${root}`)) return null

  const sub = host.slice(0, -(root.length + 1)).trim()

  if (!sub || sub === 'www') return null
  if (sub.includes('/')) return null

  return sub
}

function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true

  if (
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/site.webmanifest' ||
    pathname === '/manifest.webmanifest'
  ) {
    return true
  }

  return /\.(?:avif|bmp|css|eot|gif|ico|jpeg|jpg|js|map|mp3|mp4|ogg|png|svg|txt|wav|webm|webmanifest|webp|woff|woff2|xml)$/i.test(
    pathname,
  )
}

function isAllowedVerificationPath(pathname: string): boolean {
  if (isStaticAssetPath(pathname)) return true
  if (ALLOWED_VERIFICATION_PAGE_PATHS.has(pathname)) return true
  if (ALLOWED_VERIFICATION_API_PATHS.has(pathname)) return true
  return false
}

// Unlike hostToHostname, keeps the port: this feeds absolute URLs the
// browser must reconnect to, so dropping a non-default port breaks them.
function hostWithPort(hostHeader: string | null): string | null {
  const first = hostHeader?.split(',')[0]?.trim().toLowerCase() ?? ''
  return first || null
}

function resolveAppOrigin(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }

  const forwardedProto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    req.nextUrl.protocol.replace(/:$/, '') ||
    'https'

  const host = hostWithPort(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
  )

  if (host) {
    return `${forwardedProto}://${host}`
  }

  return req.nextUrl.origin.replace(/\/+$/, '')
}

/**
 * Canonical app origin for redirecting non-profile paths off a vanity
 * subdomain. Unlike resolveAppOrigin, this MUST NOT fall back to the request
 * host — on a vanity domain that host is the subdomain we're redirecting away
 * from, so falling back to it would loop. Falls back to `www.<root>` instead.
 */
function vanityAppOrigin(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }

  const root = process.env.APP_ROOT_DOMAIN?.trim() || 'tovis.me'
  return `https://www.${root}`
}

function buildVerificationRedirectUrl(req: NextRequest): URL {
  const url = new URL('/verify-phone', resolveAppOrigin(req))
  const currentPath = `${req.nextUrl.pathname}${req.nextUrl.search}`

  if (currentPath && currentPath !== '/verify-phone') {
    url.searchParams.set('next', currentPath)
  }

  return url
}

function withRequestId(res: NextResponse, requestId: string): NextResponse {
  res.headers.set('x-request-id', requestId)
  return res
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    return url.origin.toLowerCase().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function parseAllowedOrigins(): ReadonlySet<string> {
  const configuredOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.ALLOWED_APP_ORIGINS,
  ]
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const normalizedOrigins = configuredOrigins
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null)

  return new Set(normalizedOrigins)
}

function isSameSiteOrigin(req: NextRequest, origin: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin)
  if (normalizedOrigin === null) return false

  const requestOrigin = resolveAppOrigin(req).toLowerCase()
  if (normalizedOrigin === requestOrigin) return true

  const allowedOrigins = parseAllowedOrigins()
  if (allowedOrigins.has(normalizedOrigin)) return true

  const originHost = hostToHostname(new URL(normalizedOrigin).host)
  const requestHost = hostToHostname(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
  )

  if (!originHost || !requestHost) return false

  if (originHost === requestHost) return true

  const rootDomain = process.env.APP_ROOT_DOMAIN?.trim() || 'tovis.me'
  const originSubdomain = getSubdomain(originHost, rootDomain)
  const requestSubdomain = getSubdomain(requestHost, rootDomain)

  if (originHost === rootDomain && requestHost.endsWith(`.${rootDomain}`)) {
    return true
  }

  if (requestHost === rootDomain && originHost.endsWith(`.${rootDomain}`)) {
    return true
  }

  return originSubdomain !== null && requestSubdomain !== null
}

function shouldCheckOrigin(req: NextRequest, pathname: string): boolean {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    return false
  }

  if (isStaticAssetPath(pathname)) {
    return false
  }

  if (ORIGIN_CHECK_EXEMPT_PATHS.has(pathname)) {
    return false
  }

  if (
    ORIGIN_CHECK_EXEMPT_PATH_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    )
  ) {
    return false
  }

  return true
}

function getRequestOriginOrReferer(req: NextRequest): string | null {
  const origin = req.headers.get('origin')?.trim()
  if (origin) return origin

  const referer = req.headers.get('referer')?.trim()
  if (!referer) return null

  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

function originCheckFail(requestId: string): NextResponse {
  const res = NextResponse.json(
    {
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    },
    { status: 403 },
  )

  return withRequestId(res, requestId)
}

export async function proxy(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const pathname = normalizePathname(req.nextUrl.pathname)

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-pathname', pathname)

  const cookieToken = req.cookies.get('tovis_token')?.value ?? null
  const bearerToken = parseBearerToken(req.headers.get('authorization'))

  // The Origin/Referer check IS the CSRF defense, and CSRF only works because a
  // browser attaches the session cookie automatically. With NO auth cookie on
  // the request there is no ambient session to ride, so two cookieless shapes
  // are exempt (forcing the check on them is fatal for native, which never
  // sends Origin/Referer):
  //   1. A bearer token is present — a native authenticated call. An attacker
  //      can't set an Authorization header cross-site, so the Origin is moot.
  //   2. No Origin/Referer at all — a non-browser (native) client, e.g. the
  //      LOGIN bootstrap before any token exists. A browser is forced to attach
  //      an Origin on a cross-site state-changing request, so a cookieless
  //      request with no origin signal cannot be a browser CSRF.
  // Anything with a cookie — or a cookieless request that DOES carry an Origin
  // (a browser revealing itself, incl. login-CSRF attempts) — is still enforced.
  const exemptFromOriginCheck =
    cookieToken === null &&
    (bearerToken !== null || getRequestOriginOrReferer(req) === null)

  if (!exemptFromOriginCheck && shouldCheckOrigin(req, pathname)) {
    const originOrReferer = getRequestOriginOrReferer(req)

    if (!originOrReferer || !isSameSiteOrigin(req, originOrReferer)) {
      return originCheckFail(requestId)
    }
  }

  const rawToken = cookieToken ?? bearerToken
  const tokenPayload = await verifyMiddlewareToken(rawToken)

  if (tokenPayload?.sessionKind === 'VERIFICATION') {
    if (isAllowedVerificationPath(pathname)) {
      const res = NextResponse.next({ request: { headers: requestHeaders } })
      return withRequestId(res, requestId)
    }

    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json(
        {
          ok: false,
          error: 'Account verification is required.',
          code: 'VERIFICATION_REQUIRED',
        },
        { status: 403 },
      )
      return withRequestId(res, requestId)
    }

    const res = NextResponse.redirect(buildVerificationRedirectUrl(req))
    return withRequestId(res, requestId)
  }

  const host = hostToHostname(req.headers.get('host')) ?? ''
  const sub = getSubdomain(host, 'tovis.me')

  // Vanity domains: *.tovis.me serve the pro's public profile — but ONLY at the
  // root path, which is rewritten internally to /p/{subdomain} without changing
  // the browser URL. Any OTHER path on the subdomain (in-app links like /looks,
  // or a client-side redirect such as the pro-session guard bouncing a guest to
  // /login) must be sent to the canonical app host; otherwise it would rewrite
  // to a nonexistent /p/{subdomain}/<path> and 404. API and static assets keep
  // normal routing so the subdomain can load the app's own assets.
  if (sub && !pathname.startsWith('/api/') && !isStaticAssetPath(pathname)) {
    if (normalizePathname(pathname) !== '/') {
      const target = new URL(vanityAppOrigin())
      target.pathname = pathname
      target.search = req.nextUrl.search

      const res = NextResponse.redirect(target, 307)
      return withRequestId(res, requestId)
    }

    const url = req.nextUrl.clone()
    url.pathname = `/p/${sub}`

    const res = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    })
    return withRequestId(res, requestId)
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  return withRequestId(res, requestId)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}