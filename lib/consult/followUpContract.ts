import 'server-only'

// lib/consult/followUpContract.ts
//
// P5g — the adaptive follow-up ROUND: when one is generated, what it costs,
// where each answer is filed, and what happens when the model call fails.
//
// ## The cap is the unique index
//
// "One follow-up call per answer burst" and "at most three rounds per plan
// version" are the same constraint seen twice, and
// `(consultSessionId, planVersion, round)` is both of them as a database fact.
// A double-tapped answer, a retried POST and two concurrent requests all lose
// the insert rather than each buying a paid call. A counter in application code
// would be a race with money in it.
//
// The BURST boundary is structural rather than a timer, and that is deliberate:
// a round is closed when every question in it has been answered, so the next
// call happens when she stops answering, not ninety seconds after she started.
// (The plan rerun's debounce is a timer because its trigger — "an input
// changed" — has no natural end. This one does.)
//
// ## Where an answer goes
//
// 🔴 One home per vocabulary (./followUpVocabulary.ts). An INTAKE-keyed answer
// is written to the INTAKE revision through the ordinary write boundary, so the
// safety policy and `consult_analysis_payload_guard` read it exactly as they
// would an answer she typed into the intake step. Only the follow-up pack's own
// keys — the ones P6's diet moved out and which have never had storage — live
// on the round.
//
// ## When the call fails
//
// Part 0 rule 4, applied literally: never a generic list, never silence. The
// round is written anyway, as FALLBACK, carrying the intake pack's own REMAINING
// SAFETY questions in the pack's own words, and the thread says what happened.
// A consult with no unanswered safety question left gets no round at all, which
// is the honest answer rather than an invented one.

import {
  ConsultActorType,
  ConsultFollowUpRoundStatus,
  ConsultRevisionKind,
  Prisma,
} from '@prisma/client'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type {
  ConsultInspirationAnalysisAttributesDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { safeError } from '@/lib/security/logging'

import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import { consultHasLiveBooking } from './bookingLink'
import {
  assertConsultInputOpen,
  CONSULT_OPEN_WINDOW_SELECT,
  type ConsultOpenWindowSession,
} from './openWindow'
import { countConsultPlanVersions } from './analysisRerun'
import type { ConsultAnalysisCore } from './analysisEngine'
import {
  deriveConsultInspirationPreferences,
  type ConsultInspirationClientPreferences,
} from './inspiration/cards'
import { resolveConsultInspirationPayloadV2 } from './inspiration/registry'
import { resolveConsultSessionIntakePack } from './intake/registry'
import type { ConsultIntakePackDefinition } from './intake/types'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'
import { resolveConsultServiceIdentity } from './serviceIdentity'
import { appendConsultIntakeRevision } from './writeBoundary'
import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import {
  ConsultFollowUpError,
  CONSULT_FOLLOW_UP_MAX_QUESTIONS,
  CONSULT_FOLLOW_UP_PROMPT_VERSION,
  CONSULT_FOLLOW_UP_SCHEMA_VERSION,
  runConsultFollowUpQuestions,
  type ConsultFollowUpProvider,
  type ConsultFollowUpQuestion,
} from './followUpEngine'
import { renderConsultFollowUpContext } from './followUpContext'
import {
  consultFollowUpSafetyEntries,
  resolveConsultFollowUpVocabulary,
  type ConsultFollowUpVocabularyEntry,
} from './followUpVocabulary'

/**
 * The most rounds one PLAN VERSION may hold.
 *
 * Three, and plan versions are themselves capped at four
 * (CONSULT_MAX_PLAN_VERSIONS), so a consult can never buy more than twelve of
 * these calls. At text-only prices that is cents, but a ceiling is how a living
 * document stays affordable rather than becoming a reason to close it — the
 * same argument the plan cap makes, at a smaller scale.
 */
export const CONSULT_MAX_FOLLOW_UP_ROUNDS = 3

/** One question as the thread serves it. */
export type ConsultFollowUpRoundQuestion = ConsultFollowUpQuestion & {
  /** Her answer, or null while it is open. Read from the question's own home. */
  selectedValues: string[] | null
}

export type ConsultFollowUpRoundView = {
  id: string
  planVersion: number
  round: number
  status: ConsultFollowUpRoundStatus
  questions: ConsultFollowUpRoundQuestion[]
  createdAt: Date
}

export type ConsultFollowUpState = {
  /** Rounds for the CURRENT plan version, oldest first. */
  rounds: ConsultFollowUpRoundView[]
  /** The one question still open, or null. */
  openQuestionKey: string | null
  /** True when the newest round is a fallback and still open — the thread says so. */
  fallbackActive: boolean
  planVersion: number
  moreRoundsAvailable: boolean
}

// ── Reading a stored round ──────────────────────────────────────────────────

/**
 * A stored `questions` array, narrowed.
 *
 * The database guard already proved this shape on the way in, so a row that
 * fails here is a row written by something that bypassed the trigger. It is
 * dropped rather than thrown on: a follow-up round is an ADDITION to the
 * thread, and one unreadable round must not take the consult down with it.
 */
function readStoredQuestions(payload: Prisma.JsonValue): ConsultFollowUpQuestion[] {
  if (!Array.isArray(payload)) return []
  const questions: ConsultFollowUpQuestion[] = []
  for (const raw of payload) {
    if (!isRecord(raw)) continue
    const { key, text, home, evidence, options } = raw
    if (
      typeof key !== 'string' ||
      typeof text !== 'string' ||
      typeof evidence !== 'string' ||
      (home !== 'INTAKE' && home !== 'FOLLOW_UP') ||
      !Array.isArray(options)
    ) {
      continue
    }
    const parsed: { value: string; label: string }[] = []
    for (const option of options) {
      if (
        isRecord(option) &&
        typeof option.value === 'string' &&
        typeof option.label === 'string'
      ) {
        parsed.push({ value: option.value, label: option.label })
      }
    }
    if (parsed.length === 0) continue
    questions.push({ key, text, home, evidence, options: parsed })
  }
  return questions
}

function readStoredAnswers(
  payload: Prisma.JsonValue,
): Record<string, string[]> {
  if (!isRecord(payload)) return {}
  const answers: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!Array.isArray(value)) continue
    const values = value.filter((item): item is string => typeof item === 'string')
    if (values.length > 0) answers[key] = values
  }
  return answers
}

