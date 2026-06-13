// app/pro/calendar/_hooks/useManagementPanel.test.ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useManagementPanel } from './useManagementPanel'

const mocks = vi.hoisted(() => ({
  apiMessage: vi.fn(),
  safeJson: vi.fn(),
  errorMessageFromUnknown: vi.fn(),
}))

vi.mock('../_utils/parsers', () => ({
  apiMessage: mocks.apiMessage,
}))

vi.mock('@/lib/http', () => ({
  safeJson: mocks.safeJson,
  errorMessageFromUnknown: mocks.errorMessageFromUnknown,
}))

describe('useManagementPanel', () => {
  const fetchMock = vi.fn()

  function renderPanel() {
    const reloadCalendar = vi.fn(async () => {})
    const forceProFooterRefresh = vi.fn()

    const rendered = renderHook(() =>
      useManagementPanel({
        eventsRef: { current: [] },
        reloadCalendar,
        forceProFooterRefresh,
      }),
    )

    return { ...rendered, reloadCalendar, forceProFooterRefresh }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    mocks.apiMessage.mockImplementation(
      (_data: unknown, fallback: string) => fallback,
    )
    mocks.errorMessageFromUnknown.mockImplementation(
      (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
    )
  })

  it('offers an override and retries the accept when advance notice blocks it', async () => {
    mocks.safeJson
      .mockResolvedValueOnce({
        ok: false,
        error:
          'That booking is too soon unless you explicitly override advance notice.',
        code: 'ADVANCE_NOTICE_REQUIRED',
      })
      .mockResolvedValueOnce({ ok: true })

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const { result, reloadCalendar, forceProFooterRefresh } = renderPanel()

    await act(async () => {
      await result.current.approveBookingById('booking_1')
    })

    // No dead end: the override prompt opens instead of a transient error.
    expect(result.current.managementActionError).toBeNull()
    expect(result.current.managementOverridePrompt?.code).toBe(
      'ADVANCE_NOTICE_REQUIRED',
    )
    expect(result.current.managementOverridePrompt?.flag).toBe(
      'allowShortNotice',
    )
    expect(reloadCalendar).not.toHaveBeenCalled()

    // Confirming without a reason does nothing.
    await act(async () => {
      await result.current.confirmManagementOverride()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.setManagementOverrideReason('Regular client, slot just freed up')
    })

    await act(async () => {
      await result.current.confirmManagementOverride()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const retryCall = fetchMock.mock.calls[1]
    expect(String(retryCall?.[0])).toContain('/api/pro/bookings/booking_1')
    expect(retryCall?.[1]?.method).toBe('PATCH')

    const retryBody = JSON.parse(String(retryCall?.[1]?.body))
    expect(retryBody.status).toBe('ACCEPTED')
    expect(retryBody.notifyClient).toBe(true)
    expect(retryBody.allowShortNotice).toBe(true)
    expect(retryBody.overrideReason).toBe('Regular client, slot just freed up')

    expect(result.current.managementOverridePrompt).toBeNull()
    expect(result.current.managementOverrideReason).toBe('')
    expect(reloadCalendar).toHaveBeenCalled()
    expect(forceProFooterRefresh).toHaveBeenCalled()
  })

  it('cancelling the override clears the prompt without retrying', async () => {
    mocks.safeJson.mockResolvedValueOnce({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
    })

    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 })

    const { result } = renderPanel()

    await act(async () => {
      await result.current.approveBookingById('booking_2')
    })

    expect(result.current.managementOverridePrompt?.flag).toBe('allowFarFuture')

    act(() => {
      result.current.cancelManagementOverride()
    })

    expect(result.current.managementOverridePrompt).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a plain error when the override retry is forbidden', async () => {
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

    const { result } = renderPanel()

    await act(async () => {
      await result.current.approveBookingById('booking_3')
    })

    await act(async () => {
      result.current.setManagementOverrideReason('reason')
    })

    await act(async () => {
      await result.current.confirmManagementOverride()
    })

    expect(result.current.managementOverridePrompt).toBeNull()
    expect(result.current.managementActionError).toBe(
      'You are not allowed to use that override.',
    )
  })
})
