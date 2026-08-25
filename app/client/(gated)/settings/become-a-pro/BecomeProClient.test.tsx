// app/client/(gated)/settings/become-a-pro/BecomeProClient.test.tsx
//
// The form that finally calls POST /api/v1/pro/upgrade. What is worth pinning
// is not the markup but the things that were the point of building it:
//
//  1. the request actually goes to the upgrade route, with the pro fields the
//     route reads (it shipped dark in #987 — nothing had ever called it)
//  2. a work location the route accepts, never a client ZIP (it refuses one)
//  3. the licence card follows the profession/state pair, and an EXEMPT pair
//     sends no credential rather than an empty string
//  4. ALREADY_PRO ends the form; every other refusal leaves it usable
//  5. success leaves by a HARD navigation — the route re-mints the session
//     cookie with the PRO acting role, and a soft push would keep browsing on
//     the old one

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hardNavigate: vi.fn() }))

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: { displayName: 'TOVIS' },
    mode: 'dark',
    setMode: () => {},
  }),
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

// Only the navigation is faked. `sanitizeInternalPath` is the real one — it is
// what stops a `nextUrl` off the wire becoming an open redirect, so a stub of
// it would be testing the stub.
vi.mock('@/lib/clientNavigation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/clientNavigation')>()
  return { ...actual, hardNavigate: mocks.hardNavigate }
})

import BecomeProClient from './BecomeProClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Routed by URL rather than by call order. The ZIP confirm fires two Google
 * lookups whose ordering is an implementation detail of useWorkLocation, and a
 * sequence-based mock would silently hand the timezone reply to the geocode.
 */
