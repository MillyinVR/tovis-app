// app/api/v1/pro/clients/[id]/technical/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  const jsonFail = vi.fn((status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json' } }),
  )
  const pickString = vi.fn((v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null))
  const requirePro = vi.fn()
  const assertProCanViewClient = vi.fn()
  const isClientTechnicalRecordEnabled = vi.fn(() => true)
  const loadTechnicalRecord = vi.fn()
  return { jsonOk, jsonFail, pickString, requirePro, assertProCanViewClient, isClientTechnicalRecordEnabled, loadTechnicalRecord }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))
vi.mock('@/lib/clientVisibility', () => ({ assertProCanViewClient: mocks.assertProCanViewClient }))
vi.mock('@/lib/clients/technicalRecord', () => ({ isClientTechnicalRecordEnabled: mocks.isClientTechnicalRecordEnabled }))
vi.mock('@/lib/clients/technicalRecordLoader', () => ({ loadTechnicalRecord: mocks.loadTechnicalRecord }))
vi.mock('@/app/api/_utils/routeContext', () => ({ resolveRouteParams: vi.fn(async (ctx: { params: Promise<{ id: string }> }) => ctx.params) }))

import { GET } from './route'

function ctx(id = 'client_1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
})

describe('GET /api/v1/pro/clients/[id]/technical', () => {
  it('403s a non-pro', async () => {
    mocks.requirePro.mockResolvedValue({ ok: false, res: new Response('forbidden', { status: 403 }) })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(403)
  })

  it('404s (dark) when the technical-record flag is off, without probing visibility', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(404)
    expect(mocks.assertProCanViewClient).not.toHaveBeenCalled()
    expect(mocks.loadTechnicalRecord).not.toHaveBeenCalled()
  })

  it('404s when the pro cannot view the client', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(404)
    expect(mocks.loadTechnicalRecord).not.toHaveBeenCalled()
  })

  it('serializes the scoped technical record (ISO dates, decrypted-for-author, redacted-for-others)', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: true, visibility: { accessUntil: null } })
    mocks.loadTechnicalRecord.mockResolvedValue({
      formula: [
        {
          id: 'fm_1',
          when: new Date('2026-07-01T17:00:00Z'),
          whenLocationTimeZone: 'America/Los_Angeles',
          serviceName: 'Balayage',
          brand: 'Wella',
          developer: '20 vol',
          ratio: '1:1',
          processingTimeMinutes: 35,
          resultNotes: 'Lifted to level 8', // decrypted for the authoring pro
        },
      ],
      consents: [
        {
          id: 'cn_full',
          scope: 'full',
          kind: 'SERVICE_WAIVER',
          when: new Date('2026-06-01T00:00:00Z'),
          whenLocationTimeZone: null,
          serviceScope: 'Color',
          signedAt: new Date('2026-06-01T00:00:00Z'),
          proofMethod: 'IN_PERSON',
          proofRef: 'paper-12',
          patchTestResult: null,
          validUntil: null,
          notes: 'Signed on paper', // full scope: notes travel
          byName: null,
        },
        {
          id: 'cn_safety',
          scope: 'safety',
          kind: 'PATCH_TEST',
          when: new Date('2026-06-10T00:00:00Z'),
          whenLocationTimeZone: null,
          serviceScope: null, // redacted for another pro
          signedAt: null,
          proofMethod: null,
          proofRef: null,
          patchTestResult: 'PASS', // safety fields travel
          validUntil: new Date('2026-12-10T00:00:00Z'),
          notes: null, // redacted
          byName: 'Glow Studio',
        },
      ],
      photoReleaseStatus: 'GRANTED',
    })

    const res = await GET(new Request('http://x'), ctx())
    const body = await res.json()
    expect(res.status).toBe(200)

    expect(body.formula[0].when).toBe('2026-07-01T17:00:00.000Z')
    expect(body.formula[0].timeZone).toBe('America/Los_Angeles')
    expect(body.formula[0].resultNotes).toBe('Lifted to level 8')
    expect(body.formula[0].processingTimeMinutes).toBe(35)

    const full = body.consents.find((c: { id: string }) => c.id === 'cn_full')
    expect(full.scope).toBe('full')
    expect(full.notes).toBe('Signed on paper')
    expect(full.signedAt).toBe('2026-06-01T00:00:00.000Z')

    const safety = body.consents.find((c: { id: string }) => c.id === 'cn_safety')
    expect(safety.scope).toBe('safety')
    expect(safety.notes).toBeNull()
    expect(safety.serviceScope).toBeNull()
    expect(safety.patchTestResult).toBe('PASS')
    expect(safety.validUntil).toBe('2026-12-10T00:00:00.000Z')
    expect(safety.byName).toBe('Glow Studio')

    expect(body.photoReleaseStatus).toBe('GRANTED')
  })
})