/**
 * Whether one question has been answered — asked of its OWN home.
 *
 * 🔴 Derived, never stored twice. An INTAKE-home answer lives in the intake
 * revision and this table never sees it, so a `round.answeredAt` flag would be
 * a second copy of a fact that can change without this row being touched (she
 * can reopen the intake step and answer the same question there).
 */
function answeredValues(
  question: ConsultFollowUpQuestion,
  homes: {
    intakeAnswers: Readonly<Record<string, string>>
    roundAnswers: Readonly<Record<string, readonly string[]>>
  },
): string[] | null {
  if (question.home === 'INTAKE') {
    const answer = homes.intakeAnswers[question.key]
    return answer ? [answer] : null
  }
  const answer = homes.roundAnswers[question.key]
  return answer ? [...answer] : null
}

// ── The situation, read once ────────────────────────────────────────────────

type FollowUpSituation = {
  planVersion: number
  /** The pack this consult is PINNED to, not the pack that shipped today. */
  intakePack: ConsultIntakePackDefinition
  intakeAnswers: Record<string, string>
  serviceName: string | null
  professionalDisplayName: string
  rounds: ConsultFollowUpRoundView[]
  followUpAnswers: Record<string, string[]>
  /** The session, in the shape the input-window rule reads. */
  session: ConsultOpenWindowSession
  /** The reference as the vision model read it, or null when unread. */
  inspiration: ConsultInspirationAnalysisAttributesDTO | null
  /** Her own hair as the analysis read it, or null before the first plan. */
  core: ConsultAnalysisCore | null
  /** What her taps said, derived from the reading they were about. */
  preferences: ConsultInspirationClientPreferences | null
}

export type ConsultFollowUpDeps = {
  provider?: ConsultFollowUpProvider
  now?: Date
}

// ── Generating a round ──────────────────────────────────────────────────────

export type GenerateConsultFollowUpRoundResult =
  | { created: true; round: ConsultFollowUpRoundView }
  | {
      created: false
      reason:
        | 'NO_PLAN'
        | 'NOT_BOOKED'
        | 'ROUND_OPEN'
        | 'CAP_REACHED'
        | 'NOTHING_LEFT_TO_ASK'
        | 'ALREADY_EXISTS'
    }

