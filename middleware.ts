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
  if (!host.endsWith(root)) return null
  const left = host.slice(0, host.length - root.length)
  const sub = left.replace(/\.$/, '')
  if (!sub || sub === 'www') return null
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

export async function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)

  const pathname = normalizePathname(req.nextUrl.pathname)

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

  // Vanity domains: *.tovis.me -> internally serve /p/{subdomain}
  // This does NOT change the URL in the browser; it just routes internally.
  if (sub) {
    const url = req.nextUrl.clone()
    url.pathname = `/p/${sub}${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`

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