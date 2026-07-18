// lib/booking/lifecycleActionViewModel.ts
//
// Single source of truth for "given a booking's current state and the viewer's
// role, what buttons should the BookingActions UI render?"
//
// Derived from `lib/booking/lifecycleContract.ts` — every action the view-model
// emits corresponds to a transition the contract considers legal. The
// view-model is a UX hint, not a security boundary; the server still asserts
// legality on every mutation.
//
// Used by:
//   - app/pro/bookings/BookingActions.tsx
//   - app/client/(gated)/bookings/[id]/BookingActions.tsx
//
// New surfaces should consume this view-model rather than branching on
// `BookingStatus` directly. The legacy `BookingStatus = 'PENDING' | 'ACCEPTED'
// | 'COMPLETED' | 'CANCELLED'` union (missing IN_PROGRESS) is forbidden.

import { BookingStatus, SessionStep } from '@prisma/client'

// ─── Types ───────────────────────────────────────────────────────────────────

export type LifecycleViewerRole = 'PRO' | 'CLIENT' | 'ADMIN'

/**
 * Action verbs that the BookingActions card can emit. These are flat — deeper
 * SessionStep operations (send consultation proposal, capture before/after
 * photos, send aftercare) live on the dedicated session pages, so the card
 * just emits a `CONTINUE_SESSION` link when the booking is mid-flight.
 */
export type LifecycleActionVerb =
  | 'ACCEPT'
  | 'CANCEL'
  | 'NO_SHOW'
  | 'START_SESSION'
  | 'CONTINUE_SESSION'
  | 'CLIENT_CANCEL'
  | 'CLIENT_RESCHEDULE'
  | 'CLIENT_APPROVE_CONSULTATION'
  | 'CLIENT_VIEW_AFTERCARE'
  | 'CLIENT_REBOOK'

export type LifecycleActionMethod = 'PATCH' | 'POST' | 'NAVIGATE' | 'CALLBACK'

export type LifecycleAction = {
  verb: LifecycleActionVerb
  label: string
  method: LifecycleActionMethod
  /** Endpoint path for PATCH/POST, or destination for NAVIGATE. */
  href?: string
  /** JSON body for PATCH/POST verbs. */
  payload?: Record<string, unknown>
  primary?: boolean
  confirmCopy?: string
}

export type LifecycleBlockerCode =
  | 'BEFORE_MEDIA_REQUIRED'
  | 'PAYMENT_NOT_COLLECTED'
  | 'CONSULTATION_NOT_APPROVED'
  | 'AFTERCARE_NOT_SENT'
  | 'NO_RESCHEDULE_HOLD'

export type LifecycleTimelinePill = {
  key: string
  label: string
  on: boolean
}

export type LifecycleViewModel = {
  status: BookingStatus
  sessionStep: SessionStep
  isTerminal: boolean
  isInProgress: boolean
  displayLabel: string
  actions: LifecycleAction[]
  blockerCodes: LifecycleBlockerCode[]
  timelinePills: LifecycleTimelinePill[]
}

export type LifecycleViewModelInput = {
  bookingId: string
  status: BookingStatus
  sessionStep: SessionStep | null
  role: LifecycleViewerRole
  startedAt?: string | Date | null
  finishedAt?: string | Date | null
  paymentCollectedAt?: string | Date | null
  aftercareSentAt?: string | Date | null
  beforeMediaCount?: number
  afterMediaCount?: number
  consultationApprovalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  rescheduleHoldId?: string | null
  hasAftercareLink?: boolean
  /**
   * Whether Phase 2 revenue protection is live (server-side
   * `noShowProtectionEnabled()`). Gates the pro "Mark no-show" action — the
   * `/no-show` route 404s while the flag is off, so the button must stay hidden.
   */
  noShowFeatureEnabled?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
])

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function displayLabelFor(
  status: BookingStatus,
  sessionStep: SessionStep,
): string {
  if (status === BookingStatus.PENDING) return 'Pending'
  if (status === BookingStatus.ACCEPTED) return 'Confirmed'
  if (status === BookingStatus.COMPLETED) return 'Completed'
  if (status === BookingStatus.CANCELLED) return 'Cancelled'

  // IN_PROGRESS — surface the session step so the user knows where they are.
  switch (sessionStep) {
    case SessionStep.CONSULTATION:
      return 'Consultation'
    case SessionStep.CONSULTATION_PENDING_CLIENT:
      return 'Consultation — awaiting approval'
    case SessionStep.BEFORE_PHOTOS:
      return 'Capturing before photos'
    case SessionStep.SERVICE_IN_PROGRESS:
      return 'Service in progress'
    case SessionStep.FINISH_REVIEW:
      return 'Wrapping up'
    case SessionStep.AFTER_PHOTOS:
      return 'Capturing after photos'
    case SessionStep.DONE:
      return 'Wrapping up'
    case SessionStep.NONE:
    default:
      return 'In progress'
  }
}

