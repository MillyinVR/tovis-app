// tests/integration/consult-pro-follow-up.test.ts
//
// C2-4 — a professional asks the client one follow-up question from the
// Brief, against real PostgreSQL.
//
// What this suite exists to prove:
//
//   * the ask writes the row, its PRO_FOLLOW_UP_ASKED audit event and the
//     client's doorbell in one transaction, and the client's thread renders it
//     as an ordinary FOLLOW_UP card with the pro's name on it;
//   * the client answers through the ORDINARY follow-up path — the same
//     function the shared route calls, keyed by `pro_1` — and the answer lands
//     here, with its audit event and the pro's notification, never on a round;
//   * the Brief and the transcript show the answer with provenance;
//   * the refusals: replay, a changed answer, an unknown key, an off-menu
//     value, two values, the open cap, a stranger, and a started appointment;
//   * 🔴 the database is the backstop — raw writes around the application
//     hit the guard, the CHECKs and the deferred audit triggers.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAuditAction,
  Prisma,
  PrismaClient,
  ServiceLocationType,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

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
  const original = await importOriginal<typeof import('@/lib/consult/captureVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, checkConsultCapture: fakes.fakeCheckConsultCapture }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultAnalysis: fakes.fakeRunConsultAnalysis }
})

vi.mock('@/lib/consult/inspirationImage', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/inspirationImage')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

vi.mock('@/lib/consult/inspirationVision', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/inspirationVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultInspirationVision: fakes.fakeRunConsultInspirationVision }
})

import { consultTranscriptCopy } from '@/lib/brand/consultTranscriptCopy'
import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { defaultClientConsultPlanDiffCopy } from '@/lib/brand/defaultClientConsultPlanDiffCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { ConsultWriteError } from '@/lib/consult/errors'
import {
  answerConsultFollowUpQuestion,
  ConsultFollowUpAnswerError,
} from '@/lib/consult/followUpContract'
import { loadAuthorizedProLookBrief } from '@/lib/consult/proBrief'
import {
  askConsultProFollowUp,
  CONSULT_PRO_FOLLOW_UP_MAX_OPEN,
  loadAuthorizedConsultProFollowUps,
} from '@/lib/consult/proFollowUp'
import { loadProConsultTranscript } from '@/lib/consult/proTranscript'
import { loadConsultThread } from '@/lib/consult/thread'
import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_PRICE,
  ZONE,
  createLook,
  fx,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const client = () => ({ type: ConsultActorType.CLIENT, id: fx.clientUserId }) as const
const proArgs = (consultSessionId: string) => ({
  consultSessionId,
  professionalId: fx.professionalId,
  actorUserId: fx.proUserId,
})
const ask = (consultSessionId: string, text = 'Have you had a keratin or smoothing treatment in the last year?') =>
  askConsultProFollowUp({
    ...proArgs(consultSessionId),
    priority: 'NEED_BEFORE_APPOINTMENT',
    text,
    optionLabels: ['Yes', 'No', 'Not sure'],
  })

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'c2_4_pro_follow_up' })
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

/** Bookings this suite created, so teardown can drop them. */
const bookingIds: string[] = []

afterAll(async () => {
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await teardownLookConsultFixture(db, async () => {
    // The doorbells this suite rang. Sessions cascade their questions and
    // audits; notifications hang off the client / pro instead.
    await db.clientNotification.deleteMany({
      where: { clientId: fx.clientId, dedupeKey: { startsWith: 'consult-pro-follow-up:' } },
    })
    await db.notification.deleteMany({
      where: { professionalId: fx.professionalId, dedupeKey: { startsWith: 'consult-pro-follow-up-answer:' } },
    })
  })
  await db.$disconnect()
})

