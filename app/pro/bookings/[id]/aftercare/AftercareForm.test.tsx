import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import AftercareForm from './AftercareForm'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    refresh: mocks.routerRefresh,
  }),
}))

vi.mock('@/lib/idempotency/client', () => ({
  buildClientIdempotencyKey: vi.fn(() => 'idem_aftercare_test_key'),
  idempotencyHeaders: vi.fn(() => ({
    'Idempotency-Key': 'idem_aftercare_test_key',
  })),
}))

function makeMediaItem(overrides?: {
  id?: string
  phase?: 'BEFORE' | 'AFTER' | 'OTHER'
}) {
  return {
    id: overrides?.id ?? 'media_1',
    mediaType: 'IMAGE' as const,
    visibility: 'PRO_CLIENT' as const,
    uploadedByRole: 'PRO' as const,
    reviewId: null,
    createdAt: '2026-04-12T18:00:00.000Z',
    phase: overrides?.phase ?? 'AFTER',
    renderUrl: '/signed/media.jpg',
    renderThumbUrl: '/signed/media-thumb.jpg',
    url: null,
    thumbUrl: null,
  }
}

function renderForm(props?: Partial<React.ComponentProps<typeof AftercareForm>>) {
  return render(
    <AftercareForm
      bookingId="booking_1"
      timeZone="America/Los_Angeles"
      rebookProfessionalId="pro_1"
      rebookServiceId="service_1"
      rebookOfferingId="offering_1"
      rebookLocationType="SALON"
      rebookLocationId="location_1"
      rebookClientAddressId={null}
      rebookClientProfileId="client_1"
      existingNotes="Use gentle cleanser tonight."
      existingRebookedFor={null}
      existingRebookMode="NONE"
      existingRebookWindowStart={null}
      existingRebookWindowEnd={null}
      existingMedia={[makeMediaItem({ phase: 'AFTER' })]}
      existingRecommendedProducts={[]}
      existingDraftSavedAt={null}
      existingSentToClientAt={null}
      existingLastEditedAt={null}
      existingVersion={1}
      existingIsFinalized={false}
      {...props}
    />,
  )
}

type RouteResponse = { status: number; ok: boolean; json: () => Promise<unknown> }

function jsonResponse(body: unknown, status = 200): RouteResponse {
  return { status, ok: status < 400, json: async () => body }
}

// URL-routed fetch: the form makes background requests on mount (working hours
// for off-day shading; saved addresses for MOBILE), so positional
// `mockResolvedValueOnce` queues would misroute. Handlers match by substring;
// unmatched URLs get a benign empty 200 the effects treat as "no data".
function routeFetch(
  routes: Array<
    [
      match: string,
      handler: (url: string, init?: RequestInit) => RouteResponse,
    ]
  >,
) {
  mocks.fetch.mockImplementation(async (input: unknown, init?: unknown) => {
    const url = String(input)
    for (const [match, handler] of routes) {
      if (url.includes(match)) return handler(url, init as RequestInit)
    }
    return jsonResponse({ ok: true })
  })
}

function fetchCallUrl(match: string): string | null {
  const call = mocks.fetch.mock.calls.find((c) => String(c[0]).includes(match))
  return call ? String(call[0]) : null
}

function fetchCallInit(match: string): RequestInit | undefined {
  const call = mocks.fetch.mock.calls.find((c) => String(c[0]).includes(match))
  return call?.[1] as RequestInit | undefined
}

function aftercareSaveBody(args?: {
  completionBlockers?: unknown[]
  bookingFinished?: boolean
  clientNotified?: boolean
  redirectTo?: string | null
}) {
  return {
    aftercare: {
      id: 'aftercare_1',
      draftSavedAt: null,
      sentToClientAt: '2026-04-12T20:00:00.000Z',
      lastEditedAt: '2026-04-12T20:00:00.000Z',
      version: 2,
    },
    clientNotified: args?.clientNotified ?? true,
    bookingFinished: args?.bookingFinished ?? false,
    completionBlockers: args?.completionBlockers ?? [],
    redirectTo: args?.redirectTo ?? null,
  }
}

function mockAftercareResponse(args?: {
  completionBlockers?: unknown[]
  bookingFinished?: boolean
  clientNotified?: boolean
  redirectTo?: string | null
}) {
  routeFetch([
    ['/aftercare', () => jsonResponse(aftercareSaveBody(args))],
  ])
}

async function clickSendToClient() {
  const button = screen.getByRole('button', {
    name: /send to client|send update to client/i,
  })

  await act(async () => {
    fireEvent.click(button)
  })
}

