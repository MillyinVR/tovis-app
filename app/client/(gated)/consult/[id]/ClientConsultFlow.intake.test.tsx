// The web consult intake, driven the way a client drives it: tap the one
// question the thread is offering, over and over, until the photos.
//
// It exists to MEASURE the P6 diet rather than describe it. The fake server
// here does not emulate the pacing rule — it calls the real
// `evaluateConsultIntakeProgress` against the real pack, so what the thread
// walks is the contract that actually ships, and the tap count it returns is
// the number a client would count on the screen.
//
// 🔴 P5a moved the flow from a wizard to a thread, which costs ONE TAP FEWER:
// there is no final "Continue to photos", because the photo requests were in
// the thread the whole time. The saved tap is the shape change, not a change to
// the pack — the pack's own cost is still the difference between the two
// numbers below.
//
// Naming the service (handoff B6) is no longer asserted here. In a thread the
// app's sentences are composed SERVER-side, so asserting the opening bubble
// against this file's own fake would only prove the fake agrees with itself;
// the real guard is in tests/integration/consult-thread.test.ts, against the
// projection and real PostgreSQL.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { HAIR_COLOR_INTAKE_PACK_V2 } from '@/lib/consult/intake/packs/hairColor'
import {
  evaluateConsultIntakeProgress,
  toConsultIntakeQuestionPackDTO,
  validateConsultIntakeAnswers,
} from '@/lib/consult/intake/registry'
import type { ConsultIntakePackDefinition } from '@/lib/consult/intake/types'
import { resolveConsultIntakePack } from '@/lib/consult/intake/registry'
import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }))

import ClientConsultFlow from './ClientConsultFlow'

const CONSULT_ID = 'consult_1'
const COPY = defaultClientConsultThreadCopy

/**
 * The thread the server would project for this pack and these answers.
 *
 * The ORDERING rule is the server's (lib/consult/thread.ts) and is proven
 * against real PostgreSQL; what is reproduced here is only the part this test
 * drives — history, then the one open question — off the REAL progress
 * evaluation, so the pacing under test is the shipped one.
 */
function threadFor(
  pack: ConsultIntakePackDefinition,
  answers: Record<string, string>,
) {
  const packDto = toConsultIntakeQuestionPackDTO(pack)
  const progress = evaluateConsultIntakeProgress(pack, answers)
  // The server's own fallback (lib/consult/thread.ts): `nextQuestionKey` goes
  // null once every REQUIRED question is answered and never names a SKIPPABLE
  // one, so the projection opens the first unanswered question instead. Without
  // it here the optional questions are never offered and the measured tap count
  // silently under-reports the pack.
  const openKey =
    progress.nextQuestionKey ??
    packDto.questions.find((entry) => !answers[entry.key])?.key ??
    null
  const messages: ConsultThreadMessageDTO[] = [
    {
      kind: 'TEXT',
      id: 'opening',
      author: 'APP',
      state: 'DONE',
      text: 'Love this one.',
    },
  ]
  for (const question of packDto.questions) {
    const answer = answers[question.key] ?? null
    if (answer === null && question.key !== openKey) continue
    messages.push({
      kind: 'QUESTION',
      id: `intake:${question.key}`,
      author: 'APP',
      state: question.key === openKey ? 'OPEN' : 'DONE',
      question,
      answer,
      packVersion: packDto.version,
      schemaVersion: packDto.schemaVersion,
    })
  }
  return {
    ok: true,
    thread: {
      consultId: CONSULT_ID,
      status: openKey ? 'INTAKE_READY' : 'MEDIA_READY',
      professionalId: 'pro_1',
      professionalDisplayName: 'Susie',
      nextOpenMessageId: openKey ? `intake:${openKey}` : null,
      messages,
      chartCopy: null,
      book: {
        enabled: false,
        reason: 'SELFIE_REQUIRED',
        lookPostId: 'look_1',
        serviceId: 'service_1',
        lookMediaId: 'media_1',
      },
    },
  }
}

/**
 * Renders the thread against a fake consult on `pack`, taps the single open
 * question until there is none left, and returns the taps it took to reach the
 * photo step.
 */