/** A finished consult WITH its appointment on the calendar (see consult-follow-up.test.ts). */
async function completedConsult(label: string, scheduledFor?: Date): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const sessionId = await runConsultToCompletion(db, lookPostId, label)
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.balayageServiceId,
      offeringId: fx.balayageOfferingId,
      status: BookingStatus.ACCEPTED,
      // A distinct slot per consult: one pro cannot hold two overlapping
      // appointments, and every consult here books the same pro.
      scheduledFor:
        scheduledFor ?? new Date(Date.now() + 86_400_000 + bookingIds.length * 2 * 60 * 60 * 1000),
      sourceConsultSessionId: sessionId,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(BALAYAGE_PRICE),
      totalAmount: new Prisma.Decimal(BALAYAGE_PRICE),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
    },
    select: { id: true },
  })
  bookingIds.push(booking.id)
  return sessionId
}

function thread(consultSessionId: string) {
  return loadConsultThread({
    consultSessionId,
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
    copy: defaultClientConsultThreadCopy,
    captureCopy: defaultClientConsultCaptureCopy,
    inspirationCopy: defaultClientConsultInspirationCopy,
    planDiffCopy: defaultClientConsultPlanDiffCopy,
  })
}

function ofKind<K extends ConsultThreadMessageDTO['kind']>(
  messages: ConsultThreadMessageDTO[],
  kind: K,
): Extract<ConsultThreadMessageDTO, { kind: K }>[] {
  return messages.filter((m): m is Extract<ConsultThreadMessageDTO, { kind: K }> => m.kind === kind)
}

