import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockCookies = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockVerifyToken = vi.hoisted(() => vi.fn())
const mockIsDeviceSessionRevoked = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('next/headers', () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}))

vi.mock('./auth', () => ({
  verifyToken: mockVerifyToken,
}))

vi.mock('./auth/deviceSessions', () => ({
  isDeviceSessionRevoked: mockIsDeviceSessionRevoked,
}))

vi.mock('./prisma', () => ({
  prisma: mockPrisma,
}))

import { getCurrentUser, currentUserSelect } from './currentUser'

function makeDbUser(args?: {
  id?: string
  role?: Role
  authVersion?: number
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
  adminPermissions?: { id: string }[]
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
    id: args?.id ?? 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    role,
    authVersion: args?.authVersion ?? 1,
    phoneVerifiedAt,
    emailVerifiedAt,
    adminPermissions: args?.adminPermissions ?? [],
    clientProfile:
      role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
            phoneVerifiedAt,
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
            phoneVerifiedAt,
          }
        : null,
  }
}

describe('lib/currentUser', () => {
  beforeEach(() => {
    mockCookies.mockReset()
    mockHeaders.mockReset()
    mockVerifyToken.mockReset()
    mockPrisma.user.findUnique.mockReset()
    mockIsDeviceSessionRevoked.mockReset()
    mockIsDeviceSessionRevoked.mockResolvedValue(false)

    mockCookies.mockResolvedValue({
      get: vi.fn(() => undefined),
    })
    // Default: no Authorization header (web cookie path).
    mockHeaders.mockResolvedValue({
      get: vi.fn(() => null),
    })
    mockVerifyToken.mockReturnValue(null)
  })

  it('returns null when the auth cookie and bearer header are both missing', async () => {
    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockVerifyToken).not.toHaveBeenCalled()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to the Authorization: Bearer header when no cookie is present', async () => {
    mockHeaders.mockResolvedValue({
      get: vi.fn((name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer header_token' : null,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser())

    const result = await getCurrentUser()

    expect(mockVerifyToken).toHaveBeenCalledWith('header_token')
    expect(result?.id).toBe('user_1')
  })

  it('prefers the cookie over the bearer header when both are present', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'cookie_token' } : undefined,
      ),
    })
    mockHeaders.mockResolvedValue({
      get: vi.fn((name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer header_token' : null,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser())

    await getCurrentUser()

    expect(mockVerifyToken).toHaveBeenCalledWith('cookie_token')
  })

  it('returns null when token verification fails', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'bad_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue(null)

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockVerifyToken).toHaveBeenCalledWith('bad_token')
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when the user no longer exists', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: currentUserSelect,
    })
  })

  it('returns null when token authVersion does not match the database user authVersion', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'stale_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        authVersion: 2,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: currentUserSelect,
    })
  })

  it('rejects a device-bound token whose device session has been revoked', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'device_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
      deviceId: 'device_abc',
      issuedAtSeconds: 1000,
    })
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser())
    mockIsDeviceSessionRevoked.mockResolvedValue(true)

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockIsDeviceSessionRevoked).toHaveBeenCalledWith({
      userId: 'user_1',
      deviceId: 'device_abc',
      issuedAtSeconds: 1000,
    })
  })

  it('allows a device-bound token whose device session is not revoked, exposing deviceId', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'device_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
      deviceId: 'device_abc',
      issuedAtSeconds: 1000,
    })
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser())
    mockIsDeviceSessionRevoked.mockResolvedValue(false)

    const result = await getCurrentUser()

    expect(result?.id).toBe('user_1')
    expect(result?.deviceId).toBe('device_abc')
  })

  it('skips the device-revocation lookup entirely for a web (deviceless) token', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'web_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser())

    const result = await getCurrentUser()

    expect(result?.id).toBe('user_1')
    expect(result?.deviceId).toBeNull()
    expect(mockIsDeviceSessionRevoked).not.toHaveBeenCalled()
  })

  it('returns the current user with derived verification booleans when the token matches the database user', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        role: Role.CLIENT,
        authVersion: 1,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.CLIENT,
      homeRole: Role.CLIENT,
      canAccessAdmin: false,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: null,
      sessionKind: 'VERIFICATION',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      deviceId: null,
      clientProfile: {
        id: 'client_1',
        firstName: 'Tori',
        lastName: 'Morales',
        avatarUrl: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      },
      professionalProfile: null,
    })
  })

  it('returns a fully verified PRO user correctly', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.PRO,
      sessionKind: 'ACTIVE',
      authVersion: 3,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        role: Role.PRO,
        authVersion: 3,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.PRO,
      homeRole: Role.PRO,
      canAccessAdmin: false,
      authVersion: 3,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      sessionKind: 'ACTIVE',
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
      deviceId: null,
      clientProfile: null,
      professionalProfile: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovisstudio',
        avatarUrl: null,
        timeZone: 'America/Los_Angeles',
        location: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      },
    })
  })
})

