// lib/booking/aftercarePreselectedSlot.test.ts

import {
  ClientActionTokenKind,
  ServiceLocationType,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import {
  resolveAftercarePreselectedSlot,
  type AftercarePreselectedSlotReader,
  type AftercarePreselectedSlotTokenRow,
} from './aftercarePreselectedSlot'

const now = new Date('2026-06-01T16:00:00.000Z')
const expiresAt = new Date('2026-06-01T17:00:00.000Z')
const startsAt = new Date('2026-06-03T18:00:00.000Z')
const endsAt = new Date('2026-06-03T19:15:00.000Z')

function makeRebookSlot(
  overrides: Partial<
    NonNullable<
      NonNullable<AftercarePreselectedSlotTokenRow['aftercareSummary']>['rebookSlot']
    >
  > = {},
) {
  return {
    id: 'aftercare_rebook_slot_1',
    professionalId: 'pro_1',
    offeringId: 'offering_1',
    locationId: 'location_1',
    locationType: ServiceLocationType.SALON,
    startsAt,
    endsAt,
    ...overrides,
  }
}

function makeAftercareSummary(
  overrides: Partial<
    NonNullable<AftercarePreselectedSlotTokenRow['aftercareSummary']>
  > = {},
): NonNullable<AftercarePreselectedSlotTokenRow['aftercareSummary']> {
  return {
    id: 'aftercare_1',
    bookingId: 'booking_1',
    rebookSlot: makeRebookSlot(),
    ...overrides,
  }
}

function makeTokenRow(
  overrides: Partial<AftercarePreselectedSlotTokenRow> = {},
): AftercarePreselectedSlotTokenRow {
  return {
    id: 'token_1',
    kind: ClientActionTokenKind.AFTERCARE_ACCESS,
    bookingId: 'booking_1',
    aftercareSummaryId: 'aftercare_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    expiresAt,
    revokedAt: null,
    aftercareSummary:
      overrides.aftercareSummary === undefined
        ? makeAftercareSummary()
        : overrides.aftercareSummary,
    ...overrides,
  }
}

function makeReader(
  token: AftercarePreselectedSlotTokenRow | null,
): AftercarePreselectedSlotReader {
  return {
    clientActionToken: {
      findUnique: vi.fn(() => Promise.resolve(token)),
    },
  }
}

function makeArgs(
  tx: AftercarePreselectedSlotReader,
): Parameters<typeof resolveAftercarePreselectedSlot>[0] {
  return {
    tx,
    clientActionTokenId: 'token_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    bookingId: 'booking_1',
    now,
  }
}

describe('resolveAftercarePreselectedSlot', () => {
  it('returns the pro-preselected slot for a valid aftercare access token', async () => {
    const tx = makeReader(makeTokenRow())

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toEqual({
      aftercareSummaryId: 'aftercare_1',
      clientActionTokenId: 'token_1',
      professionalId: 'pro_1',
      offeringId: 'offering_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      startsAt,
      endsAt,
    })

    expect(tx.clientActionToken.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'token_1',
      },
      select: {
        id: true,
        kind: true,
        bookingId: true,
        aftercareSummaryId: true,
        clientId: true,
        professionalId: true,
        expiresAt: true,
        revokedAt: true,
        aftercareSummary: {
          select: {
            id: true,
            bookingId: true,
            rebookSlot: {
              select: {
                id: true,
                professionalId: true,
                offeringId: true,
                locationId: true,
                locationType: true,
                startsAt: true,
                endsAt: true,
              },
            },
          },
        },
      },
    })
  })

  it('returns null when the token does not exist', async () => {
    const tx = makeReader(null)

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token kind is not AFTERCARE_ACCESS', async () => {
    const tx = makeReader(
      makeTokenRow({
        kind: ClientActionTokenKind.CONSULTATION_ACTION,
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token belongs to another client', async () => {
    const tx = makeReader(
      makeTokenRow({
        clientId: 'client_2',
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token belongs to another professional', async () => {
    const tx = makeReader(
      makeTokenRow({
        professionalId: 'pro_2',
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token belongs to another booking', async () => {
    const tx = makeReader(
      makeTokenRow({
        bookingId: 'booking_2',
        aftercareSummary: makeAftercareSummary({
          bookingId: 'booking_2',
        }),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token has no aftercare summary id', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummaryId: null,
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token is revoked', async () => {
    const tx = makeReader(
      makeTokenRow({
        revokedAt: new Date('2026-06-01T15:00:00.000Z'),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the token is expired', async () => {
    const tx = makeReader(
      makeTokenRow({
        expiresAt: now,
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare summary relation is missing', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: null,
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare summary id mismatches the token summary id', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummaryId: 'aftercare_1',
        aftercareSummary: makeAftercareSummary({
          id: 'aftercare_2',
        }),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare summary belongs to another booking', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: makeAftercareSummary({
          bookingId: 'booking_2',
        }),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare summary has no rebook slot', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: makeAftercareSummary({
          rebookSlot: null,
        }),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the rebook slot belongs to another professional', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: makeAftercareSummary({
          rebookSlot: makeRebookSlot({
            professionalId: 'pro_2',
          }),
        }),
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })
})