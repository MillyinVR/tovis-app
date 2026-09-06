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

import { BookingStatus, ConsultSessionStatus } from '@prisma/client'

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
  ConsultThreadMessageDTO,
  ConsultThreadMessageStateDTO,
} from '@/lib/dto/consult'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { prisma } from '@/lib/prisma'

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
import { loadConsultCaptureState } from './captureContract'
import { loadAuthorizedClientConsultResults } from './clientResults'
import { loadConsultInspirationState } from './inspirationContract'
import { loadConsultIntakeState } from './intakeContract'
import { resolveConsultServiceIdentity } from './serviceIdentity'
import { consultThreadOpening, fillConsultThreadCopy } from './threadCopy'



/** Statuses that mean a consult can no longer be worked on at all. */
const STOPPED_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.CANCELLED,
])

/**
 * Bookings that count as "she booked this look, and it is still ahead of her".
 *
 * 🔴 CANCELLED and COMPLETED are both excluded, for the same reason and it is
 * not tidiness. The booking message says "you're on Susie's calendar" and the
 * sticky CTA hides itself on `ALREADY_BOOKED` — so counting an appointment that
 * no longer exists, or one that already happened, tells her something false AND
 * takes the Book button away with no way to get it back. A consult whose
 * appointment is over is a consult she can book from again.
 */
const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
]

/**
 * The instant the explicit link went live, if it has been configured.
 *
 * Unset is the honest default: before the deploy there IS no cutover, and
 * inventing one would either blind the fallback to real legacy bookings or
 * pretend the link existed before it did. Once P7a-2 is deployed, set
 * `CONSULT_SPARK_LINK_CUTOVER_AT` to that deploy's instant (ISO-8601) and the
 * fallback narrows to exactly the pre-existing population it is for.
 *
 * A malformed value is treated as unset rather than throwing — the thread is a
 * read path, and a typo in an env var must not take the client's consult down.
 * It is logged so the typo is findable.
 */
function consultSparkLinkCutoverAt(): Date | null {
  const raw = process.env.CONSULT_SPARK_LINK_CUTOVER_AT?.trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    console.warn('CONSULT_SPARK_LINK_CUTOVER_AT is not a valid date', { raw })
    return null
  }
  return parsed
}

/**
 * Which booking is this consult's — asked of the LINK first, the old inference
 * second.
 *
 * P7a-2. The link is `Booking.sourceConsultSessionId`, stamped by the write
 * boundary after `resolveConsultSparkLink` checked that the booking's pro, look
 * and client actually match the consult. A partial unique index makes at most
 * one LIVE booking hold it, so there is nothing to disambiguate and no
 * `orderBy` that could quietly pick the wrong row.
 *
 * 🔴 The fallback exists for ONE population: bookings created before this
 * shipped, which carry no link and never will. It is P5a's inference with two
 * deliberate narrowings — its `sourceConsultSessionId` OR arm is gone (the link
 * query above owns that case now) and it matches only rows where that column is
 * NULL, so it can never take a booking that belongs to a different consult.
 *
 * It is NOT a safety net for the new path: a spark booking that failed to link
 * is a bug that must stay visible. Set `CONSULT_SPARK_LINK_CUTOVER_AT` to the
 * deploy instant once this is live and the fallback additionally stops being
 * able to see anything the link path could have handled — see
 * `consultSparkLinkCutoverAt`.
 *
 * Every fallback hit is logged so the retirement has a date rather than a
 * feeling. When this stops firing in prod, delete everything below the link
 * query. (`LIVE_BOOKING_STATUSES` stays — the link query uses it too.)
 */
