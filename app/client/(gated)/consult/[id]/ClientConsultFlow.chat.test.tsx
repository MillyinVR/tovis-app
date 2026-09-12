import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BrandProvider } from '@/lib/brand/BrandProvider'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { cardInspiration, threadFixture } from '@/tests/e2e/fixtures/consultInspiration'
import type { ConsultThreadDTO } from '@/lib/dto/consult'
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
import ClientConsultFlow from './ClientConsultFlow'

afterEach(() => vi.unstubAllGlobals())

it('saves a typed correction and retains it as chat history, and only then shows the next step', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const original = cardInspiration.cards!.find(card => card.questionKey === 'attr_tone')!
  const card = { ...original, selectedValues: [], selectedText: null, question: { ...original.question, allowText: true } }
  let thread: ConsultThreadDTO = threadFixture({ inspiration: { ...cardInspiration, cards: [card] } })
  thread.nextOpenMessageId = `inspiration:${card.questionKey}`
  let saved: Record<string, unknown> | null = null
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/inspiration/answers')) {
      saved = JSON.parse(String(init?.body))
      thread = { ...thread, nextOpenMessageId: 'capture-intro', messages: thread.messages.map(message =>
        message.kind === 'INSPIRATION' && message.card ? { ...message, state: 'DONE', card: { ...card, selectedText: 'The hair is warmer; that is her clothing.' } } : message) }
      return response({ ok: true, inspiration: cardInspiration })
    }
    if (url.endsWith('/thread')) return response({ ok: true, thread })
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)
  const input = await screen.findByRole('textbox', { name: 'Say it in your own words' })
  // ONE thing at a time (Tori, 2026-09-11): the step after this card is not on
  // the page until this one is answered.
  expect(screen.queryByText('Now a few of you, in daylight if you can.')).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'The hair is warmer; that is her clothing.' } })
  fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
  await waitFor(() => expect(saved).toMatchObject({ selectedValues: [], text: 'The hair is warmer; that is her clothing.' }))
  await screen.findByText('The hair is warmer; that is her clothing.')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  // The answered card is history now — the question and her words as two
  // bubbles — and the next step has arrived beneath it.
  expect(screen.getByText('Is this part of what you like?')).toBeInTheDocument()
  expect(screen.getByText('Now a few of you, in daylight if you can.')).toBeInTheDocument()
})

it('can replace an answered reference and cancel without changing its saved source', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const NativeURL = URL
  class LocalURL extends NativeURL {
    static override createObjectURL = vi.fn(() => 'blob:replacement')
    static override revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', LocalURL)
  const thread = threadFixture({ inspiration: cardInspiration })
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST' || init?.method === 'PUT') writes.push(url)
    if (url.endsWith('/thread')) return new Response(JSON.stringify({ ok: true, thread }), { headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)
  const input = await screen.findByLabelText('Change reference photo')
  fireEvent.change(input, { target: { files: [new File(['local'], 'reference.jpg', { type: 'image/jpeg' })] } })
  expect(await screen.findByText('Whose look should we focus on?')).toBeInTheDocument()
  expect(writes).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Choose another photo' }))
  expect(screen.getByLabelText('Change reference photo')).toBeInTheDocument()
  expect(writes).toEqual([])
  expect(LocalURL.revokeObjectURL).toHaveBeenCalledWith('blob:replacement')
})

// C2-6b — the reference note is an ordinary text bubble between the picture
// and the cards; the client reads it with no new component.
it('shows the app’s one sentence about a flagged reference, between the picture and the cards', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const base = threadFixture({ inspiration: cardInspiration })
  const at = base.messages.findIndex(message => message.id === 'inspiration')
  const sentence = 'One thing about this picture: it looks edited or filtered. It’s still a great reference for the feeling and the direction — just know that some details may not be how real hair reflects, moves or grows.'
  const thread: ConsultThreadDTO = { ...base, messages: [
    ...base.messages.slice(0, at + 1),
    { kind: 'TEXT', id: 'inspiration:credibility', author: 'APP', state: 'DONE', text: sentence },
    ...base.messages.slice(at + 1),
  ] }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/thread')) return new Response(JSON.stringify({ ok: true, thread }), { headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)
  const note = await screen.findByText(sentence)
  expect(note).toBeInTheDocument()
  // The cards are still asked — a flag is a note, not a refusal.
  expect(screen.getByText('What made you stop scrolling?')).toBeInTheDocument()
})
