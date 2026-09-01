// app/pro/_components/consult/ProConsultProposalReview.test.tsx
//
// Book the Look, B5. The surface's load-bearing promises, in a DOM:
//
//   * ONE component, two placements — the same lines and the same controls in
//     both, differing only in the sentence that names where it sits;
//   * the numbers it shows a pro are what the CLIENT agreed to, never the
//     estimate's salon figure;
//   * saving sends her numbers to the booking's own endpoint and asks the
//     server to re-render, rather than computing a new total in the browser;
//   * a closed booking is read-only.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsultProposalReviewDTO } from '@/lib/dto/consult'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import ProConsultProposalReview from './ProConsultProposalReview'

function review(
  overrides: Partial<ConsultProposalReviewDTO> = {},
): ConsultProposalReviewDTO {
  return {
    bookingId: 'booking_1',
    consultId: 'consult_1',
    placement: 'BEFORE_DECISION',
    editable: true,
    locationType: 'MOBILE',
    stepMinutes: 15,
    bufferMinutes: 10,
    totalDurationMinutes: 120,
    startingAtPrice: '250.00',
    startingAtLabel: 'Starting at $250',
    proFinalTotalPrice: null,
    proFinalTotalDurationMinutes: null,
    reviewedAt: null,
    lines: [
      {
        estimateLineId: 'line_floor',
        serviceId: 'svc_floor',
        serviceName: 'Full balayage',
        source: 'LOOK_LINKED_SERVICE',
        rationale: 'The look this consult started from is linked to it.',
        proposedPrice: '200.00',
        proposedDurationMinutes: 90,
        proFinalPrice: null,
        proFinalDurationMinutes: null,
        proFinalNote: null,
        proFinalAt: null,
        reviewStatus: 'NOT_REVIEWED',
      },
      {
        estimateLineId: 'line_gloss',
        serviceId: 'svc_gloss',
        serviceName: 'Gloss',
        source: 'ANALYSIS_RECOMMENDATION',
        rationale: 'Keeps the tone from going brassy.',
        proposedPrice: '50.00',
        proposedDurationMinutes: 30,
        proFinalPrice: null,
        proFinalDurationMinutes: null,
        proFinalNote: null,
        proFinalAt: null,
        reviewStatus: 'NOT_REVIEWED',
      },
    ],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProConsultProposalReview', () => {
  it('shows what the client agreed to, per line and in total', () => {
    render(<ProConsultProposalReview review={review()} timeZone="UTC" />)

    expect(screen.getByText('Starting at $250')).toBeTruthy()
    // The mode, the width the booking reserved and the pro's buffer.
    expect(screen.getByText(/Mobile · 120 min set aside \+ 10 min buffer/)).toBeTruthy()
    expect(screen.getByText(/She was quoted \$200.00 · 90 min/)).toBeTruthy()
    expect(screen.getByText(/She was quoted \$50.00 · 30 min/)).toBeTruthy()
    // Decision 6's "why" travels with the line.
    expect(screen.getByText('Keeps the tone from going brassy.')).toBeTruthy()
  })

  it('seeds the inputs from the proposal, then from her own recorded numbers', () => {
    const { rerender } = render(
      <ProConsultProposalReview review={review()} timeZone="UTC" />,
    )
    expect(
      screen.getByTestId<HTMLInputElement>('proposal-review-price-svc_floor')
        .value,
    ).toBe('200.00')

    const lines = review().lines
    const [floor, gloss] = lines
    if (!floor || !gloss) throw new Error('fixture')
    rerender(
      <ProConsultProposalReview
        review={review({
          reviewedAt: '2026-08-31T12:00:00.000Z',
          proFinalTotalPrice: '290.00',
          proFinalTotalDurationMinutes: 150,
          lines: [
            {
              ...floor,
              proFinalPrice: '240.00',
              proFinalDurationMinutes: 120,
              proFinalAt: '2026-08-31T12:00:00.000Z',
              reviewStatus: 'ADJUSTED',
            },
            gloss,
          ],
        })}
        timeZone="UTC"
      />,
    )
    expect(
      screen.getByTestId<HTMLInputElement>('proposal-review-price-svc_floor')
        .value,
    ).toBe('240.00')
    expect(screen.getByTestId('proposal-review-pro-total').textContent).toContain(
      '$290.00',
    )
    expect(screen.getByTestId('proposal-review-status-ADJUSTED')).toBeTruthy()
  })

  it('renders the same lines and controls in BOTH placements', () => {
    const { container: before } = render(
      <ProConsultProposalReview
        review={review({ placement: 'BEFORE_DECISION' })}
        timeZone="UTC"
      />,
    )
    const beforeLines = before.querySelectorAll(
      '[data-testid^="proposal-review-line-"]',
    ).length
    const beforeInputs = before.querySelectorAll('input, textarea').length
    cleanup()

    const { container: after } = render(
      <ProConsultProposalReview
        review={review({ placement: 'AFTER_ACCEPTANCE' })}
        timeZone="UTC"
      />,
    )
    expect(
      after.querySelectorAll('[data-testid^="proposal-review-line-"]').length,
    ).toBe(beforeLines)
    expect(after.querySelectorAll('input, textarea').length).toBe(beforeInputs)
    // The one thing that differs is which sentence names the placement.
    expect(
      screen.getByTestId('consult-proposal-review').dataset.placement,
    ).toBe('AFTER_ACCEPTANCE')
    expect(screen.getByText(/already on your calendar/)).toBeTruthy()
  })

  it('says out loud that nothing here reaches the client', () => {
    render(<ProConsultProposalReview review={review()} timeZone="UTC" />)
    expect(
      screen.getByText(/do not change her booking, her price or her time/),
    ).toBeTruthy()
  })

  it('sends every line to the booking endpoint and re-runs the page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ review: review() }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ProConsultProposalReview review={review()} timeZone="UTC" />)
    fireEvent.change(screen.getByTestId('proposal-review-price-svc_floor'), {
      target: { value: '240' },
    })
    fireEvent.change(screen.getByTestId('proposal-review-note-svc_gloss'), {
      target: { value: '  ask about the box dye  ' },
    })
    fireEvent.click(screen.getByTestId('proposal-review-save'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/pro/bookings/booking_1/consult-proposal')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      lines: [
        {
          estimateLineId: 'line_floor',
          price: '240.00',
          durationMinutes: 90,
          note: null,
        },
        {
          estimateLineId: 'line_gloss',
          price: '50.00',
          durationMinutes: 30,
          note: 'ask about the box dye',
        },
      ],
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('refuses to submit a price or a duration that is not one', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ProConsultProposalReview review={review()} timeZone="UTC" />)
    fireEvent.change(screen.getByTestId('proposal-review-duration-svc_floor'), {
      target: { value: '0' },
    })
    const save = screen.getByTestId<HTMLButtonElement>('proposal-review-save')
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed save instead of pretending it landed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    )
    render(<ProConsultProposalReview review={review()} timeZone="UTC" />)
    fireEvent.click(screen.getByTestId('proposal-review-save'))
    await waitFor(() =>
      expect(screen.getByText(/could not be saved/)).toBeTruthy(),
    )
    expect(screen.queryByTestId('proposal-review-saved')).toBeNull()
  })

  it('is read-only once the booking is closed, and still shows what she recorded', () => {
    const lines = review().lines
    const [floor, gloss] = lines
    if (!floor || !gloss) throw new Error('fixture')
    render(
      <ProConsultProposalReview
        review={review({
          editable: false,
          placement: 'AFTER_ACCEPTANCE',
          lines: [
            {
              ...floor,
              proFinalPrice: '240.00',
              proFinalDurationMinutes: 120,
              proFinalNote: 'took longer than the estimate',
              proFinalAt: '2026-08-31T12:00:00.000Z',
              reviewStatus: 'ADJUSTED',
            },
            gloss,
          ],
        })}
        timeZone="UTC"
      />,
    )
    expect(screen.queryByTestId('proposal-review-save')).toBeNull()
    expect(screen.queryByTestId('proposal-review-price-svc_floor')).toBeNull()
    expect(
      screen.getByText(/You recorded \$240.00 · 120 min — took longer/),
    ).toBeTruthy()
    expect(
      screen.getByText(/You did not record anything for this line./),
    ).toBeTruthy()
  })
})
