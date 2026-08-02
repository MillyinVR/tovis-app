// Regression cover for the Sentry report from prod (Safari 27, 2026-08-01):
//
//   TypeError: Load failed
//     at WorkspaceMismatchProvider.tsx:68   ← the patched window.fetch
//     at ThreadClient.tsx:354               ← fetchLatest's GET
//     at ThreadClient.tsx:696               ← void fetchLatest() in onFocus
//
// `fetchLatest` had `try { … } finally { … }` with no `catch`, and every call
// site invokes it as a bare `void fetchLatest()` — so a transient network
// failure escaped as an UNHANDLED rejection, and the user was told nothing
// because only the `!res.ok` branch ever set an error.
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/_components/live/useLiveChannels', () => ({
  useLiveChannels: () => {},
}))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: () => null,
}))

import ThreadClient from './ThreadClient'

const BASE_PROPS = {
  threadId: 'thr_1',
  myUserId: 'usr_me',
  liveChannel: 'live:usr_me',
  initialMessages: [
    {
      id: 'msg_1',
      body: 'See you at 2!',
      createdAt: '2026-08-01T20:00:00.000Z',
      senderUserId: 'usr_them',
      attachments: [],
    },
  ],
  initialCounterpartyLastReadAt: null,
  initialNextCursor: null,
  initialHasMore: false,
}

describe('ThreadClient — refresh failures', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // jsdom implements no layout, so the component's scroll-to-bottom would
    // throw out of a queueMicrotask and pollute the run. Not under test here.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('surfaces a refresh network failure instead of rejecting unhandled', async () => {
    // Safari's wording for a fetch that never completed. Typed as `typeof fetch`
    // rather than cast from a spy — the house rules forbid type escapes, and
    // nothing here asserts on call args, so a plain stub is enough.
    const loadFailed = new TypeError('Load failed')
    const failingFetch: typeof fetch = () => Promise.reject(loadFailed)
    global.fetch = failingFetch

    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)

    try {
      render(<ThreadClient {...BASE_PROPS} />)

      // The wake path from the report: the tab regains focus and refires the
      // refresh, whose fetch fails at the network layer.
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => {
        expect(screen.getByText('Could not refresh messages.')).toBeTruthy()
      })

      // Give any queued microtask rejection a chance to surface before asserting.
      await act(async () => {
        await Promise.resolve()
      })
      expect(unhandled).toEqual([])
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })
})
