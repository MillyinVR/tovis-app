// The web intake wizard, driven the way a client drives it: tap the one
// question on screen, over and over, until the photo step.
//
// It exists to MEASURE the P6 diet rather than describe it. The fake server
// here does not emulate the pacing rule — it calls the real
// `evaluateConsultIntakeProgress` against the real pack, so what the wizard
// walks is the contract that actually ships, and the tap count it returns is
// the number a client would count on the screen.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { HAIR_COLOR_INTAKE_PACK_V2 } from '@/lib/consult/intake/packs/hairColor'
import {
  evaluateConsultIntakeProgress,
  toConsultIntakeQuestionPackDTO,
} from '@/lib/consult/intake/registry'
import type { ConsultIntakePackDefinition } from '@/lib/consult/intake/types'
import { resolveConsultIntakePack } from '@/lib/consult/intake/registry'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

import ClientConsultFlow from './ClientConsultFlow'

const CONSULT_ID = 'consult_1'
// The real brand copy — the capture step is never reached here, but the
// component takes it, and a stub would drift from the type.
const CAPTURE_COPY = defaultClientConsultCaptureCopy

function intakeState(
  pack: ConsultIntakePackDefinition,
  answers: Record<string, string>,
) {
  return {
    ok: true,
    intake: {
      consultId: CONSULT_ID,
      status: 'INTAKE_READY',
      service: {
        serviceId: 'service_1',
        name: 'Signature Balayage',
        proFacingName: 'Balayage',
      },
      questionPack: toConsultIntakeQuestionPackDTO(pack),
      // The REAL rule, not a copy of it.
      progress: evaluateConsultIntakeProgress(pack, answers),
      prefillSuggestions: [],
      prefillSignals: [],
      latestRevision:
        Object.keys(answers).length === 0
          ? null
          : {
              id: 'rev_1',
              revision: 1,
              packId: pack.id,
              packVersion: pack.version,
              schemaVersion: pack.schemaVersion,
              complete: false,
              answers,
              createdAt: '2026-09-04T00:00:00.000Z',
            },
    },
  }
}

/**
 * Renders the wizard against a fake consult on `pack`, taps the single
 * question it offers until it offers none, then taps Continue. Returns the
 * total taps to reach the photo step.
 */
async function tapsToThePhotoStep(pack: ConsultIntakePackDefinition) {
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
      if (url.endsWith(`/consult/${CONSULT_ID}`)) {
        return body({ ok: true, consult: { id: CONSULT_ID, status: 'INTAKE_READY' } })
      }
      if (url.endsWith('/intake') && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as {
          answers: Record<string, string>
          complete: boolean
        }
        answers = sent.answers
        if (sent.complete) completed = true
        return body({ ...intakeState(pack, answers), replayed: false })
      }
      if (url.endsWith('/intake')) return body(intakeState(pack, answers))
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )

  render(<ClientConsultFlow consultId={CONSULT_ID} captureCopy={CAPTURE_COPY} />)

  let taps = 0
  for (;;) {
    // The screen shows exactly one question's options, or the Continue button.
    const continueButton = screen.queryByRole('button', {
      name: 'Continue to photos',
    })
    if (continueButton) {
      fireEvent.click(continueButton)
      taps += 1
      break
    }
    const heading = await screen.findByRole('heading', { level: 3 })
    const question = pack.questions.find((entry) => entry.label === heading.textContent)
    expect(question, `no pack question matches "${heading.textContent}"`).toBeDefined()
    // Only ONE question is on screen at a time.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    const option = question!.options[0]!
    fireEvent.click(screen.getByRole('button', { name: option.label }))
    taps += 1
    await waitFor(() => expect(answers[question!.key]).toBe(option.value))
    expect(taps).toBeLessThanOrEqual(pack.questions.length)
  }
  await waitFor(() => expect(completed).toBe(true))
  return taps
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the web consult intake, one question at a time', () => {
  it('names the service the consult is about', async () => {
    await tapsToThePhotoStep(resolveConsultIntakePack({
      categorySlug: 'hair-color',
      family: 'HAIR',
    }))
    // Rendered from the served identity, not from a category or a constant.
    expect(screen.getByText('About your Signature Balayage')).toBeTruthy()
  })

  // The product principle, measured: sixteen taps to reach the camera was a
  // form. The diet is the difference between these two numbers.
  it('reaches the photo step in half the taps the pre-diet pack needed', async () => {
    expect(await tapsToThePhotoStep(HAIR_COLOR_INTAKE_PACK_V2)).toBe(16)
  })

  it('reaches the photo step in eight taps on the shipped pack', async () => {
    expect(
      await tapsToThePhotoStep(
        resolveConsultIntakePack({ categorySlug: 'hair-color', family: 'HAIR' }),
      ),
    ).toBe(8)
  })
})