/**
 * Build the next round for a consult, if one is due.
 *
 * Called from exactly two places, and the split is on purpose:
 *   * the analysis runner, when a plan is published — that is what "after the
 *     photos" means, and the runner has the background budget for a call;
 *   * the follow-up answer route, when a round's last question is answered —
 *     the burst boundary.
 *
 * Everywhere else it is a no-op with a reason, so a caller that asks twice
 * cannot buy twice.
 */
export async function generateConsultFollowUpRound(
  args: {
    consultSessionId: string
    actor: { type: ConsultActorType; id: string | null }
    /**
     * The situation, when the caller has just read it.
     *
     * The answer path reads it to decide whether the round closed, and that
     * read is exactly what this function would do next. Passing it through
     * turns four full situation reads per closing answer into two — each one is
     * seven queries, and the whole thing happens while she waits on a tap.
     */
    situation?: FollowUpSituation
  },
  deps: ConsultFollowUpDeps = {},
): Promise<GenerateConsultFollowUpRoundResult> {
  const now = deps.now ?? new Date()
  const provider = deps.provider ?? runConsultFollowUpQuestions

  const situation =
    args.situation ?? (await readConsultFollowUpSituation(args.consultSessionId))
  if (!situation || situation.planVersion < 1) {
    return { created: false, reason: 'NO_PLAN' }
  }
  // 🔴 No booking, no round — and this is a MONEY rule, not a product one. The
  // thread renders the whole prep tier inside its booking block, so a round
  // bought before the booking is a paid call whose questions nobody is ever
  // shown. In the real flow the order makes this a no-op (a spark books before
  // its photos, and the plan comes after them); it fires for a consult that
  // reached a plan and never booked, which is exactly the case that would have
  // paid for nothing.
  if (!(await consultHasLiveBooking(args.consultSessionId))) {
    return { created: false, reason: 'NOT_BOOKED' }
  }
  const state = projectConsultFollowUpState(situation)
  if (state.openQuestionKey) return { created: false, reason: 'ROUND_OPEN' }
  if (!state.moreRoundsAvailable) return { created: false, reason: 'CAP_REACHED' }

  const vocabulary = await resolveVocabularyFor(situation)
  if (vocabulary.entries.length === 0) {
    return { created: false, reason: 'NOTHING_LEFT_TO_ASK' }
  }

  const round = situation.rounds.length + 1
  const context = await renderContextFor(situation, vocabulary, round)

  let questions: ConsultFollowUpQuestion[]
  let model: string | null
  let status: ConsultFollowUpRoundStatus
  try {
    const result = await provider({
      context,
      vocabulary,
      meter: { consultSessionId: args.consultSessionId },
    })
    questions = result.questions
    model = result.model
    status = ConsultFollowUpRoundStatus.GENERATED
  } catch (error) {
    if (error instanceof ConsultFollowUpError && error.kind === 'no_vocabulary') {
      return { created: false, reason: 'NOTHING_LEFT_TO_ASK' }
    }
    // 🔴 The fallback. Never the old static list (Part 0 rule 4), never a
    // generic question, never silence: the pack's own REMAINING SAFETY
    // questions, in the pack's own words, which are the ones that decide
    // whether the service is safe to do at all. If there are none left, there
    // is nothing honest to ask and no round is written.
    const safety = consultFollowUpSafetyEntries(vocabulary).slice(
      0,
      CONSULT_FOLLOW_UP_MAX_QUESTIONS,
    )
    console.warn('consult follow-up call failed; falling back to safety questions', {
      consultSessionId: args.consultSessionId,
      round,
      safetyQuestionCount: safety.length,
      ...safeError(error),
    })
    if (safety.length === 0) {
      return { created: false, reason: 'NOTHING_LEFT_TO_ASK' }
    }
    questions = safety.map(fallbackQuestion)
    model = null
    status = ConsultFollowUpRoundStatus.FALLBACK
  }

  try {
    const created = await prisma.consultFollowUpRound.create({
      data: {
        consultSessionId: args.consultSessionId,
        planVersion: situation.planVersion,
        round,
        status,
        schemaVersion: CONSULT_FOLLOW_UP_SCHEMA_VERSION,
        promptVersion: CONSULT_FOLLOW_UP_PROMPT_VERSION,
        model,
        questions: questions.map((question) => ({ ...question })),
        createdAt: now,
      },
    })
    return {
      created: true,
      round: {
        id: created.id,
        planVersion: created.planVersion,
        round: created.round,
        status: created.status,
        createdAt: created.createdAt,
        questions: questions.map((question) => ({
          ...question,
          selectedValues: null,
        })),
      },
    }
  } catch (error) {
    // The unique index did its job: something else created this round while we
    // were asking. That is the anti-double-bill working, not a failure.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { created: false, reason: 'ALREADY_EXISTS' }
    }
    throw error
  }
}

