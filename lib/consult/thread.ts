import { loadClientChartPhotoOffers } from './chartPhoto'
import { consultRequiresLookChoice } from './lookPlanning'
import { loadAuthorizedConsultBookingProposal } from './proposalEntry'
import 'server-only'

// lib/consult/thread.ts
//
// P5a — the consult THREAD projection ("the consult is a chat", handoff Part 2).
//
// ONE job: take the flow state the stage endpoints already serve and emit it as
// an ordered list of messages, plus the id of the single message still awaiting
// the client. That id is the whole point — "reopening a consult resumes at the
// next open step" becomes a READ here instead of four progress blockers
// re-interpreted independently on two clients.
//
// 🔴 What this file must never become:
//   - a second source of truth for flow state. Every state below comes from the
//     SAME loader the stage endpoint calls (`loadConsultIntakeState` and
//     friends), so there is nothing here to drift.
//   - a write path. It reads. Answering anything still goes through the
//     existing mutation routes, which are untouched.
//   - a re-derivation of the capture badge. The Uploading → Checking → Passed /
//     Retake ladder is resolved on the CLIENT, where the durable upload queue
//     can outrank the served slot state; the served slot is carried through
//     verbatim (decision: lift the P2d badge, do not rewrite it).
//
// Ordering rule, once, here: consent → intake → inspiration → photos → plan,
// with the booking confirmation slotted in wherever the booking actually
// happened. The client renders the list; it does not decide the order.

import { BookingDepositStatus, ConsultSessionStatus, type Prisma } from '@prisma/client'

import type {
  BrandClientConsultCaptureCopy,
  BrandClientConsultInspirationCopy,
  BrandClientConsultPlanDiffCopy,
  BrandClientConsultThreadCopy,
} from '@/lib/brand/types'
import type {
  ConsultCaptureStateDTO,
  ConsultInspirationCardDTO,
  ConsultInspirationStateDTO,
  ConsultThreadBookCtaDTO,
  ConsultThreadBookGateReasonDTO,
  ConsultThreadDTO,
  ConsultThreadControlsDTO,
  ConsultThreadMessageDTO,
  ConsultThreadMessageStateDTO,
} from '@/lib/dto/consult'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { prisma } from '@/lib/prisma'
import { formatLookStartingPrice } from '@/lib/looks/startingPrice'
import { decimalToCents, formatCents } from '@/lib/money'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  sanitizeTimeZone,
} from '@/lib/time'

import {
  loadConsultPlanVersions,
  resolveConsultRerunState,
} from './analysisRerun'
import {
  CONSULT_OPEN_WINDOW_SELECT,
  resolveConsultInputWindow,
} from './openWindow'
import { diffConsultPlans } from './planDiff'

import { loadConsultAgreementState } from './agreementContract'
import {
  CONSULT_EARLY_PHOTO_PACK_VERSION,
  CONSULT_EARLY_PHOTO_SHOT_KEY,
  EARLY_PHOTO_SHOT_DTO,
} from './capture/earlyPhoto'
import { formatConsultCaptureIntro } from './captureCopy'
import { loadConsultAnalysisState } from './analysisContract'
import {
  consultEarlyPhotoSettled,
  earlyPhotoWritable,
  guidedCaptureWritable,
  loadConsultCaptureState,
} from './captureContract'
import { loadAuthorizedClientConsultResults } from './clientResults'
import { canDeleteUnbookedConsult, resolveThreadBooking, type ConsultThreadBooking } from './bookingLink'
import { loadConsultFollowUpState } from './followUpContract'
import { loadConsultProFollowUps } from './proFollowUp'
import { loadConsultInspirationState } from './inspirationContract'
import { loadConsultIntakeState } from './intakeContract'
import { loadConsultPrepState } from './prepDeadline'
import { resolveConsultServiceIdentity } from './serviceIdentity'
import { previewConsultSparkCharge } from './sparkCharge'
import {
  consultSparkGateBlocked,
  loadConsultSparkGatePolicy,
  type ConsultSparkGatePolicy,
} from './sparkGate'
import {
  consultThreadBookPriceNote,
  consultThreadOpening,
  fillConsultThreadCopy,
} from './threadCopy'



/** Statuses that mean a consult can no longer be worked on at all. */
const STOPPED_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.CANCELLED,
])

type MessageBuilder = {
  push: (message: ConsultThreadMessageDTO) => void
}

function collector(): { messages: ConsultThreadMessageDTO[] } & MessageBuilder {
  const messages: ConsultThreadMessageDTO[] = []
  return {
    messages,
    push: (message) => {
      messages.push(message)
    },
  }
}

function text(
  id: string,
  body: string,
  state: ConsultThreadMessageStateDTO = 'DONE',
): ConsultThreadMessageDTO {
  return { kind: 'TEXT', id, author: 'APP', state, text: body }
}

/**
 * P5d — one inspiration CARD as a thread message.
 *
 * The card carries its own crop, its own words and its own question; this
 * function only decides which message id it gets and whether it is the one the
 * thread is waiting on. An ANSWERED card keeps its place in the thread, dimmed,
 * with what she chose still on it — a thread you can scroll back through is the
 * difference between a conversation and a form.
 *
 * `text` is null on purpose. The step says its piece once, on the message that
 * asks for a reference; a bubble above each of eleven cards would be eleven
 * sentences nobody asked for.
 */
function inspirationCardMessage(args: {
  card: ConsultInspirationCardDTO
  inspiration: ConsultInspirationStateDTO | null
  open: boolean
}): ConsultThreadMessageDTO {
  const answered = args.card.selectedValues.length > 0 || Boolean(args.card.selectedText)
  return {
    kind: 'INSPIRATION',
    id: `inspiration:${args.card.questionKey}`,
    author: 'APP',
    state: answered ? 'DONE' : args.open ? 'OPEN' : 'BLOCKED',
    text: null,
    sourceDecisionRequired: false,
    source: args.inspiration?.source ?? null,
    question: args.card.question,
    card: args.card,
    answeredQuestionCount: args.inspiration?.progress.answeredQuestionCount ?? 0,
    specificDetailCount: args.inspiration?.progress.specificDetailCount ?? 0,
    requiredSpecificDetailCount:
      args.inspiration?.progress.requiredSpecificDetailCount ?? 0,
    schemaVersion: args.inspiration?.schemaVersion ?? 0,
  }
}

/**
 * The consult's row plus everything the thread's chrome needs, in one read.
 *
 * The professional relation is selected through the display-name SSOT's own
 * select const, so the `nameDisplay` toggle is honored here exactly as it is in
 * messaging and search — a pro who shows as `@handle` is not suddenly named by
 * her business name because the consult wrote its own branch.
 */
