import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  referralFindUnique: vi.fn(),
  referralUpdate: vi.fn(),
  createClientNotification: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    referral: {
      findUnique: mocks.referralFindUnique,
      update: mocks.referralUpdate,
    },
  },
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  createClientNotification: mocks.createClientNotification,
}))

import { POST } from './route'

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client-1',
    user: { id: 'user-1' },
  })
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.jsonFail.mockImplementation((status: number, error: string) => ({
    ok: false,
    status,
    error,
  }))
  mocks.referralUpdate.mockResolvedValue({})
  mocks.createClientNotification.mockResolvedValue({ ok: true })
})

describe('POST /api/client/referrals/[id]/confirm', () => {
  it('returns 403 when the referral belongs to a different client', async () => {
    mocks.referralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      expiresAt: new Date('2099-01-01'),
      referrerClientId: 'other-client',
      referredClientId: 'referred-1',
      referrerClient: { firstName: 'Jane' },
    })

    const res = (await POST(new Request('http://x'), makeCtx('ref-1'))) as {
      status: number
    }

    expect(res.status).toBe(403)
    expect(mocks.referralUpdate).not.toHaveBeenCalled()
  })

  it('confirms a valid PENDING referral and notifies the referred client', async () => {
    mocks.referralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      expiresAt: new Date('2099-01-01'),
      referrerClientId: 'client-1',
      referredClientId: 'referred-1',
      referrerClient: { firstName: 'Alice' },
    })

    const raw: unknown = await POST(new Request('http://x'), makeCtx('ref-1'))
    const payload = raw as { confirmed: boolean }

    expect(payload.confirmed).toBe(true)

    expect(mocks.referralUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ref-1' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    )

    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'referred-1',
        eventKey: 'REFERRAL_CONFIRMED',
        title: 'You were referred by Alice',
      }),
    )
  })

  it('returns 409 when the referral is already confirmed', async () => {
    mocks.referralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'CONFIRMED',
      expiresAt: new Date('2099-01-01'),
      referrerClientId: 'client-1',
      referredClientId: 'referred-1',
      referrerClient: { firstName: 'Alice' },
    })

    const res = (await POST(new Request('http://x'), makeCtx('ref-1'))) as {
      status: number
    }

    expect(res.status).toBe(409)
  })

  it('returns 410 and marks EXPIRED when referral is past expiry', async () => {
    mocks.referralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      expiresAt: new Date('2020-01-01'),
      referrerClientId: 'client-1',
      referredClientId: 'referred-1',
      referrerClient: { firstName: 'Alice' },
    })

    const res = (await POST(new Request('http://x'), makeCtx('ref-1'))) as {
      status: number
    }

    expect(res.status).toBe(410)
    expect(mocks.referralUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'EXPIRED' },
      }),
    )
  })
})
