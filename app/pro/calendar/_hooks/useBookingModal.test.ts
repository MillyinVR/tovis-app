// app/pro/calendar/_hooks/useBookingModal.test.ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookingModal } from './useBookingModal'

const mocks = vi.hoisted(() => ({
  apiMessage: vi.fn(),
  locationTypeFromBookingValue: vi.fn(),
  parseBookingDetails: vi.fn(),
  parseServiceOptions: vi.fn(),

  roundDurationMinutes: vi.fn(),
  isOutsideWorkingHours: vi.fn(),

  serviceItemsTotalDuration: vi.fn(),
  serviceItemsLabel: vi.fn(),
  buildDraftItemFromServiceOption: vi.fn(),
  normalizeDraftServiceItems: vi.fn(),
  sameServiceItems: vi.fn(),

  safeJson: vi.fn(),
  errorMessageFromUnknown: vi.fn(),
}))

vi.mock('../_utils/parsers', () => ({
  apiMessage: mocks.apiMessage,
  locationTypeFromBookingValue: mocks.locationTypeFromBookingValue,
  parseBookingDetails: mocks.parseBookingDetails,
  parseServiceOptions: mocks.parseServiceOptions,
}))

vi.mock('../_utils/calendarMath', () => ({
  roundDurationMinutes: mocks.roundDurationMinutes,
  isOutsideWorkingHours: mocks.isOutsideWorkingHours,
}))

vi.mock('../_utils/serviceItems', () => ({
  serviceItemsTotalDuration: mocks.serviceItemsTotalDuration,
  serviceItemsLabel: mocks.serviceItemsLabel,
  buildDraftItemFromServiceOption: mocks.buildDraftItemFromServiceOption,
  normalizeDraftServiceItems: mocks.normalizeDraftServiceItems,
  sameServiceItems: mocks.sameServiceItems,
}))

vi.mock('@/lib/http', () => ({
  safeJson: mocks.safeJson,
  errorMessageFromUnknown: mocks.errorMessageFromUnknown,
}))

describe('useBookingModal', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    mocks.locationTypeFromBookingValue.mockReturnValue('SALON')
    mocks.roundDurationMinutes.mockImplementation((n: number) => n)
    mocks.isOutsideWorkingHours.mockReturnValue(false)
    mocks.serviceItemsTotalDuration.mockReturnValue(60)
    mocks.serviceItemsLabel.mockReturnValue('Haircut')
    mocks.normalizeDraftServiceItems.mockImplementation((items: unknown) => items)
    mocks.sameServiceItems.mockReturnValue(true)
    mocks.parseServiceOptions.mockReturnValue([])
    mocks.apiMessage.mockImplementation(
      (_data: unknown, fallback: string) => fallback,
    )
    mocks.errorMessageFromUnknown.mockImplementation((err: unknown) =>
      err instanceof Error ? err.message : 'Unknown error',
    )
  })

  it('initializes reschedule form values from booking timezone, not viewer timezone', async () => {
    mocks.parseBookingDetails.mockReturnValue({
      id: 'booking_1',
      status: 'ACCEPTED',
      scheduledFor: '2026-01-15T17:30:00.000Z',
      endsAt: '2026-01-15T18:30:00.000Z',
      locationId: 'loc_1',
      locationType: 'SALON',
      totalDurationMinutes: 60,
      client: {
        fullName: 'Test Client',
        email: 'test@example.com',
        phone: null,
      },
      timeZone: 'America/New_York',
      serviceItems: [],
    })

    mocks.safeJson
      .mockResolvedValueOnce({ booking: { id: 'booking_1' } })
      .mockResolvedValueOnce({ services: [] })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ booking: { id: 'booking_1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ services: [] }),
      })

    const { result } = renderHook(() =>
      useBookingModal({
        eventsRef: { current: [] },
        activeStepMinutes: 15,
        activeLocationType: 'SALON',
        timeZone: 'America/Los_Angeles',
        resolveLocationStepMinutes: () => 15,
        resolveBookingSchedulingContext: () => ({
          timeZone: 'America/New_York',
          workingHours: null,
          stepMinutes: 15,
        }),
        reloadCalendar: async () => {},
        forceProFooterRefresh: () => {},
        locations: [],
      }),
    )

    await act(async () => {
      await result.current.openBooking('booking_1')
    })

    expect(result.current.booking?.timeZone).toBe('America/New_York')
    expect(result.current.reschedDate).toBe('2026-01-15')
    expect(result.current.reschedTime).toBe('12:30')
  })

  it('submits scheduledFor using resolved booking scheduling timezone', async () => {
    const booking = {
      id: 'booking_1',
      status: 'ACCEPTED',
      scheduledFor: '2026-01-15T17:30:00.000Z',
      endsAt: '2026-01-15T18:30:00.000Z',
      locationId: 'loc_1',
      locationType: 'SALON',
      totalDurationMinutes: 60,
      client: {
        fullName: 'Test Client',
        email: 'test@example.com',
        phone: null,
      },
      timeZone: 'America/New_York',
      serviceItems: [],
    }

    mocks.parseBookingDetails.mockReturnValue(booking)
    mocks.safeJson
      .mockResolvedValueOnce({ booking })
      .mockResolvedValueOnce({ services: [] })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ booking }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ services: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })

    const reloadCalendar = vi.fn(async () => {})
    const forceProFooterRefresh = vi.fn()

    const { result } = renderHook(() =>
      useBookingModal({
        eventsRef: { current: [] },
        activeStepMinutes: 15,
        activeLocationType: 'SALON',
        timeZone: 'America/Los_Angeles',
        resolveLocationStepMinutes: () => 15,
        resolveBookingSchedulingContext: () => ({
          timeZone: 'America/New_York',
          workingHours: null,
          stepMinutes: 15,
        }),
        reloadCalendar,
        forceProFooterRefresh,
        locations: [],
      }),
    )

    await act(async () => {
      await result.current.openBooking('booking_1')
    })

    await act(async () => {
      result.current.setReschedDate('2026-01-15')
      result.current.setReschedTime('13:15')
    })

    await act(async () => {
      await result.current.submitChanges()
    })

    const patchCall = fetchMock.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/api/pro/bookings/booking_1') &&
        call[1]?.method === 'PATCH',
    )

    expect(patchCall).toBeTruthy()

    const body = JSON.parse(String(patchCall?.[1]?.body))
    expect(body.scheduledFor).toBe('2026-01-15T18:15:00.000Z')

    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })
})