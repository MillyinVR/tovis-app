// app/pro/calendar/_hooks/useConfirmChange.test.ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildClientIdempotencyKey } from '@/lib/idempotency/client'

import { useConfirmChange } from './useConfirmChange'

// Frozen so deterministic idempotency keys recomputed in assertions land in
// the same time bucket as the hook's.
const FROZEN_NOW = 1_752_000_000_000

import type { CalendarEvent, PendingChange } from '../_types'

const mocks = vi.hoisted(() => ({
  apiMessage: vi.fn(),
  locationTypeFromBookingValue: vi.fn(),

  computeDurationMinutesFromIso: vi.fn(),
  isOutsideWorkingHours: vi.fn(),
  roundDurationMinutes: vi.fn(),
  snapMinutes: vi.fn(),

  safeJson: vi.fn(),
  errorMessageFromUnknown: vi.fn(),
}))

vi.mock('../_utils/parsers', () => ({
  apiMessage: mocks.apiMessage,
  locationTypeFromBookingValue: mocks.locationTypeFromBookingValue,
}))

vi.mock('../_utils/calendarMath', () => ({
  computeDurationMinutesFromIso: mocks.computeDurationMinutesFromIso,
  isOutsideWorkingHours: mocks.isOutsideWorkingHours,
  roundDurationMinutes: mocks.roundDurationMinutes,
  snapMinutes: mocks.snapMinutes,
}))

vi.mock('../_utils/calendarRange', () => ({
  anchorDayLocalNoon: (yyyy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0)),
}))

vi.mock('@/lib/timeZone', () => ({
  DEFAULT_TIME_ZONE: 'UTC',
  sanitizeTimeZone: (value: string | null | undefined, fallback: string) =>
    value || fallback,
  getZonedParts: (date: Date) => ({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }),
  utcFromDayAndMinutesInTimeZone: (day: Date, minutes: number) =>
    new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
        minutes * 60_000,
    ),
}))

vi.mock('@/lib/http', () => ({
  safeJson: mocks.safeJson,
  errorMessageFromUnknown: mocks.errorMessageFromUnknown,
}))

function makeBookingEvent(overrides: Partial<CalendarEvent> = {}) {
  return {
    id: 'evt_1',
    kind: 'BOOKING',
    status: 'ACCEPTED',
    title: 'Haircut',
    clientName: 'Test Client',
    startsAt: '2026-06-12T14:00:00.000Z',
    endsAt: '2026-06-12T15:00:00.000Z',
    durationMinutes: 60,
    locationId: 'loc_1',
    locationType: 'SALON',
    timeZone: 'UTC',
    timeZoneSource: 'BOOKING_SNAPSHOT',
    localDateKey: '2026-06-12',
    details: {},
    ...overrides,
  } as CalendarEvent
}

function makeMoveChange(): PendingChange {
  return {
    kind: 'move',
    entityType: 'booking',
    eventId: 'evt_1',
    apiId: 'booking_1',
    nextStartIso: '2026-06-12T16:00:00.000Z',
    original: makeBookingEvent(),
  }
}