const THREAD_SESSION_SELECT = {
  // P7a-3: the input-window rule's own select, so the thread can SAY that the
  // appointment closed the document rather than only refusing a tap. Spread
  // first — the narrower `booking` below is widened by it, not the reverse.
  ...CONSULT_OPEN_WINDOW_SELECT,
  id: true,
  status: true,
  clientId: true,
  createdAt: true,
  bookingId: true,
  professionalId: true,
  anchorLookPostId: true,
  // P7a-5 — which category the pro's booking gate and deposit are keyed on.
  // The category the Service row points at, as stored: `ConsultSession` and
  // `Booking` already agree on that answer (holdCreateOffering.ts), so the
  // gate the client meets here and the deposit charged at finalize read one row.
  serviceCategoryId: true,
  // Which service this consult is FOR. The opening bubble names it (handoff
  // B6: the look-based flow never did, so the client could not answer questions
  // about it), and that has to work at CONSENT_REQUIRED — before any intake
  // state exists to carry it.
  booking: {
    select: {
      ...CONSULT_OPEN_WINDOW_SELECT.booking.select,
      serviceId: true,
      // 🔴 The nested select is MERGED, not replaced. Spreading the outer one
      // and then writing `service:` again silently drops the category fields
      // the anchor rule reads — the compiler caught it, which is the whole
      // reason these selects are spread rather than hand-listed.
      service: {
        select: {
          ...CONSULT_OPEN_WINDOW_SELECT.booking.select.service.select,
          name: true,
        },
      },
    },
  },
  // The SSOT's OWN select, not a copy of its field list: the display-name rule
  // and the columns it needs travel together, and a hand-rolled twin here is
  // how a pro who shows as @handle ends up named by her business name.
  professional: { select: professionalPublicDisplayNameSelect },
} as const

/**
 * The look the CTA would book.
 *
 * A separate read because `ConsultSession.anchorLookPostId` is a plain column
 * with no relation — deliberately, so a Look keeps its own ownership and
 * publication semantics and can never be blocked by a consultation.
 */
const THREAD_LOOK_SELECT = {
  id: true,
  serviceId: true,
  primaryMediaAssetId: true,
  // P7a-5 — the number the feed already shows for this look. Mode-free by
  // design (`LookPost.priceStartingAt`), which is what makes it the honest one
  // to put on a CTA where no salon/mobile choice has been made yet.
  priceStartingAt: true,
} as const

export class ConsultThreadNotFoundError extends Error {
  constructor() {
    super('Consult thread not found.')
    this.name = 'ConsultThreadNotFoundError'
  }
}

/**
 * Load a state, but treat a lifecycle refusal as "no history to show".
 *
 * The stage loaders throw INVALID_STATE outside their own readable window — by
 * design, and the thread must not turn that into a 500. A consult in ANALYZING
 * genuinely cannot read its intake any more, and the honest rendering of that
 * is a thread with no intake history, not a broken screen.
 *
 * 🔴 Only the lifecycle refusal is swallowed. An auth or ownership failure is
 * rethrown, because those decide whether the caller may see the thread at all.
 */
async function optionalStage<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'INVALID_STATE' || code === 'AGREEMENTS_REQUIRED') return null
    throw error
  }
}

