// app/client/(gated)/settings/become-a-pro/page.test.tsx
//
// The one question this page exists to answer: is the form a dead end for this
// person? POST /api/v1/pro/upgrade refuses 409 ALREADY_PRO once a professional
// profile exists, so rendering the form for them would be a button that cannot
// work — and a LINK to /pro would be worse, because the pro shell bounces an
// acting role that is not PRO straight into a login screen they are already
// past.

import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mockGetCurrentUser }))

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

vi.mock('next/link', () => ({
  default: (props: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href: props.href }, props.children),
}))

vi.mock('./BecomeProClient', () => ({
  default: () => React.createElement('div', {}, 'BECOME_PRO_FORM'),
}))

import ClientBecomeProPage from './page'

describe('app/client/(gated)/settings/become-a-pro/page.tsx', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockRedirect.mockReset()
    mockRedirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`)
    })
  })

  it('offers the form to a client with no professional profile', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'u_1',
      role: 'CLIENT',
      professionalProfile: null,
    })

    render(await ClientBecomeProPage())

    expect(screen.getByText('BECOME_PRO_FORM')).toBeTruthy()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('does not offer the form to an account that already has a pro workspace', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'u_1',
      role: 'CLIENT',
      professionalProfile: { id: 'pp_1' },
    })

    render(await ClientBecomeProPage())

    expect(screen.queryByText('BECOME_PRO_FORM')).toBeNull()
    expect(screen.getByText('You already offer services')).toBeTruthy()

    // No /pro link — the pro shell would bounce them; the global workspace
    // switcher is the control that actually moves them.
    expect(
      screen
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
        .some((href) => href?.startsWith('/pro')),
    ).toBe(false)
  })

  it('sends an unauthenticated caller back rather than rendering a form', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(ClientBecomeProPage()).rejects.toThrow(
      'NEXT_REDIRECT:/client/settings',
    )
  })
})
