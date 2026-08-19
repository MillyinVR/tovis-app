// app/admin/viral-requests/ViralRequestSubmitterMedia.test.tsx
//
// The reviewer-facing half of taking an attachment down. The server's rules are
// pinned elsewhere; what is only decidable here is what the person clicking sees
// — above all, whether they are warned before an action clears a LIVE cover.
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

import ViralRequestSubmitterMedia from './ViralRequestSubmitterMedia'

const BASE =
  'https://project.supabase.co/storage/v1/object/public/media-public/viral-requests/req_1/uploads'
const PHOTO = `${BASE}/inspo.jpg`
const VIDEO = `${BASE}/clip.mp4`

describe('app/admin/viral-requests/ViralRequestSubmitterMedia', () => {
  const fetchMock = vi.fn()
  const confirmMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', confirmMock)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    confirmMock.mockReturnValue(true)
  })

  it('DELETEs the attachment and refreshes', async () => {
    render(<ViralRequestSubmitterMedia requestId="req_1" media={[PHOTO]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/viral-service-requests/req_1/media',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ mediaUrl: PHOTO }),
      }),
    )
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('does nothing at all when the reviewer cancels', async () => {
    confirmMock.mockReturnValue(false)

    render(<ViralRequestSubmitterMedia requestId="req_1" media={[PHOTO]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  // 🔴 THE ONE THAT MATTERS. The cover is stored as the promoted attachment's
  // URL with a `?v=` cache-buster appended; the attachment's own URL never has
  // one. A raw `===` says "not the cover" about exactly this pair, so the
  // reviewer would clear a live cover with the generic prompt and no idea the
  // look was about to lose its picture.
  it('warns that the cover will be cleared, even through a cache-buster', async () => {
    render(
      <ViralRequestSubmitterMedia
        requestId="req_1"
        media={[PHOTO]}
        coverImage={`${PHOTO}?v=1755500000000`}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('clears the cover'),
    )
  })

  it('uses the plain prompt when the attachment is not the cover', async () => {
    render(
      <ViralRequestSubmitterMedia
        requestId="req_1"
        media={[PHOTO]}
        coverImage={`${BASE}/other.jpg?v=1`}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.not.stringContaining('clears the cover'),
    )
  })

  // A video has no "Use this" — it cannot be a cover — which is precisely why it
  // had no affordance at all before. It must still be removable.
  it('offers Remove for a video, which has no Use this', () => {
    render(<ViralRequestSubmitterMedia requestId="req_1" media={[VIDEO]} />)

    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
  })

  it('surfaces a refusal instead of silently succeeding', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )

    render(<ViralRequestSubmitterMedia requestId="req_1" media={[PHOTO]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