export async function loadConsultThread(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  copy: BrandClientConsultThreadCopy
  /**
   * The capture step's own copy table, whose count line is filled from the
   * SERVED pack. Kept separate from the thread's copy because it is the same
   * table both clients already mirror, and one pack-aware sentence should not
   * be rewritten per surface.
   */
  captureCopy: BrandClientConsultCaptureCopy
  /**
   * The inspiration step's own copy table. Separate for the same reason as the
   * capture one: the step's sentences belong to the step, and its catalogue
   * note is filled in on READ from a contract-v2 payload that stores only
   * enums.
   */
  inspirationCopy: BrandClientConsultInspirationCopy
  /**
   * P7a-3: the plan-diff labels. Its own table because the PRO's Brief diff
   * reads the same one — the client being told "one visit → two visits" while
   * her pro reads something else is the failure a versioned Brief exists to
   * prevent.
   */
  planDiffCopy: BrandClientConsultPlanDiffCopy
  now?: Date
}): Promise<ConsultThreadDTO> {
  const now = args.now ?? new Date()

  const session = await prisma.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: THREAD_SESSION_SELECT,
  })
  // Same no-leak rule as every other consult read: another client's consult is
  // indistinguishable from one that does not exist.
  if (!session || session.clientId !== args.clientId) {
    throw new ConsultThreadNotFoundError()
  }

  const { copy } = args
  // The display-name SSOT, with the thread's own warmer fallback — a pro with no
  // usable name token reads as "your professional", never as "Professional".
  const pro = formatProfessionalPublicDisplayName(
    session.professional,
    copy.proFallback,
  )
  const out = collector()

  // Which service this consult is about, through the SSOT the intake state
  // uses — one answer, so the bubble and the intake screen cannot name
  // different services. Null is a real state (a Look whose service row is
  // gone), and the copy then has a slot-free variant rather than a hole.
  const serviceIdentity = await resolveConsultServiceIdentity(prisma, {
    professionalId: session.professionalId,
    anchorLookPostId: session.anchorLookPostId,
    booking: session.booking,
  })
  const service = serviceIdentity.clientFacingName

  // The look the sticky CTA would book. Read once, used only by `bookCta`.
  const look = session.anchorLookPostId
    ? await prisma.lookPost.findUnique({
        where: { id: session.anchorLookPostId },
        select: THREAD_LOOK_SELECT,
      })
    : null

  const stageArgs = {
    consultSessionId: session.id,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    now,
  }

  // P7a-3: the plan is VERSIONED now, and the thread has to say which version
  // it is showing and whether a newer one is on its way. Read UP HERE because
  // the steps above the plan need the answer too — see `hasPlan`.
  // P7a-4 — the prep deadline and whether the safety answers are in. Read
  // through the SSOT rather than derived here, so the bubble she reads, the
  // reminders she gets and the flag her pro sees are one answer to one
  // question.
  const prepLoaded = await loadConsultPrepState(prisma, session.id)
  const prep = prepLoaded?.prep ?? null
  const prepTimeZone =
    sanitizeTimeZone(
      prepLoaded?.session.booking?.locationTimeZone ??
        prepLoaded?.session.inspiredBookings[0]?.locationTimeZone ??
        null,
    ) ?? DEFAULT_TIME_ZONE

  // P7a-5 — the pro's per-category setting: does she hold the slot until the
  // safety answers are in? Read here, beside the prep state the gate consumes,
  // and passed down rather than re-read — the CTA and the finalize refusal in
  // `sparkLink.ts` must be answering with the same row.
  const gatePolicy = await loadConsultSparkGatePolicy(prisma, {
    professionalId: session.professionalId,
    serviceCategoryId: session.serviceCategoryId,
  })

  const rerun = await resolveConsultRerunState(prisma, session.id)
  const versions = await loadConsultPlanVersions(session.id)
  /**
   * P7a-3 — has the appointment closed the document?
   *
   * 🔴 The thread has to SAY this, not just refuse a tap with a 409. A client
   * who opens her consult in the chair and finds every control silently inert
   * has been given a broken screen; one who is told "you're in Susie's chair
   * now, this is closed" has been given an ending. Same rule the writes use
   * (lib/consult/openWindow.ts), so the sentence and the refusal cannot drift.
   */
  const inputWindow = resolveConsultInputWindow(session, now)
  const appointmentStarted =
    !inputWindow.open && inputWindow.reason === 'APPOINTMENT_STARTED'
  /**
   * 🔴 Once a plan exists, NOTHING earlier in the thread is still "open".
   *
   * P7a-3 made intake and capture readable after completion, which is what
   * stopped the thread eating its own history — but the states those steps were
   * given were written for a world where a completed consult never rendered
   * them at all. Left alone, a finished consult resumed onto the photo request
   * for a shot she skipped weeks ago, and `nextOpenMessageId` pointed at it.
   *
   * She can still act on any of them: BLOCKED renders and is tappable on both
   * clients (see the photo-pack comment below). What it is not is the place
   * reopening the thread lands — that is the plan, which is the thing she came
   * back for.
   */
  const hasPlan = versions.length > 0

  // ── The booking, if she already took the spark ───────────────────────────
  //
  // P7a-2: this is a LINK now, not a guess. The spark CTA carries the consult
  // id through the look-booking path and the write boundary stamps
  // `sourceConsultSessionId` after validating it (lib/consult/sparkLink.ts), so
  // the question "which booking is this consult's?" has an answer stored on the
  // row instead of being re-derived from four columns that only USUALLY agree.
  const booking = await resolveThreadBooking(prisma, {
    consultSessionId: session.id,
    clientId: args.clientId,
    professionalId: session.professionalId,
    anchorLookPostId: session.anchorLookPostId,
    consultCreatedAt: session.createdAt,
  })

  const deletionBooking = session.bookingId || booking ? booking : await resolveThreadBooking(prisma, {
    consultSessionId: session.id, clientId: args.clientId, professionalId: session.professionalId,
    anchorLookPostId: session.anchorLookPostId, consultCreatedAt: session.createdAt, includePastBookings: true,
  })
  const controls: ConsultThreadControlsDTO = {
    inputsOpen: false, canEditAnswers: false,
    canDelete: canDeleteUnbookedConsult(session, deletionBooking), revokeAcceptanceId: null,
  }

  // ── Stopped ──────────────────────────────────────────────────────────────
  if (STOPPED_STATUSES.has(session.status)) {
    out.push(text('stopped', copy.stopped))
    return {
      controls,
      consultId: session.id,
      status: session.status,
      professionalId: session.professionalId,
      professionalDisplayName: pro,
      nextOpenMessageId: null,
      messages: out.messages,
      // A stopped consult has no capture window left, so no chart-copy choice.
      chartCopy: null,
      book: await resolveBookCta({
        reason: 'CONSULT_STOPPED',
        session,
        look,
        booking,
        pro,
        copy,
        clientId: args.clientId,
        actorUserId: args.actorUserId,
      }),
    }
  }

  // ── Consent ──────────────────────────────────────────────────────────────
  // Ownership was established above; this loader takes the id alone.
  const agreements = await optionalStage(() =>
    loadConsultAgreementState(session.id),
  )

  const revoked = session.status === ConsultSessionStatus.CONSENT_REVOKED
  const consentOutstanding =
    !agreements || !agreements.requirements.every((r) => Boolean(r.currentAcceptance))

  controls.inputsOpen = inputWindow.open && !consentOutstanding
  controls.canEditAnswers = controls.inputsOpen
  controls.revokeAcceptanceId = agreements?.requirements.find(r => r.kind === 'SENSITIVE_DATA_CONSENT')?.currentAcceptance?.id ?? null

  out.push(text('opening', consultThreadOpening(copy, { pro, service })))

  if (agreements) {
    out.push({
      kind: 'CONSENT',
      id: 'consent',
      author: 'APP',
      state: consentOutstanding ? 'OPEN' : 'DONE',
      text: fillConsultThreadCopy(
        revoked ? copy.consentResume : copy.consentIntro,
        { pro },
      ),
      requirements: agreements.requirements,
    })
  }

  if (consentOutstanding) {
    return finish({
      controls,
      session,
      look,
      pro,
      copy,
      out,
      booking,
      clientId: args.clientId,
      actorUserId: args.actorUserId,
      gatePolicy,
      prepComplete: prep?.complete ?? false,
    })
  }

  // ── Inspiration, coarse tier ─────────────────────────────────────────────
  //
  // 🔴 BEFORE the intake, and that is the Sept 5 flow order: the spark, then
  // "what made you stop scrolling?", then the booking. The three coarse cards
  // are three taps and they come before anything that reads like homework.
  //
  // ⚠️ THE DEPENDENCY (P7a): the inspiration step's own window is still
  // MEDIA_READY — in the contract (`MUTABLE_STATUS`) and in the database
  // (`consult_lifecycle_guard` pins an INSPIRATION revision to MEDIA_READY) —
  // and a consult only reaches MEDIA_READY once its intake is complete. So
  // TODAY these cards render above an intake she has already answered rather
  // than in front of one she has not. Ordering them here is what makes the
  // thread correct the day P7a's early-photo stage moves the window; it
  // changes nothing about resume, because at INTAKE_READY there are no
  // inspiration messages at all and at MEDIA_READY every intake message is
  // already DONE.
  const inspiration = await optionalStage(() =>
    loadConsultInspirationState({ ...stageArgs, copy: args.inspirationCopy }),
  )
  const inspirationCards = inspiration?.cards ?? []
  const coarseCards = inspirationCards.filter((card) => card.tier === 'COARSE')
  const prepCards = inspirationCards.filter((card) => card.tier === 'PREP')

  if (inspiration) {
    const { progress } = inspiration
    const complete = progress.canComplete && !progress.currentQuestion
    const sourceDecisionRequired = progress.blocker === 'SOURCE_DECISION_REQUIRED'
    // The step's own bubble and the reference itself. It stays one message —
    // this is where she adds a picture or carries on without one, and it is
    // the message the read stage's "let me have a proper look" hangs off.
    out.push({
      kind: 'INSPIRATION',
      id: 'inspiration',
      author: 'APP',
      // 🔴 For a CARD consult this message is a bubble and the reference, not a
      // step: the only thing it can be waiting on is the source decision. Left
      // OPEN it would be the first open message in the thread, so
      // `nextOpenMessageId` would resume her on a header instead of on the
      // card she still has to answer.
      state:
        coarseCards.length > 0
          ? sourceDecisionRequired
            ? 'OPEN'
            : 'DONE'
          : complete
            ? 'DONE'
            : 'OPEN',
      text: fillConsultThreadCopy(
        complete
          ? copy.inspirationDone
          : sourceDecisionRequired
            ? copy.inspirationSourceIntro
            : copy.inspirationIntro,
        { pro },
      ),
      sourceDecisionRequired,
      source: inspiration.source,
      // 🔴 The wizard question is carried ONLY for a contract-v1 consult, which
      // has no cards. A v2 consult answers on its cards; serving the same
      // question twice would render it twice and let two forms disagree.
      question: coarseCards.length > 0 ? null : progress.currentQuestion,
      card: null,
      answeredQuestionCount: progress.answeredQuestionCount,
      specificDetailCount: progress.specificDetailCount,
      requiredSpecificDetailCount: progress.requiredSpecificDetailCount,
      schemaVersion: inspiration.schemaVersion,
    })

    // One message per coarse card, in pack order. The card the server is
    // waiting on is the OPEN one; the ones after it render as requests she can
    // still jump to, exactly as the photo pack does.
    for (const card of coarseCards) {
      out.push(
        inspirationCardMessage({
          card,
          inspiration,
          open: progress.currentQuestion?.key === card.questionKey,
        }),
      )
    }
  }

  // ── The early photo ──────────────────────────────────────────────────────
  //
  // P7a-1, and it sits HERE — after the coarse cards, before the intake —
  // because this is the photo that unlocks the booking. Everything below it is
  // prep. The capture state is loaded once, at this point, and reused by the
  // guided pack further down; it is the same stage endpoint either way.
  const capture = await optionalStage(() => loadConsultCaptureState(stageArgs))
  if (capture) {
    const early = capture.earlyPhoto
    // 🔴 PURGED counts as settled. A purged capture is one that WAS accepted and
    // has since been swept — the retention window closed, or the client did not
    // opt into chart copy — and rendering it as an outstanding request would ask
    // her again for the photo that unlocked her booking.
    const settled = early?.state === 'ACCEPTED' || early?.state === 'PURGED'
    out.push({
      kind: 'PHOTO_REQUEST',
      id: `photo:${CONSULT_EARLY_PHOTO_SHOT_KEY}`,
      ...(controls.inputsOpen && !settled && earlyPhotoWritable(session.status) ? { chartPhotos: await loadClientChartPhotoOffers(stageArgs) } : {}),
      author: 'APP',
      // The only step that can be open before the booking; there is nothing
      // ahead of it to wait for. Once a plan exists it is history, not a step.
      state: settled ? 'DONE' : hasPlan ? 'BLOCKED' : 'OPEN',
      // 🔴 Its own predicate, not the pack's: the early photo may be taken in
      // the early stage AND replaced later, which is exactly why one shared
      // "is capture open" flag would be wrong for one of the two.
      shootable: controls.inputsOpen && earlyPhotoWritable(session.status),
      shot: EARLY_PHOTO_SHOT_DTO,
      shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION,
      schemaVersion: capture.shotPack.schemaVersion,
      slot: early ?? {
        shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
        state: 'EMPTY' as const,
        captureId: null,
        qualityReasonCode: null,
        qualityWarningCode: null,
        retakeTip: null,
        rawExpiresAt: null,
        purgedAt: null,
        attemptCount: 0,
        previousReasonCode: null,
      },
    })
  }

  // ── Intake ───────────────────────────────────────────────────────────────
  const intake = await optionalStage(() => loadConsultIntakeState(stageArgs))
  const chartReviewOpen = Boolean(intake?.chartReview && inputWindow.open)
  if (intake) {
    const answers = intake.latestRevision?.answers ?? {}
    // 🔴 `progress.nextQuestionKey` goes NULL the moment every REQUIRED question
    // (and the conditional goal direction) is answered — it never names a
    // SKIPPABLE one. Following it alone therefore stops asking optional
    // questions altogether, which is a question the client is simply never
    // shown. The wizard this replaced fell back to "the first unanswered
    // question" for exactly that reason, and the fallback comes with it.
    //
    // The server still owns COMPLETENESS: `canComplete` is what the submit
    // echoes, and an optional question left unanswered never blocks it.
    const nextKey =
      intake.progress.nextQuestionKey ??
      intake.questionPack.questions.find((entry) => !answers[entry.key])?.key ??
      null
    out.push(text('intake-intro', copy.intakeIntro))
    if (intake.chartReview && chartReviewOpen) {
      const review = intake.chartReview
      out.push({ kind: 'QUESTION', id: 'chart-review', author: 'APP', state: 'OPEN', answer: null,
        packVersion: intake.questionPack.version, schemaVersion: intake.questionPack.schemaVersion,
        chartReviewFingerprint: review.fingerprint,
        question: { key: 'chart_review', kind: 'SINGLE_SELECT', requirement: 'REQUIRED',
          label: fillConsultThreadCopy(copy.chartReviewQuestion, { date: formatInTimeZone(review.lastVisitAt, DEFAULT_TIME_ZONE,
            { month: 'long', day: 'numeric', year: 'numeric' }) }),
          helpText: [copy.chartReviewSummary, ...review.facts.map(fact => `${fact.label} ${fact.answer} (${formatInTimeZone(fact.recordedAt, DEFAULT_TIME_ZONE,
            { month: 'long', day: 'numeric', year: 'numeric' })})`)].join(' '),
          options: [{ value: 'CONFIRMED', label: copy.chartReviewConfirm },
            ...(review.facts.some(fact => fact.questionKey === 'box_dye_history') ? [{ value: 'BOX_DYE_ONLY', label: copy.chartReviewBoxDyeOnly }] : []),
            { value: 'CHANGED', label: copy.chartReviewChanged }],
        },
      })
    }


    for (const question of intake.questionPack.questions) {
      const answer = answers[question.key] ?? null
      // Everything after the open question is still unasked — a thread shows
      // what has happened and the one thing being asked, never a form's worth
      // of questions the client has not reached.
      if (answer === null && (question.key !== nextKey || chartReviewOpen)) continue
      const chartSuggestion = answer === null ? intake.prefillSuggestions.find(suggestion =>
        suggestion.questionKey === question.key && suggestion.provenance.some(source => source.source === 'CHART_FACT')) : undefined
      const chartSource = chartSuggestion?.provenance.find(source => source.source === 'CHART_FACT')
      const chartAnswer = question.options.find(option => option.value === chartSuggestion?.value)
      out.push({
        kind: 'QUESTION',
        id: `intake:${question.key}`,
        author: 'APP',
        // An unanswered OPTIONAL question on a consult that already has a plan
        // is history she may still fill in, not a step she owes anyone.
        state:
          question.key !== nextKey
            ? 'DONE'
            : hasPlan
              ? 'BLOCKED'
              : 'OPEN',
        ...(chartSource?.sourceId ? { chartFactSourceId: chartSource.sourceId } : {}),
        question: chartSource?.recordedAt && chartAnswer ? { ...question,
          helpText: fillConsultThreadCopy(copy.chartHistoryConfirmation, {
            date: formatInTimeZone(chartSource.recordedAt, DEFAULT_TIME_ZONE, { month: 'long', day: 'numeric', year: 'numeric' }), answer: chartAnswer.label,
          }),
          options: [chartAnswer, ...question.options.filter(option => option.value !== chartAnswer.value)],
        } : question,
        answer,
        packVersion: intake.questionPack.version,
        schemaVersion: intake.questionPack.schemaVersion,
      })
    }

    if (!nextKey && intake.progress.canComplete) {
      out.push(text('intake-done', copy.intakeDone))
    }
  }

  // ── Photos, the guided pack ──────────────────────────────────────────────
  //
  // Prep. Uses the capture state already loaded above the intake.
  //
  // 🔴 GATED ON THE WRITE BOUNDARY'S OWN ANSWER (P3b). `capture` loads at
  // EARLY_PHOTO_READY — it has to, because the early photo lives in the same
  // stage — and this block used to run whenever it loaded. So all seven guided
  // requests were served before the guided stage existed, both clients drew a
  // working camera on them, and `assertCaptureWriteState` refused the upload
  // that came back. On Tori's phone that surfaced as "This consult changed.
  // Return to your appointment and try again" on a shot the thread had just
  // asked her for, twice.
  //
  // The fix is not a second status check here. It is asking the function the
  // write boundary itself asks, so the offer and the permission cannot drift.
  if (capture && !guidedCaptureWritable(session.status)) {
    // Not silence: she should know the photos are coming, just not now. One
    // bubble, in place of the pack — nothing shootable, nothing to fail at.
    out.push(text('capture-locked', copy.captureLockedBeforeBooking))
  }
  if (capture && guidedCaptureWritable(session.status)) {
    // 🔴 The intro names the PACK's own counts, and it must keep doing so. The
    // thread shows every photo request as its own message, so she can see them —
    // but the sentence that says "three of your hair and two of your face" is
    // what stops a nails consult (three shots) reading hair copy and waiting for
    // four slots that will never appear. That is the whole reason
    // `formatConsultCaptureIntro` exists, so it is reused rather than replaced
    // by a fixed sentence.
    out.push(
      text(
        'capture-intro',
        `${copy.captureIntro} ${formatConsultCaptureIntro(args.captureCopy, capture.shotPack)}`,
      ),
    )
    const slots = new Map(capture.slots.map((slot) => [slot.shotKey, slot]))
    let firstOpenShot = true
    for (const shot of capture.shotPack.shots) {
      // The server serves a slot per shot in the pack; a missing one would mean
      // the pack and the slot list disagree, and an EMPTY stand-in is the honest
      // rendering of "nothing sent yet" rather than a dropped photo request.
      const slot = slots.get(shot.key) ?? {
        shotKey: shot.key,
        state: 'EMPTY' as const,
        captureId: null,
        qualityReasonCode: null,
        qualityWarningCode: null,
        retakeTip: null,
        rawExpiresAt: null,
        purgedAt: null,
        attemptCount: 0,
        previousReasonCode: null,
      }
      // PURGED is settled here for the same reason it is on the early photo.
      const settled = slot.state === 'ACCEPTED' || slot.state === 'PURGED'
      // Only the FIRST outstanding photo is the open step. The rest are still
      // requests — they render, and she can jump to any of them, but resume
      // lands on one place. Once a plan exists, none of them is that place.
      const open = !settled && firstOpenShot && !hasPlan
      if (open) firstOpenShot = false
      out.push({
        kind: 'PHOTO_REQUEST',
        id: `photo:${shot.key}`,
        author: 'APP',
        state: settled ? 'DONE' : open ? 'OPEN' : 'BLOCKED',
        shot,
        shotPackVersion: capture.shotPack.version,
        schemaVersion: capture.shotPack.schemaVersion,
        slot,
        // The stage and appointment window must both permit another photo.
        // Message state still only determines the next step in the thread.
        shootable: controls.inputsOpen && guidedCaptureWritable(session.status),
      })
    }
    const accepted = capture.slots.filter((s) => s.state === 'ACCEPTED').length
    if (accepted === capture.shotPack.shots.length) {
      out.push(text('capture-done', copy.captureDone))
    } else if (accepted > 0) {
      out.push(text('capture-partial', copy.capturePartial))
    }
  }

  // ── Plan ─────────────────────────────────────────────────────────────────
  const analysis = await optionalStage(() => loadConsultAnalysisState(stageArgs))
  const results =
    session.status === ConsultSessionStatus.COMPLETED
      ? await optionalStage(() =>
          loadAuthorizedClientConsultResults({
            consultSessionId: session.id,
            clientId: args.clientId,
            actorUserId: args.actorUserId,
          }),
        )
      : null

  if (analysis || results) {
    const awaitingStart =
      analysis?.status === ConsultSessionStatus.ANALYSIS_PENDING
    // 🔴 An update in flight outranks "here is your plan". Showing planReady
    // over a plan she has already told us is out of date is the thread lying
    // about the most expensive thing in it.
    const updating = rerun.pending && Boolean(results)
    out.push({
      kind: 'PLAN',
      id: 'plan',
      author: 'APP',
      state: results ? 'DONE' : awaitingStart ? 'OPEN' : 'BLOCKED',
      text: fillConsultThreadCopy(
        updating
          ? copy.planUpdating
          : results
            ? copy.planReady
            : awaitingStart
              ? copy.planAwaitingStart
              : copy.planRunning,
        { pro },
      ),
      run: analysis?.run ?? null,
      results,
      awaitingStart,
      planVersion: versions.length,
      updatePending: rerun.pending,
      schemaVersion: analysis?.schemaVersion ?? null,
      promptVersion: analysis?.promptVersion ?? null,
    })

    // ── "Plan updated", one bubble per version after the first ────────────
    //
    // AFTER the plan card, which is the thread's ordering rule everywhere: the
    // card is the current state, and what follows it is what has happened
    // since. Scrolling back through them reads as the history of a plan being
    // worked out together, which is exactly what it is.
    //
    // 🔴 An empty diff still renders, with its own sentence. A rerun that
    // changed nothing is a real outcome — "I looked again and it still holds"
    // — and swallowing it would make her edit look ignored.
    for (let index = 1; index < versions.length; index += 1) {
      const previous = versions[index - 1]
      const current = versions[index]
      // A null payload only happens on the single-version fast path, which this
      // loop never enters — but skipping is the honest guard, not a cast.
      if (!previous?.analysis || !current?.analysis) continue
      const changes = diffConsultPlans({
        previous: previous.analysis,
        next: current.analysis,
        copy: args.planDiffCopy,
      })
      out.push({
        kind: 'PLAN_UPDATE',
        id: `plan-update:${current.revisionId}`,
        author: 'APP',
        state: 'DONE',
        text: fillConsultThreadCopy(
          changes.length > 0 ? copy.planUpdated : copy.planUnchanged,
          { pro },
        ),
        planVersion: index + 1,
        previousPlanVersion: index,
        changes,
        createdAt: current.createdAt.toISOString(),
      })
    }

    // Why no more updates are coming, when that is the case. Said once, at the
    // bottom, rather than as a disabled control she has to go looking for.
    if (!rerun.moreVersionsAvailable && versions.length > 1) {
      out.push(
        text(
          'plan-update-limit',
          fillConsultThreadCopy(copy.planUpdateLimitReached, { pro }),
        ),
      )
    } else if (rerun.pending && rerun.photosExpired) {
      out.push(text('plan-needs-photo', copy.planNeedsPhoto))
    }
  }

  if (appointmentStarted) {
    out.push(
      text(
        'appointment-started',
        fillConsultThreadCopy(copy.appointmentStarted, { pro }),
      ),
    )
  }

  // ── Booked, and everything after it is prep ──────────────────────────────
  if (booking) {
    out.push({
      kind: 'BOOKING',
      id: `booking:${booking.id}`,
      author: 'APP',
      state: 'DONE',
      // P7a-5 — the deposit, said out loud at the moment it becomes real.
      //
      // 🔴 Appended to the EXISTING bubble rather than pushed as a new one. A
      // new message kind would need three landings across two repos to ship
      // (the cross-repo fixture guard fails a new union member in BOTH
      // directions); a longer sentence in a kind both clients already render
      // needs none. Same reasoning P7a-4 recorded for its deadline bubble.
      //
      // The amount is `depositAmount` off the booking — the number actually
      // stamped and charged — so a PERCENT deposit, which the CTA could only
      // honestly show as a percentage, becomes a real dollar figure here.
      text: consultThreadBookedText(copy, { pro, booking }),
      bookingId: booking.id,
    })
    out.push(text('prep-intro', fillConsultThreadCopy(copy.prepIntro, { pro })))

    // ── P7a-4: the safety answers, and when they are due ───────────────────
    //
    // 🔴 A TEXT bubble, not a message kind of its own. A new member of the
    // ConsultThreadMessageDTO union fails the cross-repo fixture guard in BOTH
    // directions and needs three landings to ship (iOS property → web schema →
    // iOS fixture); a new sentence in an existing kind needs none, and this is
    // a sentence. iOS renders it today with no change at all.
    //
    // Derived on every read, so it is never stale: the bubble flips the moment
    // the last answer lands, from the same rule that stops the reminders
    // (lib/consult/prepDeadline.ts). One rule, so the thread and her inbox
    // cannot disagree about whether she is finished.
    if (prep) {
      if (prep.complete) {
        out.push(
          text('prep-complete', fillConsultThreadCopy(copy.prepComplete, { pro })),
        )
      } else if (prep.deadlineAt) {
        out.push(
          text(
            'prep-deadline',
            fillConsultThreadCopy(copy.prepDeadlineDue, {
              pro,
              deadline: formatInTimeZone(prep.deadlineAt, prepTimeZone, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }),
            }),
          ),
        )
      }
    }
  }

  // A result-first look resolves visual details before reserving its work.
  if (booking || results?.lookPlan) {
    // ── Inspiration, prep tier ─────────────────────────────────────────────
    //
    // AFTER the booking, because that is what they are for: "help {pro} get
    // ready". One card per attribute the reference was actually read as, so a
    // consult whose reading settled three things asks three cards and one that
    // could not be read asks none — the list is never padded out.
    //
    // Only the FIRST unanswered one is open. The rest render and are tappable
    // (she can answer them in any order — the write path allows it) but resume
    // lands on one place, the same rule the photo pack follows.
    for (const card of prepCards) {
      out.push(
        inspirationCardMessage({
          card,
          inspiration,
          open: inspiration?.progress.nextPrepQuestionKey === card.questionKey,
        }),
      )
    }
    // The moment the provisional price firms up. Derived, not written: P5a is
    // presentation only, so this ANNOUNCES that an estimate now exists — it does
    // not reprice the booking. That write is the next slice.
    if (results && booking) {
      out.push(
        text(
          'estimate-ready',
          fillConsultThreadCopy(copy.estimateReady, { pro }),
        ),
      )
    }

    // ── The adaptive follow-ups ────────────────────────────────────────────
    //
    // P5g, and they sit LAST because that is what they are made of: a follow-up
    // is generated from the reference reading, her own photo reading and every
    // answer above it, so a question here could not have been asked earlier
    // even in principle.
    //
    // 🔴 One card at a time. The generated round holds up to three questions
    // and the thread opens only the FIRST unanswered one — the rest render as
    // history she has not reached, the same rule the photo pack follows. A
    // round is BOUGHT when its last question is answered, so showing all three
    // at once would let her answer them out of order and spend the next round
    // on a question the model wrote before it had her answer.
    const followUp = await optionalStage(() => loadConsultFollowUpState(session.id))
    if (followUp && followUp.rounds.length > 0) {
      out.push(text('follow-up-intro', fillConsultThreadCopy(copy.followUpIntro, { pro })))
      let saidFallback = false
      for (const round of followUp.rounds) {
        // 🔴 Said out loud, once, above the round it explains. A client being
        // asked the essentials instead of the clever question is told why —
        // Part 0 rule 4, which forbids a fallback she cannot see.
        if (round.status === 'FALLBACK' && !saidFallback) {
          saidFallback = true
          out.push(
            text(
              `follow-up-fallback:${round.round}`,
              fillConsultThreadCopy(copy.followUpFallback, { pro }),
            ),
          )
        }
        for (const question of round.questions) {
          if (chartReviewOpen && question.selectedValues === null) continue
          const open = followUp.openQuestionKey === question.key
          const suggestion = question.selectedValues === null ? intake?.prefillSuggestions.find(item => item.questionKey === question.key) : undefined
          const source = suggestion?.provenance.find(item => item.source === 'CHART_FACT')
          const answer = question.options.find(option => option.value === suggestion?.value)

          out.push({
            kind: 'FOLLOW_UP',
            id: `follow-up:${round.round}:${question.key}`,
            author: 'APP',
            state:
              question.selectedValues !== null ? 'DONE' : open ? 'OPEN' : 'BLOCKED',
            ...(source?.sourceId ? { chartFactSourceId: source.sourceId } : {}),
            text: source?.recordedAt && answer ? `${question.text} ${fillConsultThreadCopy(copy.chartHistoryConfirmation, {
              date: formatInTimeZone(source.recordedAt, DEFAULT_TIME_ZONE, { month: 'long', day: 'numeric', year: 'numeric' }), answer: answer.label,
            })}` : question.text,
            questionKey: question.key,
            options: question.options.map((option) => ({ ...option })),
            selectedValues: question.selectedValues ?? [],
            fallback: round.status === 'FALLBACK',
            round: round.round,
          })
        }
      }
      // Why nothing more is coming, when that is the case. Said at the bottom
      // rather than left as an absence she has to interpret.
      if (!followUp.openQuestionKey && !followUp.moreRoundsAvailable) {
        out.push(
          text('follow-up-done', fillConsultThreadCopy(copy.followUpDone, { pro })),
        )
      }
    }
  }

  // ── A question the professional wrote herself (C2-4) ─────────────────────
  //
  // Rendered as the SAME card as a model follow-up, with her name as its
  // eyebrow, and answered through the same route — see lib/consult/proFollowUp.ts
  // for why. Every open one is OPEN at once: they are independent, and
  // `nextOpenMessageId` still lands her on the first, which is where the
  // notification says it will. Sits outside the booking block on purpose: a
  // pro can ask from any Brief she is authorised to read, booked or not.
  const proQuestions = await optionalStage(() => loadConsultProFollowUps(prisma, session.id))
  if (proQuestions && proQuestions.length > 0) {
    const needed = proQuestions.some(
      question => question.selectedValue === null && question.priority === 'NEED_BEFORE_APPOINTMENT',
    )
    out.push(text('pro-follow-up-intro',
      fillConsultThreadCopy(needed ? copy.proFollowUpIntroNeeded : copy.proFollowUpIntro, { pro })))
    for (const question of proQuestions) {
      out.push({
        kind: 'FOLLOW_UP',
        id: `pro-follow-up:${question.questionKey}`,
        author: 'APP',
        state: question.selectedValue !== null ? 'DONE' : 'OPEN',
        text: question.text,
        attribution: fillConsultThreadCopy(copy.proFollowUpAttribution, { pro }),
        questionKey: question.questionKey,
        options: question.options.map(option => ({ ...option })),
        selectedValues: question.selectedValue ? [question.selectedValue] : [],
        fallback: false,
        round: 0,
      })
    }
    if (proQuestions.every(question => question.selectedValue !== null)) {
      out.push(text('pro-follow-up-done', fillConsultThreadCopy(copy.proFollowUpDone, { pro })))
    }
  }

  if (results?.lookPlan) {
    const planIndex = out.messages.findIndex(message => message.kind === 'PLAN')
    const pendingIndex = out.messages.findIndex(message => message.state === 'OPEN' &&
      (message.kind === 'QUESTION' || message.kind === 'PHOTO_REQUEST'))
    if (pendingIndex >= 0 && planIndex > pendingIndex) {
      const [planMessage] = out.messages.splice(planIndex, 1)
      if (planMessage) out.messages.splice(pendingIndex, 0, planMessage)
    }
  }

  return finish({
    controls,
    session,
    look,
    pro,
    copy,
    out,
    booking,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    gatePolicy,
    prepComplete: prep?.complete ?? false,
    capture,
  })
}

