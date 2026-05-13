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

  it('sends aftercare and shows friendly closeout blocker copy instead of raw blocker codes', async () => {
    mockAftercareResponse({
      bookingFinished: false,
      clientNotified: true,
      completionBlockers: [
        'AFTER_PHOTOS_REQUIRED',
        'PAYMENT_NOT_COLLECTED',
        'CHECKOUT_NOT_PAID_OR_WAIVED',
      ],
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(
        screen.getByText(/Aftercare sent\. Booking is not complete yet\./i),
      ).toBeInTheDocument()
    })

    expect(screen.getByText(/After photos required:/i)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Add at least one after photo before this booking can be completed\./i,
      ),
    ).toBeInTheDocument()

    expect(screen.getByText(/Payment not collected:/i)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Collect or confirm payment before this booking can be completed\./i,
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByText(/Checkout not paid or waived:/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Mark checkout as paid or waived before this booking can be completed\./i,
      ),
    ).toBeInTheDocument()

    expect(
      screen.queryByText(/AFTER_PHOTOS_REQUIRED/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/PAYMENT_NOT_COLLECTED/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/CHECKOUT_NOT_PAID_OR_WAIVED/),
    ).not.toBeInTheDocument()

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
    expect(mocks.routerReplace).not.toHaveBeenCalled()
  })

  it('ignores unknown closeout blocker codes from the API response', async () => {
    mockAftercareResponse({
      bookingFinished: false,
      clientNotified: true,
      completionBlockers: [
        'NOPE',
        'AFTERCARE_NOT_SENT',
        null,
        123,
        'PAYMENT_NOT_COLLECTED',
      ],
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(
        screen.getByText(/Aftercare sent\. Booking is not complete yet\./i),
      ).toBeInTheDocument()
    })

    expect(screen.getByText(/Aftercare not sent:/i)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Send the aftercare summary to the client before this booking can be completed\./i,
      ),
    ).toBeInTheDocument()

    expect(screen.getByText(/Payment not collected:/i)).toBeInTheDocument()

    expect(screen.queryByText(/NOPE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/123/)).not.toBeInTheDocument()
  })

  it('redirects when aftercare send finishes the booking and API returns a safe redirect', async () => {
    mockAftercareResponse({
      bookingFinished: true,
      clientNotified: true,
      completionBlockers: [],
      redirectTo: '/pro/bookings/booking_1/session',
    })

    renderForm()

    await clickSendToClient()

    await waitFor(() => {
      expect(mocks.routerReplace).toHaveBeenCalledWith(
        '/pro/bookings/booking_1/session',
      )
    })

    expect(
      screen.getByText(/Aftercare sent\. Booking completed\./i),
    ).toBeInTheDocument()
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
      screen.queryByText(/Booking is not complete yet/i),
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
      screen.queryByText(/Booking is not complete yet/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Aftercare not sent:/i)).not.toBeInTheDocument()
  })
})