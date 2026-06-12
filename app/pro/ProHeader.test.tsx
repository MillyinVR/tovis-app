// app/pro/ProHeader.test.tsx
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
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

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: { displayName: 'TOVIS' },
  }),
}))

import ProHeader from './ProHeader'

describe('app/pro/ProHeader', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ hasUnread: false, count: 0 }), {
        status: 200,
      }),
    )

    mocks.usePathname.mockReturnValue('/pro/calendar')
    mocks.useRouter.mockReturnValue({
      replace: vi.fn(),
      refresh: vi.fn(),
    })
  })

  it('renders the account menu trigger in the header', () => {
    render(
      <ProHeader
        businessName="TOVIS Studio"
        subtitle="@tovisstudio"
        publicUrl="/professionals/pro_1"
      />,
    )

    expect(
      screen.getByRole('button', { name: /account menu/i }),
    ).toBeInTheDocument()
  })

  it('exposes sign out from the account menu', async () => {
    const user = userEvent.setup()

    render(
      <ProHeader
        businessName="TOVIS Studio"
        subtitle="@tovisstudio"
        publicUrl="/professionals/pro_1"
      />,
    )

    await user.click(screen.getByRole('button', { name: /account menu/i }))

    const menu = await screen.findByRole('menu', { name: /account actions/i })

    expect(within(menu).getByText('TOVIS Studio')).toBeInTheDocument()
    expect(
      within(menu).getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
  })
})
