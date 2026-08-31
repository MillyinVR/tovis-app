import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ConsultProBriefDTO } from '@/lib/dto/consult'

import ProConsultBrief from './ProConsultBrief'

const confidence = { min: 0.4, max: 0.7 }
const brief: ConsultProBriefDTO = {
  consultId: 'consult_1',
  bookingId: 'booking_1',
  lookPostId: null,
  professionalId: 'pro_1',
  serviceCategoryId: 'hair_color',
  briefRevisionId: 'brief_1',
  briefRevision: 5,
  sourceAnalysisRevisionId: 'analysis_1',
  sourceAnalysisRevision: 4,
  intakeRevisionId: 'intake_1',
  inspiration: {
    revisionId: 'inspiration_1',
    source: 'NONE',
    inspirationId: null,
    lookPostId: null,
    mediaEndpoint: null,
    referenceNote: 'An inspiration image is a reference, not a guarantee.',
    exactClientDetails: [],
    possibleProfessionalInterpretation: [],
    catalogGuidance: [],
  },
  clientIntake: [
    {
      questionKey: 'desired_color',
      question: 'Your dream color?',
      answerCode: 'red',
      answer: 'Red',
    },
  ],
  aiObservations: {
    currentLevel: {
      min: 4,
      max: 5,
      confidence,
      evidence: ['hair_back'],
    },
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
    faceProportion: { value: 'BALANCED', confidence, evidence: ['face_front'] },
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
  safetyFlags: [
    {
      code: 'RECENT_BOX_DYE',
      summary: 'Recent box dye was reported.',
      discussWithProfessional: true,
    },
  ],
  achievabilityDirection: {
    direction: 'Discuss this assessment with the professional.',
    assessment: 'REQUIRES_PRO_ASSESSMENT',
    context: 'Condition needs an in-person check.',
    discussWithProfessional: true,
  },
  recommendationDirections: [
    {
      title: 'Color consultation',
      why: 'Review the direction together.',
      direction: 'Direction to discuss with the professional.',
      reference: {
        type: 'SERVICE_CATEGORY',
        serviceId: null,
        serviceCategoryId: 'hair_color',
      },
      discussWithProfessional: true,
    },
  ],
  feedback: null,
  createdAt: '2026-08-01T00:00:00.000Z',
}

describe('ProConsultBrief', () => {
  it('renders client words first, AI observations second, and the separate safety section unconditionally', () => {
    const html = renderToStaticMarkup(
      <ProConsultBrief brief={brief} timeZone="UTC" />,
    )

    const clientIndex = html.indexOf('Client&#x27;s words')
    const aiIndex = html.indexOf('AI observations')
    const safetyIndex = html.indexOf('Safety flags')
    expect(clientIndex).toBeGreaterThanOrEqual(0)
    expect(clientIndex).toBeLessThan(aiIndex)
    expect(aiIndex).toBeLessThan(safetyIndex)
    expect(html).toContain('Recent box dye was reported.')
    expect(html).toContain('Discuss with the professional before service.')
  })

  it('renders the feature profile and style directions between observations and safety', () => {
    const html = renderToStaticMarkup(
      <ProConsultBrief brief={brief} timeZone="UTC" />,
    )
    const aiIndex = html.indexOf('AI observations')
    const profileIndex = html.indexOf('Feature profile')
    const directionsIndex = html.indexOf('Style directions by area')
    const safetyIndex = html.indexOf('Safety flags')
    expect(aiIndex).toBeLessThan(profileIndex)
    expect(profileIndex).toBeLessThan(directionsIndex)
    expect(directionsIndex).toBeLessThan(safetyIndex)
    expect(html).toContain('Skin undertone')
    expect(html).toContain('Soft curtain bangs')
    expect(html).toContain('Hooded eyes are opened by a lifted curl.')
  })
})
