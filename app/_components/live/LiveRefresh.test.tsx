// app/_components/live/LiveRefresh.test.tsx
//
// The bug this pins: `router.refresh()` only re-runs SERVER components. A pro
// surface that holds its rows in client state (the calendar fetches
// /api/v1/pro/calendar from a hook) kept rendering stale data even though the
// live-sync ping arrived — so a client approving a consultation was invisible
// until the pro reloaded by hand.
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  /** The `onChanged` the component handed to useLiveChannels, so a test can fire a ping. */
  onChanged: { current: null as null | (() => void) },
  channels: { current: [] as string[] },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('./useLiveChannels', () => ({
  useLiveChannels: (channels: string[], onChanged: () => void) => {
    mocks.channels.current = channels
    mocks.onChanged.current = onChanged
  },
}))

import { LiveRefresh, useLiveChanged } from './LiveRefresh'

function ping(): void {
  act(() => {
    mocks.onChanged.current?.()
  })
}

function Listener({ label, onChanged }: { label: string; onChanged: () => void }) {
  useLiveChanged(onChanged)

  return <span>{label}</span>
}

describe('LiveRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onChanged.current = null
    mocks.channels.current = []
  })

  it('subscribes to the given channels and refreshes the route on a ping', () => {
    render(<LiveRefresh channels={['pro:pro_1', 'user:usr_1']} />)

    expect(mocks.channels.current).toEqual(['pro:pro_1', 'user:usr_1'])
    expect(mocks.refresh).not.toHaveBeenCalled()

    ping()

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when used without children (the pre-existing call sites)', () => {
    const { container } = render(<LiveRefresh channels={['user:usr_1']} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders children and notifies a descendant that registered via useLiveChanged', () => {
    const onChanged = vi.fn()

    render(
      <LiveRefresh channels={['pro:pro_1']}>
        <Listener label="calendar" onChanged={onChanged} />
      </LiveRefresh>,
    )

    expect(screen.getByText('calendar')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()

    ping()

    // Both happen off ONE subscription: the RSC route refreshes AND the
    // client-fetched surface re-runs its own fetch.
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('notifies every registered listener, and one that throws does not silence the rest', () => {
    const first = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const second = vi.fn()

    render(
      <LiveRefresh channels={['pro:pro_1']}>
        <Listener label="a" onChanged={first} />
        <Listener label="b" onChanged={second} />
      </LiveRefresh>,
    )

    ping()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops notifying a listener once it unmounts', () => {
    const onChanged = vi.fn()

    const { rerender } = render(
      <LiveRefresh channels={['pro:pro_1']}>
        <Listener label="a" onChanged={onChanged} />
      </LiveRefresh>,
    )

    ping()
    expect(onChanged).toHaveBeenCalledTimes(1)

    rerender(<LiveRefresh channels={['pro:pro_1']}>{null}</LiveRefresh>)

    ping()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('always calls the LATEST callback, so a fresh closure per render is not stale', () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(
      <LiveRefresh channels={['pro:pro_1']}>
        <Listener label="a" onChanged={first} />
      </LiveRefresh>,
    )

    rerender(
      <LiveRefresh channels={['pro:pro_1']}>
        <Listener label="a" onChanged={second} />
      </LiveRefresh>,
    )

    ping()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('useLiveChanged no-ops outside a LiveRefresh boundary (Realtime unconfigured)', () => {
    const onChanged = vi.fn()

    expect(() =>
      render(<Listener label="orphan" onChanged={onChanged} />),
    ).not.toThrow()
    expect(screen.getByText('orphan')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
