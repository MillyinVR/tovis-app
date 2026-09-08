import { ConsultServiceFamily, Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { ConsultAnalysisPayloadDTO, ConsultCaptureShotKeyDTO } from '@/lib/dto/consult'
import { ConsultAnalysisProviderError } from './analysisValidation'
import type { ConsultProMenuOffering } from './proMenu'
import {
  buildConsultLookPlanOutputSchema,
  consultLookPlanEvidence,
  consultLookPlanMenu,
  consultLookPlanMenuContext,
  resolveConsultLookPlan,
  sanitizeConsultLookPlan,
  type ConsultLookPlanProviderOutput,
} from './lookPlan'
import { toProviderOutputSchema } from './providerSchema'

function observed<const T extends string>(value: T, shot: ConsultCaptureShotKeyDTO = 'face_front') {
  return { value, confidence: { min: 0.6, max: 0.85 }, evidence: [shot] }
}

function observations(): Pick<ConsultAnalysisPayloadDTO, 'profile' | 'core'> {
  return {
    profile: {
      skinUndertone: observed('WARM'), contrastLevel: observed('MEDIUM'),
      colorSeason: observed('UNKNOWN'), faceProportion: observed('UNKNOWN'),
      jawline: observed('UNKNOWN'), foreheadProportion: observed('UNKNOWN'),
      featureBalance: observed('UNKNOWN'), eyeShape: observed('UNKNOWN'),
      eyeSpacing: observed('UNKNOWN'), browDensity: observed('UNKNOWN'), browShape: observed('UNKNOWN'),
    },
    core: {
      baseLevel: observed('LEVEL_4', 'hair_back'), lightestLevel: observed('LEVEL_5', 'hair_back'),
      currentTone: observed('GOLDEN', 'hair_back'), visibleCondition: observed('NO_VISIBLE_CONCERN', 'hair_back'),
      density: observed('HIGH', 'hair_back'), texture: observed('WAVY', 'hair_back'),
    },
  }
}

function offering(name: string, category = 'color'): ConsultProMenuOffering {
  return {
    id: `offering-${name}`, serviceId: `service-${name}`,
    offersInSalon: true, offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal(200), salonDurationMinutes: 120,
    mobilePriceStartingAt: null, mobileDurationMinutes: null,
    service: { name, categoryId: category, description: `${name} offering description.`, defaultDurationMinutes: 90 },
  }
}

function context() {
  return {
    family: ConsultServiceFamily.HAIR,
    menu: [offering('Extensions', 'extensions'), offering('Dimensional color'), offering('Layered cut', 'cut')],
    observations: observations(),
    requiredHistoryComplete: true, startingPointSufficient: true, goalConfirmed: true, maintenanceDecisionResolved: true,
    requiresProfessionalReview: false,
  }
}

function plan(): ConsultLookPlanProviderOutput {
  return {
    tier: 'EXACT', blocker: 'NONE',
    summary: 'Keep your length, with soft layers and buttery dimension.',
    nextStep: 'Confirm this look with your pro.',
    paths: [{
      title: 'Buttery dimension and soft movement',
      whyThisWorksForYou: 'Warm dimension supports the color you love while keeping your length.',
      featureEvidence: ['profile.skinUndertone'],
      visits: [{ services: ['Dimensional color', 'Layered cut'] }],
    }],
  }
}

describe('a look plan follows the desired result', () => {
  it('resolves color and layers without adding the extensions that inspired the consult', () => {
    const result = resolveConsultLookPlan(plan(), context())
    expect(result.status).toBe('READY_TO_CHOOSE')
    expect(result.provisional).toBe(false)
    expect(result.paths[0]?.visits[0]?.steps).toEqual([
      { serviceId: 'service-Dimensional color', offeringId: 'offering-Dimensional color', serviceCategoryId: 'color', serviceName: 'Dimensional color' },
      { serviceId: 'service-Layered cut', offeringId: 'offering-Layered cut', serviceCategoryId: 'cut', serviceName: 'Layered cut' },
    ])
    expect(result.paths[0]?.sessionCount).toBe(1)
  })

  it.each(['EXACT', 'CLOSE', 'TOWARD'] as const)('preserves an honest %s path without requiring filler alternatives', tier => {
    const result = resolveConsultLookPlan({ ...plan(), tier }, context())
    expect(result.tier).toBe(tier)
    expect(result.paths).toHaveLength(1)
  })

  it('keeps alternatives separate and preserves repeat work on distinct visits', () => {
    const raw = plan()
    raw.tier = 'CLOSE'
    raw.paths.push({
      title: 'Gentle brightness over two visits', whyThisWorksForYou: 'Gradual brightness keeps the warm dimension you like.',
      featureEvidence: ['core.baseLevel'],
      visits: [{ services: ['Dimensional color'] }, { services: ['Dimensional color', 'Layered cut'] }],
    })
    const result = resolveConsultLookPlan(raw, context())
    expect(result.paths.map(path => path.sessionCount)).toEqual([1, 2])
    expect(result.paths.map(path => path.visits.map(visit => visit.steps.length))).toEqual([[2], [1, 2]])
  })

  it.each(['MORE_INFORMATION', 'PRO_REVIEW', 'NO_MATCHING_OFFERING'] as const)(
    'keeps a useful non-bookable result with no paths (%s)', blocker => {
      const result = resolveConsultLookPlan({ ...plan(), paths: [], blocker }, context())
      expect(result.paths).toEqual([])
      expect(result.provisional).toBe(true)
      expect(result.status).not.toBe('READY_TO_CHOOSE')
      expect(result.nextStep).not.toBe('')
      expect(result.summary).not.toBe('')
    },
  )

  it('supports an empty pro menu with a next step', () => {
    const result = resolveConsultLookPlan({ ...plan(), paths: [], blocker: 'NO_MATCHING_OFFERING' }, { ...context(), menu: [] })
    expect(result.status).toBe('NO_OFFERING')
  })

  it.each(['requiredHistoryComplete', 'startingPointSufficient', 'goalConfirmed', 'maintenanceDecisionResolved'] as const)(
    'a model cannot override missing %s', field => {
      const result = resolveConsultLookPlan(plan(), { ...context(), [field]: false })
      expect(result.status).toBe('NEEDS_INPUT')
      expect(result.provisional).toBe(true)
      expect(result.nextStep).not.toBe(plan().nextStep)
    },
  )

  it('existing safety review wins over a claimed exact, ready path and all other gates', () => {
    const result = resolveConsultLookPlan(plan(), { ...context(), requiresProfessionalReview: true, requiredHistoryComplete: false })
    expect(result.status).toBe('PRO_REVIEW')
    expect(result.paths).toEqual([])
    expect(result.nextStep).toContain('before we can reserve')
  })
})

describe('look-plan boundaries', () => {
  it('does not apply the hair ladder to other service families', () => {
    const input = { ...context(), family: ConsultServiceFamily.NAILS }
    expect(() => sanitizeConsultLookPlan(plan(), input)).toThrow(ConsultAnalysisProviderError)
    expect(() => buildConsultLookPlanOutputSchema(input)).toThrow(ConsultAnalysisProviderError)
  })

  it('sends only names and bounded descriptions to the provider', () => {
    const menu = context().menu
    menu[0]!.service.description = 'x'.repeat(1000)
    const text = consultLookPlanMenuContext(menu)
    const data: unknown = JSON.parse(text)
    expect(data).toEqual(menu.map((item, index) => ({
      name: item.service.name, description: index === 0 ? 'x'.repeat(600) : item.service.description,
    })))
    expect(text).not.toContain('offering-')
    expect(text).not.toContain('200')
    expect(text).not.toContain('120')
  })

  it('excludes ambiguous names and offerings with no hostable mode', () => {
    const menu = [offering('Dimensional color'), { ...offering('Dimensional color'), id: 'other', serviceId: 'other' },
      { ...offering('Extensions'), offersInSalon: false }, offering('Layered cut')]
    expect(consultLookPlanMenu(menu).map(item => item.service.name)).toEqual(['Layered cut'])
    expect(() => sanitizeConsultLookPlan(plan(), { ...context(), menu })).toThrow(ConsultAnalysisProviderError)
  })

  it('does not turn unknown, low-confidence, missing historical, or client-reported traits into photo evidence', () => {
    const input = context()
    input.observations.profile.skinUndertone.confidence = { min: 0.2, max: 0.4 }
    input.observations.profile.contrastLevel.evidence = ['intake']
    const fields = consultLookPlanEvidence(input.observations)
    expect(fields).not.toContain('profile.skinUndertone')
    expect(fields).not.toContain('profile.contrastLevel')
    expect(fields).not.toContain('profile.eyeColor')
    expect(fields).not.toContain('profile.colorSeason')
    expect(fields).toContain('core.baseLevel')
    expect(() => sanitizeConsultLookPlan(plan(), input)).toThrow(ConsultAnalysisProviderError)
    const raw = plan()
    raw.paths[0]!.featureEvidence = []
    expect(sanitizeConsultLookPlan(raw, input).paths).toHaveLength(1)
  })

  it.each([
    ['empty explanation', { ...plan(), summary: '  ' }],
    ['empty next step', { ...plan(), nextStep: '' }],
    ['invented price', { ...plan(), price: 500 }],
    ['invented price in prose', { ...plan(), summary: 'This look will cost $500.' }],
    ['invented price without symbol', { ...plan(), nextStep: 'Reserve for five hundred dollars.' }],
    ['unknown tier', { ...plan(), tier: 'PERFECT' }],
    ['no ready path', { ...plan(), paths: [] }],
    ['contradictory unavailable menu', { ...plan(), blocker: 'NO_MATCHING_OFFERING' }],
    ['too many alternatives', { ...plan(), paths: Array.from({ length: 4 }, () => plan().paths[0]) }],
  ])('rejects %s', (_label, raw) => {
    expect(() => sanitizeConsultLookPlan(raw, context())).toThrow(ConsultAnalysisProviderError)
  })

  it.each([
    ['unknown offering', { services: ['Invented color'] }],
    ['client-invented service ID', { services: ['Dimensional color'], serviceId: 'trusted-looking-id' }],
    ['same service twice in one visit', { services: ['Dimensional color', 'Dimensional color'] }],
    ['empty appointment', { services: [] }],
    ['duration from the model', { services: ['Dimensional color'], durationMinutes: 10 }],
  ])('rejects a visit with %s', (_label, visit) => {
    const raw = plan()
    const path = raw.paths[0]!
    expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, visits: [visit] }] }, context())).toThrow(ConsultAnalysisProviderError)
  })

  it('refuses excess visits instead of truncating the transformation', () => {
    const raw = plan()
    raw.paths[0]!.visits = Array.from({ length: 9 }, () => ({ services: ['Dimensional color'] }))
    expect(() => sanitizeConsultLookPlan(raw, context())).toThrow(ConsultAnalysisProviderError)
    raw.paths[0]!.visits.pop()
    expect(resolveConsultLookPlan(raw, context()).paths[0]?.sessionCount).toBe(8)
  })

  it('refuses unsupported or duplicated citations', () => {
    const raw = plan()
    const path = raw.paths[0]!
    for (const featureEvidence of [['profile.eyeColor'], ['identity'], ['profile.skinUndertone', 'profile.skinUndertone']]) {
      expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, featureEvidence }] }, context())).toThrow(ConsultAnalysisProviderError)
    }
  })

  it('builds the closed menu schema through the existing provider boundary', () => {
    const schema = toProviderOutputSchema(buildConsultLookPlanOutputSchema(context()))
    const text = JSON.stringify(schema)
    expect(text).toContain('Dimensional color')
    expect(text).toContain('profile.skinUndertone')
    expect(text).not.toContain('profile.eyeColor')
    expect(text).not.toContain('offering-')
    expect(text).not.toContain('maxItems')
    expect(text).not.toContain('uniqueItems')
    expect(text).toContain('additionalProperties')
  })
})
