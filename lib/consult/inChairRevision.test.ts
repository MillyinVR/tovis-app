// lib/consult/inChairRevision.test.ts
//
// Book the Look, B6 — the row-level half of the revision notice. The DB read is
// trivial; the judgement is not, and every state where the question CANNOT be
// asked must answer null rather than a comforting "no big change".

import { ConsultationApprovalStatus, Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { deriveConsultRevisionState } from './inChairRevision'

type Row = Parameters<typeof deriveConsultRevisionState>[0]

const SENT_ITEMS = {
  currency: 'USD',
  items: [
    {
      bookingServiceItemId: null,
      offeringId: 'off_1',
      serviceId: 'svc_1',
      itemType: 'BASE',
      label: 'Full balayage',
      categoryName: null,
      price: '240.00',
      durationMinutes: 120,
      notes: null,
      sortOrder: 0,
      source: 'PROPOSAL',
    },
  ],
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'bk_1',
    clientId: 'cl_1',
    consultBookingProposal: {
      startingAtPrice: new Prisma.Decimal('200.00'),
      totalDurationMinutes: 90,
    },
    consultationApproval: {
      id: 'ca_1',
      status: ConsultationApprovalStatus.PENDING,
      proposedTotal: new Prisma.Decimal('240.00'),
      proposedServicesJson: SENT_ITEMS,
    },
    ...overrides,
  }
}

describe('deriveConsultRevisionState', () => {
  it('judges the pending proposal against what the client committed to', () => {
    const state = deriveConsultRevisionState(row())

    expect(state?.consultationApprovalId).toBe('ca_1')
    // $200 → $240 is +20%, past the 10% line; 90 → 120 min is +30, at the line.
    expect(state?.notice.bigChange).toBe(true)
    expect(state?.notice.reasons).toEqual(['PRICE', 'DURATION'])
    expect(state?.notice.committedPriceCents).toBe(20000)
    expect(state?.notice.finalPriceCents).toBe(24000)
    expect(state?.notice.finalDurationMinutes).toBe(120)
  })

  it('returns a quiet notice for a small adjustment, not null', () => {
    const state = deriveConsultRevisionState(
      row({
        consultationApproval: {
          id: 'ca_1',
          status: ConsultationApprovalStatus.PENDING,
          proposedTotal: new Prisma.Decimal('210.00'),
          proposedServicesJson: {
            ...SENT_ITEMS,
            items: [{ ...SENT_ITEMS.items[0], price: '210.00', durationMinutes: 90 }],
          },
        },
      }),
    )

    expect(state).not.toBeNull()
    expect(state?.notice.bigChange).toBe(false)
  })

  it('is null on a booking with no look-anchored proposal behind it', () => {
    expect(
      deriveConsultRevisionState(row({ consultBookingProposal: null })),
    ).toBeNull()
  })

  it('is null once the proposal has been answered', () => {
    expect(
      deriveConsultRevisionState(
        row({
          consultationApproval: {
            id: 'ca_1',
            status: ConsultationApprovalStatus.APPROVED,
            proposedTotal: new Prisma.Decimal('240.00'),
            proposedServicesJson: SENT_ITEMS,
          },
        }),
      ),
    ).toBeNull()
  })

  it('is null — never a reassurance — when the proposal cannot be read', () => {
    expect(
      deriveConsultRevisionState(
        row({
          consultationApproval: {
            id: 'ca_1',
            status: ConsultationApprovalStatus.PENDING,
            proposedTotal: new Prisma.Decimal('240.00'),
            proposedServicesJson: { items: [] },
          },
        }),
      ),
    ).toBeNull()
  })
})
