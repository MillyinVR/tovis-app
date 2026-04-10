import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

import { GET } from './route'

function makeUser(args?: {
  role?: Role
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
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
          }
        : null,
  }
}

describe('app/api/auth/verification/status/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await GET()

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
  })

  it('returns client verification status and default nextUrl', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
        emailVerifiedAt: null,
      }),
    })

    const result = await GET()
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
        role: Role.CLIENT,
      },
      sessionKind: 'VERIFICATION',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresPhoneVerification: false,
      requiresEmailVerification: true,
      nextUrl: '/looks',
    })
  })

  it('returns pro default nextUrl', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
      }),
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/pro/calendar')
    expect(body.user.role).toBe(Role.PRO)
    expect(body.isFullyVerified).toBe(true)
  })

  it('returns admin default nextUrl', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.ADMIN,
      }),
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.nextUrl).toBe('/admin')
    expect(body.user.role).toBe(Role.ADMIN)
  })
})