import {
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultSessionStatus,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposureEnabled: true,
  queryRaw: vi.fn(),
  sessionFindUnique: vi.fn(),
  auditFindMany: vi.fn(),
  auditFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  captureFindMany: vi.fn(),
  bookingCount: vi.fn(),
  transaction: vi.fn(),
  requireAgreements: vi.fn(),
  loadImmutable: vi.fn(),
  logServe: vi.fn(),
}))

vi.mock('./access', () => ({
  isAiConsultC7ExposureEnabledForPro: () => mocks.exposureEnabled,
  isAiConsultEnabledForPro: () => mocks.exposureEnabled,
}))

vi.mock('./agreementContract', () => ({
  requireCurrentConsultAgreementAcceptances: mocks.requireAgreements,
}))

vi.mock('./immutableResult', async (importOriginal) => {
  const original = await importOriginal<typeof import('./immutableResult')>()
  return {
    ...original,
    loadLatestImmutableConsultResult: mocks.loadImmutable,
  }
})

vi.mock('@/lib/observability/aiConsultEvents', () => ({
  logAiConsultServe: mocks.logServe,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import {
  ClientConsultResultsError,
  loadAuthorizedClientConsultResults,
  recordLockedMeCardTeaserTap,
} from './clientResults'

const request = {
  consultSessionId: 'consult_1',
  clientId: 'client_1',
  actorUserId: 'user_1',
  now: new Date('2026-08-11T00:00:00.000Z'),
}

const scope = {
  id: 'consult_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  serviceCategoryId: 'hair_color',
  bookingId: 'booking_1',
  status: ConsultSessionStatus.COMPLETED,
  client: { userId: 'user_1' },
  booking: {
    clientId: 'client_1',
    status: 'ACCEPTED',
    scheduledFor: new Date('2026-08-20T00:00:00.000Z'),
    professionalId: 'pro_1',
    service: {
      categoryId: 'hair_color',
      category: { slug: 'hair-color' },
    },
  },
}

function direction(index: number) {
  return {
    title: `Direction ${index}`,
    why: `Reason ${index}`,
    direction: `Direction to discuss with the professional: ${index}.`,
    reference: {
      type: 'SERVICE_CATEGORY' as const,
      serviceId: null,
      serviceCategoryId: 'hair_color',
    },
    discussWithProfessional: true as const,
  }
}

function immutableResult(recommendationCount = 2) {
  const confidence = { min: 0.4, max: 0.7 }
  return {
    briefRevisionId: 'brief_7',
    briefRevision: 7,
    analysisRevisionId: 'analysis_6',
    analysisRevision: 6,
    intakeRevisionId: 'intake_5',
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    payload: {
      schemaVersion: 1,
      sourceAnalysisRevisionId: 'analysis_6',
      sourceAnalysisRevision: 6,
      intakeRevisionId: 'intake_5',
      clientIntake: [
        {
          questionKey: 'desired_color',
          question: 'Desired direction?',
          answerCode: 'red',
          answer: 'Red',
        },
      ],
      aiObservations: {
        currentLevel: { min: 4, max: 5, confidence, evidence: ['hair_back'] },
        currentTone: { value: 'MIXED', confidence, evidence: ['hair_left'] },
        visibleCondition: {
          value: 'POSSIBLE_COMPROMISE',
          confidence,
          evidence: ['hair_crown'],
        },
        density: { value: 'UNKNOWN', confidence, evidence: [] },
        texture: { value: 'WAVY', confidence, evidence: ['hair_back'] },
        goalSummary: 'Goal.',
        historySummary: 'History.',
        constraintsSummary: 'Constraints.',
        maintenanceSummary: 'Maintenance.',
        appointmentContextSummary: 'Context.',
      },
      safetyFlags: [
        {
          code: 'RECENT_BOX_DYE',
          summary: 'History to discuss.',
          discussWithProfessional: true,
        },
      ],
      achievabilityDirection: {
        direction: 'Discuss this assessment with the professional.',
        assessment: 'REQUIRES_PRO_ASSESSMENT',
        context: 'An in-person check is needed.',
        discussWithProfessional: true,
      },
      recommendationDirections: Array.from(
        { length: recommendationCount },
        (_, index) => direction(index + 1),
      ),
    },
  }
}

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    consultSession: { findUnique: mocks.sessionFindUnique },
    consultAuditEvent: {
      findMany: mocks.auditFindMany,
      findFirst: mocks.auditFindFirst,
      create: mocks.auditCreate,
    },
    consultCapture: { findMany: mocks.captureFindMany },
    booking: { count: mocks.bookingCount },
  }
}

describe('authorized client consult results', () => {
  beforeEach(() => {
    mocks.exposureEnabled = true
    mocks.queryRaw.mockResolvedValue([{ id: 'consult_1' }])
    mocks.sessionFindUnique.mockResolvedValue(scope)
    mocks.requireAgreements.mockResolvedValue(undefined)
    mocks.loadImmutable.mockResolvedValue(immutableResult())
    mocks.auditFindMany.mockResolvedValue([])
    mocks.auditCreate.mockResolvedValue({ id: 'audit_1' })
    mocks.captureFindMany.mockResolvedValue([
      { status: ConsultCaptureStatus.ACCEPTED },
      { status: ConsultCaptureStatus.ACCEPTED },
      { status: ConsultCaptureStatus.ACCEPTED },
      { status: ConsultCaptureStatus.ACCEPTED },
      { status: ConsultCaptureStatus.REJECTED },
      { status: ConsultCaptureStatus.REJECTED },
    ])
    mocks.bookingCount.mockResolvedValue(1)
    mocks.transaction.mockImplementation(async (work) => work(transactionClient()))
  })

  it('fails closed before content or measurement when the checked-in exposure gate is blocked', async () => {
    mocks.exposureEnabled = false

    await expect(loadAuthorizedClientConsultResults(request)).rejects.toMatchObject({
      code: 'HIDDEN',
    } satisfies Partial<ClientConsultResultsError>)
    expect(mocks.loadImmutable).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.logServe).not.toHaveBeenCalled()
  })

  it('requires both client-profile and signed-in-user ownership', async () => {
    mocks.sessionFindUnique.mockResolvedValue({
      ...scope,
      client: { userId: 'another_user' },
    })

    await expect(loadAuthorizedClientConsultResults(request)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<ClientConsultResultsError>)
    expect(mocks.requireAgreements).not.toHaveBeenCalled()
    expect(mocks.logServe).not.toHaveBeenCalled()
  })

  it('serves exactly 2–3 framed directions, separate safety, and content-free metric facts', async () => {
    const results = await loadAuthorizedClientConsultResults(request)

    expect(results.recommendationDirections).toHaveLength(2)
    expect(
      results.recommendationDirections.every(
        (item) =>
          item.discussWithProfessional &&
          item.direction.toLowerCase().includes('discuss'),
      ),
    ).toBe(true)
    expect(results.safetyFlags).toEqual(immutableResult().payload.safetyFlags)
    expect(Object.keys(results).indexOf('clientIntake')).toBeLessThan(
      Object.keys(results).indexOf('aiObservations'),
    )
    expect(Object.keys(results).indexOf('aiObservations')).toBeLessThan(
      Object.keys(results).indexOf('safetyFlags'),
    )
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: ConsultAuditAction.CLIENT_RESULTS_SERVED,
      }),
    })
    expect(mocks.logServe).toHaveBeenCalledWith({
      metric: 'CLIENT_RESULTS',
      consultId: 'consult_1',
      clientId: 'client_1',
      firstServe: true,
      acceptedPhotoCount: 4,
      retakeCount: 2,
      bookingAttributed: true,
    })
  })

  it('rejects a stored result outside the client 2–3 recommendation contract', async () => {
    mocks.loadImmutable.mockResolvedValue(immutableResult(1))

    await expect(loadAuthorizedClientConsultResults(request)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    } satisfies Partial<ClientConsultResultsError>)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.logServe).not.toHaveBeenCalled()
  })

  it('replays the singular completion/first-serve audit fact without a second write', async () => {
    mocks.auditFindMany.mockResolvedValue([
      { action: ConsultAuditAction.CLIENT_RESULTS_SERVED },
    ])

    await loadAuthorizedClientConsultResults(request)

    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.logServe).toHaveBeenCalledWith(
      expect.objectContaining({ firstServe: false }),
    )
  })
})