describe('app/pro/bookings/[id]/aftercare/AftercareForm', () => {
  // 🔴 The clock is FROZEN for this whole file, and that is load-bearing.
  //
  // Several tests drive the BOOKED_NEXT_APPOINTMENT flow with a hard-coded
  // availability slot at `2026-09-01T17:00:00.000Z`, and `validateBeforePost`
  // refuses a rebook whose `startsAt <= Date.now()` ("The next appointment must
  // be in the future"). Those tests therefore depended, silently, on the machine
  // clock being earlier than that instant — so they passed for months and then
  // began failing FOREVER at 17:00 UTC on 2026-09-01, in CI and locally alike,
  // with an assertion about `null` that says nothing about the real cause (the
  // POST simply never happens, because validation short-circuits first).
  //
  // Only `Date` is faked: `waitFor` / `findBy*` need real setTimeout/setInterval
  // to poll, and faking those makes this file's async assertions hang instead of
  // resolving. 12:00Z is 05:00 in America/Los_Angeles, so the form's "today" is
  // unambiguously 2026-09-01 — the same reasoning the min-date test below spells
  // out — and it sits before the 17:00Z slot, which is what the fixtures need.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))

    vi.clearAllMocks()

    mocks.fetch.mockReset()
    global.fetch = mocks.fetch

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: vi.fn(() => 'uuid_test_1'),
      },
    })

    window.dispatchEvent = vi.fn()
  })

  afterEach(() => {
    // Hand the real clock back, so a frozen Date cannot leak into another file
    // sharing this worker.
    vi.useRealTimers()
  })

  it('sends aftercare and navigates to the wrap-up screen', async () => {
    // Outstanding closeout (payment/checkout) now shows on the wrap-up
    // checklist, not in the form — sending just proceeds there.
    mockAftercareResponse({
      bookingFinished: false,
      clientNotified: true,
      completionBlockers: ['PAYMENT_NOT_COLLECTED', 'CHECKOUT_NOT_PAID_OR_WAIVED'],
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(mocks.routerPush).toHaveBeenCalledWith(
        '/pro/bookings/booking_1/session',
      )
    })

    // Sending navigates to the wrap-up screen via push; it must NOT also
    // router.refresh() this force-dynamic page (that re-signed + reloaded every
    // before/after image for nothing).
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
    expect(mocks.routerReplace).not.toHaveBeenCalled()
  })

  it('navigates to wrap-up even when the send completes the booking', async () => {
    mockAftercareResponse({
      bookingFinished: true,
      clientNotified: true,
      completionBlockers: [],
      redirectTo: '/pro/bookings/booking_1/session',
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(mocks.routerPush).toHaveBeenCalledWith(
        '/pro/bookings/booking_1/session',
      )
    })
  })

  it('shows normal sent message when there are no blockers and booking is not completed yet', async () => {
    mockAftercareResponse({
      bookingFinished: false,
      clientNotified: true,
      completionBlockers: [],
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(screen.getByText(/Aftercare sent to client\./i)).toBeInTheDocument()
    })

    expect(
      screen.queryByText(/free to start your next booking/i),
    ).not.toBeInTheDocument()
  })

  it('saves draft without showing closeout blocker messaging', async () => {
    routeFetch([
      [
        '/aftercare',
        () =>
          jsonResponse({
            aftercare: {
              id: 'aftercare_1',
              draftSavedAt: '2026-04-12T20:00:00.000Z',
              sentToClientAt: null,
              lastEditedAt: '2026-04-12T20:00:00.000Z',
              version: 2,
            },
            clientNotified: false,
            bookingFinished: false,
            completionBlockers: ['AFTERCARE_NOT_SENT'],
            redirectTo: null,
          }),
      ],
    ])

    renderForm()

    const button = screen.getByRole('button', { name: /save draft/i })

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => {
      expect(screen.getByText(/Aftercare draft saved\./i)).toBeInTheDocument()
    })

    expect(
      screen.queryByText(/free to start your next booking/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Aftercare not sent:/i)).not.toBeInTheDocument()
  })

  it('lets the pro pick which client service address a mobile next appointment is at', async () => {
    routeFetch([
      // Mount (MOBILE): the form loads the client's saved service addresses.
      [
        '/service-addresses',
        () =>
          jsonResponse({
            ok: true,
            clientId: 'client_1',
            addresses: [
              {
                id: 'addr_1',
                label: 'Home',
                formattedAddress: '1 Main St, Los Angeles, CA',
                isDefault: true,
              },
              {
                id: 'addr_2',
                label: 'Work',
                formattedAddress: '2 Office Way, Los Angeles, CA',
                isDefault: false,
              },
            ],
          }),
      ],
      [
        '/api/v1/availability/day',
        () =>
          jsonResponse({
            ok: true,
            slots: ['2026-09-01T17:00:00.000Z'],
            durationMinutes: 90,
          }),
      ],
      ['/aftercare', () => jsonResponse(aftercareSaveBody())],
    ])

    renderForm({
      rebookLocationType: 'MOBILE',
      rebookClientAddressId: 'addr_1',
    })

    expect(fetchCallUrl('/service-addresses')).toBe(
      '/api/v1/pro/clients/client_1/service-addresses',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next booking date' }))

    // The pro can choose among the client's saved addresses; the source
    // booking's address (their default here) starts selected.
    const select = await screen.findByRole('combobox', {
      name: /service address/i,
    })
    await waitFor(() => {
      expect(
        (screen.getByRole('option', { name: /Home/ }) as HTMLOptionElement)
          .selected,
      ).toBe(true)
    })

    fireEvent.change(select, { target: { value: 'addr_2' } })

    const dayInput = document.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-09-01' } })

    // Picking a day queries availability FOR THE CHOSEN ADDRESS…
    await waitFor(() => {
      expect(fetchCallUrl('/api/v1/availability/day')).toContain(
        'clientAddressId=addr_2',
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))

    // …and the saved proposal carries that same address.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })

    expect(fetchCallUrl('/api/v1/pro/bookings/booking_1/aftercare')).toContain(
      '/api/v1/pro/bookings/booking_1/aftercare',
    )
    const body = JSON.parse(
      String(
        fetchCallInit('/api/v1/pro/bookings/booking_1/aftercare')?.body,
      ),
    )
    expect(body.rebookSlot).toMatchObject({
      locationType: 'MOBILE',
      clientAddressId: 'addr_2',
      startsAt: '2026-09-01T17:00:00.000Z',
    })
  })

  it('turns an OUTSIDE_WORKING_HOURS refusal into a confirm card and retries with the flag', async () => {
    // First save refuses with the gated code; after the pro confirms, the
    // retry carries allowOutsideWorkingHours and succeeds.
    let saveAttempts = 0
    const saveBodies: Array<Record<string, unknown>> = []
    routeFetch([
      [
        '/api/v1/availability/day',
        () =>
          jsonResponse({
            ok: true,
            slots: ['2026-09-01T17:00:00.000Z'],
            durationMinutes: 60,
          }),
      ],
      [
        '/api/v1/pro/bookings/booking_1/aftercare',
        (_url, init) => {
          saveAttempts += 1
          saveBodies.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          )
          if (saveAttempts === 1) {
            return jsonResponse(
              {
                error: 'That time is outside working hours.',
                code: 'OUTSIDE_WORKING_HOURS',
              },
              422,
            )
          }
          return jsonResponse(aftercareSaveBody())
        },
      ],
    ])

    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Next booking date' }))

    const dayInput = document.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-09-01' } })
    fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })

    // The refusal surfaced as the soft confirm card, not a dead-end error.
    expect(
      await screen.findByText(/Booking rule override/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/outside your working hours\. Book it anyway\?/i),
    ).toBeInTheDocument()
    expect(saveBodies[0]?.allowOutsideWorkingHours).toBe(false)

    // Saving again without confirming is blocked client-side.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })
    expect(saveAttempts).toBe(1)

    fireEvent.click(
      screen.getByRole('checkbox', { name: /Book anyway/i }),
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/Aftercare draft saved\./i)).toBeInTheDocument()
    })
    expect(saveBodies[1]?.allowOutsideWorkingHours).toBe(true)
  })

  it('floors the BOOKED day at TODAY while the recommended window still starts tomorrow', () => {
    // The inline calendars fetch busy-days on mount — route it benignly.
    routeFetch([])

    // 2026-09-01T18:00Z = 11:00 in America/Los_Angeles, so "today" in the
    // form's zone is unambiguously 2026-09-01.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T18:00:00.000Z'))

    try {
      const { container } = renderForm()

      // BOOKED: the pro books this on their own authority, so same-day is
      // theirs to choose — the server's now+1min floor (and the override
      // confirm for short notice) is what actually guards it.
      fireEvent.click(screen.getByRole('button', { name: 'Next booking date' }))
      const bookedDay = container.querySelector(
        'input[type="date"]',
      ) as HTMLInputElement
      expect(bookedDay.min).toBe('2026-09-01')

      // WINDOW: a client-facing recommendation, still floored at tomorrow.
      fireEvent.click(screen.getByRole('button', { name: 'Booking window' }))
      const windowInputs = Array.from(
        container.querySelectorAll('input[type="date"]'),
      ) as HTMLInputElement[]
      expect(windowInputs[0]?.min).toBe('2026-09-02')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses date-only window inputs and auto-advances the end past the start', () => {
    // The inline calendars fetch busy-days on mount — route it benignly.
    routeFetch([])

    const { container } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Booking window' }))

    const dateInputs = Array.from(
      container.querySelectorAll('input[type="date"]'),
    ) as HTMLInputElement[]

    // Window start + end are dates only — no time-of-day inputs in window mode.
    expect(dateInputs).toHaveLength(2)
    expect(
      container.querySelectorAll('input[type="datetime-local"]'),
    ).toHaveLength(0)

    const [startInput, endInput] = dateInputs as [
      HTMLInputElement,
      HTMLInputElement,
    ]

    // Picking a start with no end yet fills the end to a full suggested span
    // ahead (7 days), matching the fresh auto-suggested window width.
    fireEvent.change(startInput, { target: { value: '2026-09-10' } })
    expect(endInput.value).toBe('2026-09-17')

    // Moving the start to/after the end pulls the end forward to start + span.
    fireEvent.change(startInput, { target: { value: '2026-09-20' } })
    expect(endInput.value).toBe('2026-09-27')
  })
})