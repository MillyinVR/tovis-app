// app/api/v1/client/chart-shares/route.test.ts
//
// Live-sync coverage for the client's chart-consent decisions. The asymmetry
// here is deliberate and is the point of these tests:
//
//   GRANT   → ping. The pro is already told by notifyChartAccessGranted, so the
//             ping discloses nothing new; it just flips their open client page
//             from "refused" to the real chart without a manual reload.
//   DECLINE → NO ping, ever. A ping is an event the pro receives the moment the
//             client says no — exactly what the decline design refuses (see the
//             ⚠️ block in lib/notifications/chartAccessNotifications.ts).
//   REVOKE  → NO ping, for the same reason.
//
// A future change that "helpfully" broadcasts every branch turns a private no
// into a live notification. These tests are the guard.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  readJsonRecord: vi.fn(),
  respondToChartShare: vi.fn(),
  revokeChartShare: vi.fn(),
  broadcastChange: vi.fn(),
  notifyChartAccessGranted: vi.fn(),
  kickNotificationDrain: vi.fn(),
  professionalFindUnique: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...(data ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  pickString: (value: unknown) => (typeof value === 'string' ? value : null),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/readJsonRecord', () => ({
  readJsonRecord: mocks.readJsonRecord,
}))

vi.mock('@/lib/clients/chartShare', () => ({
  respondToChartShare: mocks.respondToChartShare,
  revokeChartShare: mocks.revokeChartShare,
  listChartSharesForClient: vi.fn(),
}))

vi.mock('@/lib/live/broadcastAudience', () => ({
  broadcastChange: mocks.broadcastChange,
}))

vi.mock('@/lib/notifications/chartAccessNotifications', () => ({
  notifyChartAccessGranted: mocks.notifyChartAccessGranted,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: { findUnique: mocks.professionalFindUnique },
  },
}))

vi.mock('@/lib/privacy/professionalDisplayName', () => ({
  formatProfessionalPublicDisplayName: vi.fn(),
}))

import { PATCH } from './route'

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/client/chart-shares', {
    method: 'PATCH',
  })
}

describe('PATCH /api/v1/client/chart-shares — live-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })
    mocks.professionalFindUnique.mockResolvedValue({ id: 'pro_1' })
    mocks.respondToChartShare.mockResolvedValue({ status: 'GRANTED' })
    mocks.revokeChartShare.mockResolvedValue({ status: 'REVOKED' })
    mocks.notifyChartAccessGranted.mockResolvedValue(undefined)
    mocks.broadcastChange.mockResolvedValue(undefined)
  })

  it('pings the pro when the client GRANTS chart access', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({
      professionalId: 'pro_1',
      action: 'GRANT',
    })

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.broadcastChange).toHaveBeenCalledWith({
      topic: 'charts',
      professionalId: 'pro_1',
    })
  })

  it('does NOT ping when the client DECLINES', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({
      professionalId: 'pro_1',
      action: 'DECLINE',
    })
    mocks.respondToChartShare.mockResolvedValueOnce({ status: 'DECLINED' })

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.respondToChartShare).toHaveBeenCalledWith({
      clientId: 'client_1',
      professionalId: 'pro_1',
      grant: false,
    })

    // The refusal is recorded; the asker is not told, and is not told LIVE.
    expect(mocks.broadcastChange).not.toHaveBeenCalled()
    expect(mocks.notifyChartAccessGranted).not.toHaveBeenCalled()
  })

  it('does NOT ping when the client REVOKES', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({
      professionalId: 'pro_1',
      action: 'REVOKE',
    })

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.revokeChartShare).toHaveBeenCalledWith({
      clientId: 'client_1',
      professionalId: 'pro_1',
    })
    expect(mocks.broadcastChange).not.toHaveBeenCalled()
  })

  it('pings only after the consent row has been written', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({
      professionalId: 'pro_1',
      action: 'GRANT',
    })

    const calls: string[] = []
    mocks.respondToChartShare.mockImplementationOnce(async () => {
      calls.push('write')
      return { status: 'GRANTED' }
    })
    mocks.broadcastChange.mockImplementationOnce(async () => {
      calls.push('broadcast')
    })

    await PATCH(makeRequest())

    // Ping first and the pro refetches a chart that still refuses them.
    expect(calls).toEqual(['write', 'broadcast'])
  })

  it('does not ping when the professional does not exist', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({
      professionalId: 'pro_missing',
      action: 'GRANT',
    })
    mocks.professionalFindUnique.mockResolvedValueOnce(null)

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(404)
    expect(mocks.broadcastChange).not.toHaveBeenCalled()
  })
})
