import { describe, expect, it } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  ConsultationApprovalProofMethod,
  ConsultationApprovalStatus,
  ConsultationDecision,
  SessionStep,
} from '@prisma/client'

import {
  buildProSessionState,
  computeProSessionStateHash,
  type ProSessionStateBookingRow,
} from './sessionState'

function makeRow(
  overrides: Partial<ProSessionStateBookingRow> = {},
): ProSessionStateBookingRow {
  return {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.CONSULTATION,
    startedAt: new Date('2026-06-09T10:00:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-06-09T10:05:00.000Z'),
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    selectedPaymentMethod: null,
    paymentCollectedAt: null,
    paymentAuthorizedAt: null,
    stripePaymentStatus: null,
    consultationApproval: null,
    aftercareSummary: null,
    ...overrides,
  }
}

describe('buildProSessionState', () => {
  it('builds a snapshot with ISO dates and no consultation/aftercare', () => {
    const state = buildProSessionState(makeRow())

    expect(state.bookingId).toBe('booking_1')
    expect(state.status).toBe(BookingStatus.IN_PROGRESS)
    expect(state.sessionStep).toBe(SessionStep.CONSULTATION)
    expect(state.startedAt).toBe('2026-06-09T10:00:00.000Z')
    expect(state.finishedAt).toBeNull()
    expect(state.consultation).toBeNull()
    expect(state.aftercare).toBeNull()
    expect(state.terminal).toBe(false)
    expect(state.bookingUpdatedAt).toBe('2026-06-09T10:05:00.000Z')
  })

  it('derives the effective step when an approval lands while waiting on the client', () => {
    const state = buildProSessionState(
      makeRow({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationApproval: {
          status: ConsultationApprovalStatus.APPROVED,
          approvedAt: new Date('2026-06-09T10:10:00.000Z'),
          rejectedAt: null,
          updatedAt: new Date('2026-06-09T10:10:00.000Z'),
          proof: null,
        },
      }),
    )

    expect(state.sessionStep).toBe(SessionStep.CONSULTATION_PENDING_CLIENT)
    expect(state.effectiveSessionStep).toBe(SessionStep.BEFORE_PHOTOS)
    expect(state.consultation?.status).toBe(ConsultationApprovalStatus.APPROVED)
    expect(state.consultation?.approvedAt).toBe('2026-06-09T10:10:00.000Z')
  })

  it('walks the effective step back to consultation on rejection', () => {
    const state = buildProSessionState(
      makeRow({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationApproval: {
          status: ConsultationApprovalStatus.REJECTED,
          approvedAt: null,
          rejectedAt: new Date('2026-06-09T10:10:00.000Z'),
          updatedAt: new Date('2026-06-09T10:10:00.000Z'),
          proof: null,
        },
      }),
    )

    expect(state.effectiveSessionStep).toBe(SessionStep.CONSULTATION)
  })

  it('maps the consultation proof (decision/method/actedAt) when present', () => {
    const state = buildProSessionState(
      makeRow({
        consultationApproval: {
          status: ConsultationApprovalStatus.APPROVED,
          approvedAt: new Date('2026-06-09T10:10:00.000Z'),
          rejectedAt: null,
          updatedAt: new Date('2026-06-09T10:10:00.000Z'),
          proof: {
            decision: ConsultationDecision.APPROVED,
            method: ConsultationApprovalProofMethod.REMOTE_SECURE_LINK,
            actedAt: new Date('2026-06-09T10:09:30.000Z'),
          },
        },
      }),
    )

    expect(state.consultation?.proof).toEqual({
      decision: ConsultationDecision.APPROVED,
      method: ConsultationApprovalProofMethod.REMOTE_SECURE_LINK,
      actedAt: '2026-06-09T10:09:30.000Z',
    })
  })

  it.each([
    ['CANCELLED status', makeRow({ status: BookingStatus.CANCELLED })],
    ['COMPLETED status', makeRow({ status: BookingStatus.COMPLETED })],
    ['finishedAt set', makeRow({ finishedAt: new Date() })],
    ['DONE step', makeRow({ sessionStep: SessionStep.DONE })],
  ])('marks terminal for %s', (_label, row) => {
    expect(buildProSessionState(row).terminal).toBe(true)
  })

  it('exposes checkout and aftercare progress', () => {
    const state = buildProSessionState(
      makeRow({
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: new Date('2026-06-09T11:00:00.000Z'),
        aftercareSummary: {
          draftSavedAt: new Date('2026-06-09T11:05:00.000Z'),
          sentToClientAt: null,
          version: 2,
        },
      }),
    )

    expect(state.checkout.status).toBe(BookingCheckoutStatus.PAID)
    expect(state.checkout.paymentCollectedAt).toBe('2026-06-09T11:00:00.000Z')
    expect(state.aftercare).toEqual({
      draftSavedAt: '2026-06-09T11:05:00.000Z',
      sentToClientAt: null,
      version: 2,
    })
  })
})

describe('computeProSessionStateHash', () => {
  it('is stable for identical state', () => {
    const a = buildProSessionState(makeRow())
    const b = buildProSessionState(makeRow())

    expect(computeProSessionStateHash(a)).toBe(computeProSessionStateHash(b))
  })

  it('is independent of object key insertion order', () => {
    const state = buildProSessionState(makeRow())
    const reordered = Object.fromEntries(
      Object.entries(state).reverse(),
    ) as typeof state

    expect(computeProSessionStateHash(reordered)).toBe(
      computeProSessionStateHash(state),
    )
  })

  it('changes when consultation approval status changes', () => {
    const pending = buildProSessionState(
      makeRow({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationApproval: {
          status: ConsultationApprovalStatus.PENDING,
          approvedAt: null,
          rejectedAt: null,
          updatedAt: new Date('2026-06-09T10:10:00.000Z'),
          proof: null,
        },
      }),
    )
    const approved = buildProSessionState(
      makeRow({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationApproval: {
          status: ConsultationApprovalStatus.APPROVED,
          approvedAt: new Date('2026-06-09T10:11:00.000Z'),
          rejectedAt: null,
          updatedAt: new Date('2026-06-09T10:11:00.000Z'),
          proof: null,
        },
      }),
    )

    expect(computeProSessionStateHash(pending)).not.toBe(
      computeProSessionStateHash(approved),
    )
  })

  it('changes when checkout status changes', () => {
    const before = buildProSessionState(makeRow())
    const after = buildProSessionState(
      makeRow({ checkoutStatus: BookingCheckoutStatus.PAID }),
    )

    expect(computeProSessionStateHash(before)).not.toBe(
      computeProSessionStateHash(after),
    )
  })
})
