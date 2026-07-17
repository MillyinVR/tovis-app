// app/api/v1/pro/clients/[id]/chart/route.test.ts
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
  const requirePro = vi.fn()
  const assertProCanViewClient = vi.fn()
  const prisma = {
    clientProfile: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
    review: { count: vi.fn(), findMany: vi.fn() },
    productRecommendation: { findMany: vi.fn() },
    clientProfessionalNote: { findMany: vi.fn() },
    mediaAsset: { findMany: vi.fn() },
    referral: { count: vi.fn() },
  }
  return { jsonOk, jsonFail, requirePro, assertProCanViewClient, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', () => ({ jsonOk: mocks.jsonOk, jsonFail: mocks.jsonFail, requirePro: mocks.requirePro }))
vi.mock('@/lib/clientVisibility', () => ({ assertProCanViewClient: mocks.assertProCanViewClient }))
vi.mock('@/lib/media/renderUrls', () => ({ renderMediaUrls: vi.fn(async () => ({ renderUrl: 'https://x/u.jpg', renderThumbUrl: 'https://x/t.jpg' })) }))
vi.mock('@/lib/security/notesPrivacy', () => ({ readEncryptedNoteOrFallback: vi.fn(() => 'Stylist') }))
vi.mock('@/lib/clients/clientNoteKinds', () => ({ partitionNotesByKind: vi.fn(() => ({ groups: [], doNotRebook: [] })) }))
vi.mock('@/lib/clients/technicalRecord', () => ({ isClientTechnicalRecordEnabled: vi.fn(() => false) }))
vi.mock('@/lib/money', async () => await vi.importActual<typeof import('@/lib/money')>('@/lib/money'))
vi.mock('@/lib/pick', async () => await vi.importActual<typeof import('@/lib/pick')>('@/lib/pick'))
vi.mock('@/lib/proLocations/resolveProScheduleTimeZone', () => ({ resolveProScheduleTimeZone: vi.fn(async () => 'America/Los_Angeles') }))
vi.mock('@/app/api/_utils/routeContext', () => ({ resolveRouteParams: vi.fn(async (ctx: { params: Promise<{ id: string }> }) => ctx.params) }))

import { GET } from './route'

function ctx(id = 'client_1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/clients/[id]/chart', () => {
  it('403s a non-pro', async () => {
    mocks.requirePro.mockResolvedValue({ ok: false, res: new Response('forbidden', { status: 403 }) })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(403)
  })

  it('404s when the pro cannot view the client', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns the aggregate chart for a viewable client', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1', user: { professionalProfile: { timeZone: 'America/Los_Angeles' } } })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: true, visibility: { accessUntil: new Date('2026-08-01T00:00:00Z') } })
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1', firstName: 'Jordan', lastName: 'Rivera', phone: '+15555550123',
      alertBanner: 'Sensitive scalp', dateOfBirth: null, preferredContactMethod: 'SMS',
      occupationEncrypted: null, proCapturedSocialHandle: '@jordan',
      user: { email: 'jordan@example.com' },
      allergies: [{ id: 'al_1', label: 'PPD', severity: 'high', description: 'Hair dye', createdAt: new Date(), recordedBy: { businessName: 'Studio', firstName: null, lastName: null } }],
      notes: [],
    })
    mocks.prisma.booking.findMany.mockResolvedValue([
      { id: 'bk_1', status: 'COMPLETED', scheduledFor: new Date('2026-07-01T17:00:00Z'), createdAt: new Date('2026-06-21T17:00:00Z'), locationTimeZone: 'America/Los_Angeles', finishedAt: null, totalDurationMinutes: 120, totalAmount: '180', subtotalSnapshot: '180', professionalId: 'pro_1', service: { name: 'Balayage', category: { name: 'Hair' } }, professional: { businessName: 'Studio', firstName: null, lastName: null }, aftercareSummary: { notes: 'Gloss in 6w' } },
    ])
    mocks.prisma.review.count.mockResolvedValue(2)
    mocks.prisma.productRecommendation.findMany.mockResolvedValue([])
    mocks.prisma.review.findMany.mockResolvedValue([])
    mocks.prisma.clientProfessionalNote.findMany.mockResolvedValue([])
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.referral.count.mockResolvedValue(0)

    const res = await GET(new Request('http://x'), ctx())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.header.fullName).toBe('Jordan Rivera')
    expect(body.header.occupation).toBe('Stylist')
    expect(body.header.bookingCount).toBe(1)
    expect(body.alertBanner).toBe('Sensitive scalp')
    expect(body.allergies[0].severity).toBe('HIGH')
    expect(body.allergies[0].recordedBy).toBe('Studio')
    expect(body.history[0].serviceName).toBe('Balayage')
    expect(body.history[0].isMine).toBe(true)
    expect(body.technicalEnabled).toBe(false)
    // Relationship intelligence: one $180 completed visit with this pro.
    expect(body.relationshipIntelligence.lifetimeValue.value).toBe('$180')
    expect(body.relationshipIntelligence.visits.value).toBe('1')
    expect(body.relationshipIntelligence.rebooking.value).toBe('Lapsing')
    expect(Array.isArray(body.relationshipIntelligence.flags)).toBe(true)
  })
})
