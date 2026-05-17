// lib/booking/aftercarePreselectedSlot.test.ts

import {
  AftercareRebookMode,
  ClientActionTokenKind,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import {
  resolveAftercarePreselectedSlot,
  type AftercarePreselectedSlotReader,
  type AftercarePreselectedSlotTokenRow,
} from './aftercarePreselectedSlot'

const now = new Date('2026-06-01T16:00:00.000Z')
const expiresAt = new Date('2026-06-01T17:00:00.000Z')
const rebookedFor = new Date('2026-06-03T18:00:00.000Z')

function makeTokenRow(
  overrides: Partial<AftercarePreselectedSlotTokenRow> = {},
): AftercarePreselectedSlotTokenRow {
  const aftercareSummary =
    overrides.aftercareSummary === undefined
      ? {
          id: 'aftercare_1',
          bookingId: 'booking_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor,
        }
      : overrides.aftercareSummary

  return {
    id: 'token_1',
    kind: ClientActionTokenKind.AFTERCARE_ACCESS,
    bookingId: 'booking_1',
    aftercareSummaryId: 'aftercare_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    expiresAt,
    revokedAt: null,
    aftercareSummary,
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
      startsAt: rebookedFor,
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
            rebookMode: true,
            rebookedFor: true,
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
        aftercareSummary: {
          id: 'aftercare_1',
          bookingId: 'booking_2',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor,
        },
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
        aftercareSummary: {
          id: 'aftercare_2',
          bookingId: 'booking_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor,
        },
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare summary belongs to another booking', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: {
          id: 'aftercare_1',
          bookingId: 'booking_2',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor,
        },
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare mode is NONE', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: {
          id: 'aftercare_1',
          bookingId: 'booking_1',
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor,
        },
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when the aftercare mode is RECOMMENDED_WINDOW', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: {
          id: 'aftercare_1',
          bookingId: 'booking_1',
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookedFor,
        },
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })

  it('returns null when BOOKED_NEXT_APPOINTMENT has no rebookedFor timestamp', async () => {
    const tx = makeReader(
      makeTokenRow({
        aftercareSummary: {
          id: 'aftercare_1',
          bookingId: 'booking_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: null,
        },
      }),
    )

    await expect(resolveAftercarePreselectedSlot(makeArgs(tx))).resolves.toBeNull()
  })
})