// app/client/page.test.tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockClientHomeShellProps = {
  brandText: string
  displayName: string
  home: unknown
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),

  getCurrentUser: vi.fn(),
  getBrandConfig: vi.fn(),
  getClientHomeData: vi.fn(),

  clientHomeShellProps: [] as MockClientHomeShellProps[],

  homeData: {
    upcoming: null,
    action: null,
    invites: [],
    waitlists: [],
    favoritePros: [],
  },

  prisma: {
    professionalFavorite: {
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/brand', () => ({
  getBrandConfig: mocks.getBrandConfig,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('./_data/getClientHomeData', () => ({
  getClientHomeData: mocks.getClientHomeData,
}))

vi.mock('./_components/ClientHomeShell', () => ({
  default: function MockClientHomeShell(props: MockClientHomeShellProps) {
    mocks.clientHomeShellProps.push(props)

    return (
      <div data-testid="client-home-shell">
        ClientHomeShell: {props.displayName}
      </div>
    )
  },
}))

import ClientHomePage from './page'

describe('app/client/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientHomeShellProps.length = 0

    mocks.getBrandConfig.mockReturnValue({
      assets: {
        wordmark: {
          text: 'TOVIS',
        },
      },
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: 'CLIENT',
      email: 'tori@example.com',
      clientProfile: {
        id: 'client_1',
        firstName: 'Tori',
      },
    })

    mocks.getClientHomeData.mockResolvedValue(mocks.homeData)
  })

  it('renders the client home shell with route-backed home data', async () => {
    render(await ClientHomePage())

    expect(mocks.getClientHomeData).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
    })

    expect(screen.getByTestId('client-home-shell')).toHaveTextContent(
      'ClientHomeShell: Tori',
    )

    expect(mocks.clientHomeShellProps).toHaveLength(1)
    expect(mocks.clientHomeShellProps[0]).toMatchObject({
      brandText: 'TOVIS',
      displayName: 'Tori',
      home: mocks.homeData,
    })

    expect(typeof mocks.clientHomeShellProps[0]?.removeProFavoriteAction).toBe(
      'function',
    )
  })

  it('uses email as the display name when the client profile has no first name', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: 'CLIENT',
      email: 'tori@example.com',
      clientProfile: {
        id: 'client_1',
        firstName: '',
      },
    })

    render(await ClientHomePage())

    expect(screen.getByTestId('client-home-shell')).toHaveTextContent(
      'ClientHomeShell: tori@example.com',
    )

    expect(mocks.clientHomeShellProps[0]).toMatchObject({
      displayName: 'tori@example.com',
    })
  })

  it('redirects non-client users to login', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_2',
      role: 'PRO',
      email: 'pro@example.com',
      clientProfile: null,
    })

    await expect(ClientHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=/client',
    )

    expect(mocks.redirect).toHaveBeenCalledWith('/login?from=/client')
    expect(mocks.getClientHomeData).not.toHaveBeenCalled()
  })
})