type ThreadLook = Prisma.LookPostGetPayload<{
  select: typeof THREAD_LOOK_SELECT
}> | null

async function finish(args: {
  controls: ConsultThreadControlsDTO
  session: {
    id: string
    status: ConsultSessionStatus
    professionalId: string
    anchorLookPostId: string | null
  }
  look: ThreadLook
  pro: string
  copy: BrandClientConsultThreadCopy
  out: { messages: ConsultThreadMessageDTO[] }
  booking: ConsultThreadBooking | null
  /** The client, for the deposit preview's relationship-aware resolution. */
  clientId: string
  actorUserId: string
  /** P7a-5 — the pro's setting for this consult's category, or null for none. */
  gatePolicy: ConsultSparkGatePolicy | null
  /** P7a-5 — `deriveConsultPrepState().complete`, the gate for AFTER_PREP. */
  prepComplete: boolean
  /**
   * The capture state, when the step is readable. Its slots decide the sticky
   * CTA's gate, and its chart-copy choice rides on the thread root.
   */
  capture?: ConsultCaptureStateDTO | null
}): Promise<ConsultThreadDTO> {
  // What unlocks the sticky CTA: one accepted early photo (P7a-1).
  //
  // Read off its own field, not out of `slots` — the early photo belongs to no
  // pack. A WARNED photo counts: a warning only ever rides on an ACCEPTED
  // capture, so "accepted or warned" is one condition, and for this shot
  // warnings are the NORMAL outcome (dim room, warm lamp, odd crop).
  //
  // This was `face_front` out of `slots` before P7a. That worked — every pack
  // does contain `face_front`, the area pack included (it imports the hair
  // pack's shot object rather than declaring one, which is easy to miss when
  // reading the file). It moved because the guided pack is PREP now: it is not
  // served until the intake is done, so gating the booking on one of its slots
  // would have put the whole intake in front of the spark, which is the exact
  // ordering P7a exists to undo.
  // 🔴 The stage's answer FIRST, the database's answer only when the stage has
  // none. The capture stage stops being readable once the intake begins, so
  // `capture` goes null there and reading the slot alone re-locked the CTA on
  // SELFIE_REQUIRED — telling a client to send a photo she had already sent,
  // with no way to send it again. `consultEarlyPhotoSettled` asks the row.
  //
  // PURGED and EXPIRED count for the same reason PURGED counts on the photo
  // request above: both describe a photo that WAS accepted and has since been
  // swept, and retention running is not something the client did.
  const earlyPhotoState = args.capture?.earlyPhoto?.state
  const selfieIn =
    earlyPhotoState === 'ACCEPTED' ||
    earlyPhotoState === 'PURGED' ||
    earlyPhotoState === 'EXPIRED' ||
    (args.capture == null &&
      (await consultEarlyPhotoSettled(prisma, args.session.id)))

  // P7a-5 — the pro's gate, second in line behind the selfie.
  //
  // Order is not arbitrary: the early photo comes BEFORE the intake in this
  // thread, so when neither is done the honest next step to name is the photo.
  // Prep surfaces once that is in, which is also when she can act on it — the
  // intake messages are right there, above the button.
  const prepBlocked = consultSparkGateBlocked({
    policy: args.gatePolicy,
    prepComplete: args.prepComplete,
  })

  const book = await resolveBookCta({
    reason: selfieIn ? (prepBlocked ? 'PREP_REQUIRED' : null) : 'SELFIE_REQUIRED',
    session: args.session,
    look: args.look,
    booking: args.booking,
    pro: args.pro,
    copy: args.copy,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
  })

  return {
    controls: args.controls,
    consultId: args.session.id,
    status: args.session.status,
    professionalId: args.session.professionalId,
    professionalDisplayName: args.pro,
    nextOpenMessageId:
      args.out.messages.find((m) => m.state === 'OPEN')?.id ?? null,
    messages: args.out.messages,
    chartCopy: args.capture?.chartCopy ?? null,
    book,
  }
}

