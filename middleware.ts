// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

import { verifyMiddlewareToken } from '@/lib/auth/middlewareToken'

const ALLOWED_VERIFICATION_PAGE_PATHS = new Set([
  '/verify-phone',
  '/verify-email',
])

const ALLOWED_VERIFICATION_API_PATHS = new Set([
  '/api/auth/phone/send',
  '/api/auth/phone/verify',
  '/api/auth/email/send',
  '/api/auth/email/verify',
  '/api/auth/verification/status',
  '/api/auth/logout',
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
  '/api/auth/logout',
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

function resolveAppOrigin(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }

  const forwardedProto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    req.nextUrl.protocol.replace(/:$/, '') ||
    'https'

  const hostname = hostToHostname(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
  )

  if (hostname) {
    return `${forwardedProto}://${hostname}`
  }

  return req.nextUrl.origin.replace(/\/+$/, '')
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

export async function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const pathname = normalizePathname(req.nextUrl.pathname)

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-pathname', pathname)

  if (shouldCheckOrigin(req, pathname)) {
    const originOrReferer = getRequestOriginOrReferer(req)

    if (!originOrReferer || !isSameSiteOrigin(req, originOrReferer)) {
      return originCheckFail(requestId)
    }
  }

  const rawToken = req.cookies.get('tovis_token')?.value ?? null
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

  // Vanity domains: *.tovis.me -> internally serve /p/{subdomain}.
  // This does NOT change the URL in the browser; it just routes internally.
  // Do not rewrite API or static asset requests; those should keep normal app routing.
  if (sub && !pathname.startsWith('/api/') && !isStaticAssetPath(pathname)) {
    const url = req.nextUrl.clone()
    url.pathname = `/p/${sub}${pathname === '/' ? '' : pathname}`

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