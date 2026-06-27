// app/(auth)/_components/signup/SignupClientClient.test.tsx

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const router = {
    refresh: vi.fn(),
  }

  let searchParams = new URLSearchParams()

  return {
    router,
    hardNavigate: vi.fn(),
    getTurnstileToken: vi.fn(),
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
      {
        href: props.href,
        className: props.className,
      },
      props.children,
    ),
}))

vi.mock('../AuthShell', () => ({
  default: (props: {
    title: string
    subtitle: string
    children: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('h1', {}, props.title),
      React.createElement('p', {}, props.subtitle),
      props.children,
    ),
}))

vi.mock('@/lib/http', () => ({
  safeJsonRecord: async (res: Response) =>
    (await res.json().catch(() => null)) as Record<string, unknown> | null,
  readErrorMessage: (data: Record<string, unknown> | null) =>
    typeof data?.error === 'string' ? data.error : null,
  readStringField: (data: Record<string, unknown> | null, key: string) =>
    typeof data?.[key] === 'string' ? data[key] : null,
}))

vi.mock('@/lib/clientNavigation', () => ({
  hardNavigate: mocks.hardNavigate,
}))

vi.mock('@/lib/turnstileClient', () => ({
  getTurnstileToken: mocks.getTurnstileToken,
}))

import SignupClientClient from './SignupClientClient'

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

function getPasswordInput(): HTMLInputElement {
  const input = document.querySelector(
    'input[type="password"]',
  ) as HTMLInputElement | null

  if (!input) {
    throw new Error('Password input not found')
  }

  return input
}

function getTermsCheckbox(): HTMLInputElement {
  return screen.getByLabelText(/I agree to the\s+Terms\s+and\s+Privacy Policy/i)
}

function getTransactionalSmsCheckbox(): HTMLInputElement {
  return screen.getByLabelText(/transactional SMS\/text messages from TOVIS/i)
}

function checkTermsConsent() {
  fireEvent.click(getTermsCheckbox())
}

function checkTransactionalSmsConsent() {
  fireEvent.click(getTransactionalSmsCheckbox())
}

function checkAllRequiredConsents() {
  checkTransactionalSmsConsent()
  checkTermsConsent()
}

async function confirmZip(zip = '92024') {
  const zipInput = screen.getByPlaceholderText(
    'e.g. 92024',
  ) as HTMLInputElement

  fireEvent.change(zipInput, { target: { value: zip } })
  fireEvent.blur(zipInput)

  await waitFor(() => {
    expect(screen.getByText('Confirmed')).toBeTruthy()
  })
}

describe('app/(auth)/_components/signup/SignupClientClient.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.router.refresh.mockReset()
    mocks.hardNavigate.mockReset()
    mocks.getTurnstileToken.mockReset()
    mocks.getTurnstileToken.mockResolvedValue('ts_client_ok')
    mocks.setSearchParams({})
    vi.unstubAllGlobals()
  })

  it('prefills claim invite fields and preserves handoff in the login link', () => {
    mocks.setSearchParams({
      ti: 'ti_123',
      from: '/claim/tok_1',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    render(<SignupClientClient />)

    expect(
      screen.getByText('Create Client Account to Claim Your History'),
    ).toBeTruthy()

    expect(
      screen.getByText(
        'Finish creating your client account so we can attach your booking history to the right identity.',
      ),
    ).toBeTruthy()

    expect(screen.getByDisplayValue('Tori')).toBeTruthy()
    expect(screen.getByDisplayValue('Morales')).toBeTruthy()
    expect(screen.getByDisplayValue('tori@example.com')).toBeTruthy()
    expect(screen.getByDisplayValue('+1 (619) 555-1234')).toBeTruthy()

    expect(
      screen.getByText(
        'Your account will return to the secure claim link after phone verification.',
      ),
    ).toBeTruthy()

    const loginLink = screen.getByRole('link', {
      name: 'I already have a client account',
    })

    expect(loginLink.getAttribute('href')).toBe(
      '/login?ti=ti_123&from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&intent=CLAIM_INVITE&inviteToken=tok_1&email=tori%40example.com&phone=%2B16195551234&role=CLIENT',
    )
  })

  it('submits client signup with separate transactional SMS consent, tosAccepted, and turnstile, and treats pending verification sends as optimistic success while falling back to query next', async () => {
    mocks.setSearchParams({
      ti: 'ti_123',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    const fetchMock = setFetchSequence([
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
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
      jsonResponse({
        nextUrl: null,
        emailVerificationSent: 'pending',
        phoneVerificationSent: 'pending',
      }),
    ])

    render(<SignupClientClient />)

    await confirmZip('92024')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'supersecret123' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(mocks.getTurnstileToken).toHaveBeenCalledWith(
      'signup_client',
      expect.objectContaining({
        onInteractiveChallenge: expect.any(Function),
      }),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const registerCall = fetchMock.mock.calls[2]
    const registerBody = JSON.parse(String(registerCall?.[1]?.body ?? '{}'))

    expect(registerBody).toMatchObject({
      email: 'tori@example.com',
      password: 'supersecret123',
      role: 'CLIENT',
      firstName: 'Tori',
      lastName: 'Morales',
      phone: '+16195551234',
      transactionalSmsConsent: true,
      tosAccepted: true,
      turnstileToken: 'ts_client_ok',
      tapIntentId: 'ti_123',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      signupLocation: {
        kind: 'CLIENT_ZIP',
        postalCode: '92024',
        city: 'Encinitas',
        state: 'CA',
        countryCode: 'US',
        lat: 33.036,
        lng: -117.292,
        timeZoneId: 'America/Los_Angeles',
      },
    })

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fclaim%2Ftok_1',
      )
    })
  })

  it('preserves explicit retry flags when register reports real send failures', async () => {
    mocks.setSearchParams({
      ti: 'ti_123',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    const fetchMock = setFetchSequence([
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
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
      jsonResponse({
        nextUrl: null,
        emailVerificationSent: false,
        phoneVerificationSent: false,
      }),
    ])

    render(<SignupClientClient />)

    await confirmZip('92024')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'supersecret123' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fclaim%2Ftok_1&email=retry&sms=retry',
      )
    })
  })

  it('prefers server nextUrl and omits retry flags when verification sends are pending', async () => {
    mocks.setSearchParams({
      next: '/claim/tok_1',
      email: 'client@example.com',
      phone: '+16195550000',
      name: 'Tori Morales',
    })

    const fetchMock = setFetchSequence([
      jsonResponse({
        geo: {
          lat: 32.7157,
          lng: -117.1611,
          postalCode: '92101',
          city: 'San Diego',
          state: 'CA',
          countryCode: 'US',
        },
      }),
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
      jsonResponse({
        nextUrl: '/client/onboarding',
        emailVerificationSent: 'pending',
        phoneVerificationSent: 'pending',
      }),
    ])

    render(<SignupClientClient />)

    await confirmZip('92101')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'supersecret123' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fclient%2Fonboarding',
      )
    })
  })

  it('shows the neutral duplicate-account error from register failures', async () => {
    mocks.setSearchParams({
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    setFetchSequence([
      jsonResponse({
        geo: {
          lat: 32.7157,
          lng: -117.1611,
          postalCode: '92101',
          city: 'San Diego',
          state: 'CA',
          countryCode: 'US',
        },
      }),
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
      jsonResponse(
        {
          error: 'An account already exists with those details.',
        },
        400,
      ),
    ])

    render(<SignupClientClient />)

    await confirmZip('92101')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'supersecret123' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(
        screen.getByText('An account already exists with those details.'),
      ).toBeTruthy()
    })

    expect(mocks.hardNavigate).not.toHaveBeenCalled()
  })

  it('surfaces turnstile errors and does not call register', async () => {
    mocks.setSearchParams({
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    const fetchMock = setFetchSequence([
      jsonResponse({
        geo: {
          lat: 32.7157,
          lng: -117.1611,
          postalCode: '92101',
          city: 'San Diego',
          state: 'CA',
          countryCode: 'US',
        },
      }),
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
    ])

    mocks.getTurnstileToken.mockRejectedValue(
      new Error('Captcha timed out. Please try again.'),
    )

    render(<SignupClientClient />)

    await confirmZip('92101')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'supersecret123' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(
        screen.getByText('Captcha timed out. Please try again.'),
      ).toBeTruthy()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
    expect(mocks.router.refresh).not.toHaveBeenCalled()
  })

  it('shows inline field errors instead of submitting when required fields are missing', async () => {
    setFetchSequence([])

    render(<SignupClientClient />)

    const submitButton = screen.getByRole('button', {
      name: 'Create Client Account',
    })

    expect(submitButton.hasAttribute('disabled')).toBe(false)

    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('First name is required.')).toBeTruthy()
    })

    expect(screen.getByText('Last name is required.')).toBeTruthy()
    expect(screen.getByText('Please confirm your ZIP code.')).toBeTruthy()
    expect(screen.getByText('Phone number is required.')).toBeTruthy()
    expect(screen.getByText('Email is required.')).toBeTruthy()
    expect(screen.getByText('Password is required.')).toBeTruthy()
    expect(
      screen.getByText('Please accept the Terms and Privacy Policy.'),
    ).toBeTruthy()

    // Focus lands on the first invalid field.
    expect(document.activeElement?.id).toBe('signup-first-name')

    expect(mocks.getTurnstileToken).not.toHaveBeenCalled()
    expect(mocks.router.refresh).not.toHaveBeenCalled()
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
  })

  it('flags a too-short password inline before calling register', async () => {
    mocks.setSearchParams({
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    setFetchSequence([
      jsonResponse({
        geo: {
          lat: 32.7157,
          lng: -117.1611,
          postalCode: '92101',
          city: 'San Diego',
          state: 'CA',
          countryCode: 'US',
        },
      }),
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
    ])

    render(<SignupClientClient />)

    await confirmZip('92101')

    fireEvent.change(getPasswordInput(), {
      target: { value: 'short' },
    })

    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Client Account' }),
    )

    await waitFor(() => {
      expect(
        screen.getByText('Password must be at least 10 characters.'),
      ).toBeTruthy()
    })

    expect(mocks.getTurnstileToken).not.toHaveBeenCalled()
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
  })

  it('formats the phone number as the user types', () => {
    setFetchSequence([])

    render(<SignupClientClient />)

    const phoneInput = screen.getByPlaceholderText(
      '+1 (___) ___-____',
    ) as HTMLInputElement

    fireEvent.change(phoneInput, { target: { value: '6195551234' } })
    expect(phoneInput.value).toBe('(619) 555-1234')

    fireEvent.change(phoneInput, { target: { value: '+16195551234' } })
    expect(phoneInput.value).toBe('+1 (619) 555-1234')
  })

  it('lets the user clear a confirmed ZIP and re-enter it', async () => {
    setFetchSequence([
      jsonResponse({
        geo: {
          lat: 32.7157,
          lng: -117.1611,
          postalCode: '92101',
          city: 'San Diego',
          state: 'CA',
          countryCode: 'US',
        },
      }),
      jsonResponse({
        timeZoneId: 'America/Los_Angeles',
      }),
    ])

    render(<SignupClientClient />)

    await confirmZip('92101')

    expect(screen.getByText('Near:')).toBeTruthy()
    expect(screen.getByText('San Diego, CA')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    const zipInput = screen.getByPlaceholderText(
      'e.g. 92024',
    ) as HTMLInputElement

    expect(zipInput.value).toBe('92101')
    expect(screen.queryByText('Confirmed')).toBeNull()
  })
})