async function resolveThreadBooking(
  db: typeof prisma,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    anchorLookPostId: string | null
    consultCreatedAt: Date
  },
): Promise<{ id: string } | null> {
  const linked = await db.booking.findFirst({
    where: {
      sourceConsultSessionId: args.consultSessionId,
      status: { in: LIVE_BOOKING_STATUSES },
    },
    select: { id: true },
  })
  if (linked) return linked

  // No link. Only a LOOK-anchored consult ever had an inference to fall back
  // to; a booking-anchored one reads its appointment off its own anchor.
  if (!args.anchorLookPostId) return null

  const cutover = consultSparkLinkCutoverAt()

  const legacy = await db.booking.findFirst({
    where: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      status: { in: LIVE_BOOKING_STATUSES },
      sourceLookPostId: args.anchorLookPostId,
      // Unlinked only. A booking that HAS a link belongs to whichever consult
      // the boundary validated it against, and it is not this one.
      sourceConsultSessionId: null,
      // The P5a window, unchanged: at or after this consult began. Plus, when
      // the cutover is configured, strictly before the link path shipped — so
      // the fallback can never quietly cover for a spark booking that should
      // have linked and didn't.
      createdAt: cutover
        ? { gte: args.consultCreatedAt, lt: cutover }
        : { gte: args.consultCreatedAt },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })

  if (legacy) {
    // Telemetry, not an error: this is the retirement signal for the fallback.
    console.warn('consult-thread booking resolved by LEGACY inference', {
      consultSessionId: args.consultSessionId,
      bookingId: legacy.id,
      anchorLookPostId: args.anchorLookPostId,
      cutoverConfigured: cutover !== null,
    })
  }

  return legacy
}

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
  const answered = args.card.selectedValues.length > 0
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
  // Which service this consult is FOR. The opening bubble names it (handoff
  // B6: the look-based flow never did, so the client could not answer questions
  // about it), and that has to work at CONSENT_REQUIRED — before any intake
  // state exists to carry it.
  booking: {
    select: {
      ...CONSULT_OPEN_WINDOW_SELECT.booking.select,
      serviceId: true,
      service: { select: { name: true } },
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

  // ── Stopped ──────────────────────────────────────────────────────────────
  if (STOPPED_STATUSES.has(session.status)) {
    out.push(text('stopped', copy.stopped))
    return {
      consultId: session.id,
      status: session.status,
      professionalId: session.professionalId,
      professionalDisplayName: pro,
      nextOpenMessageId: null,
      messages: out.messages,
      // A stopped consult has no capture window left, so no chart-copy choice.
      chartCopy: null,
      book: bookCta({ reason: 'CONSULT_STOPPED', session, look, booking }),
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
    return finish({ session, look, pro, out, booking })
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
      author: 'APP',
      // The only step that can be open before the booking; there is nothing
      // ahead of it to wait for. Once a plan exists it is history, not a step.
      state: settled ? 'DONE' : hasPlan ? 'BLOCKED' : 'OPEN',
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
      },
    })
  }

  // ── Intake ───────────────────────────────────────────────────────────────
  const intake = await optionalStage(() => loadConsultIntakeState(stageArgs))
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

    for (const question of intake.questionPack.questions) {
      const answer = answers[question.key] ?? null
      // Everything after the open question is still unasked — a thread shows
      // what has happened and the one thing being asked, never a form's worth
      // of questions the client has not reached.
      if (answer === null && question.key !== nextKey) continue
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
        question,
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
  // Prep. Uses the capture state already loaded above the intake.
  if (capture) {
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
      if (!previous || !current) continue
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
      text: fillConsultThreadCopy(copy.booked, { pro }),
      bookingId: booking.id,
    })
    out.push(text('prep-intro', fillConsultThreadCopy(copy.prepIntro, { pro })))
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
    if (results) {
      out.push(
        text(
          'estimate-ready',
          fillConsultThreadCopy(copy.estimateReady, { pro }),
        ),
      )
    }
  }

  return finish({ session, look, pro, out, booking, capture })
}

type ThreadLook = {
  id: string
  serviceId: string | null
  primaryMediaAssetId: string
} | null

function finish(args: {
  session: {
    id: string
    status: ConsultSessionStatus
    professionalId: string
    anchorLookPostId: string | null
  }
  look: ThreadLook
  pro: string
  out: { messages: ConsultThreadMessageDTO[] }
  booking: { id: string } | null
  /**
   * The capture state, when the step is readable. Its slots decide the sticky
   * CTA's gate, and its chart-copy choice rides on the thread root.
   */
  capture?: ConsultCaptureStateDTO | null
}): ConsultThreadDTO {
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
  const selfieIn = args.capture?.earlyPhoto?.state === 'ACCEPTED'

  return {
    consultId: args.session.id,
    status: args.session.status,
    professionalId: args.session.professionalId,
    professionalDisplayName: args.pro,
    nextOpenMessageId:
      args.out.messages.find((m) => m.state === 'OPEN')?.id ?? null,
    messages: args.out.messages,
    chartCopy: args.capture?.chartCopy ?? null,
    book: bookCta({
      reason: selfieIn ? null : 'SELFIE_REQUIRED',
      session: args.session,
      look: args.look,
      booking: args.booking,
    }),
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
function bookCta(args: {
  reason: ConsultThreadBookGateReasonDTO | null
  session: { anchorLookPostId: string | null }
  look: ThreadLook
  booking: { id: string } | null
}): ConsultThreadBookCtaDTO {
  const { look } = args
  const base = {
    lookPostId: args.session.anchorLookPostId,
    serviceId: look?.serviceId ?? null,
    lookMediaId: look?.primaryMediaAssetId ?? null,
  }

  // A booking-anchored consult already HAS its appointment; a look that names no
  // service has nothing for the ordinary path to book. Both are refusals with a
  // reason rather than a button that fails one screen later.
  if (!args.session.anchorLookPostId) {
    return { enabled: false, reason: 'NOT_LOOK_ANCHORED', ...base }
  }
  if (args.booking) {
    return { enabled: false, reason: 'ALREADY_BOOKED', ...base }
  }
  if (!look?.serviceId) {
    return { enabled: false, reason: 'LOOK_NOT_BOOKABLE', ...base }
  }
  if (args.reason) {
    return { enabled: false, reason: args.reason, ...base }
  }
  return { enabled: true, reason: null, ...base }
}