function stubFetch(upgrade: () => Response) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)

    if (url.startsWith('/api/v1/google/geocode')) {
      return jsonResponse({
        geo: {
          lat: 33.036,
          lng: -117.292,
          postalCode: '92024',
          city: 'Encinitas',
          state: 'CA',
          countryCode: 'US',
        },
      })
    }

    if (url.startsWith('/api/v1/google/timezone')) {
      return jsonResponse({ timeZoneId: 'America/Los_Angeles' })
    }

    if (url === '/api/v1/pro/upgrade') return upgrade()

    throw new Error(`unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function selectState(code = 'CA') {
  fireEvent.change(document.getElementById('upgrade-license-state')!, {
    target: { value: code },
  })
}

function selectProfession(value: string) {
  // The profession select is the first combobox; the state select carries an id.
  const [profession] = screen.getAllByRole('combobox')
  fireEvent.change(profession!, { target: { value } })
}

async function confirmMobileBase(zip = '92024') {
  fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))

  const field = document.getElementById('upgrade-location')!
  fireEvent.change(field, { target: { value: zip } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm ZIP' }))

  await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy())
}

function tickConfirmation() {
  fireEvent.click(document.getElementById('upgrade-confirm')!)
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Set up my pro account' }))
}

function lastUpgradeBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(
    (c) => String(c[0]) === '/api/v1/pro/upgrade',
  )
  if (!call) throw new Error('the upgrade route was never called')
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('app/client/(gated)/settings/become-a-pro/BecomeProClient.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hardNavigate.mockReset()
    vi.unstubAllGlobals()
  })

  it('does not call the upgrade route until the form is complete', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }, 201))
    render(<BecomeProClient />)

    submit()

    await waitFor(() =>
      expect(screen.getByText('Please select your state.')).toBeTruthy(),
    )

    // The state is the first field in render order, so that is where the
    // person is put — not at the confirmation checkbox further down.
    expect(document.activeElement?.id).toBe('upgrade-license-state')

    expect(
      fetchMock.mock.calls.some((c) => String(c[0]) === '/api/v1/pro/upgrade'),
    ).toBe(false)
  })

  it('refuses to submit until the irreversible change is confirmed', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }, 201))
    render(<BecomeProClient />)

    selectState('CA')
    await confirmMobileBase()
    fireEvent.change(document.getElementById('upgrade-license-number')!, {
      target: { value: 'abc123' },
    })

    submit()

    await waitFor(() =>
      expect(
        screen.getByText(
          'Please confirm you understand your account becomes a pro account.',
        ),
      ).toBeTruthy(),
    )
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]) === '/api/v1/pro/upgrade'),
    ).toBe(false)
  })

  it('posts a PRO work location, the radius and the credential the state needs', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ ok: true, nextUrl: '/pro/calendar' }, 201),
    )
    render(<BecomeProClient />)

    selectState('CA')
    await confirmMobileBase()
    fireEvent.change(document.getElementById('upgrade-license-number')!, {
      target: { value: 'abc123' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. iLoveTOVIS'), {
      target: { value: ' Ada Styles! ' },
    })
    tickConfirmation()

    submit()

    await waitFor(() => expect(mocks.hardNavigate).toHaveBeenCalled())

    const body = lastUpgradeBody(fetchMock)

    expect(body.professionType).toBe('COSMETOLOGIST')
    expect(body.licenseState).toBe('CA')
    // Upper-cased on the way out, the same as pro signup does.
    expect(body.licenseNumber).toBe('ABC123')
    expect(body.mobileRadiusMiles).toBe(15)
    expect(body.handle).toBe('adastyles')

    // A client ZIP is refused by the route (LOCATION_INVALID) — this has to be
    // one of the two PRO shapes, carrying a real timezone.
    expect(body.signupLocation).toMatchObject({
      kind: 'PRO_MOBILE',
      postalCode: '92024',
      timeZoneId: 'America/Los_Angeles',
    })
  })

  it('sends no credential for a profession the state does not license', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }, 201))
    render(<BecomeProClient />)

    selectProfession('MAKEUP_ARTIST')
    selectState('CA')

    // The card is gone, so there is no field to leave blank.
    expect(document.getElementById('upgrade-license-number')).toBeNull()

    await confirmMobileBase()
    tickConfirmation()
    submit()

    await waitFor(() => expect(mocks.hardNavigate).toHaveBeenCalled())

    const body = lastUpgradeBody(fetchMock)
    // Absent, not '' — an empty string is a value the route would have to
    // decide what to do with.
    expect('licenseNumber' in body).toBe(false)
    expect('licenseExpiry' in body).toBe(false)
  })

  it('leaves the form usable when the refusal is retryable', async () => {
    stubFetch(() =>
      jsonResponse(
        { error: 'That handle is taken.', code: 'HANDLE_TAKEN' },
        409,
      ),
    )
    render(<BecomeProClient />)

    selectState('CA')
    await confirmMobileBase()
    fireEvent.change(document.getElementById('upgrade-license-number')!, {
      target: { value: 'abc123' },
    })
    tickConfirmation()
    submit()

    await waitFor(() =>
      expect(screen.getByText('That handle is taken.')).toBeTruthy(),
    )

    // Still a form, still submittable — the account was not created.
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Set up my pro account' }),
    ).toBeTruthy()
  })

  it('stops offering to create a workspace that already exists', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: 'This account already has a professional profile.',
          code: 'ALREADY_PRO',
        },
        409,
      ),
    )
    render(<BecomeProClient />)

    selectState('CA')
    await confirmMobileBase()
    fireEvent.change(document.getElementById('upgrade-license-number')!, {
      target: { value: 'abc123' },
    })
    tickConfirmation()
    submit()

    await waitFor(() =>
      expect(mocks.hardNavigate).toHaveBeenCalledWith('/pro/calendar'),
    )
  })

  it('will not follow a nextUrl that leaves the site', async () => {
    stubFetch(() =>
      jsonResponse({ ok: true, nextUrl: '//evil.example.com/pwn' }, 201),
    )
    render(<BecomeProClient />)

    selectState('CA')
    await confirmMobileBase()
    fireEvent.change(document.getElementById('upgrade-license-number')!, {
      target: { value: 'abc123' },
    })
    tickConfirmation()
    submit()

    await waitFor(() =>
      expect(mocks.hardNavigate).toHaveBeenCalledWith('/pro/calendar'),
    )
  })
})
