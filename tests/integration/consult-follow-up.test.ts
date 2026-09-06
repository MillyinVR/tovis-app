// tests/integration/consult-follow-up.test.ts
//
// P5g — the adaptive follow-up round, against real PostgreSQL.
//
// Everything worth proving here is a claim about DATABASE state under
// constraints written for this feature, so a mocked test would only prove that
// the mock agrees with itself. What this suite exists to prove:
//
//   * the round is BOUGHT once — the unique index, not application code, is
//     what stops a retried or concurrent request paying twice;
//   * an INTAKE-home answer lands in the INTAKE revision, where the safety
//     policy reads it, and a FOLLOW_UP-home answer lands on the round;
//   * 🔴 THE FALLBACK. It is FORCED, because it cannot be waited for: hair
//     colour's intake requires every safety question before it can complete,
//     and completion gates the analysis, so by the prep tier there is never an
//     unanswered one. A test that waited for the fallback would wait forever
//     and pass, having proven nothing;
//   * the cap holds at three rounds per plan version, and a NEW plan version
//     opens a fresh allowance;
//   * the CHECK constraints refuse what the sanitizer would have refused —
//     the database is the backstop, and a backstop nobody tested is a guess.

import { createHash } from 'node:crypto'

import {
  BookingStatus,
  ConsultActorType,
  ConsultFollowUpRoundStatus,
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

vi.mock('@/lib/consult/inspirationImage', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/inspirationImage')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

vi.mock('@/lib/consult/inspirationVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/inspirationVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultInspirationVision: fakes.fakeRunConsultInspirationVision }
})

import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { defaultClientConsultPlanDiffCopy } from '@/lib/brand/defaultClientConsultPlanDiffCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import {
  answerConsultFollowUpQuestion,
  ConsultFollowUpAnswerError,
  CONSULT_MAX_FOLLOW_UP_ROUNDS,
  generateConsultFollowUpRound,
  loadConsultFollowUpState,
} from '@/lib/consult/followUpContract'
import {
  ConsultFollowUpError,
  CONSULT_FOLLOW_UP_PROMPT_VERSION,
  CONSULT_FOLLOW_UP_SCHEMA_VERSION,
  type ConsultFollowUpProvider,
} from '@/lib/consult/followUpEngine'
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

const client = () =>
  ({ type: ConsultActorType.CLIENT, id: fx.clientUserId }) as const

/** A provider that answers with one question, keyed however the caller says. */
function providerAnswering(key: string, values: string[]): ConsultFollowUpProvider {
  return async ({ vocabulary }) => {
    const entry = vocabulary.byKey.get(key)
    if (!entry) throw new ConsultFollowUpError('bad_output')
    return {
      model: 'claude-sonnet-5',
      questions: [
        {
          key: entry.key,
          home: entry.home,
          text: 'You’re at a light brown now and you loved the ash — would coming back in a few weeks work?',
          evidence: `wants lightestLevel:LEVEL_9; core.baseLevel LEVEL_6`,
          options: values.map((value) => ({ value, label: `Option ${value}` })),
        },
      ],
    }
  }
}

/** The failure the fallback exists for. */
const failingProvider: ConsultFollowUpProvider = async () => {
  throw new ConsultFollowUpError('unavailable')
}

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'p5g_follow_up' })
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
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await teardownLookConsultFixture(db)
  await db.$disconnect()
})

/** Bookings this suite created, so teardown can drop them. */
const bookingIds: string[] = []

/**
 * A finished consult WITH its appointment on the calendar.
 *
 * 🔴 The booking is not decoration. The thread renders the whole prep tier —
 * and therefore every follow-up — inside its booking block, and
 * `generateConsultFollowUpRound` refuses without one for that exact reason: a
 * round bought before the booking is a paid call nobody is ever shown. In the
 * real flow this is automatic (a spark books before its photos, and the plan
 * comes after them); the fixture has to do it by hand.
 */
