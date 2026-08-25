// app/client/(gated)/settings/page.test.tsx
//
// The hub only grew one new decision: whether to offer "Offer services".
// It is offered to someone who could actually take it — POST /api/v1/pro/upgrade
// answers 409 ALREADY_PRO once a professional profile exists, so showing the row
// to a dual-role account advertises a door that is already open.

import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mockGetCurrentUser }))

vi.mock('@/lib/brand/ThemeToggle', () => ({
  default: () => React.createElement('div', {}, 'theme-toggle'),
}))

vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: () => ({ displayName: 'TOVIS' }),
}))

vi.mock('@/lib/tenant/layoutContext', () => ({
  resolveTenantContextForLayout: async () => ({ tenantId: 't_1' }),
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: () => false,
}))

vi.mock('next/link', () => ({
  default: (props: {
    href: string
    id?: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement(
      'a',
      { href: props.href, id: props.id, className: props.className },
      props.children,
    ),
}))

import ClientSettingsPage from './page'

const BECOME_PRO_HREF = '/client/settings/become-a-pro'

function hrefs(): (string | null)[] {
  return screen.getAllByRole('link').map((a) => a.getAttribute('href'))
}

describe('app/client/(gated)/settings/page.tsx', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
  })

  it('offers the become-a-pro row to a client-only account', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'u_1',
      role: 'CLIENT',
      professionalProfile: null,
    })

    render(await ClientSettingsPage())

    expect(hrefs()).toContain(BECOME_PRO_HREF)
    expect(screen.getByText('Offer services')).toBeTruthy()
  })

  it('hides it from an account that already has a professional profile', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'u_1',
      role: 'CLIENT',
      professionalProfile: { id: 'pp_1' },
    })

    render(await ClientSettingsPage())

    expect(hrefs()).not.toContain(BECOME_PRO_HREF)
    // The rest of the hub is untouched — this is a new row, not a rebuild.
    expect(hrefs()).toContain('/client/settings/profile')
    expect(hrefs()).toContain('/client/settings/account')
  })

  it('hides it rather than guessing when the user cannot be read', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('boom'))

    render(await ClientSettingsPage())

    expect(hrefs()).not.toContain(BECOME_PRO_HREF)
    expect(hrefs()).toContain('/client/settings/profile')
  })
})
