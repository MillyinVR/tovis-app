// tests/integration/consult-look-estimate.test.ts
//
// Book the Look, slice B3 (docs/product/BOOK-THE-LOOK-DIRECTION.md): the
// TRANSLATION MODULE, driven end to end against real PostgreSQL — a
// look-anchored consult runs to analysis, and the estimate it persists is
// priced entirely off the seeded pro's real service list and surfaces on her
// brief.
//
// Three things only a real database can prove, and each is why this suite
// exists rather than another unit test:
//
//   * the RLS grant on both new tables — nothing else catches its omission;
//   * the correction pair's protection: the AI half of a line is frozen by a
//     trigger while the pro-final half stays writable. Decision 7's training
//     signal is worthless if an estimate can be rewritten to agree with its
//     own correction;
//   * "the pro's menu cannot express this look" reaching the brief as a TYPED
//     refusal instead of a guess.
//
// The world it runs in — the seeded pro, her two-service menu, and the
// create → consent → intake → captures → analysis drive — lives in
// tests/integration/_support/lookConsultFixture.ts, shared with B4's suite
// (consult-booking-proposal.test.ts) so the two cannot drift about how a
// consult is driven.

import { Prisma, PrismaClient, ProfessionalLocationType } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

// Only the C6/C7 SERVE gate is stubbed — it is a founder allowlist a synthetic
// fixture pro can never be on. The C1–C5 founder gate this slice depends on
// stays real, driven by ENABLE_AI_CONSULT in the fixture.
vi.mock('@/lib/consult/access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/access')>()
  return {
    ...original,
    isAiConsultC6ExposureEnabledForPro: () => true,
    isAiConsultC7ExposureEnabledForPro: () => true,
  }
})

vi.mock('@/lib/consult/captureStorage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return fakes.buildFakeCaptureStorageModule()
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/captureVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, checkConsultCapture: fakes.fakeCheckConsultCapture }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultAnalysis: fakes.fakeRunConsultAnalysis }
})

import { loadAuthorizedProConsultBriefs } from '@/lib/consult/proBrief'
import {
  CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
  CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
} from '@/lib/consult/serviceEstimate'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_ESTIMATED_MINUTES,
  BALAYAGE_MINUTES,
  BALAYAGE_PRICE,
  BUFFER_MINUTES,
  GLOSS_ESTIMATED_MINUTES,
  GLOSS_MINUTES,
  GLOSS_PRICE,
  STEP_MINUTES,
  createLook,
  fx,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

beforeAll(async () => {
  // The tag prefix is deliberately free of the words "color" and "consult":
  // service names are matched to analysis intents by regex, and a tag carrying
  // either word would silently change which offering matched.
  await seedLookConsultFixture(db, { tagPrefix: 'bt1_estim' })
})

beforeEach(() => {
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
})

afterAll(async () => {
  await teardownLookConsultFixture(db)
  await db.$disconnect()
})