async function completedConsult(label: string): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const sessionId = await runConsultToCompletion(db, lookPostId, label)
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.balayageServiceId,
      offeringId: fx.balayageOfferingId,
      status: BookingStatus.ACCEPTED,
      // 🔴 A distinct slot per consult. One professional cannot hold two
      // overlapping appointments (`Booking_no_active_professional_overlap`),
      // and every consult in this suite books the same pro.
      scheduledFor: new Date(
        Date.now() + 86_400_000 + bookingIds.length * 2 * 60 * 60 * 1000,
      ),
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

/**
 * Leave one intake question genuinely unanswered.
 *
 * 🔴 The only way to reach the fallback, and the only way to give the model
 * anything to ask on the INTAKE home at all: hair colour's intake requires
 * every safety question before it can complete, and completion gates the
 * analysis, so a finished consult never has one outstanding.
 *
 * 🔴 An INSERT, not an update — `ConsultRevision` is append-only and the
 * database says so ("ConsultRevision is append-only; insert a new record
 * instead"). This mirrors what the write boundary does: bump the session's
 * sequence, then write the revision AT that number. `complete: false`, because
 * an intake missing a required answer is not complete and the payload guard
 * refuses the claim that it is.
 */
async function unanswerIntakeQuestion(sessionId: string, key: string) {
  const previous = await db.consultRevision.findFirstOrThrow({
    where: { consultSessionId: sessionId, kind: 'INTAKE' },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  const payload = previous.payload as Prisma.JsonObject
  const answers = { ...(payload.answers as Prisma.JsonObject) }
  delete answers[key]
  const sequenced = await db.consultSession.update({
    where: { id: sessionId },
    data: { revisionSequence: { increment: 1 } },
    select: { revisionSequence: true },
  })
  await db.consultRevision.create({
    data: {
      consultSessionId: sessionId,
      revision: sequenced.revisionSequence,
      kind: 'INTAKE',
      schemaVersion: previous.schemaVersion,
      payload: { ...payload, answers, complete: false },
      // `ConsultRevision_idempotency_shape` requires both on every kind but
      // BRIEF. The hash is only ever read to detect a replay, so any 64 hex
      // characters satisfies it — but it has to BE 64 hex characters.
      idempotencyKey: `p5g-unanswer-${key}-${sequenced.revisionSequence}`,
      requestHash: createHash('sha256')
        .update(`${sessionId}:${key}:${sequenced.revisionSequence}`)
        .digest('hex'),
    },
  })
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
  return messages.filter(
    (m): m is Extract<ConsultThreadMessageDTO, { kind: K }> => m.kind === kind,
  )
}

describe('a round is bought once', () => {
  it('creates the first round when the plan publishes, and never a second for it', async () => {
    const sessionId = await completedConsult('p5g-once')
    const provider = vi.fn(providerAnswering('event_timing', ['no-deadline', '1-3-months']))

    const first = await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider },
    )
    expect(first.created).toBe(true)
    expect(provider).toHaveBeenCalledTimes(1)

    // 🔴 A round is still OPEN, so nothing else may be bought. This is the
    // burst boundary: the next call happens when she stops answering.
    const again = await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider },
    )
    expect(again).toEqual({ created: false, reason: 'ROUND_OPEN' })
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('🔴 the UNIQUE INDEX is what stops a concurrent request paying twice', async () => {
    const sessionId = await completedConsult('p5g-race')
    // Both calls see no round and both pay for a question. Only one insert can
    // win — which is the point: a counter in application code would be a race
    // with money in it, and this proves the money is bounded by the database.
    const [a, b] = await Promise.all([
      generateConsultFollowUpRound(
        { consultSessionId: sessionId, actor: client() },
        { provider: providerAnswering('event_timing', ['no-deadline', '1-3-months']) },
      ),
      generateConsultFollowUpRound(
        { consultSessionId: sessionId, actor: client() },
        { provider: providerAnswering('budget', ['under-150', 'over-400']) },
      ),
    ])
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1)
    const loser = a.created ? b : a
    expect(loser.created === false && loser.reason).toBe('ALREADY_EXISTS')
    expect(
      await db.consultFollowUpRound.count({ where: { consultSessionId: sessionId } }),
    ).toBe(1)
  })
})

