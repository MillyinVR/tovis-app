import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  mediaAssetCount: vi.fn(),
  aftercareSummaryFindFirst: vi.fn(),

  getCurrentUser: vi.fn(),

  redirect: vi.fn(),
  notFound: vi.fn(),

  transitionSessionStep: vi.fn(),
  recordInPersonConsultationDecision: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    mediaAsset: {
      count: mocks.mediaAssetCount,
    },
    aftercareSummary: {
      findFirst: mocks.aftercareSummaryFindFirst,
    },
  },
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('../ConsultationForm', () => ({
  default: ({
    bookingId,
    initialNotes,
    initialPrice,
  }: {
    bookingId: string
    initialNotes: string
    initialPrice: string
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'consultation-form',
        'data-booking-id': bookingId,
        'data-initial-notes': initialNotes,
        'data-initial-price': initialPrice,
      },
      'ConsultationForm',
    ),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  transitionSessionStep: mocks.transitionSessionStep,
  recordInPersonConsultationDecision: mocks.recordInPersonConsultationDecision,
}))

import ProBookingSessionPage from './page'

type PageNode = React.ReactNode

function makeRedirectError(href: string) {
  return Object.assign(new Error(`redirect:${href}`), {
    href,
    digest: 'NEXT_REDIRECT',
  })
}

function makeNotFoundError() {
  return Object.assign(new Error('notFound'), {
    digest: 'NEXT_NOT_FOUND',
  })
}

function makeCurrentUser() {
  return {
    id: 'user_1',
    role: 'PRO',
    professionalProfile: {
      id: 'pro_1',
    },
  }
}

function makeBooking(overrides?: {
  status?: BookingStatus
  sessionStep?: SessionStep | null
  finishedAt?: Date | null
  consultationStatus?: ConsultationApprovalStatus | null
  proof?: {
    id: string
    decision: 'APPROVED' | 'REJECTED'
    method: 'REMOTE_SECURE_LINK' | 'IN_PERSON_PRO_DEVICE'
    actedAt: Date
    recordedByUserId: string | null
    clientActionTokenId: string | null
    contactMethod: 'EMAIL' | 'SMS' | null
    destinationSnapshot: string | null
  } | null
  proposedTotal?: string | null
}) {
  const consultationStatus =
    overrides?.consultationStatus ?? ConsultationApprovalStatus.PENDING

  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    scheduledFor: new Date('2026-04-12T18:00:00.000Z'),
    startedAt: null,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.CONSULTATION_PENDING_CLIENT,

    service: {
      name: 'Haircut',
    },
    client: {
      firstName: 'Tori',
      lastName: 'Morales',
      user: {
        email: 'tori@example.com',
      },
    },

    subtotalSnapshot: '95.00',
    totalAmount: '125.00',
    consultationNotes: 'Client wants a trim and gloss.',

    consultationApproval:
      consultationStatus == null
        ? null
        : {
            status: consultationStatus,
            proposedTotal: overrides?.proposedTotal ?? '125.00',
            notes: 'Please review the plan.',
            approvedAt:
              consultationStatus === ConsultationApprovalStatus.APPROVED
                ? new Date('2026-04-12T19:00:00.000Z')
                : null,
            rejectedAt:
              consultationStatus === ConsultationApprovalStatus.REJECTED
                ? new Date('2026-04-12T19:00:00.000Z')
                : null,
            proof: overrides?.proof ?? null,
          },
  }
}

async function renderPage(args?: {
  booking?: ReturnType<typeof makeBooking>
  beforeCount?: number
  afterCount?: number
  aftercare?: {
    id: string
    publicToken: string
    draftSavedAt: Date | null
    sentToClientAt: Date | null
    lastEditedAt: Date | null
    version: number
  } | null
}) {
  mocks.bookingFindUnique.mockResolvedValueOnce(
    args?.booking ?? makeBooking(),
  )
  mocks.mediaAssetCount
    .mockResolvedValueOnce(args?.beforeCount ?? 0)
    .mockResolvedValueOnce(args?.afterCount ?? 0)
  mocks.aftercareSummaryFindFirst.mockResolvedValueOnce(args?.aftercare ?? null)

  return ProBookingSessionPage({
    params: Promise.resolve({ id: 'booking_1' }),
  })
}

function isFunctionComponent(
  type: React.JSXElementConstructor<unknown>,
): type is (props: unknown) => React.ReactNode {
  return !(
    'prototype' in type &&
    type.prototype &&
    'isReactComponent' in type.prototype
  )
}

function extractText(node: PageNode): string {
  if (node == null || typeof node === 'boolean') return ''

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    const element = node

    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      const rendered = element.type(element.props)
      return extractText(rendered)
    }

    return extractText(element.props.children)
  }

  return ''
}

function hasText(node: PageNode, text: string): boolean {
  return extractText(node).includes(text)
}

