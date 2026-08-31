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
    lookPostId: null,
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
    profile: {
      skinUndertone: { value: 'NEUTRAL', confidence, evidence: ['face_front'] },
      contrastLevel: { value: 'MEDIUM', confidence, evidence: ['face_front'] },
      colorSeason: {
        value: 'UNKNOWN',
        confidence: { min: 0, max: 0.2 },
        evidence: [],
      },
      faceProportion: {
        value: 'BALANCED',
        confidence,
        evidence: ['face_front'],
      },
      jawline: { value: 'SOFTLY_ROUNDED', confidence, evidence: ['face_side'] },
      foreheadProportion: {
        value: 'BALANCED',
        confidence,
        evidence: ['face_side'],
      },
      featureBalance: { value: 'SOFT', confidence, evidence: ['face_front'] },
      eyeShape: { value: 'HOODED', confidence, evidence: ['eyes_closeup'] },
      eyeSpacing: { value: 'BALANCED', confidence, evidence: ['eyes_closeup'] },
      browDensity: { value: 'FULL', confidence, evidence: ['eyes_closeup'] },
      browShape: { value: 'SOFT_ARCH', confidence, evidence: ['eyes_closeup'] },
    },
    styleDirections: [
      {
        domain: 'BANGS',
        title: 'Soft curtain bangs',
        direction: 'Discuss soft curtain bangs that open at the cheekbone.',
        whyItFlatters:
          'A taller forehead reading is balanced by soft curtain bangs.',
        confidence,
        evidence: ['face_front'],
        discussWithProfessional: true,
      },
      {
        domain: 'LASHES',
        title: 'Lifted-curl lash mapping',
        direction: 'Discuss a lifted curl that opens the lid.',
        whyItFlatters: 'Hooded eyes are opened by a lifted curl.',
        confidence,
        evidence: ['eyes_closeup'],
        discussWithProfessional: true,
      },
    ],
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

describe('ClientConsultResults — the way back out', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a booking-anchored consult goes back to its booking', () => {
    render(<ClientConsultResults results={results()} copy={copy} />)
    const back = screen.getByRole('link', { name: copy.backToBooking })
    expect(back).toHaveAttribute('href', '/client/bookings/booking_1')
  })

  it('a look-anchored consult goes back to the LOOK, not a booking', () => {
    render(
      <ClientConsultResults
        results={{ ...results(), bookingId: null, lookPostId: 'look_9' }}
        copy={copy}
      />,
    )
    const back = screen.getByRole('link', { name: copy.backToLook })
    expect(back).toHaveAttribute('href', '/looks/look_9')
    expect(
      screen.queryByRole('link', { name: copy.backToBooking }),
    ).toBeNull()
  })
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
    // Feature profile and style directions render between observations and safety.
    expect(html.indexOf(copy.aiObservationsTitle)).toBeLessThan(
      html.indexOf(copy.profileTitle),
    )
    expect(html.indexOf(copy.profileTitle)).toBeLessThan(
      html.indexOf(copy.styleDirectionsTitle),
    )
    expect(html.indexOf(copy.styleDirectionsTitle)).toBeLessThan(
      html.indexOf(copy.safetyTitle),
    )
    expect(screen.getByText('Soft curtain bangs')).toBeInTheDocument()
    // 2 style directions + 2 recommendation directions.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4)
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
