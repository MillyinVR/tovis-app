// lib/proSession/sessionState.ts
//
// Compact, hashable snapshot of the Pro-facing booking session state.
// The session state route returns this snapshot plus its hash so the Pro
// session UI can poll cheaply: when the hash changes, the client refreshes
// the server-rendered page; when `terminal` is true, polling stops.

import { createHash } from 'node:crypto'

import {
  SessionStep,
  type BookingCheckoutStatus,
  type BookingStatus,
  type ConsultationApprovalStatus,
  type PaymentMethod,
  type Prisma,
  type StripePaymentStatus,
} from '@prisma/client'

import { isTerminalBooking, resolveEffectiveSessionStep } from './sessionFlow'

export const PRO_SESSION_STATE_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentCollectedAt: true,
  paymentAuthorizedAt: true,
  stripePaymentStatus: true,
  consultationApproval: {
    select: {
      status: true,
      approvedAt: true,
      rejectedAt: true,
      updatedAt: true,
    },
  },
  aftercareSummary: {
    select: {
      draftSavedAt: true,
      sentToClientAt: true,
      version: true,
    },
  },
} satisfies Prisma.BookingSelect

export type ProSessionStateBookingRow = {
  id: string
  status: BookingStatus
  sessionStep: SessionStep
  startedAt: Date | null
  finishedAt: Date | null
  updatedAt: Date
  checkoutStatus: BookingCheckoutStatus
  selectedPaymentMethod: PaymentMethod | null
  paymentCollectedAt: Date | null
  paymentAuthorizedAt: Date | null
  stripePaymentStatus: StripePaymentStatus | null
  consultationApproval: {
    status: ConsultationApprovalStatus
    approvedAt: Date | null
    rejectedAt: Date | null
    updatedAt: Date
  } | null
  aftercareSummary: {
    draftSavedAt: Date | null
    sentToClientAt: Date | null
    version: number
  } | null
}

export type ProSessionState = {
  bookingId: string
  status: BookingStatus
  sessionStep: SessionStep
  effectiveSessionStep: SessionStep
  terminal: boolean
  startedAt: string | null
  finishedAt: string | null
  consultation: {
    status: ConsultationApprovalStatus
    approvedAt: string | null
    rejectedAt: string | null
    updatedAt: string
  } | null
  checkout: {
    status: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    paymentCollectedAt: string | null
    paymentAuthorizedAt: string | null
    stripePaymentStatus: StripePaymentStatus | null
  }
  aftercare: {
    draftSavedAt: string | null
    sentToClientAt: string | null
    version: number
  } | null
  bookingUpdatedAt: string
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export function buildProSessionState(
  booking: ProSessionStateBookingRow,
): ProSessionState {
  const consultationStatus = booking.consultationApproval?.status ?? null

  const effectiveSessionStep = resolveEffectiveSessionStep({
    bookingStatus: booking.status,
    rawStep: booking.sessionStep,
    consultationStatus,
  })

  const terminal =
    isTerminalBooking(booking.status, booking.finishedAt) ||
    booking.sessionStep === SessionStep.DONE

  return {
    bookingId: booking.id,
    status: booking.status,
    sessionStep: booking.sessionStep,
    effectiveSessionStep,
    terminal,
    startedAt: iso(booking.startedAt),
    finishedAt: iso(booking.finishedAt),
    consultation: booking.consultationApproval
      ? {
          status: booking.consultationApproval.status,
          approvedAt: iso(booking.consultationApproval.approvedAt),
          rejectedAt: iso(booking.consultationApproval.rejectedAt),
          updatedAt: booking.consultationApproval.updatedAt.toISOString(),
        }
      : null,
    checkout: {
      status: booking.checkoutStatus,
      selectedPaymentMethod: booking.selectedPaymentMethod,
      paymentCollectedAt: iso(booking.paymentCollectedAt),
      paymentAuthorizedAt: iso(booking.paymentAuthorizedAt),
      stripePaymentStatus: booking.stripePaymentStatus,
    },
    aftercare: booking.aftercareSummary
      ? {
          draftSavedAt: iso(booking.aftercareSummary.draftSavedAt),
          sentToClientAt: iso(booking.aftercareSummary.sentToClientAt),
          version: booking.aftercareSummary.version,
        }
      : null,
    bookingUpdatedAt: booking.updatedAt.toISOString(),
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)

  return `{${entries.join(',')}}`
}

export function computeProSessionStateHash(state: ProSessionState): string {
  return createHash('sha256').update(stableStringify(state)).digest('hex')
}
