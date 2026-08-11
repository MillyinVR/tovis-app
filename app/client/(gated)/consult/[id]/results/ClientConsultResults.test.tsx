import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultClientConsultResultsCopy as copy } from '@/lib/brand/defaultClientConsultResultsCopy'
import type { ConsultClientResultsDTO } from '@/lib/dto/consult'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import ClientConsultResults from './ClientConsultResults'

const confidence = { min: 0.4, max: 0.7 }

function results(withSafety = true): ConsultClientResultsDTO {
  return {
    consultId: 'consult_1',
    bookingId: 'booking_1',
    serviceCategoryId: 'hair_color',
    briefRevisionId: 'brief_7',
    briefRevision: 7,
    analysisRevisionId: 'analysis_6',
    analysisRevision: 6,
    intakeRevisionId: 'intake_5',
    clientIntake: [
      {
        questionKey: 'desired_color',
        question: 'Desired direction?',
        answerCode: 'red',
        answer: 'Red',
      },
    ],
    aiObservations: {
      currentLevel: { min: 4, max: 5, confidence, evidence: ['hair_back'] },
      currentTone: { value: 'MIXED', confidence, evidence: ['hair_left'] },
      visibleCondition: {
        value: 'POSSIBLE_COMPROMISE',
        confidence,
        evidence: ['hair_crown'],
      },
      density: { value: 'UNKNOWN', confidence, evidence: [] },
      texture: { value: 'WAVY', confidence, evidence: ['hair_back'] },
      goalSummary: 'A red direction.',
      historySummary: 'Recent box dye was reported.',
      constraintsSummary: 'Review history.',
      maintenanceSummary: 'Discuss maintenance.',
      appointmentContextSummary: 'No fixed event date.',
    },
    safetyFlags: withSafety
      ? [
          {
            code: 'RECENT_BOX_DYE',
            summary: 'Recent box dye was reported.',
            discussWithProfessional: true,
          },
        ]
      : [],
    achievabilityDirection: {
      direction:
        'Discuss this assessment with the professional; they will decide what is achievable in person.',
      assessment: 'REQUIRES_PRO_ASSESSMENT',
      context: 'Condition needs an in-person check.',
      discussWithProfessional: true,
    },
    recommendationDirections: [1, 2].map((index) => ({
      title: `Direction ${index}`,
      why: `Reason ${index}.`,
      direction: `Direction to discuss with the professional: ${index}.`,
      reference: {
        type: 'SERVICE_CATEGORY',
        serviceId: null,
        serviceCategoryId: 'hair_color',
      },
      discussWithProfessional: true,
    })),
    meCardTeaser: { locked: true, tapped: false },
    createdAt: '2026-08-11T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClientConsultResults', () => {
  it('renders client words before AI observations, safety separately, and exactly the 2–3 supplied discussion directions', () => {
    const { container } = render(
      <ClientConsultResults results={results()} copy={copy} />,
    )
    const html = container.innerHTML

    expect(html.indexOf(copy.clientWordsTitle)).toBeLessThan(
      html.indexOf(copy.aiObservationsTitle),
    )
    expect(html.indexOf(copy.aiObservationsTitle)).toBeLessThan(
      html.indexOf(copy.safetyTitle),
    )
    expect(container.querySelector('[data-safety-visible="true"]')).not.toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2)
    expect(screen.getByText('Direction 1')).toBeInTheDocument()
    expect(screen.getByText('Direction 2')).toBeInTheDocument()
    const recommendationFraming = container.querySelectorAll('ol li > p:last-child')
    expect(recommendationFraming).toHaveLength(2)
    for (const item of recommendationFraming) {
      expect(item.textContent).toContain(copy.recommendationDiscussionPrefix)
    }
    expect(copy.intro.toLowerCase()).not.toMatch(/guarantee|promise|will achieve/)
  })

  it('keeps the safety section visible even when there are no flags', () => {
    render(<ClientConsultResults results={results(false)} copy={copy} />)

    expect(screen.getByText(copy.safetyTitle)).toBeInTheDocument()
    expect(screen.getByText(copy.safetyEmpty)).toBeInTheDocument()
  })

  it('records interest but stays locked with no membership, billing, signup, or unlock path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ teaser: { locked: true, tapped: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <ClientConsultResults results={results()} copy={copy} />,
    )

    const teaser = container.querySelector('[data-me-card-state="locked"]')
    expect(teaser).not.toBeNull()
    expect(teaser?.querySelector('a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.meCardTapLabel }))

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent(copy.meCardTappedLabel)
    })
    expect(screen.getByRole('button')).toBeDisabled()
    expect(container.querySelector('[data-me-card-state="locked"]')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/results/teaser-tap',
    )
    expect(container.textContent).not.toMatch(/join waitlist|notify me|payment|checkout/i)
  })
})