/**
 * One safety question as a round question.
 *
 * 🔴 The pack's OWN words, verbatim, and every one of its options. A fallback
 * is the moment the model could not help, so nothing here may be a paraphrase
 * — a safety question re-worded by code that has not read the reason it exists
 * is exactly the risk the fallback is protecting against.
 */
function fallbackQuestion(
  entry: ConsultFollowUpVocabularyEntry,
): ConsultFollowUpQuestion {
  return {
    key: entry.key,
    home: entry.home,
    text: entry.packLabel,
    evidence: 'Asked because it is still unanswered and it affects what is safe to do.',
    options: entry.options.map((option) => ({ ...option })),
  }
}

// ── Reading the situation ───────────────────────────────────────────────────

const FOLLOW_UP_SESSION_SELECT = {
  // 🔴 The input-window rule's own select, so this path can refuse a write
  // after the appointment started rather than only the intake path doing it.
  ...CONSULT_OPEN_WINDOW_SELECT,
  id: true,
  clientId: true,
  status: true,
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
} satisfies Prisma.ConsultSessionSelect

/**
 * Everything a round needs, in one read.
 *
 * Deliberately NOT a call into the stage loaders. Those enforce the client's
 * own scope and agreements, which is right for a request and wrong here: this
 * also runs from the analysis runner, where there is no actor at all. The
 * caller has already established who may do this; what is read below is the
 * consult's own state.
 */
