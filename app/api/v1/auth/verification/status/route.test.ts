// app/api/v1/auth/verification/status/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, VerificationStatus } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/lib/auth', () => ({
  createActiveToken: mockCreateActiveToken,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
}))

import { GET } from './route'

function makeRequest() {
  return new Request('http://localhost/api/v1/auth/verification/status', {
    headers: { host: 'localhost:3000' },
  })
}

function makeUser(args?: {
  role?: Role
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
  professionalVerificationStatus?: VerificationStatus | null
}) {
  const role = args?.role ?? Role.CLIENT
  const phoneVerifiedAt =
    args?.phoneVerifiedAt === undefined
      ? new Date('2026-04-08T10:00:00.000Z')
      : args.phoneVerifiedAt
  const emailVerifiedAt =
    args?.emailVerifiedAt === undefined
      ? new Date('2026-04-08T10:05:00.000Z')
      : args.emailVerifiedAt

  return {
    id: 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    role,
    authVersion: 1,
    sessionKind: args?.sessionKind ?? 'ACTIVE',
    phoneVerifiedAt,
    emailVerifiedAt,
    isPhoneVerified: Boolean(phoneVerifiedAt),
    isEmailVerified: Boolean(emailVerifiedAt),
    isFullyVerified: Boolean(phoneVerifiedAt && emailVerifiedAt),
    clientProfile:
      role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          }
        : null,
    professionalProfile:
      role === Role.PRO
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
            verificationStatus:
              args?.professionalVerificationStatus ??
              VerificationStatus.APPROVED,
          }
        : null,
  }
}

describe('app/api/v1/auth/verification/status/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateActiveToken.mockReturnValue('active_token_test')
    mockLogAuthEvent.mockReset()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await GET(makeRequest())

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
  })

  it('returns null nextUrl during unfinished client verification sessions', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
        emailVerifiedAt: null,
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })

    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        phone: '+15551234567',
        role: Role.CLIENT,
      },
      sessionKind: 'VERIFICATION',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresPhoneVerification: false,
      requiresEmailVerification: true,
      nextUrl: null,
      token: null,
    })
  })

  it('returns null nextUrl during unfinished pro verification sessions', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        sessionKind: 'VERIFICATION',
        emailVerifiedAt: null,
        professionalVerificationStatus: VerificationStatus.PENDING,
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        phone: '+15551234567',
        role: Role.PRO,
      },
      sessionKind: 'VERIFICATION',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresPhoneVerification: false,
      requiresEmailVerification: true,
      nextUrl: null,
      token: null,
    })
  })

  it('returns approved pro nextUrl once fully verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        sessionKind: 'ACTIVE',
        professionalVerificationStatus: VerificationStatus.APPROVED,
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/pro/calendar')
    expect(body.user).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.PRO,
    })
    expect(body.isFullyVerified).toBe(true)
  })

  it('returns pending pro nextUrl to the profile setup surface once fully verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        sessionKind: 'ACTIVE',
        professionalVerificationStatus: VerificationStatus.PENDING,
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/pro/profile/public-profile')
    expect(body.user).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.PRO,
    })
  })

  it('returns admin default nextUrl once fully verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.ADMIN,
        sessionKind: 'ACTIVE',
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/admin')
    expect(body.user).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.ADMIN,
    })
  })

  it('returns default client nextUrl once fully verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'ACTIVE',
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/looks')
    expect(body.user).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.CLIENT,
    })
  })

  it('upgrades a stale VERIFICATION session to ACTIVE once fully verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.sessionKind).toBe('ACTIVE')
    expect(body.isFullyVerified).toBe(true)
    expect(body.nextUrl).toBe('/looks')

    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
    })

    // Native (no cookie jar) reads the healed token from the body and swaps
    // its stored bearer for it.
    expect(body.token).toBe('active_token_test')

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=active_token_test')
    expect(setCookie).toContain('HttpOnly')

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.session.upgraded_from_stale_verification',
      route: 'auth.verification.status',
      userId: 'user_1',
    })
  })

  it('does not upgrade or set a cookie while verification is incomplete', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
        emailVerifiedAt: null,
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(body.sessionKind).toBe('VERIFICATION')
    expect(body.token).toBeNull()
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
  })

  it('does not reissue a cookie for sessions that are already ACTIVE', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'ACTIVE',
      }),
    })

    const result = await GET(makeRequest())
    const body = await result.json()

    expect(body.sessionKind).toBe('ACTIVE')
    expect(body.token).toBeNull()
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
  })
})