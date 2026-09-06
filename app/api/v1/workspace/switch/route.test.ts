import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import { PrismaClientInitializationError } from '@prisma/client/runtime/library'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockSetSessionCookie = vi.hoisted(() => vi.fn())
// The tenant resolver is REAL here (only prisma is mocked) so the suite
// proves the whole chain: this handler stamps `tenantId` onto a row, so a
// failed tenant lookup must throw out of the handler, never degrade.
const mockPrisma = vi.hoisted(() => ({
  clientProfile: { findFirst: vi.fn(), create: vi.fn() },
  tenant: { findUnique: vi.fn(), findFirst: vi.fn() },
}))

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/auth', () => ({ createActiveToken: mockCreateActiveToken }))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: mockSetSessionCookie,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/security/contactLookup', () => ({
  buildClientProfileContactLookupData: () => ({}),
}))
vi.mock('@/lib/security/phonePrivacy', () => ({
  buildPhoneEncryptionWriteData: () => ({}),
}))

import { clearTenantResolutionCache } from '@/lib/tenant/resolveTenant'

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/workspace/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    authVersion: 4,
    role: Role.ADMIN,
    homeRole: Role.ADMIN,
    canAccessAdmin: false,
    sessionKind: 'ACTIVE',
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: null,
    ...overrides,
  }
}

describe('POST /api/v1/workspace/switch', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockCreateActiveToken.mockReset().mockReturnValue('minted_token')
    mockSetSessionCookie.mockReset()
    clearTenantResolutionCache()
    mockPrisma.tenant.findUnique.mockReset().mockResolvedValue({ id: 'tenant_root' })
    mockPrisma.tenant.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.clientProfile.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.clientProfile.create.mockReset().mockResolvedValue({ id: 'cp_new' })
  })

  it('401s when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await POST(request({ workspace: 'CLIENT' }))
    expect(res.status).toBe(401)
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('403s when the session is not active', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({ sessionKind: 'VERIFICATION' }),
    )
    const res = await POST(request({ workspace: 'CLIENT' }))
    expect(res.status).toBe(403)
  })

  it('400s on an unknown workspace', async () => {
    mockGetCurrentUser.mockResolvedValue(activeUser())
    const res = await POST(request({ workspace: 'SUPERUSER' }))
    expect(res.status).toBe(400)
  })

  it('403s when the user is not entitled to the target workspace', async () => {
    // A pure client cannot switch to ADMIN.
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        role: Role.CLIENT,
        homeRole: Role.CLIENT,
        clientProfile: { id: 'cp_1' },
      }),
    )
    const res = await POST(request({ workspace: 'ADMIN' }))
    expect(res.status).toBe(403)
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('switches an admin to an existing client workspace without creating a profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({ clientProfile: { id: 'cp_1' } }),
    )

    const res = await POST(request({ workspace: 'CLIENT' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      workspace: 'CLIENT',
      href: '/client',
    })
    expect(mockPrisma.clientProfile.create).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: 'CLIENT',
      authVersion: 4,
    })
    expect(mockSetSessionCookie).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'minted_token' }),
    )
  })

  it('auto-provisions a ClientProfile when an admin switches to client without one', async () => {
    mockGetCurrentUser.mockResolvedValue(activeUser({ clientProfile: null }))

    const res = await POST(request({ workspace: 'CLIENT' }))

    expect(res.status).toBe(200)
    expect(mockPrisma.clientProfile.findFirst).toHaveBeenCalled()
    expect(mockPrisma.clientProfile.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.clientProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          homeTenant: { connect: { id: 'tenant_root' } },
        }),
      }),
    )
    expect(mockSetSessionCookie).toHaveBeenCalled()
  })

  it('throws out of the handler when the tenant lookup fails (no degraded fallback)', async () => {
    // The home tenant is WRITTEN here, so it must be a real row. A DB outage
    // has to surface as a thrown error (Next → onRequestError → Sentry), not
    // a profile silently stamped with the degraded sentinel id.
    const outage = new PrismaClientInitializationError(
      "Can't reach database server at `db.example.supabase.co:5432`",
      '6.19.0',
    )
    mockPrisma.tenant.findUnique.mockRejectedValue(outage)
    mockGetCurrentUser.mockResolvedValue(activeUser({ clientProfile: null }))

    await expect(POST(request({ workspace: 'CLIENT' }))).rejects.toBe(outage)

    expect(mockPrisma.clientProfile.create).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('switches a licensed admin to the pro workspace', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        professionalProfile: { verificationStatus: 'APPROVED' },
      }),
    )

    const res = await POST(request({ workspace: 'PRO' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ href: '/pro/calendar' })
    expect(mockPrisma.clientProfile.create).not.toHaveBeenCalled()
  })

  it('switches a pro who holds a super-admin grant into the admin console', async () => {
    // The founder case: home role PRO, licensed, plus a SUPER_ADMIN grant.
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        role: Role.PRO,
        homeRole: Role.PRO,
        canAccessAdmin: true,
        professionalProfile: { verificationStatus: 'APPROVED' },
      }),
    )

    const res = await POST(request({ workspace: 'ADMIN' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ href: '/admin' })
    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: 'ADMIN',
      authVersion: 4,
    })
  })

  it('403s when a pro without a super-admin grant tries to switch to admin', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        role: Role.PRO,
        homeRole: Role.PRO,
        canAccessAdmin: false,
        professionalProfile: { verificationStatus: 'APPROVED' },
      }),
    )

    const res = await POST(request({ workspace: 'ADMIN' }))

    expect(res.status).toBe(403)
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
  })
})
