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
  expect(screen.queryByText('Now a few photos of you, and these need daylight — it shows your truest colour, where indoor light warms or flattens it.')).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'The hair is warmer; that is her clothing.' } })
  fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
  await waitFor(() => expect(saved).toMatchObject({ selectedValues: [], text: 'The hair is warmer; that is her clothing.' }))
  await screen.findByText('The hair is warmer; that is her clothing.')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  // The answered card is history now — the question and her words as two
  // bubbles — and the next step has arrived beneath it.
  expect(screen.getByText('Is this part of what you like?')).toBeInTheDocument()
  expect(screen.getByText('Now a few photos of you, and these need daylight — it shows your truest colour, where indoor light warms or flattens it.')).toBeInTheDocument()
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

// ── The INTAKE question takes her own words ─────────────────────────────────
//
// Tori, 2026-09-13: "there were times i couldnt answer the consult questions
// with the optios it gave me". Driven through the real component against a
// fake server, so what is asserted is the REQUEST BODY the client actually
// sends — not a function called with the right arguments.
it('sends an intake answer in her own words, and a note beside a tapped option', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const question = {
    key: 'prior_reaction',
    label: 'Have you ever had a reaction to a hair service?',
    helpText: null,
    kind: 'SINGLE_SELECT' as const,
    requirement: 'REQUIRED' as const,
    allowText: true,
    options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
  }
  const thread: ConsultThreadDTO = threadFixture({ inspiration: cardInspiration })
  thread.messages = [{
    kind: 'QUESTION', id: 'intake:prior_reaction', author: 'APP', state: 'OPEN',
    question, answer: null, packVersion: 4, schemaVersion: 2,
  }]
  thread.nextOpenMessageId = 'intake:prior_reaction'
  const posts: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/intake') && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return response({ ok: true, intake: { questionPack: { id: 'hair-color', categorySlug: 'hair-color', version: 4, schemaVersion: 2, questions: [question] },
        progress: { canComplete: false, nextQuestionKey: 'prior_reaction', blocker: null }, latestRevision: null, prefillSuggestions: [], prefillSignals: [] }, replayed: false })
    }
    if (url.endsWith('/intake')) {
      return response({ ok: true, intake: { questionPack: { id: 'hair-color', categorySlug: 'hair-color', version: 4, schemaVersion: 2, questions: [question] },
        progress: { canComplete: false, nextQuestionKey: 'prior_reaction', blocker: null }, latestRevision: null, prefillSuggestions: [], prefillSignals: [] } })
    }
    if (url.endsWith('/thread')) return response({ ok: true, thread })
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)

  const input = await screen.findByRole('textbox', { name: 'Say it in your own words' })
  fireEvent.change(input, { target: { value: 'I had a reaction on my skin once, I do not know to what' } })

  // 1. Her words INSTEAD of an option — the escape hatch.
  fireEvent.click(screen.getByRole('button', { name: 'None of these — use what I wrote' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toMatchObject({
    answers: { prior_reaction: 'client-words' },
    textAnswers: { prior_reaction: 'I had a reaction on my skin once, I do not know to what' },
  })

  // 2. The same words as a NOTE beside a tapped option.
  fireEvent.click(screen.getByRole('button', { name: 'No' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toMatchObject({
    answers: { prior_reaction: 'no' },
    textAnswers: { prior_reaction: 'I had a reaction on my skin once, I do not know to what' },
  })

  // 3. An EMPTY box clears the note — the only way to take one back.
  fireEvent.change(screen.getByRole('textbox', { name: 'Say it in your own words' }), { target: { value: '  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'No' }))
  await waitFor(() => expect(posts).toHaveLength(3))
  expect(posts[2]).toMatchObject({ answers: { prior_reaction: 'no' }, textAnswers: {} })
})

// 🔴 A box that cannot send what she types is the defect #1171 fixed. A
// question the server did not mark `allowText` must not grow one.
it('offers no box on a question the server did not mark for words', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const thread: ConsultThreadDTO = threadFixture({ inspiration: cardInspiration })
  thread.messages = [{
    kind: 'QUESTION', id: 'chart-review', author: 'APP', state: 'OPEN',
    chartReviewFingerprint: 'a'.repeat(64), answer: null, packVersion: 4, schemaVersion: 2,
    question: { key: 'chart_review', label: 'Anything done since your last visit?', helpText: null,
      kind: 'SINGLE_SELECT', requirement: 'REQUIRED', allowText: false,
      options: [{ value: 'CONFIRMED', label: 'Nothing has changed' }] },
  }]
  thread.nextOpenMessageId = 'chart-review'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/thread')) {
      return new Response(JSON.stringify({ ok: true, thread }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)
  await screen.findByText('Anything done since your last visit?')
  expect(screen.queryByRole('textbox', { name: 'Say it in your own words' })).not.toBeInTheDocument()
})

// The THREAD FOLLOW-UP card, the other surface that never took free text.
it('sends follow-up words, and withholds the box on a question the pro wrote', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const thread: ConsultThreadDTO = threadFixture({ inspiration: cardInspiration })
  thread.messages = [
    {
      kind: 'FOLLOW_UP', id: 'follow-up:1:box_dye_history', author: 'APP', state: 'OPEN',
      text: 'When did you last use box dye?', questionKey: 'box_dye_history',
      options: [{ value: 'never', label: 'Never' }], selectedValues: [],
      allowText: true, fallback: false, round: 1,
    },
    {
      // 🔴 A professional's own question files through a route with nowhere to
      // put a sentence, so the server sends no flag and the card grows no box.
      kind: 'FOLLOW_UP', id: 'pro-follow-up:pro_1', author: 'APP', state: 'OPEN',
      text: 'Are you still thinking about a fringe?', questionKey: 'pro_1',
      attribution: 'From Susie',
      options: [{ value: 'yes', label: 'Yes' }], selectedValues: [],
      allowText: false, fallback: false, round: 0,
    },
  ]
  thread.nextOpenMessageId = 'follow-up:1:box_dye_history'
  const posts: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/follow-up') && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    }
    if (url.endsWith('/thread')) {
      return new Response(JSON.stringify({ ok: true, thread }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }))
  render(<BrandProvider><ClientConsultFlow consultId={thread.consultId} copy={defaultClientConsultThreadCopy} /></BrandProvider>)

  const input = await screen.findByRole('textbox', { name: 'Say it in your own words' })
  fireEvent.change(input, { target: { value: 'at a salon abroad, I do not know the brand' } })
  fireEvent.click(screen.getByTestId('consult-follow-up-client-words'))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toMatchObject({
    questionKey: 'box_dye_history',
    selectedValues: ['client-words'],
    text: 'at a salon abroad, I do not know the brand',
  })
  // One card offered the box; the pro's did not, so there is exactly one.
  expect(screen.getAllByRole('textbox', { name: 'Say it in your own words' })).toHaveLength(1)
})