async function readConsultFollowUpSituation(
  consultSessionId: string,
): Promise<FollowUpSituation | null> {
  const session = await prisma.consultSession.findUnique({
    where: { id: consultSessionId },
    select: FOLLOW_UP_SESSION_SELECT,
  })
  if (!session) return null

  const [planVersion, intakePayloads, rounds, analysisRevision, inspirationRevision, inspirationAnalysisRevision] =
    await Promise.all([
    countConsultPlanVersions(prisma, consultSessionId),
    prisma.consultRevision.findMany({
      where: { consultSessionId, kind: ConsultRevisionKind.INTAKE },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { payload: true },
    }),
    prisma.consultFollowUpRound.findMany({
      where: { consultSessionId },
      orderBy: [{ planVersion: 'asc' }, { round: 'asc' }],
      select: {
        id: true,
        planVersion: true,
        round: true,
        status: true,
        questions: true,
        answers: true,
        createdAt: true,
      },
    }),
    prisma.consultRevision.findFirst({
      where: { consultSessionId, kind: ConsultRevisionKind.ANALYSIS },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { payload: true, schemaVersion: true },
    }),
    prisma.consultRevision.findFirst({
      where: { consultSessionId, kind: ConsultRevisionKind.INSPIRATION },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { payload: true },
    }),
    prisma.consultRevision.findFirst({
      where: { consultSessionId, kind: ConsultRevisionKind.INSPIRATION_ANALYSIS },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        payload: true,
        schemaVersion: true,
        promptVersion: true,
        model: true,
        createdAt: true,
      },
    }),
  ])

  const intakeAnswers: Record<string, string> = {}
  const intakePayload = intakePayloads[0]?.payload
  if (isRecord(intakePayload) && isRecord(intakePayload.answers)) {
    for (const [key, value] of Object.entries(intakePayload.answers)) {
      if (typeof value === 'string') intakeAnswers[key] = value
    }
  }

  // 🔴 The pack this consult was SERVED, pinned by its own stored revisions —
  // not the pack that shipped today. A client mid-consult when a new pack
  // version lands is asked the questions she was already being asked, which is
  // the rule `resolveConsultSessionIntakePack` exists for; a follow-up that
  // ignored it could offer an option value her stored payload cannot hold.
  const intakePack = resolveConsultSessionIntakePack(
    resolveConsultServiceProfile(session.serviceCategory).intakePack,
    intakePayloads.map((revision) => revision.payload),
  )

  const identity = await resolveConsultFollowUpIdentity(consultSessionId)

  // The reference as the vision model read it. Null when it was never read (no
  // reference, or an unreadable one) — the prompt is told so, and told not to
  // describe a picture it has not seen.
  const inspirationAnalysis = inspirationAnalysisRevision
    ? normalizeStoredConsultInspirationAnalysis(inspirationAnalysisRevision)
    : null
  const inspiration = inspirationAnalysis?.attributes ?? null

  // Her own hair, from the plan. `normalizeStoredConsultAnalysisPayload` throws
  // on a payload it cannot read; a follow-up is an ADDITION to the thread and
  // must not be the thing that takes it down, so an unreadable plan simply
  // means the prompt is told her hair has not been read.
  let core: ConsultAnalysisCore | null = null
  if (analysisRevision) {
    try {
      core = normalizeStoredConsultAnalysisPayload(
        analysisRevision.payload,
        analysisRevision.schemaVersion,
      ).core as ConsultAnalysisCore
    } catch (error) {
      console.warn('consult follow-up could not read the stored plan', {
        consultSessionId,
        ...safeError(error),
      })
    }
  }

  // What her taps meant, derived from the reading they were about — the same
  // function the analysis prompt is fed from, so the two cannot disagree about
  // what she said.
  const preferences = resolveConsultFollowUpPreferences({
    inspirationPayload: inspirationRevision?.payload ?? null,
    reading: inspiration,
  })

  // 🔴 Rounds for the CURRENT plan version only. A new plan version is a new
  // allowance, which is what "three rounds per plan version" means, and mixing
  // versions here would make the second plan's first round look like the
  // fourth and be refused.
  const currentRounds = rounds
    .filter((row) => row.planVersion === planVersion)
    .map((row) => ({
      id: row.id,
      planVersion: row.planVersion,
      round: row.round,
      status: row.status,
      createdAt: row.createdAt,
      storedQuestions: readStoredQuestions(row.questions),
      storedAnswers: readStoredAnswers(row.answers),
    }))

  // Follow-up-home answers accumulate ACROSS rounds: a question answered in
  // round 1 must not be asked again in round 2, and the vocabulary is what
  // enforces that.
  const followUpAnswers: Record<string, string[]> = {}
  for (const row of rounds) {
    for (const [key, values] of Object.entries(readStoredAnswers(row.answers))) {
      followUpAnswers[key] = values
    }
  }

  return {
    session,
    planVersion,
    intakePack,
    intakeAnswers,
    inspiration,
    core,
    preferences,
    serviceName: identity.serviceName,
    professionalDisplayName: identity.professionalDisplayName,
    followUpAnswers,
    rounds: currentRounds.map((row) => ({
      id: row.id,
      planVersion: row.planVersion,
      round: row.round,
      status: row.status,
      createdAt: row.createdAt,
      questions: row.storedQuestions.map((question) => ({
        ...question,
        selectedValues: answeredValues(question, {
          intakeAnswers,
          roundAnswers: row.storedAnswers,
        }),
      })),
    })),
  }
}

/** The rendered state — what the thread shows and what generation gates on. */
function projectConsultFollowUpState(
  situation: FollowUpSituation,
): ConsultFollowUpState {
  let openQuestionKey: string | null = null
  for (const round of situation.rounds) {
    for (const question of round.questions) {
      if (question.selectedValues === null) {
        openQuestionKey = openQuestionKey ?? question.key
      }
    }
  }
  const newest = situation.rounds[situation.rounds.length - 1] ?? null
  return {
    rounds: situation.rounds,
    openQuestionKey,
    fallbackActive:
      newest?.status === ConsultFollowUpRoundStatus.FALLBACK &&
      newest.questions.some((question) => question.selectedValues === null),
    planVersion: situation.planVersion,
    moreRoundsAvailable: situation.rounds.length < CONSULT_MAX_FOLLOW_UP_ROUNDS,
  }
}

