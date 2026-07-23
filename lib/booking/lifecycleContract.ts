// lib/booking/lifecycleContract.ts
//
// Single source of truth for all legal BookingStatus and SessionStep
// transitions in the booking lifecycle.
//
// ┌──────────┐  accept   ┌──────────┐  start   ┌─────────────┐
// │ PENDING  │ ────────► │ ACCEPTED │ ────────► │ IN_PROGRESS │
// └──────────┘           └──────────┘           └──────┬──────┘
//                                                       │ startBookingSession
//                                                       ▼
//                                               [SessionStep.CONSULTATION]
//
// Full SessionStep ladder (while status = IN_PROGRESS):
//
//   CONSULTATION
//     │ sendConsultationProposal
//     ▼
//   CONSULTATION_PENDING_CLIENT
//     │ clientApproves (remote or in-person)
//     ▼
//   BEFORE_PHOTOS
//     │ beforeMediaConfirmed
//     ▼
//   SERVICE_IN_PROGRESS
//     │ finishService
//     ▼
//   FINISH_REVIEW
//     │ afterMediaUploaded
//     ▼
//   AFTER_PHOTOS
//     │ sendAftercareAndComplete
//     ▼
//   DONE  →  BookingStatus = COMPLETED
//
// Canonical verb labels (use these in all UI copy, API response messages, and tests):
//   "Start booking"               — ACCEPTED → IN_PROGRESS + NONE → CONSULTATION
//   "Send consultation proposal"  — CONSULTATION → CONSULTATION_PENDING_CLIENT
//   "Approve consultation"        — CONSULTATION_PENDING_CLIENT → BEFORE_PHOTOS
//   "Capture before photos"       — BEFORE_PHOTOS (media upload step)
//   "Start service"               — BEFORE_PHOTOS → SERVICE_IN_PROGRESS
//   "Finish service"              — SERVICE_IN_PROGRESS → FINISH_REVIEW
//   "Capture after photos"        — AFTER_PHOTOS (media upload step)
//   "Create aftercare"            — FINISH_REVIEW → AFTER_PHOTOS
//   "Send aftercare + complete"   — AFTER_PHOTOS → DONE / COMPLETED
//

import { BookingStatus, SessionStep } from '@prisma/client'

// ─── Actors ──────────────────────────────────────────────────────────────────

export type LifecycleActor = 'PRO' | 'CLIENT' | 'ADMIN' | 'SYSTEM'

// ─── Transition maps ─────────────────────────────────────────────────────────

/**
 * Legal BookingStatus transitions keyed by (from, to).
 * Value is the set of actors that may trigger the transition.
 */
export const BOOKING_STATUS_TRANSITIONS: Map<
  BookingStatus,
  Map<BookingStatus, LifecycleActor[]>
> = new Map([
  [
    BookingStatus.PENDING,
    new Map<BookingStatus, LifecycleActor[]>([
      [BookingStatus.ACCEPTED, ['PRO', 'ADMIN', 'SYSTEM']],
      // SYSTEM cancels a PENDING booking in two automated paths: the M5 unpaid-
      // deposit auto-release sweep (releaseUnpaidDepositBookingBySystem) and the
      // calendar-migration pristine-import cleanup (cancelImportedBookingIfPristine).
      // Both stamp cancelledByRole=null. A live human cancel is still PRO/CLIENT/ADMIN.
      [BookingStatus.CANCELLED, ['PRO', 'CLIENT', 'ADMIN', 'SYSTEM']],
    ]),
  ],
  [
    BookingStatus.ACCEPTED,
    new Map<BookingStatus, LifecycleActor[]>([
      [BookingStatus.IN_PROGRESS, ['PRO']],
      // SYSTEM here is the same two automated paths as PENDING→CANCELLED above
      // (an auto-accept pro's unpaid-deposit hold is ACCEPTED, and imported
      // bookings are created ACCEPTED). A started session (IN_PROGRESS) may only
      // be cancelled by ADMIN — see that map below.
      [BookingStatus.CANCELLED, ['PRO', 'CLIENT', 'ADMIN', 'SYSTEM']],
      // Client did not attend a confirmed appointment (Phase 2 revenue
      // protection). Terminal, like CANCELLED. Pro- or admin-driven only.
      [BookingStatus.NO_SHOW, ['PRO', 'ADMIN']],
    ]),
  ],
  [
    BookingStatus.IN_PROGRESS,
    new Map<BookingStatus, LifecycleActor[]>([
      [BookingStatus.COMPLETED, ['PRO', 'ADMIN', 'SYSTEM']],
      [BookingStatus.CANCELLED, ['ADMIN']],
    ]),
  ],
])

/**
 * Legal SessionStep transitions keyed by (from, to).
 * Value is the set of actors that may trigger the transition.
 */
export const SESSION_STEP_TRANSITIONS: Map<
  SessionStep,
  Map<SessionStep, LifecycleActor[]>
