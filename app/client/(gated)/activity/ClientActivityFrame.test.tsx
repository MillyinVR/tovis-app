// app/client/(gated)/activity/ClientActivityFrame.test.tsx
//
// /client/activity used to hand-roll its own "Mark all read" button and fetch,
// which is how it ended up sending a different request shape AND rendering a
// different-looking control than /client/notifications. It now mounts the
// shared ClientMarkAllReadButton, so what needs guarding here is the WIRING —
// a shared control is easy to mount with the wrong props, and the two failure
// modes are silent: pass the wrong count and the button is permanently
// disabled; drop the selector and it marks every notification read, including
// the bookings and payments rows this page never showed.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientActivityItem } from '@/lib/notifications/activityFeed'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import ClientActivityFrame from './ClientActivityFrame'

const fetchMock = vi.fn()

const EVENT_KEYS = ['CLIENT_FOLLOW', 'LOOK_LIKED']

function item(overrides: Partial<ClientActivityItem> = {}): ClientActivityItem {
  return {
    id: 'act-1',
    iconKind: 'like',
    who: 'Someone',
    action: 'liked your look',
    highlight: null,
    timestamp: '2026-08-01T12:00:00.000Z',
    unread: true,
    href: null,
    followBack: null,
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClientActivityFrame — mark all read wiring', () => {
  it('marks ONLY the activity event keys, not every notification', async () => {
    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
      />,
    )

    const button = screen.getByRole('button', { name: /unread notifications as read/i })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/client/notifications/read')
    expect(JSON.parse(String(init.body))).toEqual({ eventKeys: EVENT_KEYS })
  })

  it('clears the unread state optimistically and disables the button', async () => {
    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /unread notifications as read/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /No unread notifications/i })).toBeDisabled(),
    )
  })

  it('restores the unread state when the request fails, so it can be retried', async () => {
    fetchMock.mockResolvedValue({ ok: false })

    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /unread notifications as read/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1 unread notifications as read/i })).toBeEnabled(),
    )
  })

  it('disables the control when there is nothing unread', () => {
    render(
      <ClientActivityFrame
        items={[item({ unread: false })]}
        unreadCount={0}
        markReadEventKeys={EVENT_KEYS}
      />,
    )

    expect(screen.getByRole('button', { name: /No unread notifications/i })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Screen 7 (Tori, 2026-08-17): the Me bell opens Activity as an OVERVIEW —
// "the pop up and done buttons on the iOS version so it feels like its an
// overview not a full page". One component serves both presentations so the
// optimistic mark-all-read has a single implementation; these pin that the
// two presentations actually differ where they are supposed to.
describe('ClientActivityFrame — presentation', () => {
  it('renders a Done button in the sheet and calls back to dismiss', () => {
    const onDone = vi.fn()

    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
        presentation="sheet"
        onDone={onDone}
      />,
    )

    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.click(done)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('keeps Mark all read in the sheet — dismissing is not the same as reading', () => {
    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
        presentation="sheet"
        onDone={() => {}}
      />,
    )

    expect(
      screen.getByRole('button', { name: /1 unread notifications as read/i }),
    ).toBeEnabled()
  })

  it('renders the full page with its back link and NO Done button by default', () => {
    // The standalone route is reached by deep link and push taps, where the
    // back affordance is the only way out of a non-tab client page on web.
    render(
      <ClientActivityFrame
        items={[item()]}
        unreadCount={1}
        markReadEventKeys={EVENT_KEYS}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute(
      'href',
      '/client',
    )
  })
})