describe('useConfirmChange', () => {
  const fetchMock = vi.fn()

  function renderConfirmChange() {
    const setEvents = vi.fn()
    const setError = vi.fn()
    const reloadCalendar = vi.fn(async () => {})
    const forceProFooterRefresh = vi.fn()

    const rendered = renderHook(() =>
      useConfirmChange({
        eventsRef: { current: [makeBookingEvent()] },
        setEvents,
        resolveBookingSchedulingContext: () => ({
          timeZone: 'UTC',
          workingHours: null,
          stepMinutes: 15,
        }),
        timeZoneRef: { current: 'UTC' },
        reloadCalendar,
        forceProFooterRefresh,
        setError,
      }),
    )

    return {
      ...rendered,
      setEvents,
      setError,
      reloadCalendar,
      forceProFooterRefresh,
    }
  }

  function bookingPatchCalls() {
    return fetchMock.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/api/v1/pro/bookings/booking_1') &&
        call[1]?.method === 'PATCH',
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)

    mocks.locationTypeFromBookingValue.mockReturnValue('SALON')
    mocks.computeDurationMinutesFromIso.mockReturnValue(60)
    mocks.isOutsideWorkingHours.mockReturnValue(false)
    mocks.roundDurationMinutes.mockImplementation((n: number) => n)
    mocks.snapMinutes.mockImplementation((n: number) => n)
    mocks.apiMessage.mockImplementation(
      (_data: unknown, fallback: string) => fallback,
    )
    mocks.errorMessageFromUnknown.mockImplementation((err: unknown) =>
      err instanceof Error ? err.message : 'Unknown error',
    )
  })

  it('applies an in-hours move without blind override flags', async () => {
    mocks.safeJson.mockResolvedValueOnce({ ok: true })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

    const { result, reloadCalendar, forceProFooterRefresh } =
      renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    const patchCalls = bookingPatchCalls()
    expect(patchCalls).toHaveLength(1)

    const body = JSON.parse(String(patchCalls[0]?.[1]?.body))
    expect(body.scheduledFor).toBe('2026-06-12T16:00:00.000Z')
    expect(body.notifyClient).toBe(true)

    // Override flags must be explicit, so the calendar must never
    // blind-send them with a plain drag move.
    expect(body.allowShortNotice).toBeUndefined()
    expect(body.allowFarFuture).toBeUndefined()
    expect(body.overrideReason).toBeUndefined()

    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.pendingChange).toBeNull()
    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })

  it('offers an override and retries the move when advance notice blocks it', async () => {
    mocks.safeJson
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const { result, setEvents, setError, reloadCalendar } =
      renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    // No dead end and no rollback: the override prompt opens while the
    // optimistic event position is kept for the retry.
    expect(setError).not.toHaveBeenCalled()
    expect(setEvents).not.toHaveBeenCalled()
    expect(result.current.changeOverridePrompt?.code).toBe(
      'ADVANCE_NOTICE_REQUIRED',
    )
    expect(result.current.changeOverridePrompt?.flag).toBe('allowShortNotice')
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.pendingChange).not.toBeNull()
    expect(reloadCalendar).not.toHaveBeenCalled()

    await act(async () => {
      result.current.setChangeOverrideReason('Client asked to move it today')
    })

    await act(async () => {
      await result.current.confirmChangeOverride()
    })

    const patchCalls = bookingPatchCalls()
    expect(patchCalls).toHaveLength(2)

    const retryBody = JSON.parse(String(patchCalls[1]?.[1]?.body))
    expect(retryBody.scheduledFor).toBe('2026-06-12T16:00:00.000Z')
    expect(retryBody.notifyClient).toBe(true)
    expect(retryBody.allowShortNotice).toBe(true)
    expect(retryBody.overrideReason).toBe('Client asked to move it today')

    // The override retry adds flags + a reason, so the body changes and the
    // deterministic key must change with it (same key ⇒ same body, else the
    // ledger 409s on the changed request).
    const firstKey = patchCalls[0]?.[1]?.headers?.['Idempotency-Key']
    const retryKey = patchCalls[1]?.[1]?.headers?.['Idempotency-Key']
    expect(retryKey).toBeTruthy()
    expect(retryKey).not.toBe(firstKey)
    // Both keys are the deterministic client key, not a random UUID.
    expect(firstKey).toMatch(/^pro-calendar-change:booking_1:apply:/)
    expect(retryKey).toMatch(/^pro-calendar-change:booking_1:apply:/)

    expect(result.current.changeOverridePrompt).toBeNull()
    expect(result.current.pendingChange).toBeNull()
    expect(reloadCalendar).toHaveBeenCalled()
  })

  it('replays with the SAME key when the identical change is re-applied', async () => {
    // A double-submit of the exact same move must reuse one key so the server
    // ledger replays the first response instead of re-patching the booking.
    mocks.safeJson.mockResolvedValue({ ok: true })
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const { result } = renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })
    await act(async () => {
      await result.current.applyConfirm()
    })

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })
    await act(async () => {
      await result.current.applyConfirm()
    })

    const patchCalls = bookingPatchCalls()
    expect(patchCalls).toHaveLength(2)

    const firstKey = patchCalls[0]?.[1]?.headers?.['Idempotency-Key']
    const secondKey = patchCalls[1]?.[1]?.headers?.['Idempotency-Key']

    // Identical body within the same time bucket ⇒ identical key.
    const expectedKey = buildClientIdempotencyKey({
      scope: 'pro-calendar-change',
      entityId: 'booking_1',
      action: 'apply',
      nonce: String(patchCalls[0]?.[1]?.body),
    })
    expect(firstKey).toBe(expectedKey)
    expect(secondKey).toBe(firstKey)
  })

  it('retries the override without an overrideReason when none is given', async () => {
    mocks.safeJson
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const { result, reloadCalendar } = renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    expect(result.current.changeOverridePrompt?.flag).toBe('allowShortNotice')

    // The reason is optional: confirming with an empty reason retries with
    // the override flag and omits overrideReason entirely.
    await act(async () => {
      await result.current.confirmChangeOverride()
    })

    const patchCalls = bookingPatchCalls()
    expect(patchCalls).toHaveLength(2)

    const retryBody = JSON.parse(String(patchCalls[1]?.[1]?.body))
    expect(retryBody.allowShortNotice).toBe(true)
    expect(retryBody.overrideReason).toBeUndefined()

    expect(result.current.changeOverridePrompt).toBeNull()
    expect(result.current.pendingChange).toBeNull()
    expect(reloadCalendar).toHaveBeenCalled()
  })

  it('accumulates flags when the override retry trips a second override-gated rule', async () => {
    mocks.safeJson
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' })
      .mockResolvedValueOnce({ ok: false, code: 'OUTSIDE_WORKING_HOURS' })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const { result } = renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    await act(async () => {
      result.current.setChangeOverrideReason('Client travels tomorrow')
    })

    await act(async () => {
      await result.current.confirmChangeOverride()
    })

    // First retry tripped the working-hours rule: dialog stays open.
    expect(result.current.changeOverridePrompt?.code).toBe(
      'OUTSIDE_WORKING_HOURS',
    )

    await act(async () => {
      await result.current.confirmChangeOverride()
    })

    const patchCalls = bookingPatchCalls()
    expect(patchCalls).toHaveLength(3)

    const finalBody = JSON.parse(String(patchCalls[2]?.[1]?.body))
    expect(finalBody.allowShortNotice).toBe(true)
    expect(finalBody.allowOutsideWorkingHours).toBe(true)
    expect(finalBody.overrideReason).toBe('Client travels tomorrow')

    expect(result.current.changeOverridePrompt).toBeNull()
  })

  it('cancelling the override rolls the event back without retrying', async () => {
    mocks.safeJson.mockResolvedValueOnce({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
    })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 })

    const { result, setEvents } = renderConfirmChange()

    const change = makeMoveChange()

    act(() => {
      result.current.openConfirm(change)
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    expect(result.current.changeOverridePrompt).not.toBeNull()

    act(() => {
      result.current.cancelChangeOverride()
    })

    expect(setEvents).toHaveBeenCalledTimes(1)
    expect(result.current.changeOverridePrompt).toBeNull()
    expect(result.current.pendingChange).toBeNull()
    expect(bookingPatchCalls()).toHaveLength(1)
  })

  it('surfaces a plain error and rolls back when the override retry is forbidden', async () => {
    mocks.safeJson
      .mockResolvedValueOnce({ ok: false, code: 'ADVANCE_NOTICE_REQUIRED' })
      .mockResolvedValueOnce({
        ok: false,
        error: 'You are not allowed to use that override.',
        code: 'FORBIDDEN',
      })

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

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 403 })

    const { result, setEvents, setError } = renderConfirmChange()

    act(() => {
      result.current.openConfirm(makeMoveChange())
    })

    await act(async () => {
      await result.current.applyConfirm()
    })

    await act(async () => {
      result.current.setChangeOverrideReason('reason')
    })

    await act(async () => {
      await result.current.confirmChangeOverride()
    })

    expect(result.current.changeOverridePrompt).toBeNull()
    expect(result.current.pendingChange).toBeNull()
    expect(setEvents).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith(
      'You are not allowed to use that override.',
    )
  })
})
