// app/_components/ProSessionFooter/useProSession.test.tsx
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FORCE_EVENT, useProSession } from './useProSession'

const navMocks = vi.hoisted(() => {
  const routerPush = vi.fn()
  const routerRefresh = vi.fn()
  const pathnameMock = vi.fn()

  return {
    routerPush,
    routerRefresh,
    pathnameMock,
    router: {
      push: routerPush,
      refresh: routerRefresh,
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => navMocks.router,
  usePathname: () => navMocks.pathnameMock(),
}))

vi.mock('@/lib/http', () => ({
  safeJson: async (res: Response) => res.json(),
}))

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(init?: Parameters<typeof fetch>[1]): string {
  return init?.method?.toUpperCase() ?? 'GET'
}

type FetchResponseQueue = {
  session?: Response[]
  start?: Record<string, Response[]>
  finish?: Record<string, Response[]>
}

function installFetchQueue(queue: FetchResponseQueue) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input)
    const method = requestMethod(init)

    if (url === '/api/v1/pro/session' && method === 'GET') {
      const next = queue.session?.shift()
      return next ?? jsonResponse(idlePayload)
    }

    const startMatch = url.match(
      /^\/api\/v1\/pro\/bookings\/([^/]+)\/session\/start$/,
    )
    if (method === 'POST' && startMatch) {
      const bookingId = decodeURIComponent(startMatch[1] ?? '')
      const next = queue.start?.[bookingId]?.shift()
      return (
        next ??
        jsonResponse(
          { ok: false, error: 'Unexpected start request.' },
          { status: 500 },
        )
      )
    }

    const finishMatch = url.match(
      /^\/api\/v1\/pro\/bookings\/([^/]+)\/session\/finish$/,
    )
    if (method === 'POST' && finishMatch) {
      const bookingId = decodeURIComponent(finishMatch[1] ?? '')
      const next = queue.finish?.[bookingId]?.shift()
      return (
        next ??
        jsonResponse(
          { ok: false, error: 'Unexpected finish request.' },
          { status: 500 },
        )
      )
    }

    return jsonResponse(
      { ok: false, error: `Unexpected request: ${method} ${url}` },
      { status: 500 },
    )
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

const idlePayload = {
  ok: true,
  mode: 'IDLE',
  booking: null,
  eligibleBookings: null,
  targetStep: null,
  center: {
    label: 'Start',
    action: 'NONE',
    href: null,
  },
}

const upcomingPayload = {
  ok: true,
  mode: 'UPCOMING',
  booking: {
    id: 'booking_1',
    serviceName: 'Cut',
    clientName: 'Tori Morales',
    scheduledFor: '2026-05-14T18:00:00.000Z',
    sessionStep: 'NONE',
  },
  eligibleBookings: null,
  targetStep: 'consult',
  center: {
    label: 'Start',
    action: 'START',
    href: '/pro/bookings/booking_1/session',
  },
}

const pickerPayload = {
  ok: true,
  mode: 'UPCOMING_PICKER',
  booking: null,
  eligibleBookings: [
    {
      id: 'booking_a',
      serviceName: 'Cut',
      clientName: 'Tori Morales',
      scheduledFor: '2026-05-14T18:00:00.000Z',
      sessionStep: 'NONE',
    },
    {
      id: 'booking_b',
      serviceName: 'Color',
      clientName: 'Client Two',
      scheduledFor: '2026-05-14T18:15:00.000Z',
      sessionStep: 'NONE',
    },
  ],
  targetStep: 'consult',
  center: {
    label: 'Choose booking',
    action: 'PICK_BOOKING',
    href: null,
  },
}

const activeFinishPayload = {
  ok: true,
  mode: 'ACTIVE',
  booking: {
    id: 'booking_1',
    serviceName: 'Cut',
    clientName: 'Tori Morales',
    scheduledFor: '2026-05-14T18:00:00.000Z',
    sessionStep: 'SERVICE_IN_PROGRESS',
  },
  eligibleBookings: null,
  targetStep: 'session',
  center: {
    label: 'Finish service',
    action: 'FINISH',
    href: null,
  },
}