function timelinePillsFor(
  status: BookingStatus,
  sessionStep: SessionStep,
): LifecycleTimelinePill[] {
  if (status === BookingStatus.CANCELLED) {
    return [
      { key: 'requested', label: 'Requested', on: true },
      { key: 'cancelled', label: 'Cancelled', on: true },
    ]
  }

  const inProgress = status === BookingStatus.IN_PROGRESS
  const completed = status === BookingStatus.COMPLETED
  const accepted = status === BookingStatus.ACCEPTED || inProgress || completed

  return [
    {
      key: 'requested',
      label: 'Requested',
      on: true,
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      on: accepted,
    },
    {
      key: 'in_progress',
      label: 'In progress',
      on: inProgress || completed,
    },
    {
      key: 'completed',
      label: 'Completed',
      on: completed,
    },
  ]
}

// ─── Action builders ─────────────────────────────────────────────────────────

function proActions(input: LifecycleViewModelInput): LifecycleAction[] {
  const { bookingId, status, sessionStep } = input
  const safeId = encodePathSegment(bookingId)
  const actions: LifecycleAction[] = []

  if (status === BookingStatus.PENDING) {
    actions.push({
      verb: 'ACCEPT',
      label: 'Accept',
      method: 'PATCH',
      href: `/api/v1/pro/bookings/${safeId}`,
      payload: { status: 'ACCEPTED', notifyClient: true },
      primary: true,
    })
    actions.push({
      verb: 'CANCEL',
      label: 'Cancel',
      method: 'PATCH',
      href: `/api/v1/pro/bookings/${safeId}`,
      payload: { status: 'CANCELLED', notifyClient: true },
      confirmCopy: 'Cancel this booking? This will notify the client.',
    })
    return actions
  }

  if (status === BookingStatus.ACCEPTED) {
    actions.push({
      verb: 'START_SESSION',
      label: 'Start booking',
      method: 'POST',
      href: `/api/v1/pro/bookings/${safeId}/session/start`,
      payload: { explicitSelection: true },
      primary: true,
    })
    actions.push({
      verb: 'CANCEL',
      label: 'Cancel',
      method: 'PATCH',
      href: `/api/v1/pro/bookings/${safeId}`,
      payload: { status: 'CANCELLED', notifyClient: true },
      confirmCopy: 'Cancel this booking? This will notify the client.',
    })
    if (input.noShowFeatureEnabled) {
      actions.push({
        verb: 'NO_SHOW',
        label: 'Mark no-show',
        method: 'POST',
        href: `/api/v1/pro/bookings/${safeId}/no-show`,
        confirmCopy:
          'Mark this client as a no-show? This may charge their saved card a fee per your no-show policy.',
      })
    }
    return actions
  }

  if (status === BookingStatus.IN_PROGRESS && sessionStep !== SessionStep.DONE) {
    actions.push({
      verb: 'CONTINUE_SESSION',
      label: 'Continue session',
      method: 'NAVIGATE',
      href: `/pro/bookings/${safeId}/session`,
      primary: true,
    })
    return actions
  }

  // COMPLETED, CANCELLED, or IN_PROGRESS+DONE → no card actions; the booking
  // either lives on the session page or in a read-only history view.
  return actions
}

