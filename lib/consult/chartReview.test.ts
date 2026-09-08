import { describe, expect, it } from 'vitest'
import { buildConsultChartReview } from './chartReview'
import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import type { ClientChartFacts } from './chartFacts'

function chart(): ClientChartFacts {
  return { available: true, completedVisits: 2, lastVisitAt: '2026-08-01T12:00:00Z', photos: [],
    facts: ['box_dye_history', 'henna_plant_dye_history', 'other_chemical_history', 'prior_lightening'].map(key => ({
      key, value: 'never', source: 'CLIENT_ANSWER', sourceId: `source:${key}`, bookingId: 'old-visit', consultSessionId: 'old-consult',
      professionalId: 'pro', recordedAt: '2026-07-30T12:00:00Z', validUntil: '2027-07-30T12:00:00Z', state: 'CONFIRM',
    })) }
}
const pack = HAIR_COLOR_INTAKE_PACK

describe('short returning-client chart review', () => {
  it('offers one explicit review for a complete current history, leaving reactions to be checked', () => {
    const result = buildConsultChartReview({ chart: chart(), pack, answers: {} })
    expect(result?.offer.facts).toHaveLength(4)
    expect(result?.offer.facts.some(fact => fact.questionKey === 'prior_reaction')).toBe(false)
    expect(result?.offer.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
  it('never offers the shortcut on a thin, expired or incomplete chart', () => {
    expect(buildConsultChartReview({ chart: { ...chart(), completedVisits: 1 }, pack, answers: {} })).toBeNull()
    const expired = chart(); expired.facts[0]!.state = 'REASK'
    expect(buildConsultChartReview({ chart: expired, pack, answers: {} })).toBeNull()
    const missing = chart(); missing.facts.pop()
    expect(buildConsultChartReview({ chart: missing, pack, answers: {} })).toBeNull()
  })
  it('preserves current answers rather than adding them to the review', () => {
    const result = buildConsultChartReview({ chart: chart(), pack, answers: { box_dye_history: 'within-6-months' } })
    expect(result?.offer.facts.some(fact => fact.questionKey === 'box_dye_history')).toBe(false)
  })
  it('changes its fingerprint if a source changes', () => {
    const original = buildConsultChartReview({ chart: chart(), pack, answers: {} })
    const updated = chart(); updated.facts[0]!.sourceId = 'corrected-source'
    expect(buildConsultChartReview({ chart: updated, pack, answers: {} })?.offer.fingerprint).not.toBe(original?.offer.fingerprint)
  })
})
