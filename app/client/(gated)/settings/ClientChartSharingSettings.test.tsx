// app/client/(gated)/settings/ClientChartSharingSettings.test.tsx
//
// This row names a pro the client has a real relationship with (they asked to
// read the client's chart) and rendered them as dead text. Covered here rather
// than in the browser because the local dev DB has no `ClientChartShare` table.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}))

import ClientChartSharingSettings from './ClientChartSharingSettings'

function mockShares(shares: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ shares }),
      text: async () => JSON.stringify({ shares }),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ClientChartSharingSettings', () => {
  it('links the pro name and avatar to the pro profile', async () => {
    mockShares([
      {
        professionalId: 'pro_1',
        professionalName: 'Glow Studio',
        avatarUrl: 'https://cdn.example/a.jpg',
        status: 'GRANTED',
      },
    ])

    render(<ClientChartSharingSettings />)

    expect(
      await screen.findByRole('link', { name: 'Glow Studio' }),
    ).toHaveAttribute('href', '/professionals/pro_1')
    expect(
      screen.getByRole('link', { name: "View Glow Studio's profile" }),
    ).toHaveAttribute('href', '/professionals/pro_1')
  })

  it('still renders the revoke control alongside the new links', async () => {
    mockShares([
      {
        professionalId: 'pro_1',
        professionalName: 'Glow Studio',
        avatarUrl: null,
        status: 'GRANTED',
      },
    ])

    render(<ClientChartSharingSettings />)

    expect(await screen.findByText('Can see your chart')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Turn off' }),
    ).toBeInTheDocument()
  })
})
