// app/(auth)/_components/signup/SignupProClient.test.tsx
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

import SignupProClient from './SignupProClient'

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

function clickMobileMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
}

async function confirmMobileZip(zip = '92101') {
  clickMobileMode()

  const locationInput = screen.getByPlaceholderText(
    'Enter your ZIP code (e.g. 92101)',
  ) as HTMLInputElement

  fireEvent.change(locationInput, { target: { value: zip } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm ZIP' }))

  await waitFor(() => {
    expect(screen.getByText('Confirmed')).toBeTruthy()
  })
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

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/First name/i), {
    target: { value: 'Tori' },
  })
  fireEvent.change(screen.getByLabelText(/Last name/i), {
    target: { value: 'Morales' },
  })
  fireEvent.change(screen.getByPlaceholderText('+1 (___) ___-____'), {
    target: { value: '+16195551234' },
  })
  fireEvent.change(screen.getByLabelText(/Email address/i), {
    target: { value: 'pro@example.com' },
  })
  fireEvent.change(getPasswordInput(), {
    target: { value: 'longpassword' },
  })
  fireEvent.change(screen.getByLabelText(/License number/i), {
    target: { value: '123456' },
  })
}

describe('app/(auth)/_components/signup/SignupProClient.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    mocks.router.refresh.mockReset()
    mocks.hardNavigate.mockReset()
    mocks.getTurnstileToken.mockReset()
    mocks.getTurnstileToken.mockResolvedValue('ts_pro_ok')
    mocks.setSearchParams({})
  })

  it('shows inline consent errors instead of submitting when consents are missing', async () => {
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

    render(<SignupProClient />)

    await confirmMobileZip('92101')
    fillRequiredFields()

    const submitButton = screen.getByRole('button', {
      name: 'Create Pro Account',
    })

    expect(submitButton.hasAttribute('disabled')).toBe(false)

    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(
        screen.getByText(
          'Required so we can send verification codes and appointment updates.',
        ),
      ).toBeTruthy()
    })

    expect(
      screen.getByText('Please accept the Terms and Privacy Policy.'),
    ).toBeTruthy()
    expect(mocks.getTurnstileToken).not.toHaveBeenCalled()

    checkTransactionalSmsConsent()
    checkTermsConsent()

    expect(
      screen.queryByText(
        'Required so we can send verification codes and appointment updates.',
      ),
    ).toBeNull()
    expect(
      screen.queryByText('Please accept the Terms and Privacy Policy.'),
    ).toBeNull()
  })

  it('inline-flags a missing license number and focuses the location first when unconfirmed', async () => {
    setFetchSequence([])

    render(<SignupProClient />)

    fillRequiredFields()
    fireEvent.change(screen.getByLabelText(/License number/i), {
      target: { value: '' },
    })
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
    )

    await waitFor(() => {
      expect(
        screen.getByText('Please choose an address from the dropdown.'),
      ).toBeTruthy()
    })

    expect(
      screen.getByText('License number is required for this profession.'),
    ).toBeTruthy()

    expect(document.activeElement?.id).toBe('signup-pro-location')
    expect(mocks.getTurnstileToken).not.toHaveBeenCalled()
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
  })

  it('submits with separate transactional SMS consent, tosAccepted, and turnstileToken, then treats pending verification sends as optimistic success', async () => {
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
        nextUrl: '/pro/calendar',
        emailVerificationSent: 'pending',
        phoneVerificationSent: 'pending',
      }),
    ])

    render(<SignupProClient />)

    await confirmMobileZip('92101')
    fillRequiredFields()
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(mocks.getTurnstileToken).toHaveBeenCalledWith('signup_pro')

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const registerCall = fetchMock.mock.calls[2]
    const registerBody = JSON.parse(String(registerCall?.[1]?.body ?? '{}'))

    expect(registerBody).toMatchObject({
      email: 'pro@example.com',
      password: 'longpassword',
      role: 'PRO',
      firstName: 'Tori',
      lastName: 'Morales',
      phone: '+16195551234',
      transactionalSmsConsent: true,
      tosAccepted: true,
      turnstileToken: 'ts_pro_ok',
      professionType: 'COSMETOLOGIST',
      mobileRadiusMiles: 15,
      licenseState: 'CA',
      licenseNumber: '123456',
      signupLocation: {
        kind: 'PRO_MOBILE',
        postalCode: '92101',
        city: 'San Diego',
        state: 'CA',
        countryCode: 'US',
        lat: 32.7157,
        lng: -117.1611,
        timeZoneId: 'America/Los_Angeles',
      },
    })

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fpro%2Fcalendar',
      )
    })
  })

  it('preserves explicit retry redirect params when register reports real send failures', async () => {
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
        nextUrl: '/pro/calendar',
        emailVerificationSent: false,
        phoneVerificationSent: false,
      }),
    ])

    render(<SignupProClient />)

    await confirmMobileZip('92101')
    fillRequiredFields()
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fpro%2Fcalendar&email=retry&sms=retry',
      )
    })
  })

  it('prefills from forwarded params, carries next into register, and falls back to query next for verify-phone', async () => {
    mocks.setSearchParams({
      ti: 'tap_pro_1',
      next: '/pro/services?from=invite',
      intent: 'TEAM_INVITE',
      inviteToken: 'invite_token_1',
      email: 'prefill-pro@example.com',
      phone: '+16195550000',
      name: 'Pre Filled Pro',
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
        nextUrl: null,
        emailVerificationSent: 'pending',
        phoneVerificationSent: 'pending',
      }),
    ])

    render(<SignupProClient />)

    expect(
      (screen.getByLabelText(/First name/i) as HTMLInputElement).value,
    ).toBe('Pre')
    expect(
      (screen.getByLabelText(/Last name/i) as HTMLInputElement).value,
    ).toBe('Filled Pro')
    expect(
      (screen.getByLabelText(/Email address/i) as HTMLInputElement).value,
    ).toBe('prefill-pro@example.com')
    expect(
      (
        screen.getByPlaceholderText('+1 (___) ___-____') as HTMLInputElement
      ).value,
    ).toBe('+1 (619) 555-0000')

    const loginLink = screen.getByRole('link', { name: 'Sign in' })
    const loginHref = loginLink.getAttribute('href') ?? ''
    expect(loginHref).toContain('ti=tap_pro_1')
    expect(loginHref).toContain('next=%2Fpro%2Fservices%3Ffrom%3Dinvite')
    expect(loginHref).toContain('email=prefill-pro%40example.com')
    expect(loginHref).toContain('role=PRO')

    await confirmMobileZip('92101')
    fireEvent.change(screen.getByLabelText(/License number/i), {
      target: { value: '123456' },
    })
    fireEvent.change(getPasswordInput(), {
      target: { value: 'longpassword' },
    })
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    const registerBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}'),
    )

    expect(registerBody).toMatchObject({
      tapIntentId: 'tap_pro_1',
      next: '/pro/services?from=invite',
      intent: 'TEAM_INVITE',
      inviteToken: 'invite_token_1',
      email: 'prefill-pro@example.com',
      phone: '+16195550000',
      firstName: 'Pre',
      lastName: 'Filled Pro',
    })

    // Register returned no nextUrl, so the query param must drive the
    // post-verification redirect.
    await waitFor(() => {
      expect(mocks.hardNavigate).toHaveBeenCalledWith(
        '/verify-phone?next=%2Fpro%2Fservices%3Ffrom%3Dinvite',
      )
    })
  })

  it('surfaces turnstile errors and does not call register', async () => {
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

    render(<SignupProClient />)

    await confirmMobileZip('92101')
    fillRequiredFields()
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
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

  it('shows the neutral duplicate-account error from register failures', async () => {
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

    render(<SignupProClient />)

    await confirmMobileZip('92101')
    fillRequiredFields()
    checkAllRequiredConsents()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Pro Account' }),
    )

    await waitFor(() => {
      expect(
        screen.getByText('An account already exists with those details.'),
      ).toBeTruthy()
    })

    expect(mocks.hardNavigate).not.toHaveBeenCalled()
    expect(mocks.router.refresh).not.toHaveBeenCalled()
  })
})