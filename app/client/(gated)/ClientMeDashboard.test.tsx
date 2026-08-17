// app/client/(gated)/ClientMeDashboard.test.tsx
//
// Regression cover for the settings dead-end.
//
// The link to /client/settings used to live ONLY in the else-branch of the
// public-profile prompt: going public swapped "Set up public profile" for
// "View public profile" and took the only route to settings with it. A client
// who opted into a public profile could no longer reach payment methods,
// service addresses, notification preferences — or the switch back to private.
// These tests pin the link to profile state so it can never be coupled again.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The header's Share button reads the brand for its share title. At runtime the
// root layout supplies the provider (app/layout.tsx); a bare render() does not.
vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({ brand: { displayName: 'TOVIS' } }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('./components/LogoutButton', () => ({
  default: () => <button type="button">Log out</button>,
}))

vi.mock('@/app/_components/WorkspaceSwitcher', () => ({
  default: () => null,
}))

vi.mock('./_components/FollowSuggestionsRail', () => ({
  default: () => null,
}))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <span data-alt={alt} />,
}))

import ClientMeDashboard from './ClientMeDashboard'

function renderDashboard(
  publicProfile: { handle: string | null; isPublic: boolean },
) {
  return render(
    <ClientMeDashboard
      displayName="Ada"
      handle="ada"
      counts={{ followers: 0, boards: 0, saved: 0, booked: 0 }}
      upcomingNotificationBooking={null}
      boards={[]}
      following={[]}
      history={[]}
      publicProfile={publicProfile}
      activityHref="/client/activity"
      workspaces={[]}
    />,
  )
}

describe('ClientMeDashboard settings entry point', () => {
  it('links to /client/settings when the profile is PRIVATE', () => {
    renderDashboard({ handle: null, isPublic: false })

    expect(screen.getByTestId('client-settings-link')).toHaveAttribute(
      'href',
      '/client/settings',
    )
  })

  // The exact reported bug: public profile + claimed handle.
  it('STILL links to /client/settings when the profile is PUBLIC', () => {
    renderDashboard({ handle: 'ada', isPublic: true })

    expect(screen.getByTestId('client-settings-link')).toHaveAttribute(
      'href',
      '/client/settings',
    )
  })

  it('shows the public profile link only once public, without losing settings', () => {
    renderDashboard({ handle: 'ada', isPublic: true })

    // Both must coexist — the regression was one replacing the other.
    expect(screen.getByRole('link', { name: /view public profile/i })).toBeTruthy()
    expect(screen.getByTestId('client-settings-link')).toBeTruthy()
  })

  it('a public profile with no handle still reaches settings', () => {
    // Half-migrated state: opted in but the handle write never landed.
    renderDashboard({ handle: null, isPublic: true })

    expect(screen.getByTestId('client-settings-link')).toHaveAttribute(
      'href',
      '/client/settings',
    )
  })
})
