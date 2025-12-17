import { NextResponse, type NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'

const PROTECTED_CLIENT_ROUTES = ['/client']
const PROTECTED_PRO_ROUTES = ['/pro']

function isProtected(pathname: string, protectedList: string[]) {
  return protectedList.some(base => pathname === base || pathname.startsWith(`${base}/`))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only protect /client and /pro namespaces for now
  const isClientRoute = isProtected(pathname, PROTECTED_CLIENT_ROUTES)
  const isProRoute = isProtected(pathname, PROTECTED_PRO_ROUTES)

  if (!isClientRoute && !isProRoute) {
    return NextResponse.next()
  }

  const token = request.cookies.get('tovis_token')?.value

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const payload = verifyToken(token)

  if (!payload) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Role enforcement
  if (isClientRoute && payload.role !== 'CLIENT') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isProRoute && payload.role !== 'PRO') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/client/:path*', '/pro/:path*'],
}
