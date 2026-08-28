// app/api/internal/jobs/waitlist-offer-expiry/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInternalJobSecret: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  expireLapsedWaitlistOffers: vi.fn(),
  captureScheduledJobException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...(data as object) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/auth/internalJob', () => ({
  getInternalJobSecret: mocks.getInternalJobSecret,
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  expireLapsedWaitlistOffers: mocks.expireLapsedWaitlistOffers,
}))

vi.mock('@/lib/observability/scheduledJobEvents', () => ({
  captureScheduledJobException: mocks.captureScheduledJobException,
}))

import { GET, POST } from './route'

function req() {
  return new Request('http://localhost/api/internal/jobs/waitlist-offer-expiry')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInternalJobSecret.mockReturnValue('job-secret')
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.expireLapsedWaitlistOffers.mockResolvedValue({
    considered: 4,
    expired: 3,
    revivedEntries: 2,
    skipped: 1,
    failed: 0,
  })
})

describe('the waitlist offer-expiry sweep endpoint', () => {
  // This route mutates offers and waitlist entries across every professional on
  // the platform. An unauthenticated caller reaching it is the failure that
  // matters most, so the refusal is asserted before anything else — and it must
  // refuse WITHOUT running the sweep, not after.
  it('refuses an unauthorized caller WITHOUT running the sweep', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.expireLapsedWaitlistOffers).not.toHaveBeenCalled()
  })

  // A missing secret must not degrade to "no auth required".
  it('refuses with a 500 when no job secret is configured, and runs nothing', async () => {
    mocks.getInternalJobSecret.mockReturnValue(null)

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(mocks.isAuthorizedJobRequest).not.toHaveBeenCalled()
    expect(mocks.expireLapsedWaitlistOffers).not.toHaveBeenCalled()
  })

  it('reports every counter the sweep returns', async () => {
    const res = await GET(req())
    const body: unknown = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        considered: 4,
        expired: 3,
        revivedEntries: 2,
        skipped: 1,
        failed: 0,
      }),
    )

    // One clock for the whole run, and it is the same instant reported back.
    const [args] = mocks.expireLapsedWaitlistOffers.mock.calls[0] ?? []
    expect(args?.now).toBeInstanceOf(Date)
    expect(
      (body as { ranAt?: string }).ranAt,
    ).toBe(args?.now?.toISOString())
  })

  // Vercel crons issue GET; POST exists so the job can be driven by hand.
  it('accepts POST on the same terms', async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(mocks.expireLapsedWaitlistOffers).toHaveBeenCalledTimes(1)
  })

  // A thrown sweep must surface as a failed cron run, not a 200 that reads as
  // "nothing to do" — a silent 200 is how a broken sweep stays broken.
  it('surfaces a thrown sweep as a 500', async () => {
    mocks.expireLapsedWaitlistOffers.mockRejectedValueOnce(new Error('boom'))

    const res = await GET(req())

    expect(res.status).toBe(500)
  })

  // The 500 above is only seen by Vercel's cron log. This job is the ONLY thing
  // that acts on an offer's expiresAt, so while it is failing a client sits
  // NOTIFIED forever and quietly stops being offerable, with nothing else in the
  // product looking wrong. The console line it also writes is invisible to
  // Sentry unless SENTRY_ENABLE_LOGS is on, and it is off by default — so the
  // capture is the only alarm that actually reaches a human.
  it('captures the thrown sweep to Sentry, not just the console', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const boom = new Error('boom')
    mocks.expireLapsedWaitlistOffers.mockRejectedValueOnce(boom)

    await GET(req())

    expect(mocks.captureScheduledJobException).toHaveBeenCalledWith({
      error: boom,
      job: '/api/internal/jobs/waitlist-offer-expiry',
      event: 'WAITLIST_OFFER_EXPIRY_SWEEP_ERROR',
    })

    consoleErrorSpy.mockRestore()
  })
})
