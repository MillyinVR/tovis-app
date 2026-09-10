import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BrandProvider } from '@/lib/brand/BrandProvider'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { cardInspiration, threadFixture } from '@/tests/e2e/fixtures/consultInspiration'
import type { ConsultThreadDTO } from '@/lib/dto/consult'
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
import ClientConsultFlow from './ClientConsultFlow'

afterEach(() => vi.unstubAllGlobals())

it('shows one current question, saves a typed correction, and retains it as chat history', async () => {
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
  expect(screen.queryByText('Now a few of you, in daylight if you can.')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'The hair is warmer; that is her clothing.' } })
  fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
  await waitFor(() => expect(saved).toMatchObject({ selectedValues: [], text: 'The hair is warmer; that is her clothing.' }))
  await screen.findByText('The hair is warmer; that is her clothing.')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('Now a few of you, in daylight if you can.')).toBeInTheDocument()
})