describe('locked Me-card teaser measurement', () => {
  beforeEach(() => {
    mocks.exposureEnabled = true
    mocks.queryRaw.mockResolvedValue([{ id: 'consult_1' }])
    mocks.sessionFindUnique.mockResolvedValue(scope)
    mocks.requireAgreements.mockResolvedValue(undefined)
    mocks.loadImmutable.mockResolvedValue(immutableResult())
    mocks.auditFindFirst
      .mockResolvedValueOnce({ id: 'results_served' })
      .mockResolvedValueOnce(null)
    mocks.auditCreate.mockResolvedValue({ id: 'tap_audit' })
    mocks.transaction.mockImplementation(async (work) => work(transactionClient()))
  })

  it('writes one content-free audit fact and one locked-teaser serve event', async () => {
    await expect(recordLockedMeCardTeaserTap(request)).resolves.toEqual({
      replayed: false,
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        consultSessionId: 'consult_1',
        action: ConsultAuditAction.ME_CARD_TEASER_TAPPED,
        actorType: 'CLIENT',
        actorId: 'user_1',
      },
    })
    expect(mocks.logServe).toHaveBeenCalledWith({
      metric: 'ME_CARD_TEASER_TAP',
      consultId: 'consult_1',
      clientId: 'client_1',
      firstTap: true,
    })
  })

  it('idempotently replays an existing tap without another write or event', async () => {
    mocks.auditFindFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'results_served' })
      .mockResolvedValueOnce({ id: 'tap_audit' })

    await expect(recordLockedMeCardTeaserTap(request)).resolves.toEqual({
      replayed: true,
    })
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.logServe).not.toHaveBeenCalled()
  })
})
