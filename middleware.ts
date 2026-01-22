// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  // Pass it forward to routes (useful for server logs)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // Also return it to client
  res.headers.set('x-request-id', requestId)

  return res
}

// Apply to all routes (or tighten if you want)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
