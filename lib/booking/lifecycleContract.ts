// lib/booking/lifecycleContract.ts
//
// Single source of truth for all legal BookingStatus and SessionStep
// transitions in the Tovis booking lifecycle.
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
      [BookingStatus.CANCELLED, ['PRO', 'CLIENT', 'ADMIN']],
    ]),
  ],
  [
    BookingStatus.ACCEPTED,
    new Map<BookingStatus, LifecycleActor[]>([
      [BookingStatus.IN_PROGRESS, ['PRO']],
      [BookingStatus.CANCELLED, ['PRO', 'CLIENT', 'ADMIN']],
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
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.SERVICE_IN_PROGRESS, ['PRO']]]),
  ],
  [
    SessionStep.SERVICE_IN_PROGRESS,
    new Map<SessionStep, LifecycleActor[]>([[SessionStep.FINISH_REVIEW, ['PRO']]]),
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

// ─── Drift telemetry ──────────────────────────────────────────────────────────

/**
 * Strict mode toggle. When `LIFECYCLE_STRICT_MODE=true` (or `1`), drift recorders
 * throw on contract violations instead of just logging telemetry.
 *
 * Default OFF: drift is captured but does not change runtime behavior. This lets
 * us roll out contract enforcement safely — observe first, enforce later.
 */
export function isLifecycleStrictMode(): boolean {
  const raw = process.env.LIFECYCLE_STRICT_MODE
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
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
