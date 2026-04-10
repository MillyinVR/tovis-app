// app/api/auth/login/route.ts
import { prisma } from '@/lib/prisma'
import { verifyPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { jsonFail, jsonOk, pickString, normalizeEmail, enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type LoginBody = {
  email?: unknown
  password?: unknown
  tapIntentId?: unknown
  expectedRole?: unknown
}

function normalizeExpectedRole(raw: unknown): Role | null {
  const s = pickString(raw)?.trim().toUpperCase() ?? ''
  if (s === Role.ADMIN) return Role.ADMIN
  if (s === Role.PRO) return Role.PRO
  if (s === Role.CLIENT) return Role.CLIENT
  return null
}

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null
  const host = hostHeader.trim().toLowerCase()
  if (!host) return null

  // Handle IPv6 like "[::1]:3000"
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end === -1) return null
    return host.slice(1, end)
  }

  // Strip port if present: "localhost:3000" -> "localhost"
  const idx = host.indexOf(':')
  return idx >= 0 ? host.slice(0, idx) : host
}

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined

  // Share cookie across subdomains of tovis.app or tovis.me
  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) return '.tovis.app'
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) return '.tovis.me'

  // localhost / other hosts: host-only cookie (no Domain attribute)
  return undefined
}

function resolveIsHttps(request: Request): boolean {
  // Prefer proxy headers (Vercel / reverse proxies)
  const xfProto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  // Fallback to request.url
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  try {
    console.log('LOGIN ROUTE DATABASE_URL =', process.env.DATABASE_URL?.slice(0, 120))
    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({ bucket: 'auth:login', identity })
    if (rlRes) return rlRes

    const body = (await request.json().catch(() => ({}))) as LoginBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const tapIntentId = pickString(body.tapIntentId)
    const expectedRole = normalizeExpectedRole(body.expectedRole)

    if (!email || !password) {
      return jsonFail(400, 'Missing email or password', { code: 'MISSING_CREDENTIALS' })
    }

   const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        professionalProfile: { select: { id: true } },
        clientProfile: { select: { id: true } },
      },
    })

    console.log('LOGIN LOOKUP RESULT =', user ? {
      id: user.id,
      email: user.email,
      role: user.role,
      passwordHashPrefix: user.password.slice(0, 20),
    } : null)

    if (!user) {
      console.log('LOGIN FAILURE REASON = USER_NOT_FOUND')
      return jsonFail(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' })
    }

    const isValid = await verifyPassword(password, user.password)
    console.log('LOGIN PASSWORD MATCH =', isValid)

    if (!isValid) {
      console.log('LOGIN FAILURE REASON = PASSWORD_MISMATCH')
      return jsonFail(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' })
    }

    // ✅ Role intent enforcement (prevents “login then bounce back to login” loops)
    if (expectedRole && user.role !== expectedRole) {
      return jsonFail(403, `That account is not a ${expectedRole.toLowerCase()} account.`, {
        code: 'ROLE_MISMATCH',
        expectedRole,
        actualRole: user.role,
      })
    }

    // ✅ Pro setup enforcement (matches your /pro layout requirement)
    if (user.role === Role.PRO && !user.professionalProfile?.id) {
      return jsonFail(409, 'Professional setup is not complete yet.', {
        code: 'PRO_SETUP_REQUIRED',
      })
    }

    const token = createToken({ userId: user.id, role: user.role })

    const consumed = await consumeTapIntent({
      tapIntentId: tapIntentId ?? null,
      userId: user.id,
    })

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? null,
      },
      200,
    )

    const hostname = hostToHostname(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
    const cookieDomain = resolveCookieDomain(hostname)
    const isHttps = resolveIsHttps(request)

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: isHttps, // ✅ based on actual protocol, not NODE_ENV
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      ...(cookieDomain ? { domain: cookieDomain } : {}), // ✅ domain only for tovis.app / tovis.me
    })

    return res
  } catch (error) {
    console.error('Login error', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}