describe('an answer goes to its own vocabulary’s home', () => {
  it('🔴 an INTAKE key lands in the INTAKE revision, where the safety policy reads it', async () => {
    const sessionId = await completedConsult('p5g-intake-home')
    await unanswerIntakeQuestion(sessionId, 'henna_plant_dye_history')

    await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      {
        provider: providerAnswering('henna_plant_dye_history', [
          'never',
          'within-6-months',
        ]),
      },
    )

    await answerConsultFollowUpQuestion({
      consultSessionId: sessionId,
      clientId: fx.clientId,
      actor: client(),
      questionKey: 'henna_plant_dye_history',
      selectedValues: ['within-6-months'],
      idempotencyKey: `p5g-henna-${sessionId}`,
    })

    const revision = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: sessionId, kind: 'INTAKE' },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    })
    const answers = (revision.payload as Prisma.JsonObject).answers as Prisma.JsonObject
    expect(answers.henna_plant_dye_history).toBe('within-6-months')
    // 🔴 A REPLACE write echoes the WHOLE map. If it did not, every other
    // answer would have been wiped by this one tap.
    expect(answers.prior_reaction).toBeDefined()
    expect(answers.box_dye_history).toBeDefined()

    // And nothing was written to the round, which would be the second home.
    const round = await db.consultFollowUpRound.findFirstOrThrow({
      where: { consultSessionId: sessionId },
    })
    expect(round.answers).toEqual({})
  })

  it('a FOLLOW_UP key lands on the round, which is the only home it has', async () => {
    const sessionId = await completedConsult('p5g-round-home')
    await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider: providerAnswering('event_timing', ['no-deadline', '1-3-months']) },
    )
    await answerConsultFollowUpQuestion({
      consultSessionId: sessionId,
      clientId: fx.clientId,
      actor: client(),
      questionKey: 'event_timing',
      selectedValues: ['1-3-months'],
      idempotencyKey: `p5g-event-${sessionId}`,
    })
    const round = await db.consultFollowUpRound.findFirstOrThrow({
      where: { consultSessionId: sessionId },
      orderBy: { round: 'asc' },
    })
    expect(round.answers).toEqual({ event_timing: ['1-3-months'] })
    expect(round.answeredAt).not.toBeNull()
  })

  it('refuses a value the question never offered, and a key that is not open', async () => {
    const sessionId = await completedConsult('p5g-refuse')
    await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider: providerAnswering('event_timing', ['no-deadline', '1-3-months']) },
    )
    const answer = (questionKey: string, values: string[]) =>
      answerConsultFollowUpQuestion({
        consultSessionId: sessionId,
        clientId: fx.clientId,
        actor: client(),
        questionKey,
        selectedValues: values,
        idempotencyKey: `p5g-bad-${questionKey}-${values.join()}`,
      })
    await expect(answer('event_timing', ['within-2-weeks'])).rejects.toBeInstanceOf(
      ConsultFollowUpAnswerError,
    )
    await expect(answer('budget', ['under-150'])).rejects.toBeInstanceOf(
      ConsultFollowUpAnswerError,
    )
  })
})