/**
 * The sticky CTA's state.
 *
 * Decided here rather than on each client so the two cannot disagree about when
 * the spark is bookable. `enabled` deliberately does not wait for the analysis:
 * booking runs the ordinary look-booking path, and the analysis takes ~100s,
 * which is longer than a spark lasts.
 */
/**
 * The booking confirmation bubble, plus its deposit sentence when there is one.
 *
 * PENDING is deliberately included: a deposit checkout that has been created
 * and not yet paid is still money she is about to be asked for, and a
 * confirmation that stayed silent about it would be the same surprise this
 * slice exists to remove. A REFUNDED, FAILED or NONE deposit says nothing —
 * there is no held money to describe.
 */
function consultThreadBookedText(
  copy: BrandClientConsultThreadCopy,
  args: { pro: string; booking: ConsultThreadBooking },
): string {
  const booked = fillConsultThreadCopy(copy.booked, { pro: args.pro })
  const status = args.booking.depositStatus
  if (status !== BookingDepositStatus.PAID && status !== BookingDepositStatus.PENDING) {
    return booked
  }

  const cents = decimalToCents(args.booking.depositAmount)
  if (cents == null || cents <= 0) return booked

  return `${booked} ${fillConsultThreadCopy(copy.bookedDepositNote, {
    amount: formatCents(cents),
  })}`
}