describe('row level security', () => {
  it('is enabled on both new tables', async () => {
    const rows = await db.$queryRaw<Array<{ relname: string }>>(Prisma.sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relrowsecurity = true
        AND c.relname IN ('ConsultServiceEstimate', 'ConsultServiceEstimateLine')
    `)
    expect(rows.map((row) => row.relname).sort()).toEqual([
      'ConsultServiceEstimate',
      'ConsultServiceEstimateLine',
    ])
  })
})

describe('a look-anchored consult persists a line-item estimate', () => {
  it('prices the floor off the pro’s own list and rounds duration UP', async () => {
    const lookPostId = await createLook(db, fx.balayageServiceId)
    const sessionId = await runConsultToCompletion(db, lookPostId, 'priced')

    const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
      where: { consultSessionId: sessionId },
      select: {
        status: true,
        refusalCode: true,
        locationType: true,
        stepMinutes: true,
        bufferMinutes: true,
        schemaVersion: true,
        derivationVersion: true,
        sourceAnalysisRevisionId: true,
        professionalId: true,
        lines: {
          select: {
            sortOrder: true,
            serviceId: true,
            serviceName: true,
            source: true,
            rationale: true,
            estimatedPrice: true,
            estimatedDurationMinutes: true,
            proFinalPrice: true,
            proFinalDurationMinutes: true,
            proFinalAt: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    expect(estimate).toMatchObject({
      status: 'ESTIMATED',
      refusalCode: null,
      locationType: 'SALON',
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      schemaVersion: CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
      derivationVersion: CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
      professionalId: fx.professionalId,
    })

    // The pin is what makes a later correction pair interpretable.
    const analysisRevision = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: sessionId, kind: 'ANALYSIS' },
      select: { id: true },
    })
    expect(estimate.sourceAnalysisRevisionId).toBe(analysisRevision.id)

    expect(estimate.lines).toHaveLength(2)

    const [floor, extra] = estimate.lines
    expect(floor).toMatchObject({
      sortOrder: 0,
      serviceId: fx.balayageServiceId,
      serviceName: `${fx.tag} Balayage`,
      source: 'LOOK_LINKED_SERVICE',
      estimatedDurationMinutes: BALAYAGE_ESTIMATED_MINUTES,
    })
    expect(floor?.estimatedPrice.toFixed(2)).toBe(BALAYAGE_PRICE)
    // The analysis also named this service, so its reason rides the floor line.
    expect(floor?.rationale).toContain(
      'A hand-painted approach suits the blended direction.',
    )

    expect(extra).toMatchObject({
      sortOrder: 1,
      serviceId: fx.glossServiceId,
      source: 'ANALYSIS_RECOMMENDATION',
      estimatedDurationMinutes: GLOSS_ESTIMATED_MINUTES,
    })
    expect(extra?.estimatedPrice.toFixed(2)).toBe(GLOSS_PRICE)
    expect(extra?.rationale).toContain(
      'The mid-lengths would otherwise read brassy in weeks.',
    )

    // Every price on the estimate is one the pro actually listed.
    const listed = await db.professionalServiceOffering.findMany({
      where: { professionalId: fx.professionalId },
      select: { serviceId: true, salonPriceStartingAt: true },
    })
    const listedByService = new Map(
      listed.map((row) => [
        row.serviceId,
        row.salonPriceStartingAt?.toFixed(2) ?? null,
      ]),
    )
    for (const line of estimate.lines) {
      expect(line.estimatedPrice.toFixed(2)).toBe(
        listedByService.get(line.serviceId),
      )
    }

    // The correction half exists and is empty. B5/B6 fills it.
    for (const line of estimate.lines) {
      expect(line.proFinalPrice).toBeNull()
      expect(line.proFinalDurationMinutes).toBeNull()
      expect(line.proFinalAt).toBeNull()
    }
  })

  it('surfaces the estimate on the pro brief', async () => {
    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId: fx.professionalId,
      clientId: fx.clientId,
    })
    const brief = briefs.find((candidate) => candidate.serviceEstimate)
    expect(brief).toBeDefined()
    expect(brief?.serviceEstimate).toMatchObject({
      status: 'ESTIMATED',
      refusalCode: null,
      locationType: 'SALON',
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      derivationVersion: CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
    })
    expect(brief?.serviceEstimate?.lines).toMatchObject([
      {
        serviceId: fx.balayageServiceId,
        source: 'LOOK_LINKED_SERVICE',
        estimatedPrice: BALAYAGE_PRICE,
        estimatedDurationMinutes: BALAYAGE_ESTIMATED_MINUTES,
        proFinalPrice: null,
      },
      {
        serviceId: fx.glossServiceId,
        source: 'ANALYSIS_RECOMMENDATION',
        estimatedPrice: GLOSS_PRICE,
        estimatedDurationMinutes: GLOSS_ESTIMATED_MINUTES,
        proFinalPrice: null,
      },
    ])
  })
})

describe('a menu that cannot express the look', () => {
  it('records a TYPED refusal rather than guessing a price', async () => {
    const lookPostId = await createLook(db, fx.offMenuServiceId)
    const sessionId = await runConsultToCompletion(db, lookPostId, 'off-menu')

    const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
      where: { consultSessionId: sessionId },
      select: { status: true, refusalCode: true, lines: { select: { id: true } } },
    })
    expect(estimate).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'SERVICE_NOT_ON_MENU',
      lines: [],
    })

    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId: fx.professionalId,
      clientId: fx.clientId,
    })
    const brief = briefs.find(
      (candidate) => candidate.consultId === sessionId,
    )
    expect(brief?.serviceEstimate).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'SERVICE_NOT_ON_MENU',
      lines: [],
    })
  })
})

describe('a pro with nothing bookable to size a duration against', () => {
  it('records PRO_SCHEDULING_NOT_READY with no scheduling facts at all', async () => {
    // The one refusal whose row shape differs: stepMinutes and bufferMinutes
    // are NULL, and a CHECK constraint decides whether that is legal. Getting
    // it backwards would abort the whole analysis transaction, not just skip
    // the estimate — which is exactly why this runs against the real database.
    await db.professionalLocation.update({
      where: { id: fx.locationId },
      data: { isBookable: false },
    })
    try {
      const lookPostId = await createLook(db, fx.balayageServiceId)
      const sessionId = await runConsultToCompletion(db, lookPostId, 'no-location')

      expect(
        await db.consultServiceEstimate.findUniqueOrThrow({
          where: { consultSessionId: sessionId },
          select: {
            status: true,
            refusalCode: true,
            stepMinutes: true,
            bufferMinutes: true,
          },
        }),
      ).toEqual({
        status: 'REFUSED',
        refusalCode: 'PRO_SCHEDULING_NOT_READY',
        stepMinutes: null,
        bufferMinutes: null,
      })
    } finally {
      await db.professionalLocation.update({
        where: { id: fx.locationId },
        data: { isBookable: true },
      })
    }
  })
})

describe('a pro who only travels (the founder’s shape in prod)', () => {
  it('reads the MOBILE column, the mode she can host, instead of refusing', async () => {
    // Her rows advertise salon (prod's shape — the flag was never a choice)
    // but her one bookable location is a mobile base. The look anchor used to
    // read the SALON column unconditionally, so the estimate was refused
    // PRO_SCHEDULING_NOT_READY for a pro who is perfectly bookable; and had
    // the salon location existed but been unhostable, it would have quoted a
    // column the commit then refused (`MODE_NOT_SUPPORTED`).
    await db.professionalLocation.update({
      where: { id: fx.locationId },
      data: { type: ProfessionalLocationType.MOBILE_BASE },
    })
    await db.professionalServiceOffering.updateMany({
      where: { id: { in: [fx.balayageOfferingId, fx.glossOfferingId] } },
      data: { offersMobile: true },
    })
    await db.professionalServiceOffering.update({
      where: { id: fx.balayageOfferingId },
      data: {
        mobilePriceStartingAt: new Prisma.Decimal(BALAYAGE_PRICE),
        mobileDurationMinutes: BALAYAGE_MINUTES,
      },
    })
    await db.professionalServiceOffering.update({
      where: { id: fx.glossOfferingId },
      data: {
        mobilePriceStartingAt: new Prisma.Decimal(GLOSS_PRICE),
        mobileDurationMinutes: GLOSS_MINUTES,
      },
    })
    try {
      const lookPostId = await createLook(db, fx.balayageServiceId)
      const sessionId = await runConsultToCompletion(db, lookPostId, 'mobile-only')

      const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
        where: { consultSessionId: sessionId },
        select: {
          status: true,
          refusalCode: true,
          locationType: true,
          lines: { select: { estimatedPrice: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      expect(estimate).toMatchObject({
        status: 'ESTIMATED',
        refusalCode: null,
        locationType: 'MOBILE',
      })
      expect(estimate.lines[0]?.estimatedPrice.toNumber()).toBe(Number(BALAYAGE_PRICE))
    } finally {
      await db.professionalLocation.update({
        where: { id: fx.locationId },
        data: { type: ProfessionalLocationType.SALON },
      })
      await db.professionalServiceOffering.updateMany({
        where: { id: { in: [fx.balayageOfferingId, fx.glossOfferingId] } },
        data: {
          offersMobile: false,
          mobilePriceStartingAt: null,
          mobileDurationMinutes: null,
        },
      })
    }
  })
})

describe('the correction pair is protected', () => {
  it('freezes the AI half of a line and leaves the pro-final half writable', async () => {
    const estimate = await db.consultServiceEstimate.findFirstOrThrow({
      where: { professionalId: fx.professionalId, status: 'ESTIMATED' },
      select: { id: true, lines: { select: { id: true }, take: 1 } },
    })
    const lineId = estimate.lines[0]?.id ?? ''
    expect(lineId).not.toBe('')

    await expect(
      db.consultServiceEstimateLine.update({
        where: { id: lineId },
        data: { estimatedPrice: new Prisma.Decimal('1.00') },
      }),
    ).rejects.toThrow(/immutable/i)

    await expect(
      db.consultServiceEstimate.update({
        where: { id: estimate.id },
        data: { status: 'REFUSED', refusalCode: 'SERVICE_NOT_ON_MENU' },
      }),
    ).rejects.toThrow(/immutable/i)

    const corrected = await db.consultServiceEstimateLine.update({
      where: { id: lineId },
      data: {
        proFinalPrice: new Prisma.Decimal('205.00'),
        proFinalDurationMinutes: 75,
        proFinalNote: 'Ran long on the root melt.',
        proFinalAt: new Date(),
      },
      select: {
        estimatedPrice: true,
        proFinalPrice: true,
        proFinalDurationMinutes: true,
      },
    })
    expect(corrected.proFinalPrice?.toFixed(2)).toBe('205.00')
    expect(corrected.proFinalDurationMinutes).toBe(75)
    // The estimate half is still what the AI derived — that is the pair.
    expect(corrected.estimatedPrice.toFixed(2)).toBe(BALAYAGE_PRICE)
  })
})