describe('app/pro/bookings/[id]/session/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.notFound.mockImplementation(() => {
      throw makeNotFoundError()
    })

    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser())

    mocks.transitionSessionStep.mockResolvedValue({
      ok: true,
      booking: {
        id: 'booking_1',
        sessionStep: SessionStep.CONSULTATION,
        startedAt: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.recordInPersonConsultationDecision.mockResolvedValue({
      booking: {
        id: 'booking_1',
        serviceId: 'svc_1',
        offeringId: 'off_1',
        subtotalSnapshot: '125.00',
        totalDurationMinutes: 75,
        consultationConfirmedAt: new Date('2026-04-12T19:00:00.000Z'),
      },
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: new Date('2026-04-12T19:00:00.000Z'),
        rejectedAt: null,
      },
      proof: {
        id: 'proof_1',
        decision: 'APPROVED',
        method: 'IN_PERSON_PRO_DEVICE',
        actedAt: new Date('2026-04-12T19:00:00.000Z'),
        recordedByUserId: 'user_1',
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('redirects to login when no pro user is available', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProBookingSessionPage({
        params: Promise.resolve({ id: 'booking_1' }),
      }),
    ).rejects.toMatchObject({
      href: '/login?from=%2Fpro%2Fbookings%2Fbooking_1%2Fsession',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('shows waiting state with honest in-person fallback actions when consultation is pending', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationStatus: ConsultationApprovalStatus.PENDING,
        proof: null,
      }),
      beforeCount: 0,
      afterCount: 0,
      aftercare: null,
    })
      expect(hasText(page, 'AWAITING APPROVAL')).toBe(true)
      expect(hasText(page, 'Waiting on client')).toBe(true)
      expect(
        hasText(page, 'Secure approval is required before the session can move forward.'),
      ).toBe(true)
      expect(hasText(page, 'In-person fallback')).toBe(true)
      expect(
        hasText(
          page,
          'Only use this if the client is physically present and cannot access their secure link.',
        ),
      ).toBe(true)
      expect(hasText(page, 'Record approval')).toBe(true)
      expect(hasText(page, 'Record decline')).toBe(true)
      expect(hasText(page, '← Back to consultation')).toBe(true)
  })

  it('maps approved waiting state forward to before photos', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationStatus: ConsultationApprovalStatus.APPROVED,
        proof: {
          id: 'proof_remote_1',
          decision: 'APPROVED',
          method: 'REMOTE_SECURE_LINK',
          actedAt: new Date('2026-04-12T19:00:00.000Z'),
          recordedByUserId: null,
          clientActionTokenId: 'token_1',
          contactMethod: 'EMAIL',
          destinationSnapshot: 'client@example.com',
        },
      }),
    })

    expect(hasText(page, 'Before photos')).toBe(true)
    expect(hasText(page, 'CONSULTATION APPROVED')).toBe(true)
    expect(hasText(page, 'Start service')).toBe(true)
    expect(hasText(page, 'Or add more before photos first')).toBe(true)
    expect(hasText(page, '+ Add photo via camera')).toBe(true)
  })

  it('shows proof details and suppresses in-person fallback when proof already exists', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationStatus: ConsultationApprovalStatus.PENDING,
        proof: {
          id: 'proof_remote_1',
          decision: 'APPROVED',
          method: 'REMOTE_SECURE_LINK',
          actedAt: new Date('2026-04-12T19:00:00.000Z'),
          recordedByUserId: null,
          clientActionTokenId: 'token_1',
          contactMethod: 'EMAIL',
          destinationSnapshot: 'client@example.com',
        },
      }),
    })

    expect(hasText(page, 'Consultation proof recorded')).toBe(true)
    expect(hasText(page, 'Method:')).toBe(true)
    expect(hasText(page, 'Remote secure link')).toBe(true)
    expect(hasText(page, 'Destination:')).toBe(true)
    expect(hasText(page, 'client@example.com')).toBe(true)

    expect(hasText(page, 'Record in-person approval')).toBe(false)
    expect(hasText(page, 'Record in-person decline')).toBe(false)
  })

  it('maps rejected consultation back to consult and shows resend guidance', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        consultationStatus: ConsultationApprovalStatus.REJECTED,
        proof: {
          id: 'proof_reject_1',
          decision: 'REJECTED',
          method: 'REMOTE_SECURE_LINK',
          actedAt: new Date('2026-04-12T19:05:00.000Z'),
          recordedByUserId: null,
          clientActionTokenId: 'token_2',
          contactMethod: 'SMS',
          destinationSnapshot: '+15551234567',
        },
      }),
    })

    expect(hasText(page, 'Consultation')).toBe(true)
    expect(hasText(page, 'Consultation needs changes')).toBe(true)
    expect(hasText(page, 'The last decision was')).toBe(true)
    expect(hasText(page, 'rejected')).toBe(true)
    expect(hasText(page, 'Remote secure link')).toBe(true)
    expect(hasText(page, 'ConsultationForm')).toBe(true)
    expect(hasText(page, 'Proceed to before photos')).toBe(false)
  })

  it('shows completed booking state and aftercare link', async () => {
    const page = await renderPage({
      booking: makeBooking({
        status: BookingStatus.COMPLETED,
        finishedAt: new Date('2026-04-12T20:00:00.000Z'),
        sessionStep: SessionStep.DONE,
        consultationStatus: ConsultationApprovalStatus.APPROVED,
      }),
      aftercare: {
        id: 'aftercare_1',
        publicToken: 'public_1',
        draftSavedAt: new Date('2026-04-12T20:10:00.000Z'),
        sentToClientAt: new Date('2026-04-12T20:15:00.000Z'),
        lastEditedAt: new Date('2026-04-12T20:15:00.000Z'),
        version: 2,
      },
    })

    expect(hasText(page, 'This booking is completed.')).toBe(true)
    expect(hasText(page, 'View aftercare')).toBe(true)
    expect(hasText(page, 'Record in-person approval')).toBe(false)
  })
})