function clientActions(input: LifecycleViewModelInput): LifecycleAction[] {
  const { bookingId, status, sessionStep, rescheduleHoldId, hasAftercareLink } =
    input
  const safeId = encodePathSegment(bookingId)
  const actions: LifecycleAction[] = []

  const cancellable =
    status === BookingStatus.PENDING || status === BookingStatus.ACCEPTED

  if (cancellable) {
    actions.push({
      verb: 'CLIENT_RESCHEDULE',
      label: 'Reschedule',
      method: 'CALLBACK',
    })

    actions.push({
      verb: 'CLIENT_CANCEL',
      label: 'Cancel booking',
      method: 'POST',
      href: `/api/v1/bookings/${safeId}/cancel`,
      confirmCopy: 'Cancel this booking?',
    })
  }

  if (
    status === BookingStatus.IN_PROGRESS &&
    sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    actions.push({
      verb: 'CLIENT_APPROVE_CONSULTATION',
      label: 'Review consultation',
      method: 'NAVIGATE',
      href: `/client/bookings/${safeId}?step=consult`,
      primary: true,
    })
  }

  if (status === BookingStatus.COMPLETED && hasAftercareLink) {
    actions.push({
      verb: 'CLIENT_VIEW_AFTERCARE',
      label: 'View aftercare',
      method: 'NAVIGATE',
      href: `/client/bookings/${safeId}?step=aftercare`,
      primary: true,
    })
  }

  if (status === BookingStatus.COMPLETED) {
    actions.push({
      verb: 'CLIENT_REBOOK',
      label: 'Rebook',
      method: 'NAVIGATE',
      href: `/client/bookings/${safeId}?action=rebook`,
    })
  }

  // Reschedule blocker hint is a UX nudge — disables the confirm step on the
  // calling component when no hold has been picked yet.
  if (cancellable && !rescheduleHoldId) {
    // Caller can read this from blockerCodes to disable the confirm button
    // until a hold is selected.
  }

  return actions
}

function blockersFor(input: LifecycleViewModelInput): LifecycleBlockerCode[] {
  const blockers: LifecycleBlockerCode[] = []

  if (input.role === 'PRO' && input.status === BookingStatus.IN_PROGRESS) {
    if (
      input.sessionStep === SessionStep.BEFORE_PHOTOS &&
      (input.beforeMediaCount ?? 0) === 0
    ) {
      blockers.push('BEFORE_MEDIA_REQUIRED')
    }

    if (
      input.consultationApprovalStatus &&
      input.consultationApprovalStatus !== 'APPROVED' &&
      input.sessionStep !== SessionStep.CONSULTATION &&
      input.sessionStep !== SessionStep.CONSULTATION_PENDING_CLIENT
    ) {
      blockers.push('CONSULTATION_NOT_APPROVED')
    }

    if (
      input.sessionStep === SessionStep.AFTER_PHOTOS &&
      !input.paymentCollectedAt
    ) {
      blockers.push('PAYMENT_NOT_COLLECTED')
    }

    if (
      input.sessionStep === SessionStep.DONE &&
      !input.aftercareSentAt
    ) {
      blockers.push('AFTERCARE_NOT_SENT')
    }
  }

  if (
    input.role === 'CLIENT' &&
    (input.status === BookingStatus.PENDING ||
      input.status === BookingStatus.ACCEPTED) &&
    !input.rescheduleHoldId
  ) {
    // Hint for the reschedule button — caller can read this and disable
    // the confirm step until a hold is picked.
    blockers.push('NO_RESCHEDULE_HOLD')
  }

  return blockers
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildLifecycleActionViewModel(
  input: LifecycleViewModelInput,
): LifecycleViewModel {
  const status = input.status
  const sessionStep = input.sessionStep ?? SessionStep.NONE
  const isTerminal = TERMINAL_STATUSES.has(status)
  const isInProgress = status === BookingStatus.IN_PROGRESS

  let actions: LifecycleAction[] = []
  if (input.role === 'PRO' || input.role === 'ADMIN') {
    actions = proActions({ ...input, sessionStep })
  } else if (input.role === 'CLIENT') {
    actions = clientActions({ ...input, sessionStep })
  }

  return {
    status,
    sessionStep,
    isTerminal,
    isInProgress,
    displayLabel: displayLabelFor(status, sessionStep),
    actions,
    blockerCodes: blockersFor({ ...input, sessionStep }),
    timelinePills: timelinePillsFor(status, sessionStep),
  }
}
