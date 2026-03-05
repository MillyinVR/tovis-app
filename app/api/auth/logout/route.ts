// app/api/auth/logout/route.ts
import { jsonOk } from '@/app/api/_utils'

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null
  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  // IPv6 like "[::1]:3000"
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  // Strip port "localhost:3000" -> "localhost"
  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
}

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined
  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) return '.tovis.app'
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) return '.tovis.me'
  return undefined // host-only cookie (localhost etc)
}

function resolveIsHttps(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function getRequestHostname(request: Request): string | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return hostToHostname(host)
}

export async function POST(request: Request) {
  const res = jsonOk({ ok: true }, 200)

  const hostname = getRequestHostname(request)
  const cookieDomain = resolveCookieDomain(hostname)
  const isHttps = resolveIsHttps(request)

  // Clear auth token
  res.cookies.set('tovis_token', '', {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })

  // Optional: if you ALSO want logout to clear client zip (not required for auth)
  // res.cookies.set('tovis_client_zip', '', {
  //   httpOnly: false,
  //   secure: isHttps,
  //   sameSite: 'lax',
  //   path: '/',
  //   maxAge: 0,
  //   ...(cookieDomain ? { domain: cookieDomain } : {}),
  // })

  return res
}