describe('lib/currentUser — acting role (workspace switching)', () => {
  const verified = new Date('2026-04-08T10:00:00.000Z')

  function cookieWith(token: string) {
    return {
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: token } : undefined,
      ),
    }
  }

  // A full currentUserSelect-shaped DB record with explicit profiles.
  function dbUser(args: {
    homeRole: Role
    hasClientProfile?: boolean
    proStatus?: 'APPROVED' | 'PENDING' | null
    hasAdminGrant?: boolean
  }) {
    return {
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: args.homeRole,
      authVersion: 1,
      phoneVerifiedAt: verified,
      emailVerifiedAt: verified,
      adminPermissions: args.hasAdminGrant ? [{ id: 'ap_1' }] : [],
      clientProfile: args.hasClientProfile
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
            phoneVerifiedAt: verified,
          }
        : null,
      professionalProfile: args.proStatus
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
            phoneVerifiedAt: verified,
            verificationStatus: args.proStatus,
          }
        : null,
    }
  }

  beforeEach(() => {
    mockCookies.mockReset()
    mockVerifyToken.mockReset()
    mockPrisma.user.findUnique.mockReset()
  })

  it('honors an entitled acting role from the token (admin acting as client)', async () => {
    mockCookies.mockResolvedValue(cookieWith('switched_token'))
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT, // acting role
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.ADMIN, hasClientProfile: true }),
    )

    const result = await getCurrentUser()

    expect(result?.role).toBe(Role.CLIENT)
    expect(result?.homeRole).toBe(Role.ADMIN)
  })

  it('falls back to the home role when the acting role is not entitled', async () => {
    mockCookies.mockResolvedValue(cookieWith('forged_token'))
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.PRO, // not entitled — no pro profile
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.CLIENT, hasClientProfile: true, proStatus: null }),
    )

    const result = await getCurrentUser()

    expect(result?.role).toBe(Role.CLIENT)
    expect(result?.homeRole).toBe(Role.CLIENT)
  })

  it('honors an ADMIN acting role for a PRO home role that holds a super-admin grant', async () => {
    // The founder case: home role PRO, licensed, plus a SUPER_ADMIN grant. The
    // token carries the ADMIN acting role after a workspace switch.
    mockCookies.mockResolvedValue(cookieWith('admin_switch_token'))
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.ADMIN, // acting role after switch
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.PRO, proStatus: 'APPROVED', hasAdminGrant: true }),
    )

    const result = await getCurrentUser()

    expect(result?.role).toBe(Role.ADMIN)
    expect(result?.homeRole).toBe(Role.PRO)
    expect(result?.canAccessAdmin).toBe(true)
  })

  it('drops an ADMIN acting role back home when the PRO has no super-admin grant', async () => {
    mockCookies.mockResolvedValue(cookieWith('forged_admin_token'))
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.ADMIN, // forged/stale — not entitled without a grant
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.PRO, proStatus: 'APPROVED', hasAdminGrant: false }),
    )

    const result = await getCurrentUser()

    expect(result?.role).toBe(Role.PRO)
    expect(result?.canAccessAdmin).toBe(false)
  })

  it('honors PRO acting role only when the professional profile is APPROVED', async () => {
    mockCookies.mockResolvedValue(cookieWith('pro_token'))
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.PRO,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.ADMIN, proStatus: 'APPROVED' }),
    )

    expect((await getCurrentUser())?.role).toBe(Role.PRO)

    mockPrisma.user.findUnique.mockResolvedValue(
      dbUser({ homeRole: Role.ADMIN, proStatus: 'PENDING' }),
    )

    // Pending license is not entitled to the PRO workspace → back to home (ADMIN).
    expect((await getCurrentUser())?.role).toBe(Role.ADMIN)
  })
})