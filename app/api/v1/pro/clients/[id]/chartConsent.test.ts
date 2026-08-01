// app/api/v1/pro/clients/[id]/chartConsent.test.ts
//
// W5 — the refusal, proved at the API layer.
//
// ⚠️ This file deliberately does NOT mock `@/lib/clientVisibility`. Every other
// test under this directory does, which is exactly why the defect survived: with
// the gate stubbed, a route test proves the route calls A gate, never that the
// gate says no. Here the REAL `assertProCanViewClient` runs against a mocked
// Prisma, so a thread-only pro's 403 is the policy's answer and not a fixture's.
//
// The reported bug: "the client sent the pro a message before requesting an
// appointment… and the pro could see the client's chart." Hiding a tab would
// have left that one `curl` away — these are the curls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  messageThreadFindFirst: vi.fn(),
  clientChartShareFindUnique: vi.fn(),
  requirePro: vi.fn(),
  clientProfileUpdate: vi.fn(),
  clientProfileFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: mocks.bookingFindMany },
    messageThread: { findFirst: mocks.messageThreadFindFirst },
    clientChartShare: { findUnique: mocks.clientChartShareFindUnique },
    clientProfile: {
      update: mocks.clientProfileUpdate,
      findUnique: mocks.clientProfileFindUnique,
    },
  },
}))

vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/app/api/_utils')
  return {
    ...actual,
    requirePro: mocks.requirePro,
  }
})

import { PATCH as patchAlert } from './alert/route'

function ctx(id = 'client_1') {
  return { params: Promise.resolve({ id }) }
}

function alertRequest(): Request {
  return new Request('http://x/api/v1/pro/clients/client_1/alert', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alertBanner: 'pwned' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  // No qualifying booking anywhere in this file — the whole point is what
  // happens when the ONLY link is a message thread.
  mocks.bookingFindMany.mockResolvedValue([])
  mocks.clientChartShareFindUnique.mockResolvedValue(null)
  mocks.clientProfileUpdate.mockResolvedValue({ id: 'client_1', alertBanner: 'pwned' })
})

describe('W5: a message thread does not open the chart', () => {
  it('403s a thread-only pro writing to the client record', async () => {
    mocks.messageThreadFindFirst.mockResolvedValue({ id: 'thread_1' })

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(403)
    // The refusal has to happen BEFORE the write. A 403 rendered after the row
    // changed is a leak with a polite error message on top.
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('403s when the pro has no relationship at all', async () => {
    mocks.messageThreadFindFirst.mockResolvedValue(null)

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(403)
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('403s on a REQUESTED share — asking is not the same as being told yes', async () => {
    mocks.messageThreadFindFirst.mockResolvedValue({ id: 'thread_1' })
    mocks.clientChartShareFindUnique.mockResolvedValue({ status: 'REQUESTED' })

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(403)
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('403s on a REVOKED share — the client took it back', async () => {
    mocks.messageThreadFindFirst.mockResolvedValue({ id: 'thread_1' })
    mocks.clientChartShareFindUnique.mockResolvedValue({ status: 'REVOKED' })

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(403)
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  // The ALLOW side. Without this the suite would still pass if the gate refused
  // everything, which proves nothing about a feature whose job is to let the
  // right people through.
  it('allows a GRANTED share with no booking at all', async () => {
    mocks.messageThreadFindFirst.mockResolvedValue({ id: 'thread_1' })
    mocks.clientChartShareFindUnique.mockResolvedValue({ status: 'GRANTED' })

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(200)
    expect(mocks.clientProfileUpdate).toHaveBeenCalled()
  })

  it('allows a pro with a qualifying booking, share or no share', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      {
        status: 'PENDING',
        startedAt: null,
        finishedAt: null,
        scheduledFor: new Date('2030-01-01T00:00:00.000Z'),
      },
    ])

    const res = await patchAlert(alertRequest(), ctx())

    expect(res.status).toBe(200)
    // A booking is its own consent; the share is never consulted.
    expect(mocks.clientChartShareFindUnique).not.toHaveBeenCalled()
  })
})
