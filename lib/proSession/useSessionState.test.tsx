import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionState } from './useSessionState'

const fetchMock = vi.fn()

let visibility: DocumentVisibilityState = 'visible'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function okState(stateHash: string, terminal = false) {
  return jsonResponse({
    ok: true,
    state: { terminal },
    stateHash,
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)

  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useSessionState', () => {
  it('establishes a baseline on the first poll without firing onChange', async () => {
    const onChange = vi.fn()
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_1')))

    const { result } = renderHook(() =>
      useSessionState({ bookingId: 'booking_1', onChange }),
    )

    await advance(7000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/bookings/booking_1/session/state',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.stateHash).toBe('hash_1')
  })

  it('fires onChange when the hash changes between polls', async () => {
    const onChange = vi.fn()
    fetchMock
      .mockResolvedValueOnce(okState('hash_1'))
      .mockResolvedValueOnce(okState('hash_2'))

    renderHook(() => useSessionState({ bookingId: 'booking_1', onChange }))

    await advance(7000)
    expect(onChange).not.toHaveBeenCalled()

    await advance(7000)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('hash_2')
  })

  it('fires onChange on the first poll when it differs from the server-rendered hash', async () => {
    const onChange = vi.fn()
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_2')))

    renderHook(() =>
      useSessionState({
        bookingId: 'booking_1',
        initialStateHash: 'hash_1',
        onChange,
      }),
    )

    await advance(7000)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('hash_2')
  })

  it('stops polling after a terminal state', async () => {
    const onChange = vi.fn()
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_done', true)))

    const { result } = renderHook(() =>
      useSessionState({ bookingId: 'booking_1', onChange }),
    )

    await advance(7000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.terminal).toBe(true)

    await advance(30000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the booking is gone or no longer ours', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: false }, 404)))

    const { result } = renderHook(() =>
      useSessionState({ bookingId: 'booking_1' }),
    )

    await advance(7000)
    expect(result.current.terminal).toBe(true)

    await advance(30000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling through transient failures', async () => {
    const onChange = vi.fn()
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 500))
      .mockResolvedValueOnce(okState('hash_1'))

    const { result } = renderHook(() =>
      useSessionState({ bookingId: 'booking_1', onChange }),
    )

    await advance(7000)
    await advance(7000)
    await advance(7000)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.stateHash).toBe('hash_1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('skips ticks while the tab is hidden and catches up on visibility', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_1')))

    renderHook(() => useSessionState({ bookingId: 'booking_1' }))

    visibility = 'hidden'
    await advance(7000)
    expect(fetchMock).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clamps the polling interval to at least 5 seconds', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_1')))

    renderHook(() =>
      useSessionState({ bookingId: 'booking_1', intervalMs: 1000 }),
    )

    await advance(4999)
    expect(fetchMock).not.toHaveBeenCalled()

    await advance(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not poll when disabled', async () => {
    renderHook(() =>
      useSessionState({ bookingId: 'booking_1', enabled: false }),
    )

    await advance(30000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops polling on unmount', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okState('hash_1')))

    const { unmount } = renderHook(() =>
      useSessionState({ bookingId: 'booking_1' }),
    )

    await advance(7000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()
    await advance(30000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
