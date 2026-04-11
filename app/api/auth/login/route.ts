// app/api/auth/login/route.ts
import { prisma } from '@/lib/prisma'
import { verifyPassword, createActiveToken, createVerificationToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import {
  jsonFail,
  jsonOk,
  pickString,
  normalizeEmail,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
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

  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  // Handle IPv6 like "[::1]:3000"
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  // Strip port if present: "localhost:3000" -> "localhost"
  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
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


    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({ bucket: 'auth:login', identity })
    if (rlRes) return rlRes

    const body = (await request.json().catch(() => ({}))) as LoginBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const tapIntentId = pickString(body.tapIntentId)
    const expectedRole = normalizeExpectedRole(body.expectedRole)

    if (!email || !password) {
      return jsonFail(400, 'Missing email or password', {
        code: 'MISSING_CREDENTIALS',
      })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        authVersion: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        professionalProfile: { select: { id: true } },
        clientProfile: { select: { id: true } },
      },
    })

    if (!user) {
      return jsonFail(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' })
    }

    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      return jsonFail(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' })
    }

    if (expectedRole && user.role !== expectedRole) {
      return jsonFail(
        403,
        `That account is not a ${expectedRole.toLowerCase()} account.`,
        {
          code: 'ROLE_MISMATCH',
          expectedRole,
          actualRole: user.role,
        },
      )
    }

    if (user.role === Role.PRO && !user.professionalProfile?.id) {
      return jsonFail(409, 'Professional setup is not complete yet.', {
        code: 'PRO_SETUP_REQUIRED',
      })
    }

    const isFullyVerified = Boolean(user.phoneVerifiedAt && user.emailVerifiedAt)

    const token = isFullyVerified
      ? createActiveToken({
          userId: user.id,
          role: user.role,
          authVersion: user.authVersion,
        })
      : createVerificationToken({
          userId: user.id,
          role: user.role,
          authVersion: user.authVersion,
        })

    const consumed = await consumeTapIntent({
      tapIntentId: tapIntentId ?? null,
      userId: user.id,
    })

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? null,
        isPhoneVerified: Boolean(user.phoneVerifiedAt),
        isEmailVerified: Boolean(user.emailVerifiedAt),
        isFullyVerified,
      },
      200,
    )

    const hostname = hostToHostname(
      request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    )
    const cookieDomain = resolveCookieDomain(hostname)
    const isHttps = resolveIsHttps(request)

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    })

    return res
  } catch (error) {
    console.error('Login error', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}