> = new Map([
  [
    SessionStep.NONE,
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.CONSULTATION, ['PRO']]]),
  ],
  [
    SessionStep.CONSULTATION,
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.CONSULTATION_PENDING_CLIENT, ['PRO']]]),
  ],
  [
    SessionStep.CONSULTATION_PENDING_CLIENT,
    new Map<SessionStep, LifecycleActor[]>([
      [SessionStep.BEFORE_PHOTOS, ['CLIENT', 'PRO']],
      [SessionStep.CONSULTATION, ['PRO']],
    ]),
  ],
  [
    SessionStep.BEFORE_PHOTOS,
    new Map<SessionStep, LifecycleActor[]>([
      [SessionStep.SERVICE_IN_PROGRESS, ['PRO']],
      // §22 MS1: a pre-capture mid-session service change re-opens the
      // consultation for client re-approval (guarded server-side on "no photos
      // captured yet"); the re-sent proposal drops the step back here.
      [SessionStep.CONSULTATION_PENDING_CLIENT, ['PRO']],
    ]),
  ],
  [
    SessionStep.SERVICE_IN_PROGRESS,
    new Map<SessionStep, LifecycleActor[]>([
      [SessionStep.FINISH_REVIEW, ['PRO']],
      // §22 MS1 (see BEFORE_PHOTOS above).
      [SessionStep.CONSULTATION_PENDING_CLIENT, ['PRO']],
    ]),
  ],
  [
    SessionStep.FINISH_REVIEW,
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.AFTER_PHOTOS, ['PRO']]]),
  ],
  [
    SessionStep.AFTER_PHOTOS,
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.DONE, ['PRO', 'ADMIN', 'SYSTEM']]]),
  ],
])

// ─── Error codes ──────────────────────────────────────────────────────────────

export type LifecycleViolationCode =
  | 'ILLEGAL_STATUS_TRANSITION'
  | 'ILLEGAL_STEP_TRANSITION'
  | 'UNAUTHORIZED_ACTOR'

export class LifecycleViolationError extends Error {
  constructor(
    public readonly code: LifecycleViolationCode,
    message: string,
  ) {
    super(message)
    this.name = 'LifecycleViolationError'
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/**
 * Asserts that the requested BookingStatus transition is legal for the given actor.
 *
 * Throws a `LifecycleViolationError` if the transition is not in the contract.
 * No-ops if `from === to` (idempotent accept / duplicate request).
 */
export function assertLegalStatusTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: LifecycleActor,
): void {
  if (from === to) return

  const toMap = BOOKING_STATUS_TRANSITIONS.get(from)
  if (!toMap) {
    throw new LifecycleViolationError(
      'ILLEGAL_STATUS_TRANSITION',
      `No transitions defined from status "${from}".`,
    )
  }

  const allowedActors = toMap.get(to)
  if (!allowedActors) {
    throw new LifecycleViolationError(
      'ILLEGAL_STATUS_TRANSITION',
      `Transition "${from}" → "${to}" is not a legal booking status transition.`,
    )
  }

  if (!allowedActors.includes(actor)) {
    throw new LifecycleViolationError(
      'UNAUTHORIZED_ACTOR',
      `Actor "${actor}" is not allowed to perform status transition "${from}" → "${to}".`,
    )
  }
}

/**
 * Asserts that the requested SessionStep transition is legal for the given actor.
 *
 * Throws a `LifecycleViolationError` if the transition is not in the contract.
 * No-ops if `from === to`.
 */
export function assertLegalStepTransition(
  from: SessionStep,
  to: SessionStep,
  actor: LifecycleActor,
): void {
  if (from === to) return

  const toMap = SESSION_STEP_TRANSITIONS.get(from)
  if (!toMap) {
    throw new LifecycleViolationError(
      'ILLEGAL_STEP_TRANSITION',
      `No transitions defined from step "${from}".`,
    )
  }

  const allowedActors = toMap.get(to)
  if (!allowedActors) {
    throw new LifecycleViolationError(
      'ILLEGAL_STEP_TRANSITION',
      `Transition "${from}" → "${to}" is not a legal session step transition.`,
    )
  }

  if (!allowedActors.includes(actor)) {
    throw new LifecycleViolationError(
      'UNAUTHORIZED_ACTOR',
      `Actor "${actor}" is not allowed to perform step transition "${from}" → "${to}".`,
    )
  }
}

/**
 * Returns true when the requested SessionStep transition is in the legal contract
 * for the given actor, without throwing.
 */
export function isLegalStepTransition(
  from: SessionStep,
  to: SessionStep,
  actor: LifecycleActor,
): boolean {
  try {
    assertLegalStepTransition(from, to, actor)
    return true
  } catch {
    return false
  }
}

/**
 * Returns true when the requested BookingStatus transition is in the legal contract
 * for the given actor, without throwing.
 */
export function isLegalStatusTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: LifecycleActor,
): boolean {
  try {
    assertLegalStatusTransition(from, to, actor)
    return true
  } catch {
    return false
  }
}

