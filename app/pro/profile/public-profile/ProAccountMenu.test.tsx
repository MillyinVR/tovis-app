import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
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

import ProAccountMenu from './ProAccountMenu'

describe('app/pro/profile/public-profile/ProAccountMenu', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('shows View as client when publicUrl is present', async () => {
    const user = userEvent.setup()

    render(
      <ProAccountMenu
        businessName="TOVIS Studio"
        subtitle="BARBER"
        publicUrl="/professionals/pro_1"
        looksHref="/looks"
        proServicesHref="/pro/profile/public-profile?tab=services"
        uploadHref="/pro/media/new"
        messagesHref="/messages"
      />,
    )

    await user.click(screen.getByRole('button', { name: /account menu/i }))

    const menu = await screen.findByRole('menu', { name: /account actions/i })

    expect(
      within(menu).getByRole('menuitem', { name: /view as client/i }),
    ).toHaveAttribute('href', '/professionals/pro_1')

    expect(
      within(menu).getByRole('menuitem', { name: /looks/i }),
    ).toHaveAttribute('href', '/looks')

    expect(
      within(menu).getByRole('menuitem', { name: /manage services/i }),
    ).toHaveAttribute('href', '/pro/profile/public-profile?tab=services')

    expect(
      within(menu).getByRole('menuitem', { name: /upload/i }),
    ).toHaveAttribute('href', '/pro/media/new')

    expect(
      within(menu).getByRole('menuitem', { name: /messages/i }),
    ).toHaveAttribute('href', '/messages')
  })

  it('hides View as client when publicUrl is null but keeps the other actions', async () => {
    const user = userEvent.setup()

    render(
      <ProAccountMenu
        businessName="TOVIS Studio"
        subtitle="BARBER"
        publicUrl={null}
        looksHref="/looks"
        proServicesHref="/pro/profile/public-profile?tab=services"
        uploadHref="/pro/media/new"
        messagesHref="/messages"
      />,
    )

    await user.click(screen.getByRole('button', { name: /account menu/i }))

    const menu = await screen.findByRole('menu', { name: /account actions/i })

    expect(
      within(menu).queryByRole('menuitem', { name: /view as client/i }),
    ).not.toBeInTheDocument()

    expect(
      within(menu).getByRole('menuitem', { name: /looks/i }),
    ).toHaveAttribute('href', '/looks')

    expect(
      within(menu).getByRole('menuitem', { name: /manage services/i }),
    ).toHaveAttribute('href', '/pro/profile/public-profile?tab=services')

    expect(
      within(menu).getByRole('menuitem', { name: /upload/i }),
    ).toHaveAttribute('href', '/pro/media/new')

    expect(
      within(menu).getByRole('menuitem', { name: /messages/i }),
    ).toHaveAttribute('href', '/messages')
  })

  it('signs out and redirects to login', async () => {
    const user = userEvent.setup()

    render(
      <ProAccountMenu
        businessName="TOVIS Studio"
        subtitle="BARBER"
        publicUrl="/professionals/pro_1"
        looksHref="/looks"
        proServicesHref="/pro/profile/public-profile?tab=services"
        uploadHref="/pro/media/new"
        messagesHref="/messages"
      />,
    )

    await user.click(screen.getByRole('button', { name: /account menu/i }))
    await user.click(await screen.findByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
      })
    })

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?from=/pro')
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})