/** Who the pro is and what the service is called, for the prompt's first line. */
async function resolveConsultFollowUpIdentity(consultSessionId: string): Promise<{
  serviceName: string | null
  professionalDisplayName: string
}> {
  const session = await prisma.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      professionalId: true,
      anchorLookPostId: true,
      booking: {
        select: { serviceId: true, service: { select: { name: true } } },
      },
      professional: { select: professionalPublicDisplayNameSelect },
    },
  })
  if (!session) {
    return { serviceName: null, professionalDisplayName: '' }
  }
  const identity = await resolveConsultServiceIdentity(prisma, {
    professionalId: session.professionalId,
    anchorLookPostId: session.anchorLookPostId,
    booking: session.booking,
  })
  return {
    // The CLIENT-facing name, because the question is read by the client. The
    // pro-facing catalogue name is what the brief uses; using it here would put
    // the salon's word for a service into a sentence written for her.
    serviceName: identity.clientFacingName,
    professionalDisplayName: formatProfessionalPublicDisplayName(
      session.professional,
    ),
  }
}

/**
 * Her region taps, as the analysis prompt already reads them.
 *
 * 🔴 Reuses `deriveConsultInspirationPreferences` rather than re-deriving. The
 * pairs it produces (`tone:COOL`) are what P5d fed to `runConsultAnalysis` and
 * what the pro's brief renders, so a follow-up reasoning from a second
 * derivation would be a second opinion about what she tapped.
 *
 * The copy passed in is the DEFAULT brand's, deliberately: the only strings it
 * contributes are the coarse cards' labels ("The color", "My length"), which go
 * into a PROMPT and never onto a screen. Region taps — the P5g ones — need no
 * copy at all; they are attribute names and readings.
 */
function resolveConsultFollowUpPreferences(args: {
  inspirationPayload: Prisma.JsonValue | null
  reading: ConsultInspirationAnalysisAttributesDTO | null
}): ConsultInspirationClientPreferences | null {
  if (!args.inspirationPayload) return null
  const resolved = resolveConsultInspirationPayloadV2(args.inspirationPayload)
  if (!resolved) return null
  return deriveConsultInspirationPreferences({
    pack: resolved.pack,
    reading: args.reading,
    copy: defaultClientConsultInspirationCopy,
    answers: resolved.payload.answers,
  })
}

/** The vocabulary for one consult — the packs it is on, minus what she answered. */
function resolveVocabularyFor(situation: FollowUpSituation) {
  return resolveConsultFollowUpVocabulary({
    intakePack: situation.intakePack,
    intakeAnswers: situation.intakeAnswers,
    serviceName: situation.serviceName,
    followUpAnswers: situation.followUpAnswers,
  })
}

/** Everything the model is told, for one round. */
function renderContextFor(
  situation: FollowUpSituation,
  vocabulary: ReturnType<typeof resolveVocabularyFor>,
  round: number,
): string {
  return renderConsultFollowUpContext({
    professionalDisplayName: situation.professionalDisplayName,
    serviceName: situation.serviceName,
    inspiration: situation.inspiration,
    core: situation.core,
    preferences: situation.preferences,
    intakeAnswers: situation.intakeAnswers,
    followUpAnswers: situation.followUpAnswers,
    vocabulary,
    copy: defaultClientConsultInspirationCopy,
    roundNumber: round,
    maxRounds: CONSULT_MAX_FOLLOW_UP_ROUNDS,
  })
}

/** The follow-up rounds for one consult, as the thread renders them. */
export async function loadConsultFollowUpState(
  consultSessionId: string,
): Promise<ConsultFollowUpState | null> {
  const situation = await readConsultFollowUpSituation(consultSessionId)
  if (!situation) return null
  return projectConsultFollowUpState(situation)
}

// ── Answering ───────────────────────────────────────────────────────────────

export type AnswerConsultFollowUpResult = {
  state: ConsultFollowUpState
  /** True when this answer closed a round and bought the next one. */
  nextRoundCreated: boolean
}

export class ConsultFollowUpAnswerError extends Error {
  constructor(readonly code: 'NOT_OPEN' | 'INVALID_ANSWER') {
    super('Invalid follow-up answer.')
    this.name = 'ConsultFollowUpAnswerError'
  }
}

/**
 * File one answer in its own vocabulary's home, then buy the next round if
 * this answer closed one.
 *
 * 🔴 The INTAKE branch goes through `appendConsultIntakeRevision`, the same
 * write boundary the intake step itself uses — its locking, its pack pinning,
 * its payload guard, and its rerun request all apply unchanged. A follow-up
 * answer is an intake answer; the only thing P5g changed is who asked.
 *
 * 🔴 It is a REPLACE write, so the whole answer map is echoed back. A submit
 * that sent only the new key would WIPE every other answer — the failure this
 * repo has already been bitten by once.
 */
