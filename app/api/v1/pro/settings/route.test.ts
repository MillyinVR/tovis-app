// app/api/v1/pro/settings/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const requirePro = vi.fn()

  const prisma = {
    professionalProfile: {
      update: vi.fn(),
    },
  }

  return { jsonOk, jsonFail, requirePro, prisma }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { PATCH } from './route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/v1/pro/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/v1/pro/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  })

  it('writes clientMediaExportEnabled when provided', async () => {
    mocks.prisma.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      autoAcceptBookings: false,
      clientMediaExportEnabled: false,
      timeZone: null,
    })

    const res = await PATCH(makeRequest({ clientMediaExportEnabled: false }))

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: { clientMediaExportEnabled: false },
      select: {
        id: true,
        autoAcceptBookings: true,
        clientMediaExportEnabled: true,
        timeZone: true,
      },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.professionalProfile.clientMediaExportEnabled).toBe(false)
  })

  it('combines with autoAcceptBookings and timeZone in one update', async () => {
    mocks.prisma.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      autoAcceptBookings: true,
      clientMediaExportEnabled: true,
      timeZone: 'America/New_York',
    })

    await PATCH(
      makeRequest({
        autoAcceptBookings: true,
        clientMediaExportEnabled: true,
        timeZone: 'America/New_York',
      }),
    )

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          autoAcceptBookings: true,
          clientMediaExportEnabled: true,
          timeZone: 'America/New_York',
        },
      }),
    )
  })

  it('400s when the body has nothing to update', async () => {
    const res = await PATCH(makeRequest({}))

    expect(res.status).toBe(400)
    expect(mocks.prisma.professionalProfile.update).not.toHaveBeenCalled()
  })

  it('ignores a non-boolean clientMediaExportEnabled (leaves it unset)', async () => {
    mocks.prisma.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      autoAcceptBookings: true,
      clientMediaExportEnabled: true,
      timeZone: null,
    })

    await PATCH(
      makeRequest({ autoAcceptBookings: true, clientMediaExportEnabled: 'yes' }),
    )

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { autoAcceptBookings: true },
      }),
    )
  })

  it('403s when the caller is not a pro', async () => {
    const denied = new Response(null, { status: 403 })
    mocks.requirePro.mockResolvedValue({ ok: false, res: denied })

    const res = await PATCH(makeRequest({ clientMediaExportEnabled: true }))

    expect(res).toBe(denied)
    expect(mocks.prisma.professionalProfile.update).not.toHaveBeenCalled()
  })
})