async function tapsToThePhotoStep(
  pack: ConsultIntakePackDefinition,
  changeScale?: string,
) {
  let answers: Record<string, string> = {}
  let completed = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.endsWith('/intake') && init?.method !== 'POST') return body({ intake: {
        latestRevision: Object.keys(answers).length ? { answers, complete: completed } : null,
        progress: evaluateConsultIntakeProgress(pack, answers), questionPack: toConsultIntakeQuestionPackDTO(pack),
      } })
      if (url.endsWith('/intake') && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as {
          answers: Record<string, string>
          complete: boolean
        }
        const validated = validateConsultIntakeAnswers(
          pack,
          sent.answers,
          sent.complete,
        )
        expect(validated.ok).toBe(true)
        if (!validated.ok) {
          return new Response(JSON.stringify({ error: 'Invalid intake answers.' }), {
            status: 400,
          })
        }
        answers = sent.answers
        completed = sent.complete
        return body({
          intake: {
            latestRevision: { answers, complete: completed },
            progress: evaluateConsultIntakeProgress(pack, answers),
            questionPack: toConsultIntakeQuestionPackDTO(pack),
          },
          replayed: false,
        })
      }
      if (url.endsWith('/thread')) return body(threadFor(pack, answers))
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )

  render(<ClientConsultFlow consultId={CONSULT_ID} copy={COPY} />)
  // The thread is ONE read, and it is asynchronous — without waiting for it the
  // loop below finds nothing tappable and reports a triumphant zero taps.
  await screen.findByText('Love this one.')

  let taps = 0
  for (;;) {
    // Which question is ANSWERABLE right now, found from the DOM rather than by
    // re-deriving the pacing rule this test measures. Scoped PER MESSAGE, not by
    // option label: several questions in these packs offer the same words
    // ("Never", "No"), so a label search finds one question's buttons and
    // attributes them to five.
    //
    // An answered question keeps its card and its heading — that is the thread —
    // but loses its options, so exactly one intake message is ever tappable.
    const tappable = Array.from(
      document.querySelectorAll('[data-thread-message^="intake:"]'),
    ).filter((node) => node.querySelectorAll('button').length > 0)

    if (tappable.length === 0) break
    expect(
      tappable.length,
      `two questions answerable at once: ${tappable
        .map((node) => node.getAttribute('data-thread-message'))
        .join(', ')}`,
    ).toBe(1)

    const card = tappable[0]!
    const key = card.getAttribute('data-thread-message')!.slice('intake:'.length)
    const question = pack.questions.find((entry) => entry.key === key)!
    const option =
      (key === 'change_scale'
        ? question.options.find((entry) => entry.value === changeScale)
        : undefined) ?? question.options[0]!
    const button = Array.from(card.querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === option.label,
    )!
    fireEvent.click(button)
    taps += 1
    await waitFor(() => expect(answers[question.key]).toBe(option.value))
    await waitFor(() => expect(button.isConnected).toBe(false))
    expect(taps).toBeLessThanOrEqual(pack.questions.length)
  }
  expect(completed).toBe(true)
  return taps
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the web consult intake, one question at a time', () => {
  it.each(['subtle', 'noticeable', 'total'])(
    'saves %s as a partial answer and completes only after the remaining questions',
    async (changeScale) => {
      await tapsToThePhotoStep(
        resolveConsultIntakePack({ categorySlug: 'hair-color', family: 'HAIR' }),
        changeScale,
      )
    },
  )

  it('leaves every answered question on screen as history', async () => {
    const pack = resolveConsultIntakePack({
      categorySlug: 'hair-color',
      family: 'HAIR',
    })
    await tapsToThePhotoStep(pack)
    // The wizard replaced each question with the next one. A thread keeps them:
    // the client's own answers are still there to scroll back to.
    const answered = screen.getAllByRole('heading', { level: 3 })
    expect(answered.length).toBe(pack.questions.length)
  })

  // The product principle, measured: sixteen taps to reach the camera was a
  // form. The diet is the difference between these two numbers.
  it('reaches the photo step in half the taps the pre-diet pack needed', async () => {
    expect(await tapsToThePhotoStep(HAIR_COLOR_INTAKE_PACK_V2)).toBe(15)
  })

  it('includes one upkeep tap before the remaining history on the shipped pack', async () => {
    expect(
      await tapsToThePhotoStep(
        resolveConsultIntakePack({ categorySlug: 'hair-color', family: 'HAIR' }),
      ),
    ).toBe(8)
  })
})
