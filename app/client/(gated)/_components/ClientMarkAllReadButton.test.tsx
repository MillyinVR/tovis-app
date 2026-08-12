// app/client/(gated)/_components/ClientMarkAllReadButton.test.tsx
//
// Guards the reason this component was extracted: /client/notifications and
// /client/activity each hand-rolled a POST to the SAME mark-read route, which
// let them drift into two different request shapes and two different looks for
// one control. The selector is the only legitimate difference, so that is what
// these pin — plus the rollback path, which only the optimistic caller has and
// which a shared component is easy to quietly drop.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}))

import ClientMarkAllReadButton from './ClientMarkAllReadButton'

const fetchMock = vi.fn()

beforeEach(() => {
  routerRefresh.mockReset()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function bodyOfLastCall(): unknown {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return JSON.parse(String(init.body))
}

describe('ClientMarkAllReadButton', () => {
  it('marks EVERY notification when no selector is given', async () => {
    render(<ClientMarkAllReadButton unreadCount={3} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/client/notifications/read')
    // An empty body is what the route reads as "all" — sending
    // `{eventKeys: undefined}` would serialise to the same thing, so assert the
    // parsed object has no selector key at all.
    expect(bodyOfLastCall()).toEqual({})
  })

  it('marks only the given kinds when a selector is passed', async () => {
    render(<ClientMarkAllReadButton unreadCount={2} eventKeys={['NEW_FOLLOWER']} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(bodyOfLastCall()).toEqual({ eventKeys: ['NEW_FOLLOWER'] })
  })

  it('is disabled with nothing unread, and never calls the route', () => {
    render(<ClientMarkAllReadButton unreadCount={0} />)

    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rolls back an optimistic caller when the request fails', async () => {
    const onOptimistic = vi.fn()
    const onRollback = vi.fn()
    fetchMock.mockResolvedValue({ ok: false })

    render(
      <ClientMarkAllReadButton
        unreadCount={4}
        onOptimistic={onOptimistic}
        onRollback={onRollback}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(onRollback).toHaveBeenCalledTimes(1))
    expect(onOptimistic).toHaveBeenCalledTimes(1)
    expect(routerRefresh).not.toHaveBeenCalled()
  })

  it('rolls back when the request throws, rather than leaving the list cleared', async () => {
    const onRollback = vi.fn()
    fetchMock.mockRejectedValue(new Error('offline'))

    render(<ClientMarkAllReadButton unreadCount={1} onRollback={onRollback} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(onRollback).toHaveBeenCalledTimes(1))
  })

  it('refreshes a server-rendered list, but defers to onSuccess when given', async () => {
    const { unmount } = render(<ClientMarkAllReadButton unreadCount={1} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1))
    unmount()

    const onSuccess = vi.fn()
    render(<ClientMarkAllReadButton unreadCount={1} onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    // Still once, from the first render — the second must NOT have refreshed.
    expect(routerRefresh).toHaveBeenCalledTimes(1)
  })
})
