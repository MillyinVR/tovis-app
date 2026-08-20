// app/(main)/looks/_components/reportLook.test.tsx
//
// Reporting a LOOK (the photo), not a comment — App Store guideline 1.2.
//
// The server route (`POST /api/v1/looks/[id]/report`) and its admin queue were
// already built and tested; what did not exist was a caller. These tests pin
// the two halves that were added: the shared fetch helper, and the rail's
// idle → pending → done control.
//
// The behaviours that matter and are easy to regress:
//   - a DUPLICATE report is a 200, not an error, and must still read "Reported"
//     (the route is idempotent by unique constraint — there is no un-report)
//   - there is NO server-side rate limit, so the control itself is the debounce
//   - a failure must fall BACK to "Report" so it stays retryable rather than
//     stranding the only reporting affordance in a dead state
import { ProNameDisplay } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

import RightActionRail from './RightActionRail'
import { reportLookPost } from './reportLookPost'

const PRO = {
  id: 'pro_1',
  businessName: 'TOVIS Studio',
  firstName: 'Tori',
  lastName: 'Morales',
  nameDisplay: ProNameDisplay.BUSINESS_NAME,
  avatarUrl: null,
}

function renderRail(onReport?: () => Promise<'ok' | 'auth' | 'error'>) {
  return render(
    <RightActionRail
      lookPostId="look_1"
      pro={PRO}
      viewerLiked={false}
      likeCount={0}
      commentCount={0}
      onOpenAvailability={() => {}}
      onToggleLike={() => {}}
      onOpenComments={() => {}}
      onShare={() => {}}
      onReport={onReport}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reportLookPost', () => {
  function stubFetch(status: number) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('POSTs to the look report route — not the comment one', async () => {
    const fetchMock = stubFetch(201)

    await reportLookPost('look_1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/looks/look_1/report',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends no body — the route never reads one, so a reason would be discarded', async () => {
    const fetchMock = stubFetch(201)

    await reportLookPost('look_1')

    expect(fetchMock.mock.lastCall?.[1]?.body).toBeUndefined()
  })

  it('treats the 201 first report as success', async () => {
    stubFetch(201)
    await expect(reportLookPost('look_1')).resolves.toBe('ok')
  })

  it('treats a 200 duplicate as success, not an error', async () => {
    stubFetch(200)
    await expect(reportLookPost('look_1')).resolves.toBe('ok')
  })

  it('reports 401 as an auth signal so the caller can redirect a guest', async () => {
    stubFetch(401)
    await expect(reportLookPost('look_1')).resolves.toBe('auth')
  })

  it('reports a 404/500 as an error', async () => {
    stubFetch(500)
    await expect(reportLookPost('look_1')).resolves.toBe('error')
  })

  it('swallows a network throw rather than surfacing it to the feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(reportLookPost('look_1')).resolves.toBe('error')
  })

  it('refuses a blank look id without calling the network', async () => {
    const fetchMock = stubFetch(201)
    await expect(reportLookPost('')).resolves.toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('RightActionRail report control', () => {
  it('is not rendered at all when no onReport is supplied', () => {
    renderRail(undefined)
    expect(screen.queryByTestId('report-look-button')).toBeNull()
  })

  it('renders a labelled Report control when onReport is supplied', () => {
    renderRail(async () => 'ok')
    const button = screen.getByTestId('report-look-button')
    expect(button).toBeTruthy()
    // The label is what makes it findable — a bare flag icon is not.
    expect(screen.getByText('Report')).toBeTruthy()
  })

  it('settles on "Reported" and disables itself after a successful report', async () => {
    renderRail(async () => 'ok')

    fireEvent.click(screen.getByTestId('report-look-button'))

    await waitFor(() => expect(screen.getByText('Reported')).toBeTruthy())
    expect(
      screen.getByTestId('report-look-button').hasAttribute('disabled'),
    ).toBe(true)
  })

  it('falls back to "Report" after a failure so it stays retryable', async () => {
    renderRail(async () => 'error')

    fireEvent.click(screen.getByTestId('report-look-button'))

    await waitFor(() => expect(screen.getByText('Report')).toBeTruthy())
    expect(
      screen.getByTestId('report-look-button').hasAttribute('disabled'),
    ).toBe(false)
  })

  it('falls back to "Report" on the guest-auth path (the caller redirects)', async () => {
    renderRail(async () => 'auth')

    fireEvent.click(screen.getByTestId('report-look-button'))

    await waitFor(() => expect(screen.getByText('Report')).toBeTruthy())
  })

  it('fires only ONE request for a double-click — the route has no rate limit', async () => {
    const onReport = vi.fn().mockResolvedValue('ok')
    renderRail(onReport)

    const button = screen.getByTestId('report-look-button')
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText('Reported')).toBeTruthy())
    expect(onReport).toHaveBeenCalledTimes(1)
  })

  it('does not re-fire once already reported', async () => {
    const onReport = vi.fn().mockResolvedValue('ok')
    renderRail(onReport)

    const button = screen.getByTestId('report-look-button')
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('Reported')).toBeTruthy())

    fireEvent.click(button)
    expect(onReport).toHaveBeenCalledTimes(1)
  })
})
