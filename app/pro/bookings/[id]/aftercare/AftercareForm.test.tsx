import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function mockAftercareResponse(args?: {
  completionBlockers?: unknown[]
  bookingFinished?: boolean
  clientNotified?: boolean
  redirectTo?: string | null
}) {
  mocks.fetch.mockResolvedValueOnce({
    status: 200,
    ok: true,
    json: async () => ({
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
    }),
  })
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
  beforeEach(() => {
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
    mocks.fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
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
    })

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
    // Mount (MOBILE): the form loads the client's saved service addresses.
    mocks.fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
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
    })

    renderForm({
      rebookLocationType: 'MOBILE',
      rebookClientAddressId: 'addr_1',
    })

    expect(String(mocks.fetch.mock.calls[0]?.[0])).toBe(
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

    // Picking a day queries availability FOR THE CHOSEN ADDRESS…
    mocks.fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        slots: ['2026-09-01T17:00:00.000Z'],
        durationMinutes: 90,
      }),
    })

    const dayInput = document.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-09-01' } })

    await waitFor(() => {
      expect(String(mocks.fetch.mock.calls[1]?.[0])).toContain(
        'clientAddressId=addr_2',
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))

    // …and the saved proposal carries that same address.
    mockAftercareResponse()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    })

    const saveCall = mocks.fetch.mock.calls[2]
    expect(String(saveCall?.[0])).toContain(
      '/api/v1/pro/bookings/booking_1/aftercare',
    )
    const body = JSON.parse(String((saveCall?.[1] as RequestInit).body))
    expect(body.rebookSlot).toMatchObject({
      locationType: 'MOBILE',
      clientAddressId: 'addr_2',
      startsAt: '2026-09-01T17:00:00.000Z',
    })
  })

  it('uses date-only window inputs and auto-advances the end past the start', () => {
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