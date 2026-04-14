// app/api/auth/phone/verify/route.ts
import crypto from 'crypto'
import { cookies } from 'next/headers'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  createActiveToken,
  createVerificationToken,
  verifyToken,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value ?? null
  if (!token) return null
  const payload = verifyToken(token)
  return payload?.userId ?? null
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

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined
  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) return '.tovis.app'
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) return '.tovis.me'
  return undefined
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
  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const userId = auth.user.id

    const raw: unknown = await request.json().catch(() => ({}))
    const body = isRecord(raw) ? raw : {}
    const codeRaw = pickString(body.code)?.trim()

    if (!codeRaw) {
      return jsonFail(400, 'Verification code is required.', {
        code: 'CODE_REQUIRED',
      })
    }

    if (!/^\d{6}$/.test(codeRaw)) {
      return jsonFail(400, 'Invalid code format.', {
        code: 'CODE_INVALID',
      })
    }

    if (auth.user.phoneVerifiedAt) {
      return jsonOk(
        {
          ok: true,
          alreadyVerified: true,
          isPhoneVerified: true,
          isEmailVerified: auth.user.isEmailVerified,
          isFullyVerified: auth.user.isFullyVerified,
        },
        200,
      )
    }

    const phone = auth.user.phone?.trim() ?? ''
    if (!phone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    const now = new Date()
    const codeHash = sha256(codeRaw)

    const match = await prisma.phoneVerification.findFirst({
      where: {
        userId,
        phone,
        usedAt: null,
        expiresAt: { gt: now },
        codeHash,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!match) {
      return jsonFail(400, 'Incorrect or expired code.', {
        code: 'CODE_MISMATCH',
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.phoneVerification.update({
        where: { id: match.id },
        data: { usedAt: now },
      })

      await tx.user.update({
        where: { id: userId },
        data: { phoneVerifiedAt: now },
      })

      await tx.clientProfile.updateMany({
        where: { userId },
        data: { phoneVerifiedAt: now },
      })

      await tx.professionalProfile.updateMany({
        where: { userId },
        data: { phoneVerifiedAt: now },
      })
    })

    const isEmailVerified = auth.user.isEmailVerified
    const isFullyVerified = isEmailVerified

    const res = jsonOk(
      {
        ok: true,
        isPhoneVerified: true,
        isEmailVerified,
        isFullyVerified,
        requiresEmailVerification: !isEmailVerified,
      },
      200,
    )

    // Upgrade (or refresh) the session cookie so the client can access the app
    // without needing a separate round-trip.
    const authenticatedUserId = await getAuthenticatedUserId()
    if (authenticatedUserId === userId) {
      const sessionToken = isFullyVerified
        ? createActiveToken({
            userId,
            role: auth.user.role,
            authVersion: auth.user.authVersion,
          })
        : createVerificationToken({
            userId,
            role: auth.user.role,
            authVersion: auth.user.authVersion,
          })

      const hostname = getRequestHostname(request)
      const cookieDomain = resolveCookieDomain(hostname)
      const isHttps = resolveIsHttps(request)

      res.cookies.set('tovis_token', sessionToken, {
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      })
    }

    return res
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[phone/verify] error', message)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}