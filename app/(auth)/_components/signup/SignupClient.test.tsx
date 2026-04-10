import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockRefresh = vi.hoisted(() => vi.fn())
const mockSearchParamsGet = vi.hoisted(() => vi.fn())
const mockHardNavigate = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('../AuthShell', () => ({
  default: ({
    children,
    title,
    subtitle,
  }: {
    children: React.ReactNode
    title: string
    subtitle: string
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}))

vi.mock('@/lib/clientNavigation', () => ({
  hardNavigate: mockHardNavigate,
}))

vi.mock('@/lib/http', () => ({
  safeJsonRecord: async (res: Response) => {
    const data = await res.json().catch(() => null)
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
  },
  readErrorMessage: (data: Record<string, unknown> | null) =>
    typeof data?.error === 'string' ? data.error : null,
  readStringField: (data: Record<string, unknown> | null, key: string) =>
    typeof data?.[key] === 'string' ? (data[key] as string) : null,
}))

import SignupClient from './SignupClient'

function makeResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function fillClientSignupForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Tori')
  await user.type(screen.getByLabelText(/last name/i), 'Morales')
  await user.type(screen.getByLabelText(/phone/i), '(555) 123-4567')
  await user.type(screen.getByLabelText(/email address/i), 'client@example.com')
  const passwordInput = screen.getByPlaceholderText(
  'Create a strong one',
) as HTMLInputElement

fireEvent.change(passwordInput, {
  target: { value: 'SuperSecret123!' },
})

expect(passwordInput.value).toBe('SuperSecret123!')

  await user.type(
    screen.getByPlaceholderText('Enter your ZIP code (e.g. 92101)'),
    '92101',
  )

  await user.click(screen.getByRole('button', { name: /confirm zip/i }))

  await waitFor(() => {
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument()
  })
}

describe('app/(auth)/_components/signup/SignupClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    mockRefresh.mockReset()
    mockSearchParamsGet.mockReset()
    mockHardNavigate.mockReset()
    fetchMock.mockReset()

    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'ti') return 'tap_1'
      if (key === 'role') return null
      return null
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  it('redirects to verify-phone with nextUrl after successful signup when email verification was sent', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          geo: {
            lat: 32.7157,
            lng: -117.1611,
            postalCode: '92101',
            city: 'San Diego',
            state: 'CA',
            countryCode: 'US',
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          timeZoneId: 'America/Los_Angeles',
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          nextUrl: '/looks?from=tap',
          emailVerificationSent: true,
        }),
      )

    const { container } = render(<SignupClient />)

    await fillClientSignupForm(user)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      }),
    )

    const registerCall = fetchMock.mock.calls[2]
    const parsedBody = JSON.parse(String(registerCall?.[1]?.body))

    expect(parsedBody).toMatchObject({
      email: 'client@example.com',
      password: 'SuperSecret123!',
      role: 'CLIENT',
      firstName: 'Tori',
      lastName: 'Morales',
      phone: '(555)123-4567',
      tapIntentId: 'tap_1',
      timeZone: 'America/Los_Angeles',
      signupLocation: {
        kind: 'CLIENT_ZIP',
        postalCode: '92101',
        city: 'San Diego',
        state: 'CA',
        countryCode: 'US',
        lat: 32.7157,
        lng: -117.1611,
        timeZoneId: 'America/Los_Angeles',
      },
    })

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })

    expect(mockHardNavigate).toHaveBeenCalledWith(
      '/verify-phone?next=%2Flooks%3Ffrom%3Dtap',
    )
  })

  it('redirects to verify-phone with email=retry when signup email was not sent', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          geo: {
            lat: 32.7157,
            lng: -117.1611,
            postalCode: '92101',
            city: 'San Diego',
            state: 'CA',
            countryCode: 'US',
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          timeZoneId: 'America/Los_Angeles',
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          nextUrl: '/looks?from=tap',
          emailVerificationSent: false,
        }),
      )

    const { container } = render(<SignupClient />)

    await fillClientSignupForm(user)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })

    expect(mockHardNavigate).toHaveBeenCalledWith(
      '/verify-phone?next=%2Flooks%3Ffrom%3Dtap&email=retry',
    )
  })

  it('shows the server error when signup fails', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          geo: {
            lat: 32.7157,
            lng: -117.1611,
            postalCode: '92101',
            city: 'San Diego',
            state: 'CA',
            countryCode: 'US',
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          timeZoneId: 'America/Los_Angeles',
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(
          {
            ok: false,
            error: 'Email already in use.',
          },
          400,
        ),
      )

    const { container } = render(<SignupClient />)

    await fillClientSignupForm(user)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      expect(screen.getByText('Email already in use.')).toBeInTheDocument()
    })

    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockHardNavigate).not.toHaveBeenCalled()
  })
})