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

  it('keeps submit disabled until consent is checked', async () => {
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
    expect(submitButton.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(submitButton.hasAttribute('disabled')).toBe(false)
  })

  it('submits with tosAccepted and turnstileToken, then treats pending verification sends as optimistic success', async () => {
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
    fireEvent.click(screen.getByRole('checkbox'))

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
    fireEvent.click(screen.getByRole('checkbox'))

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
    fireEvent.click(screen.getByRole('checkbox'))

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
    fireEvent.click(screen.getByRole('checkbox'))

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