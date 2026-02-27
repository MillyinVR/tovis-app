// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

function getSubdomain(host: string, root: string) {
  // host: "tori.tovis.me" root: "tovis.me" -> "tori"
  if (!host.endsWith(root)) return null
  const left = host.slice(0, host.length - root.length)
  const sub = left.replace(/\.$/, '') // remove trailing dot
  if (!sub || sub === 'www') return null
  return sub
}

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)

  const host = (req.headers.get('host') || '').toLowerCase()

  // ✅ Vanity domains: *.tovis.me -> internally serve /p/{subdomain}
  // This does NOT change the URL in the browser; it just routes internally.
  const sub = getSubdomain(host, 'tovis.me')
  if (sub) {
    const url = req.nextUrl.clone()
    // Keep the path/query (so later you can do /services, etc. if you want)
    // For now, root path is enough.
    url.pathname = `/p/${sub}${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`
    const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    res.headers.set('x-request-id', requestId)
    return res
  }

  // default pass-through
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('x-request-id', requestId)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}