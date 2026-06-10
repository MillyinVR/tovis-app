// app/pro/bookings/[id]/session/layout.test.tsx

import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
  },
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('./SessionStatePoller', () => ({
  default: ({
    bookingId,
    initialStateHash,
  }: {
    bookingId: string
    initialStateHash?: string | null
  }) =>
    React.createElement('div', {
      'data-testid': 'session-state-poller',
      'data-booking-id': bookingId,
      'data-initial-state-hash': initialStateHash ?? '',
    }),
}))

import ProBookingSessionLayout from './layout'

const PRO_USER = {
  id: 'user_1',
  role: 'PRO',
  professionalProfile: { id: 'pro_1' },
}

function makeBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
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

async function renderLayout(id = 'booking_1') {
  const element = await ProBookingSessionLayout({
    children: React.createElement('div', { 'data-testid': 'page-content' }),
    params: Promise.resolve({ id }),
  })

  return render(element)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue(PRO_USER)
  mocks.bookingFindUnique.mockResolvedValue(makeBookingRow())
})

describe('ProBookingSessionLayout', () => {
  it('mounts the poller with an initial hash for the owning pro', async () => {
    await renderLayout()

    const poller = screen.getByTestId('session-state-poller')
    expect(poller.getAttribute('data-booking-id')).toBe('booking_1')
    expect(poller.getAttribute('data-initial-state-hash')).toMatch(/^[a-f0-9]{64}$/)
    expect(screen.getByTestId('page-content')).toBeTruthy()
  })

  it('does not mount the poller for terminal bookings', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBookingRow({
        status: BookingStatus.COMPLETED,
        finishedAt: new Date(),
        sessionStep: SessionStep.DONE,
      }),
    )

    await renderLayout()

    expect(screen.queryByTestId('session-state-poller')).toBeNull()
    expect(screen.getByTestId('page-content')).toBeTruthy()
  })

  it('does not mount the poller when the booking belongs to another pro', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBookingRow({ professionalId: 'pro_other' }),
    )

    await renderLayout()

    expect(screen.queryByTestId('session-state-poller')).toBeNull()
  })

  it('does not mount the poller for logged-out or non-pro users', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    await renderLayout()

    expect(screen.queryByTestId('session-state-poller')).toBeNull()
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('renders children even when the booking lookup fails', async () => {
    mocks.bookingFindUnique.mockResolvedValue(null)

    await renderLayout()

    expect(screen.queryByTestId('session-state-poller')).toBeNull()
    expect(screen.getByTestId('page-content')).toBeTruthy()
  })
})
