// lib/clients/chartShare.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientChartShare: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}))

import {
  NO_CHART_SHARE,
  loadChartShare,
  requestChartShare,
  respondToChartShare,
  revokeChartShare,
} from './chartShare'

const PAIR = { clientId: 'client_1', professionalId: 'pro_1' }
const NOW = new Date('2026-08-01T12:00:00.000Z')

beforeEach(() => {
  findUnique.mockReset()
  findUnique.mockResolvedValue(null)
  upsert.mockReset()
  upsert.mockResolvedValue({ id: 'share_1' })
})

describe('loadChartShare', () => {
  it('reports no share rather than null, so callers cannot forget the empty case', async () => {
    await expect(loadChartShare(PAIR)).resolves.toEqual(NO_CHART_SHARE)
  })
})

describe('requestChartShare', () => {
  it('creates a REQUESTED row when the pair has no history', async () => {
    const result = await requestChartShare({ ...PAIR, now: NOW })

    expect(result).toEqual({ ok: true, status: 'REQUESTED' })
    expect(upsert.mock.calls[0]?.[0]?.update).toMatchObject({
      status: 'REQUESTED',
      requestedAt: NOW,
    })
  })

  // One open ask at a time. Restamping would turn the button into a nag.
  it('refuses a second request while one is still open', async () => {
    findUnique.mockResolvedValue({ status: 'REQUESTED' })

    await expect(requestChartShare(PAIR)).resolves.toEqual({
      ok: false,
      code: 'REQUEST_PENDING',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  // A client's "no" must not be re-askable by pressing the button again.
  it('refuses after the client DECLINED', async () => {
    findUnique.mockResolvedValue({ status: 'DECLINED' })

    await expect(requestChartShare(PAIR)).resolves.toEqual({
      ok: false,
      code: 'DECLINED',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('refuses when access is already granted', async () => {
    findUnique.mockResolvedValue({ status: 'GRANTED' })

    await expect(requestChartShare(PAIR)).resolves.toEqual({
      ok: false,
      code: 'ALREADY_GRANTED',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  // REVOKED is "not right now", DECLINED is "no". Collapsing them would mean a
  // client who revoked once could never be asked again, even if they wanted to
  // re-share after a gap.
  it('allows a fresh request after a REVOKE', async () => {
    findUnique.mockResolvedValue({ status: 'REVOKED' })

    await expect(requestChartShare({ ...PAIR, now: NOW })).resolves.toEqual({
      ok: true,
      status: 'REQUESTED',
    })
    // The old revoke stamp is cleared, or the row would read as revoked-and-
    // requested at once.
    expect(upsert.mock.calls[0]?.[0]?.update).toMatchObject({
      status: 'REQUESTED',
      revokedAt: null,
    })
  })
})

describe('respondToChartShare', () => {
  it('grants', async () => {
    await expect(
      respondToChartShare({ ...PAIR, grant: true, now: NOW }),
    ).resolves.toEqual({ status: 'GRANTED' })
    expect(upsert.mock.calls[0]?.[0]?.update).toMatchObject({
      status: 'GRANTED',
      respondedAt: NOW,
      revokedAt: null,
    })
  })

  it('declines', async () => {
    await expect(
      respondToChartShare({ ...PAIR, grant: false, now: NOW }),
    ).resolves.toEqual({ status: 'DECLINED' })
  })

  // The client can offer their chart without being asked — the prompt is a
  // convenience, not the only door.
  it('grants unprompted, with no prior request row', async () => {
    findUnique.mockResolvedValue(null)

    await expect(
      respondToChartShare({ ...PAIR, grant: true }),
    ).resolves.toEqual({ status: 'GRANTED' })
    expect(upsert).toHaveBeenCalled()
  })
})

describe('revokeChartShare', () => {
  it('revokes a granted share', async () => {
    findUnique.mockResolvedValue({ status: 'GRANTED' })

    await expect(revokeChartShare({ ...PAIR, now: NOW })).resolves.toEqual({
      status: 'REVOKED',
    })
    expect(upsert.mock.calls[0]?.[0]?.update).toMatchObject({
      status: 'REVOKED',
      revokedAt: NOW,
    })
  })

  // 🔴 A revoke that can be refused is not a revoke. It never reads the current
  // state, so there is no state it can decline to leave.
  it('never consults the existing status before revoking', async () => {
    findUnique.mockResolvedValue({ status: 'DECLINED' })

    await expect(revokeChartShare(PAIR)).resolves.toEqual({ status: 'REVOKED' })
    expect(findUnique).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalled()
  })

  it('succeeds for a pair with no row at all', async () => {
    findUnique.mockResolvedValue(null)

    await expect(revokeChartShare(PAIR)).resolves.toEqual({ status: 'REVOKED' })
  })
})