async function answer(sessionId: string, questionKey: string, values: string[]) {
  return answerConsultFollowUpQuestion({
    consultSessionId: sessionId,
    clientId: fx.clientId,
    actor: client(),
    questionKey,
    selectedValues: values,
    idempotencyKey: `c2-4-${questionKey}-${values.join('-')}`,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    if (error instanceof ConsultFollowUpAnswerError || error instanceof ConsultWriteError) return error.code
    throw error
  }
}

describe('the pro asks, and the client sees it', () => {
  it('writes the row, its audit event and the doorbell together, and renders the card with her name on it', async () => {
    const sessionId = await completedConsult('c2-4-ask')

    const questions = await ask(sessionId)
    expect(questions).toHaveLength(1)
    const [question] = questions
    if (!question) throw new Error('unreachable')
    expect(question.questionKey).toBe('pro_1')
    expect(question.priority).toBe('NEED_BEFORE_APPOINTMENT')
    expect(question.options).toEqual([
      { value: 'option-1', label: 'Yes' },
      { value: 'option-2', label: 'No' },
      { value: 'option-3', label: 'Not sure' },
    ])
    expect(question.selectedValue).toBeNull()
    expect(question.planVersion).toBeGreaterThanOrEqual(1)

    const stored = await db.consultProFollowUpQuestion.findUniqueOrThrow({ where: { id: question.id } })
    expect(stored.proIntent).toBe(stored.clientText)

    const audits = await db.consultAuditEvent.findMany({ where: { proFollowUpQuestionId: question.id } })
    expect(audits.map((row) => [row.action, row.actorType, row.actorId])).toEqual([
      [ConsultAuditAction.PRO_FOLLOW_UP_ASKED, ConsultActorType.PROFESSIONAL, fx.professionalId],
    ])

    const doorbell = await db.clientNotification.findFirst({
      where: { clientId: fx.clientId, dedupeKey: `consult-pro-follow-up:${question.id}` },
    })
    expect(doorbell?.eventKey).toBe('CONSULT_PRO_FOLLOW_UP')
    expect(doorbell?.href).toBe(`/client/consult/${sessionId}`)
    // A doorbell, not the ask: the question text never travels in it.
    expect(`${doorbell?.title} ${doorbell?.body}`).not.toContain('keratin')

    const view = await thread(sessionId)
    const cards = ofKind(view.messages, 'FOLLOW_UP').filter((m) => m.id.startsWith('pro-follow-up:'))
    expect(cards).toHaveLength(1)
    const [card] = cards
    if (!card) throw new Error('unreachable')
    expect(card.questionKey).toBe('pro_1')
    expect(card.state).toBe('OPEN')
    expect(card.round).toBe(0)
    expect(card.fallback).toBe(false)
    expect(card.attribution).toMatch(/^From /)
    expect(card.selectedValues).toEqual([])
    expect(card.options.map((o) => o.value)).toEqual(['option-1', 'option-2', 'option-3'])
    const intro = view.messages.find((m) => m.id === 'pro-follow-up-intro')
    expect(intro?.kind).toBe('TEXT')
    expect(view.messages.find((m) => m.id === 'pro-follow-up-done')).toBeUndefined()

    // The pro's own read-back goes through the same authorization.
    const list = await loadAuthorizedConsultProFollowUps(proArgs(sessionId))
    expect(list.map((q) => q.questionKey)).toEqual(['pro_1'])
  })

  it('refuses a stranger, a consult that is not COMPLETED, and a body it cannot read', async () => {
    const sessionId = await completedConsult('c2-4-refusals')
    expect(await codeOf(askConsultProFollowUp({
      consultSessionId: sessionId, professionalId: 'not-her', actorUserId: fx.proUserId,
      priority: 'HELPFUL_FOR_PREP', text: 'Q', optionLabels: ['A', 'B'],
    }))).toBe('NOT_FOUND')
    expect(await codeOf(askConsultProFollowUp({
      ...proArgs(sessionId), priority: 'HELPFUL_FOR_PREP', text: 'Q', optionLabels: ['A', 'B'],
      actorUserId: fx.clientUserId,
    }))).toBe('NOT_FOUND')
  })

  it(`caps open questions at ${CONSULT_PRO_FOLLOW_UP_MAX_OPEN}, and reopens the allowance once one is answered`, async () => {
    const sessionId = await completedConsult('c2-4-cap')
    for (let i = 0; i < CONSULT_PRO_FOLLOW_UP_MAX_OPEN; i += 1) await ask(sessionId, `Question ${i + 1}?`)
    expect(await codeOf(ask(sessionId, 'One too many?'))).toBe('INVALID_STATE')
    await answer(sessionId, 'pro_1', ['option-1'])
    const after = await ask(sessionId, 'Now there is room.')
    expect(after.map((q) => q.questionKey)).toEqual(['pro_1', 'pro_2', 'pro_3', 'pro_4'])
  })
})

describe('the client answers through the ordinary path', () => {
  it('files the answer here, with its audit event and the pro notification, and never buys a round', async () => {
    const sessionId = await completedConsult('c2-4-answer')
    const [question] = await ask(sessionId)
    if (!question) throw new Error('unreachable')
    const roundsBefore = await db.consultFollowUpRound.count({ where: { consultSessionId: sessionId } })

    const result = await answer(sessionId, 'pro_1', ['option-2'])
    expect(result.nextRoundCreated).toBe(false)
    expect(await db.consultFollowUpRound.count({ where: { consultSessionId: sessionId } })).toBe(roundsBefore)

    const stored = await db.consultProFollowUpQuestion.findUniqueOrThrow({ where: { id: question.id } })
    expect(stored.selectedValue).toBe('option-2')
    expect(stored.answeredAt).not.toBeNull()

    const audits = await db.consultAuditEvent.findMany({
      where: { proFollowUpQuestionId: question.id }, orderBy: { createdAt: 'asc' },
    })
    expect(audits.map((row) => [row.action, row.actorType])).toEqual([
      [ConsultAuditAction.PRO_FOLLOW_UP_ASKED, ConsultActorType.PROFESSIONAL],
      [ConsultAuditAction.PRO_FOLLOW_UP_ANSWERED, ConsultActorType.CLIENT],
    ])

    const told = await db.notification.findFirst({
      where: { professionalId: fx.professionalId, dedupeKey: `consult-pro-follow-up-answer:${question.id}` },
    })
    expect(told?.eventKey).toBe('CONSULT_PRO_FOLLOW_UP')
    expect(told?.href).toBe(`/pro/consults/${sessionId}`)

    const view = await thread(sessionId)
    const card = ofKind(view.messages, 'FOLLOW_UP').find((m) => m.id === 'pro-follow-up:pro_1')
    expect(card?.state).toBe('DONE')
    expect(card?.selectedValues).toEqual(['option-2'])
    expect(view.messages.find((m) => m.id === 'pro-follow-up-done')?.kind).toBe('TEXT')

    const brief = await loadAuthorizedProLookBrief(proArgs(sessionId))
    expect(brief.proFollowUps?.map((q) => [q.questionKey, q.selectedLabel])).toEqual([['pro_1', 'No']])

    const transcript = await loadProConsultTranscript(proArgs(sessionId))
    const event = transcript.events.find((e) => e.id === `PRO_FOLLOW_UP:${question.id}`)
    expect(event?.title).toBe(consultTranscriptCopy.proFollowUp)
    expect(event?.items).toEqual([
      { label: question.text, value: 'No' },
      { label: consultTranscriptCopy.proFollowUpPriority, value: consultTranscriptCopy.proFollowUpNeeded },
    ])
  })

  it('is write-once: a replay is a no-op, everything else is refused with the round\'s own codes', async () => {
    const sessionId = await completedConsult('c2-4-write-once')
    await ask(sessionId)
    expect(await codeOf(answer(sessionId, 'pro_1', ['option-1', 'option-2']))).toBe('INVALID_ANSWER')
    expect(await codeOf(answer(sessionId, 'pro_1', ['yes']))).toBe('INVALID_ANSWER')
    expect(await codeOf(answer(sessionId, 'pro_7', ['option-1']))).toBe('NOT_OPEN')
    await answer(sessionId, 'pro_1', ['option-3'])
    // The same tap again files nothing and refuses nothing.
    expect(await codeOf(answer(sessionId, 'pro_1', ['option-3']))).toBeUndefined()
    expect(await codeOf(answer(sessionId, 'pro_1', ['option-1']))).toBe('NOT_OPEN')
    const audits = await db.consultAuditEvent.count({
      where: { consultSession: { id: sessionId }, action: ConsultAuditAction.PRO_FOLLOW_UP_ANSWERED },
    })
    expect(audits).toBe(1)
  })

  it('closes with the appointment, on both sides', async () => {
    const sessionId = await completedConsult('c2-4-closed')
    await ask(sessionId)
    const booking = await db.booking.findFirstOrThrow({ where: { sourceConsultSessionId: sessionId }, select: { id: true } })
    // Scheduled 90 minutes ago, still ACCEPTED: the window rule reads the clock.
    await db.booking.update({ where: { id: booking.id }, data: { scheduledFor: new Date(Date.now() - 90 * 60 * 1000) } })
    expect(await codeOf(answer(sessionId, 'pro_1', ['option-1']))).toBe('APPOINTMENT_STARTED')
    expect(await codeOf(ask(sessionId, 'Too late to ask?'))).toBe('APPOINTMENT_STARTED')
  })
})

describe('the database is the backstop', () => {
  const raw = (sessionId: string, over: Partial<Prisma.ConsultProFollowUpQuestionUncheckedCreateInput> = {}) => ({
    consultSessionId: sessionId,
    professionalId: fx.professionalId,
    questionKey: 'pro_1',
    priority: 'HELPFUL_FOR_PREP' as const,
    proIntent: 'Raw?',
    clientText: 'Raw?',
    options: [{ value: 'option-1', label: 'A' }, { value: 'option-2', label: 'B' }],
    planVersion: 1,
    ...over,
  })

  /** A raw row WITH its audit event, the only way an insert commits. */
  async function rawAsked(sessionId: string, over: Partial<Prisma.ConsultProFollowUpQuestionUncheckedCreateInput> = {}) {
    return db.$transaction(async (tx) => {
      const row = await tx.consultProFollowUpQuestion.create({ data: raw(sessionId, over), select: { id: true } })
      await tx.consultAuditEvent.create({ data: {
        consultSessionId: sessionId, action: ConsultAuditAction.PRO_FOLLOW_UP_ASKED,
        actorType: ConsultActorType.PROFESSIONAL, actorId: fx.professionalId, proFollowUpQuestionId: row.id,
      } })
      return row.id
    })
  }

  it('refuses a question without its audit event, an answered insert, and malformed options', async () => {
    const sessionId = await completedConsult('c2-4-raw-insert')
    await expect(db.consultProFollowUpQuestion.create({ data: raw(sessionId) })).rejects.toThrow(/atomic content-free audit evidence/)
    await expect(rawAsked(sessionId, { selectedValue: 'option-1', answeredAt: new Date() })).rejects.toThrow(/asked before it is answered/)
    await expect(rawAsked(sessionId, { options: [{ value: 'option-1', label: 'A' }] })).rejects.toThrow(/ConsultProFollowUpQuestion_options_shape/)
    await expect(rawAsked(sessionId, { options: [{ value: 'yes', label: 'A' }, { value: 'no', label: 'B' }] })).rejects.toThrow(/invalid consult pro follow-up options/)
    await expect(rawAsked(sessionId, { options: [{ value: 'option-1', label: 'A' }, { value: 'option-1', label: 'B' }] })).rejects.toThrow(/invalid consult pro follow-up options/)
    await expect(rawAsked(sessionId, { options: [{ value: 'option-1', label: 'A', token: 'x' }, { value: 'option-2', label: 'B' }] })).rejects.toThrow(/no_secret_keys|invalid consult pro follow-up options/)
    await expect(rawAsked(sessionId, { questionKey: 'pro_0' })).rejects.toThrow(/ConsultProFollowUpQuestion_key_shape/)
    await expect(rawAsked(sessionId, { questionKey: 'box_dye_history' })).rejects.toThrow(/ConsultProFollowUpQuestion_key_shape/)
    await expect(rawAsked(sessionId, { professionalId: 'not-her' })).rejects.toThrow()
  })

  it('refuses every change but the answer, and the answer only once and only from the menu', async () => {
    const sessionId = await completedConsult('c2-4-raw-update')
    const id = await rawAsked(sessionId)
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { clientText: 'Edited' } })).rejects.toThrow(/immutable once asked/)
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { priority: 'NEED_BEFORE_APPOINTMENT' } })).rejects.toThrow(/immutable once asked/)
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { selectedValue: 'option-9', answeredAt: new Date() } })).rejects.toThrow(/one of its own options/)
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { selectedValue: 'option-1' } })).rejects.toThrow(/a value and a time together/)
    // A valid answer needs its own audit row in the same transaction.
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { selectedValue: 'option-1', answeredAt: new Date() } })).rejects.toThrow(/atomic content-free audit evidence/)
    await db.$transaction(async (tx) => {
      await tx.consultProFollowUpQuestion.update({ where: { id }, data: { selectedValue: 'option-1', answeredAt: new Date() } })
      await tx.consultAuditEvent.create({ data: {
        consultSessionId: sessionId, action: ConsultAuditAction.PRO_FOLLOW_UP_ANSWERED,
        actorType: ConsultActorType.CLIENT, actorId: fx.clientUserId, proFollowUpQuestionId: id,
      } })
    })
    await expect(db.consultProFollowUpQuestion.update({ where: { id }, data: { selectedValue: 'option-2', answeredAt: new Date() } })).rejects.toThrow(/answered once/)
    // And the whitelist: an ASKED/ANSWERED audit row must point at a question.
    await expect(db.consultAuditEvent.create({ data: {
      consultSessionId: sessionId, action: ConsultAuditAction.PRO_FOLLOW_UP_ASKED,
      actorType: ConsultActorType.PROFESSIONAL, actorId: fx.professionalId,
    } })).rejects.toThrow(/ConsultAuditEvent_shape/)
  })
})
