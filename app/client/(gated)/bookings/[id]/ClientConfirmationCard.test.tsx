// app/client/(gated)/bookings/[id]/ClientConfirmationCard.test.tsx
// @vitest-environment jsdom
//
// K13.
//
// ⚠️ What these tests DO pin: the request shape, which action each answered
// state offers, that BOTH buttons are inert while the POST is in flight, and
// that a refusal shows the server's own wording instead of a generic error.
//
// ⚠️ What they CANNOT pin, stated rather than implied: the window the browser
// drive actually found — between the POST resolving and `router.refresh()`
// committing the new server state. Here `refresh` is a mock that returns
// instantly, so the transition ends on the same tick and there is no window to
// observe. The fix for that (running the refresh inside `useTransition`) is
// verified by driving the real page; this file guards everything around it.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navMocks = vi.hoisted(() => ({ routerRefresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navMocks.routerRefresh }),
}))

const httpMocks = vi.hoisted(() => ({ safeJson: vi.fn() }))
vi.mock('@/lib/http', () => ({ safeJson: httpMocks.safeJson }))

import ClientConfirmationCard from './ClientConfirmationCard'

const BASE = {
  bookingId: 'bkg_1',
  professionalLabel: 'Ada’s Studio',
  whenLabel: 'Sun, Aug 2, 2026, 9:30 AM',
}

beforeEach(() => {
  vi.clearAllMocks()
  httpMocks.safeJson.mockResolvedValue({ ok: true, state: 'CLIENT_CONFIRMED' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ClientConfirmationCard', () => {
  it('asks the question and posts the client’s answer to the authed route', async () => {
    render(<ClientConfirmationCard {...BASE} state="AWAITING_CLIENT" />)

    expect(screen.getByText('Can you make it?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /I’ll be there/ }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/client/bookings/bkg_1/confirmation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ answer: 'CONFIRM' }),
        }),
      )
    })
  })

  it('offers only the opposite action once the client has answered', () => {
    const { unmount } = render(
      <ClientConfirmationCard {...BASE} state="CLIENT_CONFIRMED" />,
    )
    expect(screen.queryByRole('button', { name: /I’ll be there/ })).toBeNull()
    expect(
      screen.getByRole('button', { name: /Actually, I can’t make it/ }),
    ).toBeTruthy()
    unmount()

    render(<ClientConfirmationCard {...BASE} state="DECLINED" />)
    expect(screen.queryByRole('button', { name: /can’t make it/ })).toBeNull()
    expect(screen.getByRole('button', { name: /I’ll be there/ })).toBeTruthy()
  })

  it('disables BOTH buttons while an answer is in flight, not just the one pressed', async () => {
    let release: (value: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve
          }),
      ),
    )

    render(<ClientConfirmationCard {...BASE} state="AWAITING_CLIENT" />)

    const confirm = screen.getByRole('button', { name: /I’ll be there/ })
    const decline = screen.getByRole('button', { name: /I can’t make it/ })

    fireEvent.click(confirm)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirming…/ })).toBeTruthy()
    })
    // The DECLINE button is the one that mattered: it was never the button the
    // client pressed, so nothing local disabled it.
    expect((decline as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: /Confirming…/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    release(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await waitFor(() => {
      expect(navMocks.routerRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('surfaces the server’s own refusal wording rather than a generic error', async () => {
    httpMocks.safeJson.mockResolvedValue({
      ok: false,
      userMessage: 'This appointment can no longer be confirmed or declined.',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false }), { status: 409 }),
      ),
    )

    render(<ClientConfirmationCard {...BASE} state="AWAITING_CLIENT" />)
    fireEvent.click(screen.getByRole('button', { name: /I’ll be there/ }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'This appointment can no longer be confirmed or declined.',
        ),
      ).toBeTruthy()
    })
    expect(navMocks.routerRefresh).not.toHaveBeenCalled()
  })
})