/**
 * True when a booking status has no legal transition out of it — i.e. the
 * lifecycle is over. DERIVED from BOOKING_STATUS_TRANSITIONS rather than
 * re-listed, because hand-maintained terminal lists drift: COMPLETED and
 * CANCELLED were listed in four separate places and NO_SHOW was missing from
 * three of them, which let a no-showed booking open a live, workable session
 * and made the pro booking card read "Status: In progress".
 *
 * Today that resolves to COMPLETED, CANCELLED and NO_SHOW — the contract's own
 * comment already calls NO_SHOW "Terminal, like CANCELLED".
 */
export function isTerminalBookingStatus(status: BookingStatus): boolean {
  const outgoing = BOOKING_STATUS_TRANSITIONS.get(status)

  return outgoing === undefined || outgoing.size === 0
}

// ─── Drift telemetry ──────────────────────────────────────────────────────────

/**
 * Strict mode toggle. Drift recorders throw on contract violations by default.
 *
 * Set `LIFECYCLE_STRICT_MODE=false` (or `0`, `no`, `off`) to temporarily fall
 * back to telemetry-only mode during an incident.
 */
export function isLifecycleStrictMode(): boolean {
  const raw = process.env.LIFECYCLE_STRICT_MODE
  if (typeof raw !== 'string') return true
  const v = raw.trim().toLowerCase()
  if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false
  }
  return true
}

export type LifecycleDriftKind =
  | 'STEP_TRANSITION_OUTSIDE_CONTRACT'
  | 'STATUS_TRANSITION_OUTSIDE_CONTRACT'
  | 'UNAUTHORIZED_ACTOR'

export type LifecycleDriftEvent = {
  kind: LifecycleDriftKind
  from: SessionStep | BookingStatus
  to: SessionStep | BookingStatus
  actor: LifecycleActor
  route: string
  bookingId?: string | null
  professionalId?: string | null
  reason: string
}

/**
 * Pluggable sink for drift events. The default sink is a no-op so this module
 * stays free of side-effect imports; the booking write boundary wires in a
 * Sentry/structured-log sink during initialization.
 *
 * Multiple sinks can be registered (e.g. tests can attach a recorder).
 */
type LifecycleDriftSink = (event: LifecycleDriftEvent) => void

const driftSinks: LifecycleDriftSink[] = []

export function registerLifecycleDriftSink(sink: LifecycleDriftSink): () => void {
  driftSinks.push(sink)
  return () => {
    const i = driftSinks.indexOf(sink)
    if (i >= 0) driftSinks.splice(i, 1)
  }
}

function emitDrift(event: LifecycleDriftEvent): void {
  for (const sink of driftSinks) {
    try {
      sink(event)
    } catch {
      // Sinks must never break the caller. Swallow.
    }
  }
}

/**
 * Records a SessionStep transition through the contract. If the transition is
 * not legal for the actor, emits a drift event. In strict mode, also throws.
 *
 * No-op when `from === to` (idempotent retries are not drift).
 *
 * This is designed to be called *alongside* existing manual validation in
 * writeBoundary — it adds telemetry without changing current behavior.
 */
export function recordStepTransition(args: {
  from: SessionStep
  to: SessionStep
  actor: LifecycleActor
  route: string
  bookingId?: string | null
  professionalId?: string | null
}): void {
  if (args.from === args.to) return

  try {
    assertLegalStepTransition(args.from, args.to, args.actor)
    return
  } catch (err) {
    const violation = err instanceof LifecycleViolationError ? err : null
    const kind: LifecycleDriftKind =
      violation?.code === 'UNAUTHORIZED_ACTOR'
        ? 'UNAUTHORIZED_ACTOR'
        : 'STEP_TRANSITION_OUTSIDE_CONTRACT'

    emitDrift({
      kind,
      from: args.from,
      to: args.to,
      actor: args.actor,
      route: args.route,
      bookingId: args.bookingId ?? null,
      professionalId: args.professionalId ?? null,
      reason: violation?.message ?? String(err),
    })

    if (isLifecycleStrictMode()) {
      throw err
    }
  }
}

/**
 * Records a BookingStatus transition through the contract. Mirrors
 * `recordStepTransition`.
 */
export function recordStatusTransition(args: {
  from: BookingStatus
  to: BookingStatus
  actor: LifecycleActor
  route: string
  bookingId?: string | null
  professionalId?: string | null
}): void {
  if (args.from === args.to) return

  try {
    assertLegalStatusTransition(args.from, args.to, args.actor)
    return
  } catch (err) {
    const violation = err instanceof LifecycleViolationError ? err : null
    const kind: LifecycleDriftKind =
      violation?.code === 'UNAUTHORIZED_ACTOR'
        ? 'UNAUTHORIZED_ACTOR'
        : 'STATUS_TRANSITION_OUTSIDE_CONTRACT'

    emitDrift({
      kind,
      from: args.from,
      to: args.to,
      actor: args.actor,
      route: args.route,
      bookingId: args.bookingId ?? null,
      professionalId: args.professionalId ?? null,
      reason: violation?.message ?? String(err),
    })

    if (isLifecycleStrictMode()) {
      throw err
    }
  }
}
