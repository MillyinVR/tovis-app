// app/(auth)/_components/authNoticePlacement.test.tsx
//
// The placement rule itself (Tori, 2026-08-23): an error from a pressed
// control renders DIRECTLY ABOVE that control. Asserting the rule needs DOM
// ORDER, not `getByText` — every auth suite here checks only that the message
// exists, which passes just as happily with the banner stranded at the top of
// the page or below the buttons (both of which were real, shipped states).
//
// compareDocumentPosition is the check: FOLLOWING means the notice really is
// painted before the button in document order.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import PhoneLoginForm from './login/PhoneLoginForm'
import { RESEND_COOLDOWN_SECONDS } from './otpCooldown'
import SocialSignIn from './social/SocialSignIn'

/** Asserts `notice` precedes `control` in document order. */
function expectNoticeAboveControl(notice: Element, control: Element) {
  const position = notice.compareDocumentPosition(control)
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const assignMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('location', { assign: assignMock, origin: 'https://tovis.test' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}))

// The provider buttons only render when a public client id is configured, and
// nothing sets those in tests — without this the SocialSignIn case below would
// render an empty component and pass vacuously.
vi.mock('./social/socialProviders', () => ({
  googleWebClientId: () => null,
  appleWebClientId: () => 'apple.test.client',
  hasAnySocialProvider: () => true,
}))

describe('PhoneLoginForm notice placement', () => {
  it('renders a send failure above the submit button that produced it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Could not send a code.' }, 400),
      ),
    )

    render(
      <PhoneLoginForm nextSafe={null} fromSafe={null} onUsePassword={vi.fn()} />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '+15555550123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))

    const notice = await screen.findByText('Could not send a code.')
    const button = screen.getByRole('button', { name: /send code/i })

    expectNoticeAboveControl(notice, button)
  })

  it('renders a RESEND failure above the resend control, not the page-bottom submit', async () => {
    const fetchMock = vi
      .fn()
      // step 1: the initial send succeeds, advancing to the code step.
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      // step 2: the resend fails.
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Could not send a code.' }, 400),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PhoneLoginForm nextSafe={null} fromSafe={null} onUsePassword={vi.fn()} />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '+15555550123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))

    // A successful send starts a 60s cooldown that disables resend, so the
    // click below would be swallowed. Run the countdown out for real.
    await screen.findByRole('button', { name: /resend/i })
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend/i }),
      ).toBeDisabled()
    })

    for (let tick = 0; tick < RESEND_COOLDOWN_SECONDS; tick++) {
      await vi.advanceTimersByTimeAsync(1000)
    }

    const resend = await screen.findByRole('button', { name: /resend code/i })
    expect(resend).not.toBeDisabled()
    fireEvent.click(resend)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const notice = await screen.findByText('Could not send a code.')
    const submit = screen.getByRole('button', { name: /sign in/i })

    // Above the resend control that produced it...
    expectNoticeAboveControl(
      notice,
      screen.getByRole('button', { name: /resend code/i }),
    )
    // ...and therefore above the bottom submit too, where it used to land alone.
    expectNoticeAboveControl(notice, submit)
  })
})

describe('SocialSignIn notice placement', () => {
  it('renders the provider error ABOVE the provider buttons, not at the page footer', async () => {
    vi.stubGlobal('fetch', vi.fn())

    render(<SocialSignIn />)

    const appleButton = screen.getByRole('button', {
      name: /continue with apple/i,
    })

    fireEvent.click(appleButton)

    // jsdom never fetches the injected vendor script, so neither onload nor
    // onerror fires on its own and the component would sit forever in its
    // loading state. Fire the failure the real network would.
    const script = await waitFor(() => {
      const el = document.head.querySelector<HTMLScriptElement>(
        'script[src*="appleid.auth.js"]',
      )
      if (!el) throw new Error('Apple script tag was never injected')
      return el
    })
    fireEvent.error(script)

    const notice = await screen.findByText(/apple sign-in/i)
    expectNoticeAboveControl(notice, appleButton)
  })
})
