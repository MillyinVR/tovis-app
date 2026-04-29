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
