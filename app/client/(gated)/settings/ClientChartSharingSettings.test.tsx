// app/client/(gated)/settings/ClientChartSharingSettings.test.tsx
//
// This row names a pro the client has a real relationship with (they asked to
// read the client's chart) and rendered them as dead text. Covered here rather
// than in the browser because the local dev DB has no `ClientChartShare` table.
import { fireEvent, render, screen } from '@testing-library/react'
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

  // W5 follow-up. The server has accepted DECLINE since W5, but this row only
  // ever rendered "Share chart" — so the only answers a client could actually
  // give an open request were "yes" and silence, and silence leaves the ask
  // sitting in the pro's UI as still-pending forever.
  it('offers BOTH answers on an open request', async () => {
    mockShares([
      {
        professionalId: 'pro_1',
        professionalName: 'Glow Studio',
        avatarUrl: null,
        status: 'REQUESTED',
      },
    ])

    render(<ClientChartSharingSettings />)

    expect(await screen.findByText('Asked to see your chart')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share chart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeInTheDocument()
  })

  it('sends DECLINE — not GRANT — when the client says no', async () => {
    mockShares([
      {
        professionalId: 'pro_1',
        professionalName: 'Glow Studio',
        avatarUrl: null,
        status: 'REQUESTED',
      },
    ])

    render(<ClientChartSharingSettings />)

    const decline = await screen.findByRole('button', { name: 'No thanks' })
    fireEvent.click(decline)

    // The whole point: a mis-wired button here would GRANT the chart to a pro
    // the client just refused, which is the worst possible direction to fail.
    await vi.waitFor(() => {
      const patch = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(patch).toBeDefined()
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        professionalId: 'pro_1',
        action: 'DECLINE',
      })
    })
  })

  // Only an OPEN ask can be declined. A REVOKED/DECLINED row offering "No
  // thanks" would be a control that re-answers a question nobody asked.
  it('does not offer decline when there is no open request', async () => {
    mockShares([
      {
        professionalId: 'pro_1',
        professionalName: 'Glow Studio',
        avatarUrl: null,
        status: 'REVOKED',
      },
    ])

    render(<ClientChartSharingSettings />)

    expect(await screen.findByText('You turned this off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share chart' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'No thanks' }),
    ).not.toBeInTheDocument()
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
