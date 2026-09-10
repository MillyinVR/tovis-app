import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConsultTranscript from './ConsultTranscript'

afterEach(() => vi.unstubAllGlobals())
it('loads on request, preserves page order, and clears displayed history if access is revoked', async () => {
  let calls = 0
  const fetcher = vi.fn(async () => {
    calls += 1
    if (calls === 3) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ ok: true, transcript: { consultId: 'c1', historyNote: 'Saved history', nextCursor: `page${calls}`,
      events: [{ id: `e${calls}`, createdAt: '2026-09-10T10:00:00.000Z', title: `Event ${calls}`, unavailable: false, items: [{ label: 'Question', value: calls === 1 ? 'Not sure' : 'My correction' }] }] } }), { headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ConsultTranscript consultId="c1" timeZone="America/Los_Angeles" />)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Read consultation history' }))
  await screen.findByText('Not sure')
  fireEvent.click(screen.getByRole('button', { name: 'Load more history' }))
  await screen.findByText('My correction')
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([expect.stringContaining('Event 1'), expect.stringContaining('Event 2')])
  fireEvent.click(screen.getByRole('button', { name: 'Load more history' }))
  await screen.findByRole('alert')
  await waitFor(() => expect(screen.queryByText('Not sure')).not.toBeInTheDocument())
  expect(screen.queryByText('My correction')).not.toBeInTheDocument()
})
