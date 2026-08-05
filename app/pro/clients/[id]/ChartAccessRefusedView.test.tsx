// app/pro/clients/[id]/ChartAccessRefusedView.test.tsx
//
// Proves the screen that replaced `redirect('/pro/clients')` — and, more
// importantly, that the button it renders is driven by the SAME
// `chartShareRequestBlock` the POST runs. A screen that derives "can I ask?"
// independently is how a button appears for a state the server refuses.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { CHART_SHARE_REREQUEST_COOLDOWN_MS } from '@/lib/clients/chartShare'
import type { ChartShareState } from '@/lib/clients/chartShare'

import ChartAccessRefusedView from './ChartAccessRefusedView'

const NOW = new Date('2026-09-01T12:00:00.000Z')
const NO_SHARE: ChartShareState = {
  status: null,
  requestedAt: null,
  respondedAt: null,
  revokedAt: null,
}

function renderView(
  share: ChartShareState,
  publicProfileHref: string | null = null,
) {
  return render(
    <ChartAccessRefusedView
      clientId="client_1"
      clientName="Rae Kim"
      share={share}
      messageHref="/messages/thread/t_1"
      publicProfileHref={publicProfileHref}
      now={NOW}
    />,
  )
}

describe('ChartAccessRefusedView', () => {
  it('names the client, explains the refusal, and offers the ask', () => {
    renderView(NO_SHARE)

    expect(
      screen.getByText('Rae Kim hasn’t shared their chart with you'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Request chart access' }),
    ).toBeInTheDocument()
  })

  // The pro almost always arrived here from the conversation. A refusal screen
  // with no way back to it is a second dead end.
  it('keeps a route back to the conversation', () => {
    renderView(NO_SHARE)

    expect(screen.getByRole('link', { name: 'Message Rae Kim' })).toHaveAttribute(
      'href',
      '/messages/thread/t_1',
    )
  })

  it('hides the ask while a request is already open', () => {
    renderView({ ...NO_SHARE, status: 'REQUESTED', requestedAt: NOW })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/waiting on them/i)).toBeInTheDocument()
  })

  // The cooldown reaching the UI is the point: without it the pro sees a live
  // button that the POST answers with 409 the moment they press it.
  it('hides the ask inside the re-request cooldown after a revoke', () => {
    renderView({
      ...NO_SHARE,
      status: 'REVOKED',
      revokedAt: new Date(NOW.getTime() - 60_000),
    })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/recently turned off/i)).toBeInTheDocument()
  })

  it('offers the ask again once the cooldown is served', () => {
    renderView({
      ...NO_SHARE,
      status: 'REVOKED',
      revokedAt: new Date(NOW.getTime() - CHART_SHARE_REREQUEST_COOLDOWN_MS),
    })

    expect(
      screen.getByRole('button', { name: 'Request chart access' }),
    ).toBeInTheDocument()
  })
})


// The refusal screen is where a pro lands after tapping a client whose chart has
// closed. It must not be a dead end for a client whose PUBLIC page the pro (and
// everyone else) can already read — and it must not promise one that isn't there.
describe('ChartAccessRefusedView — public profile escape hatch', () => {
  it('offers the public profile when the client has one', () => {
    renderView(NO_SHARE, '/u/rae')

    expect(
      screen.getByRole('link', { name: 'View public profile' }),
    ).toHaveAttribute('href', '/u/rae')
  })

  it('renders NO public-profile link for a private client', () => {
    renderView(NO_SHARE, null)

    expect(
      screen.queryByRole('link', { name: 'View public profile' }),
    ).toBeNull()
    // And nothing that merely looks like one.
    expect(screen.queryByText('View public profile')).toBeNull()
  })
})