const activeNavigatePayload = {
  ok: true,
  mode: 'ACTIVE',
  booking: {
    id: 'booking_1',
    serviceName: 'Cut',
    clientName: 'Tori Morales',
    scheduledFor: '2026-05-14T18:00:00.000Z',
    sessionStep: 'AFTER_PHOTOS',
  },
  eligibleBookings: null,
  targetStep: 'session',
  center: {
    label: 'Send aftercare',
    action: 'NAVIGATE',
    href: '/pro/bookings/booking_1/aftercare',
  },
}

const unsafeNavigatePayload = {
  ...activeNavigatePayload,
  center: {
    label: 'Bad href',
    action: 'NAVIGATE',
    href: 'https://evil.test/nope',
  },
}

describe('useProSession', () => {
  beforeEach(() => {
    navMocks.pathnameMock.mockReturnValue('/pro/calendar')
    navMocks.routerPush.mockClear()
    navMocks.routerRefresh.mockClear()

    vi.spyOn(Math, 'random').mockReturnValue(0)

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'uuid_1'),
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    window.history.pushState({}, '', '/pro/calendar?tab=today')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads an idle session and disables the center action', async () => {
    const fetchMock = installFetchQueue({
      session: [jsonResponse(idlePayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.mode).toBe('IDLE')
    expect(result.current.booking).toBeNull()
    expect(result.current.center).toEqual({
      label: 'Start',
      action: 'NONE',
      href: null,
    })
    expect(result.current.centerDisabled).toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pro/session', {
      method: 'GET',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })

    unmount()
  })

  it('loads an upcoming booking and enables start', async () => {
    installFetchQueue({
      session: [jsonResponse(upcomingPayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING')
    })

    expect(result.current.booking?.id).toBe('booking_1')
    expect(result.current.displayLabel).toBe('Start')
    expect(result.current.centerDisabled).toBe(false)

    unmount()
  })

  it('redirects to login when initial session load returns 401', async () => {
    installFetchQueue({
      session: [
        jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 }),
      ],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(navMocks.routerPush).toHaveBeenCalledWith(
        '/login?from=%2Fpro%2Fcalendar%3Ftab%3Dtoday&reason=pro-session',
      )
    })

    expect(result.current.mode).toBe('IDLE')

    unmount()
  })

  it('opens the picker for PICK_BOOKING without posting', async () => {
    const fetchMock = installFetchQueue({
      session: [jsonResponse(pickerPayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING_PICKER')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(result.current.pickerOpen).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navMocks.routerPush).not.toHaveBeenCalled()

    unmount()
  })

  it('starts the selected booking from the picker and navigates to nextHref', async () => {
    const fetchMock = installFetchQueue({
      session: [
        jsonResponse(pickerPayload),
        jsonResponse({
          ...activeNavigatePayload,
          booking: {
            ...activeNavigatePayload.booking,
            id: 'booking_b',
          },
          center: {
            label: 'Continue',
            action: 'NAVIGATE',
            href: '/pro/bookings/booking_b/session',
          },
        }),
      ],
      start: {
        booking_b: [
          jsonResponse({
            ok: true,
            nextHref: '/pro/bookings/booking_b/session',
          }),
        ],
      },
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING_PICKER')
    })

    await act(async () => {
      await result.current.startSelectedBooking(' booking_b ')
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/bookings/booking_b/session/start',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': 'uuid_1',
          'x-idempotency-key': 'uuid_1',
        },
      },
    )

    expect(navMocks.routerPush).toHaveBeenCalledWith(
      '/pro/bookings/booking_b/session',
    )
    expect(result.current.pickerOpen).toBe(false)

    unmount()
  })

  it('starts the current upcoming booking from the center button', async () => {
    const fetchMock = installFetchQueue({
      session: [
        jsonResponse(upcomingPayload),
        jsonResponse({
          ...activeNavigatePayload,
          center: {
            label: 'Continue',
            action: 'NAVIGATE',
            href: '/pro/bookings/booking_1/session',
          },
        }),
      ],
      start: {
        booking_1: [
          jsonResponse({
            ok: true,
            nextHref: '/pro/bookings/booking_1/session',
          }),
        ],
      },
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/bookings/booking_1/session/start',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': 'uuid_1',
          'x-idempotency-key': 'uuid_1',
        },
      },
    )

    expect(navMocks.routerPush).toHaveBeenCalledWith(
      '/pro/bookings/booking_1/session',
    )

    unmount()
  })

  it('finishes the current service and navigates to nextHref', async () => {
    const fetchMock = installFetchQueue({
      session: [
        jsonResponse(activeFinishPayload),
        jsonResponse({
          ...activeNavigatePayload,
          center: {
            label: 'Create aftercare',
            action: 'NAVIGATE',
            href: '/pro/bookings/booking_1/aftercare',
          },
        }),
      ],
      finish: {
        booking_1: [
          jsonResponse({
            ok: true,
            nextHref: '/pro/bookings/booking_1/aftercare',
          }),
        ],
      },
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('ACTIVE')
      expect(result.current.center.action).toBe('FINISH')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/bookings/booking_1/session/finish',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': 'uuid_1',
          'x-idempotency-key': 'uuid_1',
        },
      },
    )

    expect(navMocks.routerPush).toHaveBeenCalledWith(
      '/pro/bookings/booking_1/aftercare',
    )

    unmount()
  })

  it('navigates to a safe center href without posting', async () => {
    const fetchMock = installFetchQueue({
      session: [jsonResponse(activeNavigatePayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.center.action).toBe('NAVIGATE')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navMocks.routerPush).toHaveBeenCalledWith(
      '/pro/bookings/booking_1/aftercare',
    )

    unmount()
  })

  it('falls back to the booking session hub when center href is unsafe', async () => {
    installFetchQueue({
      session: [jsonResponse(unsafeNavigatePayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.center.action).toBe('NAVIGATE')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(navMocks.routerPush).toHaveBeenCalledWith(
      '/pro/bookings/booking_1/session',
    )

    unmount()
  })

  it('sets an action error and reloads session when start fails', async () => {
    const fetchMock = installFetchQueue({
      session: [jsonResponse(upcomingPayload), jsonResponse(idlePayload)],
      start: {
        booking_1: [
          jsonResponse(
            {
              ok: false,
              error: 'That action is not allowed right now.',
            },
            { status: 409 },
          ),
        ],
      },
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    await waitFor(() => {
      expect(result.current.error).toBe('That action is not allowed right now.')
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pro/bookings/booking_1/session/start',
      expect.objectContaining({
        method: 'POST',
      }),
    )

    unmount()
  })

  it('refreshes the current route when navigation target matches the current URL', async () => {
    window.history.pushState({}, '', '/pro/bookings/booking_1/aftercare')

    installFetchQueue({
      session: [jsonResponse(activeNavigatePayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.center.action).toBe('NAVIGATE')
    })

    await act(async () => {
      await result.current.handleCenterClick()
    })

    expect(navMocks.routerRefresh).toHaveBeenCalled()
    expect(navMocks.routerPush).not.toHaveBeenCalled()

    unmount()
  })

  it('force reloads when the pro session force event is dispatched', async () => {
    const fetchMock = installFetchQueue({
      session: [jsonResponse(idlePayload), jsonResponse(upcomingPayload)],
    })

    const { result, unmount } = renderHook(() => useProSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.mode).toBe('IDLE')
    })

    await act(async () => {
      window.dispatchEvent(new Event(FORCE_EVENT))
    })

    await waitFor(() => {
      expect(result.current.mode).toBe('UPCOMING')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pro/session', {
      method: 'GET',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })

    unmount()
  })
})