async function resolveBookCta(args: {
  reason: ConsultThreadBookGateReasonDTO | null
  session: { id: string; anchorLookPostId: string | null; professionalId: string }
  look: ThreadLook
  booking: ConsultThreadBooking | null
  pro: string
  copy: BrandClientConsultThreadCopy
  clientId: string
  actorUserId: string
}): Promise<ConsultThreadBookCtaDTO> {
  const { look, copy } = args
  const base = {
    lookPostId: args.session.anchorLookPostId,
    serviceId: look?.serviceId ?? null,
    lookMediaId: look?.primaryMediaAssetId ?? null,
  }
  /** A CTA with nothing to say about money or about a gate she can clear. */
  const quiet = { ...base, priceNote: null, gateNote: null }

  // A booking-anchored consult already HAS its appointment; a look that names no
  // service has nothing for the ordinary path to book. Both are refusals with a
  // reason rather than a button that fails one screen later.
  //
  // 🔴 None of these four disclose a price, and that is a decision rather than
  // an omission: there is no tap here to disclose anything ABOUT. A booked
  // client's money lives on her booking; a look nobody can book has no charge
  // to warn her of. It also keeps `previewConsultSparkCharge` — eight indexed
  // reads — off every state that cannot use the answer, including the
  // ALREADY_BOOKED state that the 5s analysis poll refetches every tick.
  if (!args.session.anchorLookPostId) {
    return { enabled: false, reason: 'NOT_LOOK_ANCHORED', ...quiet }
  }
  if (args.booking) {
    return { enabled: false, reason: 'ALREADY_BOOKED', ...quiet }
  }
  if (!look?.serviceId) {
    return { enabled: false, reason: 'LOOK_NOT_BOOKABLE', ...quiet }
  }
  if (args.reason === 'CONSULT_STOPPED') {
    return { enabled: false, reason: args.reason, ...quiet }
  }

  if (await consultRequiresLookChoice(prisma, args.session.id)) {
    const version = await prisma.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.session.id }, orderBy: { version: 'desc' },
      select: { selectedLocationType: true } })
    if (version?.selectedLocationType) {
      try {
        const answer = await loadAuthorizedConsultBookingProposal({ consultSessionId: args.session.id, clientId: args.clientId,
          actorUserId: args.actorUserId, locationType: version.selectedLocationType, enhancementSelection: [] })
        if (answer.available && answer.proposal) return { ...quiet, enabled: true, reason: null,
          serviceId: answer.proposal.serviceId, proposalConsultId: args.session.id, priceNote: answer.proposal.startingAtLabel }
      } catch {
        // A stale/unavailable plan cannot restore the reference-service shortcut.
      }
    }
    return { ...quiet, enabled: false, reason: 'LOOK_CHOICE_REQUIRED',
      gateNote: 'Confirm the remaining details and choose your look before booking.' }
  }

  // Live, or held only by something she can clear herself in this same thread.
  // Both get the money line: a client about to answer three questions so she
  // can book deserves to know a deposit is waiting on the other side of them,
  // not to find out after she has done the work.
  const charge = await previewConsultSparkCharge({
    clientId: args.clientId,
    clientUserId: args.actorUserId,
    professionalId: args.session.professionalId,
    serviceId: look.serviceId,
    lookPostId: args.session.anchorLookPostId,
  })

  const priceNote = consultThreadBookPriceNote(copy, {
    priceLabel: formatLookStartingPrice(look.priceStartingAt),
    charge,
  })

  if (args.reason === 'PREP_REQUIRED') {
    return {
      enabled: false,
      reason: 'PREP_REQUIRED',
      ...base,
      priceNote,
      // Filled HERE because it names the pro — the thread's standing rule that
      // a sentence carrying a slot is composed by the server and rendered
      // verbatim by both clients (lib/consult/threadCopy.ts).
      gateNote: fillConsultThreadCopy(copy.bookCtaPrepRequired, { pro: args.pro }),
    }
  }

  if (args.reason) {
    return { enabled: false, reason: args.reason, ...base, priceNote, gateNote: null }
  }

  return { enabled: true, reason: null, ...base, priceNote, gateNote: null }
}
