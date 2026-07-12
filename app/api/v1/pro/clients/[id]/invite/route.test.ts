// app/api/v1/pro/clients/[id]/invite/route.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ClientClaimStatus, ProClientInviteStatus } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const jsonFail = vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  return {
    jsonOk,
    jsonFail,
    requirePro: vi.fn(),
    enforceRateLimit: vi.fn(),
    tokenRateLimitIdentity: vi.fn((id: string) => ({ kind: 'token', id })),
    prisma: {
      clientProfile: { findUnique: vi.fn() },
      booking: { count: vi.fn() },
    },
    issueClaimLinkForClient: vi.fn(),
    createClientClaimInviteDelivery: vi.fn(),
    kickNotificationDrain: vi.fn(),
    resolveTenantContextForRequest: vi.fn(async () => ({ tenantId: 't', slug: 's', isRoot: true })),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))
vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  tokenRateLimitIdentity: mocks.tokenRateLimitIdentity,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/clients/clientClaimLinks', () => ({
  issueClaimLinkForClient: mocks.issueClaimLinkForClient,
}))
vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))
vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))
vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: mocks.resolveTenantContextForRequest,
}))

import { POST } from './route'

function ctx(id = 'client_1') {
  return { params: Promise.resolve({ id }) }
}

const ORIGINAL_FLAG = process.env.ENABLE_BOOKINGLESS_CLAIM

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ENABLE_BOOKINGLESS_CLAIM = '1'
  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: 'pro_1',
    user: { id: 'user_pro_1' },
  })
  mocks.enforceRateLimit.mockResolvedValue(null)
  mocks.prisma.booking.count.mockResolvedValue(0)
})

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.ENABLE_BOOKINGLESS_CLAIM
  else process.env.ENABLE_BOOKINGLESS_CLAIM = ORIGINAL_FLAG
})

describe('POST /api/v1/pro/clients/[id]/invite', () => {
  it('404s when the feature flag is off', async () => {
    delete process.env.ENABLE_BOOKINGLESS_CLAIM

    const res = await POST(new Request('http://localhost', { method: 'POST' }), ctx())

    expect(res.status).toBe(404)
    expect(mocks.prisma.clientProfile.findUnique).not.toHaveBeenCalled()
  })

  it('mints a pro-attributed booking-less invite and delivers it for an owned unclaimed client', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      createdByProfessionalId: 'pro_1',
    })
    mocks.issueClaimLinkForClient.mockResolvedValue({
      kind: 'ok',
      rawToken: 'rawtok_1',
      invite: {
        id: 'invite_1',
        status: ProClientInviteStatus.PENDING,
        clientId: 'client_1',
        invitedName: 'Imported Client',
        invitedEmail: 'client@example.com',
        invitedPhone: null,
        preferredContactMethod: 'EMAIL',
      },
    })
    mocks.createClientClaimInviteDelivery.mockResolvedValue({
      link: { href: '/claim/rawtok_1' },
    })

    const res = await POST(new Request('http://localhost', { method: 'POST' }), ctx())

    expect(res.status).toBe(200)
    expect(mocks.issueClaimLinkForClient).toHaveBeenCalledWith({
      clientId: 'client_1',
      professionalId: 'pro_1',
    })
    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: null,
        inviteId: 'invite_1',
        rawToken: 'rawtok_1',
      }),
    )
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)

    const body = (await res.json()) as {
      invite: { id: string; token: string }
      inviteDelivery: { queued: boolean; href: string | null }
    }
    expect(body.invite).toMatchObject({ id: 'invite_1', token: 'rawtok_1' })
    expect(body.inviteDelivery).toMatchObject({ queued: true, href: '/claim/rawtok_1' })
  })

  it('409s when the client is already claimed', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: 'user_9',
      claimStatus: ClientClaimStatus.CLAIMED,
      createdByProfessionalId: 'pro_1',
    })

    const res = await POST(new Request('http://localhost', { method: 'POST' }), ctx())

    expect(res.status).toBe(409)
    expect(mocks.issueClaimLinkForClient).not.toHaveBeenCalled()
  })

  it('404s when the client is not owned by this pro (no createdBy, no booking)', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      createdByProfessionalId: 'pro_other',
    })
    mocks.prisma.booking.count.mockResolvedValue(0)

    const res = await POST(new Request('http://localhost', { method: 'POST' }), ctx())

    expect(res.status).toBe(404)
    expect(mocks.issueClaimLinkForClient).not.toHaveBeenCalled()
  })

  it('allows ownership via an existing booking with this pro', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      createdByProfessionalId: null,
    })
    mocks.prisma.booking.count.mockResolvedValue(1)
    mocks.issueClaimLinkForClient.mockResolvedValue({
      kind: 'ok',
      rawToken: 'rawtok_2',
      invite: {
        id: 'invite_2',
        status: ProClientInviteStatus.PENDING,
        clientId: 'client_1',
        invitedName: 'Booked Client',
        invitedEmail: null,
        invitedPhone: null,
        preferredContactMethod: null,
      },
    })

    const res = await POST(new Request('http://localhost', { method: 'POST' }), ctx())

    expect(res.status).toBe(200)
    // No contact channel on file → no delivery attempt, but the link is returned.
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      invite: { token: string }
      inviteDelivery: { attempted: boolean }
    }
    expect(body.invite.token).toBe('rawtok_2')
    expect(body.inviteDelivery.attempted).toBe(false)
  })
})
