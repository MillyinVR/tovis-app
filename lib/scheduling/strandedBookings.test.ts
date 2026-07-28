// lib/scheduling/strandedBookings.test.ts
//
// B11(c). B8 shipped this module with integration coverage for the SCAN
// (`findBookingsOutsideWorkingHours`, incl. #778's unparseable-week rule) but
// nothing named the two exports either side of it: the wire mapper and the
// best-effort wrapper. Both encode decisions a green scan cannot protect —
// which zone each row renders in, what the wire is allowed to carry, and
// whether a failed report can take down a save that already committed.
import { describe, expect, it, vi } from 'vitest'

import {
  findBookingsOutsideWorkingHoursSafe,
  toStrandedBookingsDTO,
  type StrandedBooking,
  type StrandedBookingReport,
  type StrandedScheduleLocation,
} from './strandedBookings'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

// Mocked at the module rather than passed as `db`, so the test needs no cast to
// stand in for a Prisma client (house rule: no type escapes).
vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findMany: mocks.findMany } },
}))

const OPEN_ALL_WEEK = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: true, start: '09:00', end: '17:00' },
  sun: { enabled: true, start: '09:00', end: '17:00' },
}

function booking(overrides?: Partial<StrandedBooking>): StrandedBooking {
  return {
    id: 'booking_1',
    scheduledFor: new Date('2026-08-04T17:00:00.000Z'),
    durationMinutes: 60,
    locationId: 'loc_1',
    clientName: 'Jane Doe',
    serviceName: 'Balayage',
    ...overrides,
  }
}

function report(items: StrandedBooking[]): StrandedBookingReport {
  return { total: items.length, items }
}

describe('toStrandedBookingsDTO', () => {
  const locations: StrandedScheduleLocation[] = [
    { id: 'loc_1', timeZone: 'America/Los_Angeles', workingHours: null },
    { id: 'loc_2', timeZone: 'Europe/Berlin', workingHours: null },
  ]

  it('renders each row in ITS OWN location zone, not the first one', () => {
    const dto = toStrandedBookingsDTO(
      report([
        booking({ id: 'b_la', locationId: 'loc_1' }),
        booking({ id: 'b_berlin', locationId: 'loc_2' }),
      ]),
      locations,
    )

    expect(dto.items.map((i) => [i.id, i.timeZone])).toEqual([
      ['b_la', 'America/Los_Angeles'],
      ['b_berlin', 'Europe/Berlin'],
    ])
  })

  it('falls back to UTC when the row names a location the save did not carry', () => {
    const dto = toStrandedBookingsDTO(
      report([booking({ locationId: 'loc_missing' })]),
      locations,
    )

    expect(dto.items[0]?.timeZone).toBe('UTC')
  })

  it('serializes the instant as an ISO string and preserves the total', () => {
    const dto = toStrandedBookingsDTO(
      { total: 9, items: [booking()] },
      locations,
    )

    expect(dto.total).toBe(9)
    expect(dto.items).toHaveLength(1)
    expect(dto.items[0]?.scheduledFor).toBe('2026-08-04T17:00:00.000Z')
    expect(dto.items[0]?.durationMinutes).toBe(60)
  })

  /**
   * B8 anchored the row's actions on the BOOKING (`contextType=BOOKING`), which
   * is what let it drop `clientProfileId`/`professionalId` from this DTO
   * entirely. The client's NAME is shown on purpose — it is the pro's own
   * client — but no client IDENTIFIER may ride along.
   */
  it('keeps client and professional identifiers off the wire', () => {
    const dto = toStrandedBookingsDTO(report([booking()]), locations)
    const keys = Object.keys(dto.items[0] ?? {})

    expect(keys).not.toContain('clientProfileId')
    expect(keys).not.toContain('clientId')
    expect(keys).not.toContain('professionalId')
    expect(JSON.stringify(dto)).not.toContain('clientProfileId')
  })

  it('maps an empty report to an empty list', () => {
    expect(toStrandedBookingsDTO(report([]), locations)).toEqual({
      total: 0,
      items: [],
    })
  })
})

describe('findBookingsOutsideWorkingHoursSafe', () => {
  const args = {
    professionalId: 'pro_1',
    locations: [] as StrandedScheduleLocation[],
    now: new Date('2026-08-01T00:00:00.000Z'),
  }

  /**
   * The hours are ALREADY committed when this runs. A throw here would tell the
   * pro their save failed when it did not, so a failed scan answers `null` —
   * "we don't know" — which every surface renders as silence rather than as a
   * reassuring zero. Same rule #778 applied to an unparseable week.
   */
  const openLocation: StrandedScheduleLocation = {
    id: 'loc_1',
    timeZone: 'America/Los_Angeles',
    workingHours: OPEN_ALL_WEEK,
  }

  it('answers null instead of throwing when the scan blows up', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mocks.findMany.mockRejectedValueOnce(new Error('connection lost'))

    await expect(
      findBookingsOutsideWorkingHoursSafe({
        ...args,
        locations: [openLocation],
      }),
    ).resolves.toBeNull()

    expect(mocks.findMany).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('passes a successful scan straight through', async () => {
    mocks.findMany.mockResolvedValueOnce([])

    await expect(
      findBookingsOutsideWorkingHoursSafe({
        ...args,
        locations: [openLocation],
      }),
    ).resolves.toEqual({ total: 0, items: [] })
  })
})
