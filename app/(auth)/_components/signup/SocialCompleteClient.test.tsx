// app/(auth)/_components/signup/SocialCompleteClient.test.tsx
//
// The form that spends a social signup ticket. What is worth pinning here is
// not the markup but the four things that were the point of building it:
//
//  1. a person with no account reaches a FORM, not "your account role is missing"
//  2. the claim params ride all the way into the request body
//  3. the ticket travels in the body, never the URL
//  4. the two answers that mean the ticket is gone end the form instead of
//     leaving a dead Create button

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const router = { refresh: vi.fn() }
  let searchParams = new URLSearchParams()

  return {
    router,
    hardNavigate: vi.fn(),
    setSearchParams(next: Record<string, string | undefined>) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value)
      }
      searchParams = params
    },
    getSearchParams() {
      return searchParams
    },
  }
})

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: { displayName: 'TOVIS' },
    mode: 'dark',
    setMode: () => {},
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.getSearchParams(),
}))

vi.mock('next/link', () => ({
  default: (props: {
    href: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement(
      'a',
      { href: props.href, className: props.className },
      props.children,
    ),
}))

vi.mock('../AuthShell', () => ({
  default: (props: {
    title: string
    subtitle?: string
    children: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('h1', {}, props.title),
      props.subtitle ? React.createElement('p', {}, props.subtitle) : null,
      props.children,
    ),
}))

vi.mock('@/lib/clientNavigation', () => ({
  hardNavigate: mocks.hardNavigate,
}))

import SocialCompleteClient from './SocialCompleteClient'
import { stashSocialSignup } from '../social/socialSignupHandoff'
import type { SocialSignupHandoff } from '../social/submitSocialToken'

const TICKET_SECRET = 'tid.secret-do-not-put-me-in-a-url'

function ticket(overrides: Partial<SocialSignupHandoff> = {}): SocialSignupHandoff {
  return {
    provider: 'google',
    signupTicket: TICKET_SECRET,
    // Far enough out that the handoff's own expiry check never fires; the
    // clock is real here, so a fixed past date would make every test null.
    ticketExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    prefill: { email: 'new@example.com', firstName: 'Ada', lastName: null },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function geoResponses() {
  return [
    jsonResponse({
      geo: {
        lat: 33.036,
        lng: -117.292,
        postalCode: '92024',
        city: 'Encinitas',
        state: 'CA',
        countryCode: 'US',
      },
    }),
    jsonResponse({ timeZoneId: 'America/Los_Angeles' }),
  ]
}

async function chooseClient() {
  fireEvent.click(screen.getByText('I’m a Client — book services'))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(screen.getByPlaceholderText('e.g. 92024')).toBeTruthy(),
  )
}

async function choosePro() {
  fireEvent.click(screen.getByText('I’m a Pro — offer services'))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(screen.getByText('Where do you offer services?')).toBeTruthy(),
  )
}

async function confirmZip(zip = '92024') {
  const zipInput = screen.getByPlaceholderText('e.g. 92024')
  fireEvent.change(zipInput, { target: { value: zip } })
  fireEvent.blur(zipInput)
  await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy())
}

/**
 * Everything on the final step. The last name is typed rather than assumed:
 * Apple releases a name exactly once and Google's can be a handle, so a null
 * `prefill.lastName` is the ordinary case, not an edge one.
 */
function fillPersonalDetails({ lastName = 'Lovelace' } = {}) {
  const lastNameInput = document.getElementById(
    'social-last-name',
  ) as HTMLInputElement
  fireEvent.change(lastNameInput, { target: { value: lastName } })

  fireEvent.change(screen.getByPlaceholderText('+1 (___) ___-____'), {
    target: { value: '+16195551234' },
  })
  fireEvent.click(
    screen.getByLabelText(/transactional SMS\/text messages from TOVIS/i),
  )
  fireEvent.click(
    screen.getByLabelText(/I agree to the\s+Terms\s+and\s+Privacy Policy/i),
  )
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was never called')
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('app/(auth)/_components/signup/SocialCompleteClient.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.router.refresh.mockReset()
    mocks.hardNavigate.mockReset()
    mocks.setSearchParams({})
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('tells a person whose sign-in expired to start again, and offers the way back', async () => {
    mocks.setSearchParams({ next: '/looks' })
    render(<SocialCompleteClient />)

    await waitFor(() =>
      expect(screen.getByText('That sign-in has expired')).toBeTruthy(),
    )

    // The whole point of the two-phase shape: nothing was created, so there is
    // nothing to clean up and nothing to apologise for.
    expect(
      screen.getByText(/Nothing was created — start again/),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href'),
    ).toContain('/login?')
  })

  it('shows the provider-verified email and asks for the role first', async () => {
    stashSocialSignup(ticket())
    render(<SocialCompleteClient />)

    await waitFor(() =>
      expect(screen.getByText('Finish creating your account')).toBeTruthy(),
    )

    expect(screen.getByText('new@example.com')).toBeTruthy()
    expect(screen.getByText(/Verified by Google/)).toBeTruthy()
    expect(screen.getByText('What are you here to do?')).toBeTruthy()

    // Never the wrong advice about an account that does not exist.
    expect(screen.queryByText(/account role is missing/i)).toBeNull()
  })

  it('refuses to advance until a role is chosen', async () => {
    stashSocialSignup(ticket())
    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(
        screen.getByText('Please choose whether you’re a client or a pro.'),
      ).toBeTruthy(),
    )
    expect(screen.queryByPlaceholderText('e.g. 92024')).toBeNull()

    // The role step is the only "field" that is a choice rather than an input,
    // and a plain div ignores .focus() — so the jump-to-first-invalid behaviour
    // would silently do nothing here without the group's tabIndex.
    await waitFor(() =>
      expect(document.activeElement?.id).toBe('social-role'),
    )
  })

  it('carries the ticket and the claim params into the completion request, and never into the URL', async () => {
    mocks.setSearchParams({
      ti: 'ti_123',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      via: 'SMS',
      vsig: 'sig_1',
    })
    stashSocialSignup(ticket())

    const fetchMock = setFetchSequence([
      ...geoResponses(),
      jsonResponse(
        {
          user: { id: 'u1', email: 'new@example.com', role: 'CLIENT' },
          nextUrl: '/claim/tok_1',
          emailVerificationSent: 'skipped',
          phoneVerificationSent: 'pending',
        },
        201,
      ),
    ])

    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    await chooseClient()
    await confirmZip('92024')
    fillPersonalDetails()

    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/social/complete')
    expect(url).not.toContain(TICKET_SECRET)

    const body = lastRequestBody(fetchMock)
    expect(body).toMatchObject({
      signupTicket: TICKET_SECRET,
      role: 'CLIENT',
      firstName: 'Ada',
      phone: '+16195551234',
      tosAccepted: true,
      transactionalSmsConsent: true,
      tapIntentId: 'ti_123',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      via: 'SMS',
      vsig: 'sig_1',
      signupLocation: {
        kind: 'CLIENT_ZIP',
        postalCode: '92024',
        timeZoneId: 'America/Los_Angeles',
      },
    })
    expect(String(init.body)).not.toContain('password')

    // Email was verified by the provider, so 'skipped' must not raise a retry
    // flag; the phone still has to be verified.
    await waitFor(() =>
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fclaim%2Ftok_1',
      ),
    )
    expect(window.sessionStorage.length).toBe(0)
  })

  it('collects the pro work location, profession and state before the personal details', async () => {
    stashSocialSignup(ticket({ prefill: { email: 'pro@example.com', firstName: 'Rae', lastName: 'Kim' } }))

    const fetchMock = setFetchSequence([
      ...geoResponses(),
      jsonResponse(
        {
          user: { id: 'u2', email: 'pro@example.com', role: 'PRO' },
          nextUrl: null,
          emailVerificationSent: 'skipped',
          phoneVerificationSent: 'pending',
        },
        201,
      ),
    ])

    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    await choosePro()

    fireEvent.change(screen.getByLabelText(/State you’re licensed/), {
      target: { value: 'CA' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
    fireEvent.change(
      screen.getByPlaceholderText('Enter your ZIP code (e.g. 92101)'),
      { target: { value: '92024' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm ZIP' }))
    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy())

    // A CA cosmetologist needs a credential, so the card is on this step too.
    fireEvent.change(screen.getByPlaceholderText('e.g. 123456'), {
      target: { value: 'ca-12345' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByDisplayValue('Rae')).toBeTruthy())
    fillPersonalDetails({ lastName: 'Kim' })

    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    expect(lastRequestBody(fetchMock)).toMatchObject({
      role: 'PRO',
      professionType: 'COSMETOLOGIST',
      licenseState: 'CA',
      licenseNumber: 'CA-12345',
      mobileRadiusMiles: 15,
      signupLocation: { kind: 'PRO_MOBILE', postalCode: '92024' },
    })
  })

  it('ends the form when the ticket is spent on a claimable history', async () => {
    stashSocialSignup(ticket())

    setFetchSequence([
      ...geoResponses(),
      jsonResponse(
        {
          error: 'We found existing history for this contact.',
          code: 'CLAIMABLE_HISTORY',
          maskedDestination: 'a•••@example.com',
          claimLinkSent: true,
        },
        409,
      ),
    ])

    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    await chooseClient()
    await confirmZip('92024')
    fillPersonalDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() =>
      expect(screen.getByText('Check your email or text')).toBeTruthy(),
    )

    expect(screen.getByText('a•••@example.com')).toBeTruthy()
    // The ticket is gone: re-submitting could only fail, so the button is too.
    expect(screen.queryByRole('button', { name: 'Create my account' })).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('falls back to the start-again screen when the server says the ticket is dead', async () => {
    stashSocialSignup(ticket())

    setFetchSequence([
      ...geoResponses(),
      jsonResponse(
        {
          error: 'That sign-in has expired. Please start again.',
          code: 'INVALID_TICKET',
        },
        400,
      ),
    ])

    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    await chooseClient()
    await confirmZip('92024')
    fillPersonalDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() =>
      expect(screen.getByText('That sign-in has expired')).toBeTruthy(),
    )
    expect(window.sessionStorage.length).toBe(0)
  })

  it('keeps the form usable when the refusal is one the person can fix', async () => {
    stashSocialSignup(ticket())

    setFetchSequence([
      ...geoResponses(),
      jsonResponse(
        { error: 'That handle is reserved.', code: 'HANDLE_RESERVED' },
        400,
      ),
    ])

    render(<SocialCompleteClient />)
    await waitFor(() =>
      expect(screen.getByText('What are you here to do?')).toBeTruthy(),
    )

    await chooseClient()
    await confirmZip('92024')
    fillPersonalDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() =>
      expect(screen.getByText('That handle is reserved.')).toBeTruthy(),
    )

    // Still on the form, and the ticket is still stashed for the retry.
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeTruthy()
    expect(window.sessionStorage.length).toBe(1)
  })
})