export async function answerConsultFollowUpQuestion(
  args: {
    consultSessionId: string
    clientId: string
    actor: { type: typeof ConsultActorType.CLIENT; id: string }
    questionKey: string
    selectedValues: string[]
    idempotencyKey: string
  },
  deps: ConsultFollowUpDeps = {},
): Promise<AnswerConsultFollowUpResult> {
  const now = deps.now ?? new Date()
  const situation = await readConsultFollowUpSituation(args.consultSessionId)
  if (!situation) throw new ConsultFollowUpAnswerError('NOT_OPEN')

  // 🔴 The appointment closes the document (P7a-3), and this path has to say so
  // itself. The INTAKE branch below goes through `appendConsultIntakeRevision`,
  // which enforces the window — but the FOLLOW_UP branch writes this table
  // directly, so without this a client could answer a follow-up after she was
  // already in the chair. Thrown, not swallowed: it is a real refusal with its
  // own code, and the thread reads the same rule.
  assertConsultInputOpen(situation.session, now)

  const round = situation.rounds.find((entry) =>
    entry.questions.some(
      (question) =>
        question.key === args.questionKey && question.selectedValues === null,
    ),
  )
  const question = round?.questions.find(
    (entry) => entry.key === args.questionKey,
  )
  // A key that is not an OPEN question on a CURRENT-plan round is refused
  // rather than filed. That covers an answer to a question from a superseded
  // plan version, a replayed tap, and a client that made the key up.
  if (!round || !question) throw new ConsultFollowUpAnswerError('NOT_OPEN')

  const allowed = new Set(question.options.map((option) => option.value))
  const values = [...new Set(args.selectedValues)]
  if (
    values.length !== 1 ||
    !values.every((value) => allowed.has(value))
  ) {
    // Every follow-up question is single-select: each key in both vocabularies
    // maps to exactly one stored string. Accepting two would mean inventing a
    // storage shape the safety policy cannot read.
    throw new ConsultFollowUpAnswerError('INVALID_ANSWER')
  }
  const [value] = values as [string]

  if (question.home === 'INTAKE') {
    await appendConsultIntakeRevision({
      consultSessionId: args.consultSessionId,
      actor: args.actor,
      now,
      loadInput: async () => {
        const answers = { ...situation.intakeAnswers, [question.key]: value }
        return {
          packVersion: situation.intakePack.version,
          schemaVersion: situation.intakePack.schemaVersion,
          // The server's own judgement, echoed: every REQUIRED question now
          // has an answer. The write boundary re-validates it and refuses a
          // claim made early.
          complete: situation.intakePack.questions
            .filter((entry) => entry.requirement === 'REQUIRED')
            .every((entry) => Boolean(answers[entry.key])),
          answers,
          idempotencyKey: args.idempotencyKey,
        }
      },
    })
  } else {
    await prisma.consultFollowUpRound.update({
      where: { id: round.id },
      data: {
        answers: {
          ...Object.fromEntries(
            round.questions
              .filter(
                (entry) =>
                  entry.home === 'FOLLOW_UP' && entry.selectedValues !== null,
              )
              .map((entry) => [entry.key, entry.selectedValues as string[]]),
          ),
          [question.key]: [value],
        },
        answeredAt: now,
      },
    })
  }

  const after = await readConsultFollowUpSituation(args.consultSessionId)
  const state = after
    ? projectConsultFollowUpState(after)
    : projectConsultFollowUpState(situation)

  // The BURST boundary: the round she was working through is finished, so the
  // next one is bought now. Awaited rather than backgrounded — she is looking
  // at the thread, the call is text-only and short, and its failure has a
  // designed answer (the fallback) rather than a spinner.
  let nextRoundCreated = false
  if (after && !state.openQuestionKey && state.moreRoundsAvailable) {
    const generated = await generateConsultFollowUpRound(
      {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        // Already read, one line above. See the `situation` note on that
        // function for why this is passed rather than read again.
        situation: after,
      },
      deps,
    )
    nextRoundCreated = generated.created
    if (generated.created) {
      // Projected from what we already hold plus the round just created, rather
      // than re-read. The new round is by construction unanswered, so there is
      // nothing about it a third read could tell us.
      return {
        state: projectConsultFollowUpState({
          ...after,
          rounds: [...after.rounds, generated.round],
        }),
        nextRoundCreated,
      }
    }
  }
  return { state, nextRoundCreated }
}
