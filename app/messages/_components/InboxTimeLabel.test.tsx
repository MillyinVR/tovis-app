// app/messages/_components/InboxTimeLabel.test.tsx
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_TIME_ZONE, formatRelativeTimeCompact } from '@/lib/time'

import InboxTimeLabel from './InboxTimeLabel'

// The viewer is in New York; the server (Vercel) is in UTC.
vi.mock('@/lib/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/time')>()
  return { ...actual, getViewerTimeZone: () => 'America/New_York' }
})

// 02:00Z on Feb 1 is still 21:00 on Jan 31 in New York. Pinned >52 weeks
// later so the compact formatter is in its dated fallback.
const AT = '2026-02-01T02:00:00Z'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function pinNow(): void {
  // Fake only Date so React's scheduler keeps its real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-03-15T12:00:00Z'))
}

describe('InboxTimeLabel', () => {
  it('renders the server label during SSR, the viewer-zone label on the client', () => {
    pinNow()
    const serverLabel = formatRelativeTimeCompact(AT, DEFAULT_TIME_ZONE)
    expect(serverLabel).toBe('Feb 1, 2026')

    expect(renderToString(<InboxTimeLabel at={AT} serverLabel={serverLabel} />)).toBe(
      'Feb 1, 2026',
    )

    render(<InboxTimeLabel at={AT} serverLabel={serverLabel} />)
    expect(screen.getByText('Jan 31, 2026')).toBeTruthy()
  })

  it('hydrates against the server markup without a mismatch, then swaps to the viewer zone', async () => {
    pinNow()
    const serverLabel = formatRelativeTimeCompact(AT, DEFAULT_TIME_ZONE)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable: unknown[] = []

    // The markup the REAL server component emits: the UTC label, formatted by
    // a process whose viewer zone is not New York. Hydrating must accept it
    // verbatim, so a component that computed its server snapshot in the
    // viewer's zone would mismatch here.
    const container = document.createElement('span')
    container.innerHTML = serverLabel
    document.body.appendChild(container)

    let root: ReturnType<typeof hydrateRoot> | null = null
    await act(async () => {
      root = hydrateRoot(
        container,
        <InboxTimeLabel at={AT} serverLabel={serverLabel} />,
        { onRecoverableError: (err) => recoverable.push(err) },
      )
    })

    expect(container.textContent).toBe('Jan 31, 2026')
    expect(recoverable).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()

    await act(async () => {
      root?.unmount()
    })
    container.remove()
  })
})
