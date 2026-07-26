// app/api/internal/jobs/migration/calendar-resync/route.test.ts
//
// The gate is the point. Every other surface of the calendar-migration flow is
// behind ENABLE_PRO_MIGRATION; this cron was not, and "no subscription rows yet"
// is a fact about the data, not a gate. B9.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  getInternalJobSecret: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  runCalendarResync: vi.fn(),
  isProMigrationEnabled: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/auth/internalJob', () => ({
  getInternalJobSecret: mocks.getInternalJobSecret,
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}))

vi.mock('@/lib/migration/calendarResync', () => ({
  runCalendarResync: mocks.runCalendarResync,
}))

vi.mock('@/lib/migration/featureFlag', () => ({
  isProMigrationEnabled: mocks.isProMigrationEnabled,
}))

import { GET, POST } from './route'

function request(): Request {
  return new Request('https://tovis.test/api/internal/jobs/migration/calendar-resync')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInternalJobSecret.mockReturnValue('secret')
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.isProMigrationEnabled.mockReturnValue(true)
  mocks.runCalendarResync.mockResolvedValue({
    scanned: 1,
    synced: 1,
    errored: 0,
    scannedAt: '2026-09-01T12:00:00.000Z',
  })
  mocks.jsonOk.mockImplementation((payload: unknown) => new Response(JSON.stringify(payload)))
  mocks.jsonFail.mockImplementation(
    (status: number, error: string) => new Response(JSON.stringify({ error }), { status }),
  )
})

describe('GET/POST /api/internal/jobs/migration/calendar-resync', () => {
  it('runs the resync when the flag is on', async () => {
    await GET(request())
    expect(mocks.runCalendarResync).toHaveBeenCalledTimes(1)
  })

  it('does not touch a single feed when the flag is off', async () => {
    mocks.isProMigrationEnabled.mockReturnValue(false)

    await GET(request())
    await POST(request())

    expect(mocks.runCalendarResync).not.toHaveBeenCalled()
    expect(mocks.jsonOk).toHaveBeenCalledWith({ skipped: 'PRO_MIGRATION_DISABLED' })
  })

  it('checks the job secret BEFORE the flag, so the flag cannot be probed', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)
    mocks.isProMigrationEnabled.mockReturnValue(false)

    await GET(request())

    expect(mocks.jsonFail).toHaveBeenCalledWith(401, 'Unauthorized')
    // An unauthenticated caller gets 401 whatever the flag says — the flag is
    // never consulted, so the two states are indistinguishable from outside.
    expect(mocks.isProMigrationEnabled).not.toHaveBeenCalled()
  })

  it('still refuses without a configured job secret', async () => {
    mocks.getInternalJobSecret.mockReturnValue(undefined)

    await GET(request())

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
    expect(mocks.runCalendarResync).not.toHaveBeenCalled()
  })
})
