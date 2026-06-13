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

  function makeBooking(overrides: Record<string, unknown> = {}) {
    return {
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
      timeZoneSource: 'BOOKING_SNAPSHOT',
      serviceItems: [],
      ...overrides,
    }
  }

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
    const booking = makeBooking({
      scheduledFor: '2026-01-15T17:30:00.000Z',
      timeZone: 'America/New_York',
    })

    mocks.parseBookingDetails.mockReturnValue(booking)
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
    expect(result.current.booking?.timeZoneSource).toBe('BOOKING_SNAPSHOT')
    expect(result.current.reschedDate).toBe('2026-01-15')
    expect(result.current.reschedTime).toBe('12:30')
  })

  it('submits scheduledFor using resolved booking scheduling timezone', async () => {
    const booking = makeBooking({
      scheduledFor: '2026-01-15T17:30:00.000Z',
      timeZone: 'America/New_York',
    })

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
    expect(body.notifyClient).toBe(true)
    expect(body.allowOutsideWorkingHours).toBe(false)

    // Override flags need an explicit reason server-side, so they must never
    // be sent blindly with a plain reschedule.
    expect(body.allowShortNotice).toBeUndefined()
    expect(body.allowFarFuture).toBeUndefined()
    expect(body.overrideReason).toBeUndefined()

    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })

  it('uses resolved scheduling timezone for submit even when viewer timezone differs', async () => {
    const booking = makeBooking({
      scheduledFor: '2026-06-01T03:30:00.000Z',
      timeZone: 'America/Chicago',
      timeZoneSource: 'LOCATION',
    })

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

    const { result } = renderHook(() =>
      useBookingModal({
        eventsRef: { current: [] },
        activeStepMinutes: 15,
        activeLocationType: 'SALON',
        timeZone: 'America/Los_Angeles',
        resolveLocationStepMinutes: () => 15,
        resolveBookingSchedulingContext: () => ({
          timeZone: 'America/Chicago',
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

    await act(async () => {
      result.current.setReschedDate('2026-05-31')
      result.current.setReschedTime('23:15')
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
    expect(body.scheduledFor).toBe('2026-06-01T04:15:00.000Z')
  })

  it('offers an override and retries the accept with overrideReason when advance notice blocks it', async () => {
    const booking = makeBooking({ status: 'PENDING' })

    mocks.parseBookingDetails.mockReturnValue(booking)
    mocks.apiMessage.mockImplementation((data: unknown, fallback: string) => {
      if (
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string'
      ) {
        return data.error
      }
      return fallback
    })

    const failPayload = {
      ok: false,
      error:
        'That booking is too soon unless you explicitly override advance notice.',
      code: 'ADVANCE_NOTICE_REQUIRED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
    }

    mocks.safeJson
      .mockResolvedValueOnce({ booking }) // GET booking
      .mockResolvedValueOnce({ services: [] }) // GET services
      .mockResolvedValueOnce(failPayload) // PATCH accept fails
      .mockResolvedValueOnce({ ok: true }) // PATCH override retry succeeds

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

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
      await result.current.approveBooking()
    })

    // The accept must not dead-end: instead of an error, the override prompt opens.
    expect(result.current.bookingError).toBeNull()
    expect(result.current.bookingOverridePrompt?.code).toBe(
      'ADVANCE_NOTICE_REQUIRED',
    )
    expect(result.current.bookingOverridePrompt?.flag).toBe('allowShortNotice')
    expect(result.current.bookingOverrideIntent).toBe('accept')
    expect(reloadCalendar).not.toHaveBeenCalled()

    // Confirming without a reason does nothing.
    const patchCallsBefore = fetchMock.mock.calls.filter(
      (call) => call[1]?.method === 'PATCH',
    ).length

    await act(async () => {
      await result.current.confirmBookingOverride()
    })

    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH').length,
    ).toBe(patchCallsBefore)

    await act(async () => {
      result.current.setBookingOverrideReason('Client asked for a same-day slot')
    })

    await act(async () => {
      await result.current.confirmBookingOverride()
    })

    const patchCalls = fetchMock.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/api/pro/bookings/booking_1') &&
        call[1]?.method === 'PATCH',
    )

    expect(patchCalls).toHaveLength(2)

    const retryBody = JSON.parse(String(patchCalls[1]?.[1]?.body))
    expect(retryBody.status).toBe('ACCEPTED')
    expect(retryBody.notifyClient).toBe(true)
    expect(retryBody.allowShortNotice).toBe(true)
    expect(retryBody.overrideReason).toBe('Client asked for a same-day slot')

    // Each attempt must use a fresh idempotency key (different body).
    const firstKey = patchCalls[0]?.[1]?.headers?.['Idempotency-Key']
    const retryKey = patchCalls[1]?.[1]?.headers?.['Idempotency-Key']
    expect(retryKey).toBeTruthy()
    expect(retryKey).not.toBe(firstKey)

    expect(result.current.bookingOverridePrompt).toBeNull()
    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })

  it('accumulates flags when the override retry trips a second override-gated rule', async () => {
    const booking = makeBooking({ status: 'PENDING' })

    mocks.parseBookingDetails.mockReturnValue(booking)

    mocks.safeJson
      .mockResolvedValueOnce({ booking })
      .mockResolvedValueOnce({ services: [] })
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' })
      .mockResolvedValueOnce({ ok: false, code: 'OUTSIDE_WORKING_HOURS' })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

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

    await act(async () => {
      await result.current.approveBooking()
    })

    await act(async () => {
      result.current.setBookingOverrideReason('Client travels tomorrow')
    })

    await act(async () => {
      await result.current.confirmBookingOverride()
    })

    // First retry tripped the working-hours rule: dialog stays open with new prompt.
    expect(result.current.bookingOverridePrompt?.code).toBe(
      'OUTSIDE_WORKING_HOURS',
    )

    await act(async () => {
      await result.current.confirmBookingOverride()
    })

    const patchCalls = fetchMock.mock.calls.filter(
      (call) => call[1]?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(3)

    const finalBody = JSON.parse(String(patchCalls[2]?.[1]?.body))
    expect(finalBody.allowShortNotice).toBe(true)
    expect(finalBody.allowOutsideWorkingHours).toBe(true)
    expect(finalBody.overrideReason).toBe('Client travels tomorrow')

    expect(result.current.bookingOverridePrompt).toBeNull()
  })

  it('offers an edit override and retries the reschedule when advance notice blocks it', async () => {
    const booking = makeBooking({
      scheduledFor: '2026-01-15T17:30:00.000Z',
      timeZone: 'America/New_York',
    })

    mocks.parseBookingDetails.mockReturnValue(booking)

    mocks.safeJson
      .mockResolvedValueOnce({ booking }) // GET booking
      .mockResolvedValueOnce({ services: [] }) // GET services
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' }) // PATCH reschedule fails
      .mockResolvedValueOnce({ ok: true }) // PATCH override retry succeeds

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

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

    // No dead end: the edit-intent override prompt opens instead of an error.
    expect(result.current.bookingError).toBeNull()
    expect(result.current.bookingOverridePrompt?.code).toBe(
      'ADVANCE_NOTICE_REQUIRED',
    )
    expect(result.current.bookingOverridePrompt?.flag).toBe('allowShortNotice')
    expect(result.current.bookingOverrideIntent).toBe('edit')
    expect(reloadCalendar).not.toHaveBeenCalled()

    await act(async () => {
      result.current.setBookingOverrideReason('Client asked to move it today')
    })

    await act(async () => {
      await result.current.confirmBookingOverride()
    })

    const patchCalls = fetchMock.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/api/pro/bookings/booking_1') &&
        call[1]?.method === 'PATCH',
    )

    expect(patchCalls).toHaveLength(2)

    // First attempt carries no override flags at all.
    const firstBody = JSON.parse(String(patchCalls[0]?.[1]?.body))
    expect(firstBody.scheduledFor).toBe('2026-01-15T18:15:00.000Z')
    expect(firstBody.allowShortNotice).toBeUndefined()
    expect(firstBody.overrideReason).toBeUndefined()

    // The retry re-sends the same reschedule plus the explicit override.
    const retryBody = JSON.parse(String(patchCalls[1]?.[1]?.body))
    expect(retryBody.scheduledFor).toBe('2026-01-15T18:15:00.000Z')
    expect(retryBody.notifyClient).toBe(true)
    expect(retryBody.allowShortNotice).toBe(true)
    expect(retryBody.overrideReason).toBe('Client asked to move it today')
    expect(retryBody.status).toBeUndefined()

    expect(result.current.bookingOverridePrompt).toBeNull()
    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })
})