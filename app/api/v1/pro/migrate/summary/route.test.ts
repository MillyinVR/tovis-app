// app/api/v1/pro/migrate/summary/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status
      return Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 })
    },
  )

  const jsonFail = vi.fn((status: number, error: string) => {
    return Response.json({ ok: false, error }, { status })
  })

  return {
    jsonOk,
    jsonFail,
    requirePro: vi.fn(),
    isProMigrationEnabled: vi.fn(),
    loadMigrationReviewSummary: vi.fn(),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/migration/featureFlag', () => ({
  isProMigrationEnabled: mocks.isProMigrationEnabled,
}))

vi.mock('@/lib/migration/migrationReview', () => ({
  loadMigrationReviewSummary: mocks.loadMigrationReviewSummary,
}))

import { GET } from './route'

function makeProAuth() {
  return { ok: true as const, professionalId: 'pro_1', proId: 'pro_1', userId: 'user_1', user: {} }
}

function makeSummary() {
  return {
    offerings: 12,
    clients: 34,
    importedBookings: 8,
    importedBlocks: 3,
    raises: [
      {
        serviceName: 'Gel X',
        from: 45,
        to: 60,
        stepMode: 'PCT' as const,
        stepValue: 10,
        cadenceWeeks: 10,
      },
    ],
  }
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

describe('GET /api/v1/pro/migrate/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue(makeProAuth())
    mocks.isProMigrationEnabled.mockReturnValue(true)
    mocks.loadMigrationReviewSummary.mockResolvedValue(makeSummary())
  })

  it('passes through failed pro auth responses unchanged', async () => {
    const authRes = Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: authRes })

    const res = await GET()

    expect(res).toBe(authRes)
    expect(mocks.isProMigrationEnabled).not.toHaveBeenCalled()
    expect(mocks.loadMigrationReviewSummary).not.toHaveBeenCalled()
  })

  it('404s while the migration flag is off (build-dark)', async () => {
    mocks.isProMigrationEnabled.mockReturnValue(false)

    const res = await GET()

    expect(res.status).toBe(404)
    expect(mocks.loadMigrationReviewSummary).not.toHaveBeenCalled()
    expect(await readJson(res)).toEqual({ ok: false, error: 'Not found' })
  })

  it('returns the owning pro’s migration summary when the flag is on', async () => {
    const res = await GET()
    const body = await readJson(res)

    // Owner-scoped by the authed professionalId.
    expect(mocks.loadMigrationReviewSummary).toHaveBeenCalledWith('pro_1')

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      summary: {
        offerings: 12,
        clients: 34,
        importedBookings: 8,
        importedBlocks: 3,
        raises: [
          {
            serviceName: 'Gel X',
            from: 45,
            to: 60,
            stepMode: 'PCT',
            stepValue: 10,
            cadenceWeeks: 10,
          },
        ],
      },
    })
  })
})