describe('🔴 the fallback, forced', () => {
  it('asks the pack’s own remaining SAFETY questions when the call fails', async () => {
    const sessionId = await completedConsult('p5g-fallback')
    // FORCED, both halves: the provider is made to fail, AND a safety question
    // is made unanswered. Neither happens on its own in a hair-colour consult
    // — see this file's header.
    await unanswerIntakeQuestion(sessionId, 'prior_lightening')

    const result = await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider: failingProvider },
    )
    expect(result.created).toBe(true)

    const round = await db.consultFollowUpRound.findFirstOrThrow({
      where: { consultSessionId: sessionId },
    })
    expect(round.status).toBe(ConsultFollowUpRoundStatus.FALLBACK)
    // 🔴 No model wrote it, so no model is named. A FALLBACK row carrying a
    // model would put a name on questions that model never saw.
    expect(round.model).toBeNull()
    expect(round.promptVersion).toBe(CONSULT_FOLLOW_UP_PROMPT_VERSION)
    expect(round.schemaVersion).toBe(CONSULT_FOLLOW_UP_SCHEMA_VERSION)

    const questions = round.questions as Prisma.JsonArray
    expect(questions).toHaveLength(1)
    const [only] = questions as [Prisma.JsonObject]
    expect(only.key).toBe('prior_lightening')
    // 🔴 The pack's OWN words, verbatim — never a paraphrase. A safety question
    // re-worded by code that has not read why it exists is the risk the
    // fallback is protecting against.
    expect(only.text).toBe('When was your hair last lightened?')
    expect(only.home).toBe('INTAKE')

    // And the client is TOLD. Part 0 rule 4 forbids a silent fallback, and one
    // she cannot see is a silent one.
    const messages = (await thread(sessionId)).messages
    const followUps = ofKind(messages, 'FOLLOW_UP')
    expect(followUps).toHaveLength(1)
    expect(followUps[0]!.fallback).toBe(true)
    expect(
      messages.some(
        (m) => m.kind === 'TEXT' && m.text.includes('couldn’t think of the next question'),
      ),
    ).toBe(true)
  })

  it('writes NO round when the call fails and no safety question is left', async () => {
    const sessionId = await completedConsult('p5g-no-fallback')
    // The ordinary state of a hair-colour consult: the intake is complete, so
    // every safety question is answered. There is nothing honest to ask, and
    // an invented question would be exactly the silent fallback rule 4 bans.
    const result = await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider: failingProvider },
    )
    expect(result).toEqual({ created: false, reason: 'NOTHING_LEFT_TO_ASK' })
    expect(
      await db.consultFollowUpRound.count({ where: { consultSessionId: sessionId } }),
    ).toBe(0)
    expect(ofKind((await thread(sessionId)).messages, 'FOLLOW_UP')).toHaveLength(0)
  })
})

