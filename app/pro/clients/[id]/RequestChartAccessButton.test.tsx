// app/pro/clients/[id]/RequestChartAccessButton.test.tsx
//
// The control the whole follow-up exists for. Covered here rather than in the
// browser because reaching it live needs a pro signed in against a client they
// can CONTACT but not VIEW — a relationship the dev DB has no seed for.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import RequestChartAccessButton from './RequestChartAccessButton'

function mockPost(ok: boolean, payload: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 201 : 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('RequestChartAccessButton', () => {
  it('offers the ask when nothing blocks it', () => {
    render(<RequestChartAccessButton clientId="client_1" block={null} />)

    expect(
      screen.getByRole('button', { name: 'Request chart access' }),
    ).toBeInTheDocument()
  })

  it('POSTs to the pro chart-share route for this client', async () => {
    mockPost(true, { chartShare: { status: 'REQUESTED' } })

    render(<RequestChartAccessButton clientId="client_1" block={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request chart access' }))

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/pro/clients/client_1/chart-share',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('turns into waiting copy once the ask lands, so it cannot be pressed twice', async () => {
    mockPost(true, { chartShare: { status: 'REQUESTED' } })

    render(<RequestChartAccessButton clientId="client_1" block={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request chart access' }))

    expect(await screen.findByText(/waiting on them/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Request chart access' }),
    ).not.toBeInTheDocument()
  })

  it('surfaces the server refusal instead of failing silently', async () => {
    mockPost(false, { error: 'This client declined to share their chart.' })

    render(<RequestChartAccessButton clientId="client_1" block={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request chart access' }))

    expect(
      await screen.findByText('This client declined to share their chart.'),
    ).toBeInTheDocument()
  })

  // Every blocked state renders as TEXT. A disabled button still reads as a
  // control the pro is failing to use — and for DECLINED it would read as the
  // client's answer being negotiable.
  it.each([
    ['REQUEST_PENDING', /waiting on them/i],
    ['DECLINED', /declined to share/i],
    ['COOLDOWN', /recently turned off/i],
    ['ALREADY_GRANTED', /already share/i],
  ] as const)('renders %s as copy with no button', (block, copy) => {
    render(<RequestChartAccessButton clientId="client_1" block={block} />)

    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