describe('the cap', () => {
  it('stops at three rounds for one plan version', async () => {
    const sessionId = await completedConsult('p5g-cap')
    const keys = ['event_timing', 'budget', 'service_experience']
    const values: Record<string, string[]> = {
      event_timing: ['no-deadline', '1-3-months'],
      budget: ['under-150', 'over-400'],
      service_experience: ['first-time', 'regular'],
    }

    for (const key of keys) {
      const created = await generateConsultFollowUpRound(
        { consultSessionId: sessionId, actor: client() },
        { provider: providerAnswering(key, values[key]!) },
      )
      expect(created.created).toBe(true)
      await answerConsultFollowUpQuestion({
        consultSessionId: sessionId,
        clientId: fx.clientId,
        actor: client(),
        questionKey: key,
        selectedValues: [values[key]![0]!],
        idempotencyKey: `p5g-cap-${key}`,
      })
    }

    const state = await loadConsultFollowUpState(sessionId)
    expect(state?.rounds).toHaveLength(CONSULT_MAX_FOLLOW_UP_ROUNDS)
    expect(state?.moreRoundsAvailable).toBe(false)
    expect(state?.openQuestionKey).toBeNull()

    const overCap = await generateConsultFollowUpRound(
      { consultSessionId: sessionId, actor: client() },
      { provider: providerAnswering('event_timing', ['no-deadline', '1-3-months']) },
    )
    expect(overCap).toEqual({ created: false, reason: 'CAP_REACHED' })

    // The thread says WHY nothing more is coming, rather than leaving an
    // absence she has to interpret.
    expect(
      (await thread(sessionId)).messages.some(
        (m) => m.kind === 'TEXT' && m.id === 'follow-up-done',
      ),
    ).toBe(true)
  })

  it('🔴 buys nothing before there is a BOOKING to hang prep off', async () => {
    // The thread shows no prep without one, so a round bought here would be a
    // paid call whose questions nobody is ever shown.
    const lookPostId = await createLook(db, fx.balayageServiceId)
    const sessionId = await runConsultToCompletion(db, lookPostId, 'p5g-unbooked')
    const provider = vi.fn(providerAnswering('event_timing', ['no-deadline']))
    expect(
      await generateConsultFollowUpRound(
        { consultSessionId: sessionId, actor: client() },
        { provider },
      ),
    ).toEqual({ created: false, reason: 'NOT_BOOKED' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('buys nothing before there is a plan', async () => {
    const lookPostId = await createLook(db, fx.balayageServiceId)
    void lookPostId
    const orphan = await generateConsultFollowUpRound(
      { consultSessionId: 'no-such-consult', actor: client() },
      { provider: providerAnswering('event_timing', ['no-deadline']) },
    )
    expect(orphan).toEqual({ created: false, reason: 'NO_PLAN' })
  })
})

describe('🔴 the database is the backstop', () => {
  async function insertRound(overrides: Prisma.InputJsonValue, extra = {}) {
    const sessionId = await completedConsult(`p5g-guard-${Math.random().toString(36).slice(2, 8)}`)
    return db.consultFollowUpRound.create({
      data: {
        consultSessionId: sessionId,
        planVersion: 1,
        round: 1,
        status: ConsultFollowUpRoundStatus.GENERATED,
        schemaVersion: CONSULT_FOLLOW_UP_SCHEMA_VERSION,
        promptVersion: CONSULT_FOLLOW_UP_PROMPT_VERSION,
        model: 'claude-sonnet-5',
        questions: overrides,
        ...extra,
      },
    })
  }

  const ok = [
    {
      key: 'event_timing',
      text: 'Is there a date you are working toward?',
      home: 'FOLLOW_UP',
      evidence: 'no deadline recorded',
      options: [{ value: 'no-deadline', label: 'No deadline' }],
    },
  ]

  it('accepts a well-formed round', async () => {
    await expect(insertRound(ok)).resolves.toBeDefined()
  })

  it('refuses a question that describes the PERSON', async () => {
    await expect(
      insertRound([{ ...ok[0]!, text: 'Does your skin react to color?' }]),
    ).rejects.toThrow(/23514|invalid|violates/i)
  })

  it('refuses a home the routing rule does not have', async () => {
    await expect(insertRound([{ ...ok[0]!, home: 'INSPIRATION' }])).rejects.toThrow(
      /23514|invalid|violates/i,
    )
  })

  it('refuses prose past the cap', async () => {
    await expect(insertRound([{ ...ok[0]!, text: 'a'.repeat(301) }])).rejects.toThrow(
      /23514|invalid|violates/i,
    )
  })

  it('refuses an option value that is not token-shaped', async () => {
    await expect(
      insertRound([{ ...ok[0]!, options: [{ value: 'No Deadline!', label: 'No' }] }]),
    ).rejects.toThrow(/23514|invalid|violates/i)
  })

  it('🔴 refuses an answer whose question belongs to another home', async () => {
    // The routing rule as a database fact. An INTAKE-keyed answer stored here
    // is an answer the safety policy cannot see, and it is refused rather than
    // trusted to application code that could be called from somewhere new.
    await expect(
      insertRound([{ ...ok[0]!, key: 'prior_reaction', home: 'INTAKE' }], {
        answers: { prior_reaction: ['no'] },
        answeredAt: new Date(),
      }),
    ).rejects.toThrow(/23514|invalid|violates/i)
  })

  it('refuses a FALLBACK round that names a model', async () => {
    await expect(
      insertRound(ok, { status: ConsultFollowUpRoundStatus.FALLBACK }),
    ).rejects.toThrow(/23514|invalid|violates/i)
  })

  it('refuses more than three questions in one round', async () => {
    await expect(
      insertRound([
        { ...ok[0]!, key: 'a_one' },
        { ...ok[0]!, key: 'a_two' },
        { ...ok[0]!, key: 'a_three' },
        { ...ok[0]!, key: 'a_four' },
      ]),
    ).rejects.toThrow(/23514|invalid|violates/i)
  })

  it('refuses the same key twice in one round', async () => {
    await expect(insertRound([ok[0]!, ok[0]!])).rejects.toThrow(
      /23514|invalid|violates/i,
    )
  })
})
