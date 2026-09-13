import { ConsultServiceFamily, Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { ConsultAnalysisPayloadDTO, ConsultCaptureShotKeyDTO } from '@/lib/dto/consult'
import { ConsultAnalysisProviderError } from './analysisValidation'
import type { ConsultProMenuOffering } from './proMenu'
import {
  buildConsultLookPlanOutputSchema,
  consultLookPlanEvidence,
  consultLookPlanMenu,
  consultLookPlanMenuContext,
  resolveConsultLookPlan,
  normalizeStoredConsultLookPlan,
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
    historyUnknownToClient: false, safetyRouted: false,
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

  it.each(['requiredHistoryComplete', 'goalConfirmed', 'maintenanceDecisionResolved'] as const)(
    'a model cannot override missing %s', field => {
      const result = resolveConsultLookPlan(plan(), { ...context(), [field]: false })
      expect(result.status).toBe('NEEDS_INPUT')
      expect(result.provisional).toBe(true)
      expect(result.choosable).toBe(false)
      expect(result.nextStep).not.toBe(plan().nextStep)
    },
  )

  // 🔴 Tori, 2026-09-13: "we absolutely can not make the pictures be a blocker".
  // The reading is still honestly marked thin — she is told so, and told what
  // daylight would add — but the photograph does not touch her permission.
  it('a thin starting-point photo marks the plan provisional and still lets her book', () => {
    const result = resolveConsultLookPlan(plan(), { ...context(), startingPointSufficient: false })
    expect(result.status).toBe('NEEDS_INPUT')
    expect(result.provisional).toBe(true)
    expect(result.choosable).toBe(true)
    expect(result.paths).toHaveLength(1)
  })

  it('never turns a thin photo into the next thing she has to do', () => {
    const result = resolveConsultLookPlan(plan(), { ...context(), startingPointSufficient: false })
    expect(result.nextStep).not.toMatch(/photo/i)
  })

  // Safety ROUTING no longer reaches this function at all (Tori, 2026-09-13):
  // it is carried by the recommendations and surfaces on the booking. What
  // remains is a history the CLIENT said she does not know, which no routing
  // rule reads — so the pro resolves it, and she still sees the look.
  it('an unknown history needs the pro, and keeps the paths it found', () => {
    const result = resolveConsultLookPlan(plan(), { ...context(), historyUnknownToClient: true })
    expect(result.status).toBe('PRO_REVIEW')
    expect(result.choosable).toBe(false)
    expect(result.paths).toHaveLength(1)
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
    // A service named twice is no longer here: it is collapsed to one step
    // (see "reads a service named twice in one visit as one step"), because
    // refusing it discarded a whole paid analysis in prod on 2026-09-13.
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

  it('refuses unsupported citations', () => {
    // A REPEATED citation is not unsupported — it leans on the field once, and
    // collapses. Only a field the profile cannot back is refused.
    const raw = plan()
    const path = raw.paths[0]!
    for (const featureEvidence of [['profile.eyeColor'], ['identity']]) {
      expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, featureEvidence }] }, context())).toThrow(ConsultAnalysisProviderError)
    }
  })

  it('reads paths drawn against an empty menu as "no matching offering" instead of refusing', () => {
    // `maxItems: 0` is stripped at the boundary, so the model can still draw a
    // path whose services can only be null. Nothing can host it; it is not a
    // wrong answer worth a whole refusal after both paid calls.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const raw = { ...plan(), paths: [{ ...plan().paths[0]!, visits: [{ services: [null] }] }] }
      const result = sanitizeConsultLookPlan(raw, { ...context(), menu: [] })
      expect(result.paths).toEqual([])
      expect(result.blocker).toBe('NO_MATCHING_OFFERING')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('reads a null citation against an empty evidence vocabulary as no citation', () => {
    const unknownAll = observations()
    for (const key of Object.keys(unknownAll.profile) as (keyof typeof unknownAll.profile)[]) unknownAll.profile[key] = observed('UNKNOWN')
    for (const key of Object.keys(unknownAll.core) as (keyof typeof unknownAll.core)[]) unknownAll.core[key] = observed('UNKNOWN', 'hair_back')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const raw = { ...plan(), paths: [{ ...plan().paths[0]!, featureEvidence: [null] }] }
      const result = sanitizeConsultLookPlan(raw, { ...context(), observations: unknownAll })
      expect(result.paths[0]?.featureEvidence).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('resolves a menu name that differs only in case or whitespace to the menu row, and names a real miss', () => {
    const raw = plan()
    const path = raw.paths[0]!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, visits: [{ services: ['dimensional COLOR ', 'Layered cut'] }] }] }, context())
      expect(result.paths[0]?.visits[0]?.services).toEqual(['Dimensional color', 'Layered cut'])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, visits: [{ services: ['Balayage'] }] }] }, context()))
        .toThrowError(expect.objectContaining({ check: 'visit_services_enum' }))
      expect(JSON.stringify(error.mock.calls[0])).toContain('Balayage')
    } finally {
      warn.mockRestore(); error.mockRestore()
    }
  })

  it('reads a service named twice in one visit as one step, and still refuses a real overrun', () => {
    // Prod, 2026-09-13 00:08Z: a visit listed "iTip Install" twice, both
    // resolved to the one menu row, and the duplicate check discarded four
    // model calls that had all answered.
    const raw = plan()
    const path = raw.paths[0]!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = sanitizeConsultLookPlan(
        { ...raw, paths: [{ ...path, visits: [{ services: ['Dimensional color', 'dimensional COLOR'] }] }] },
        context(),
      )
      expect(result.paths[0]?.visits[0]?.services).toEqual(['Dimensional color'])
      expect(JSON.stringify(warn.mock.calls)).toContain('listed the same item twice')
    } finally {
      warn.mockRestore()
    }
    // A repeated citation collapses the same way.
    const evidence = sanitizeConsultLookPlan(
      { ...raw, paths: [{ ...path, featureEvidence: ['profile.skinUndertone', 'profile.skinUndertone'] }] },
      context(),
    )
    expect(evidence.paths[0]?.featureEvidence).toEqual(['profile.skinUndertone'])
    // Twice the allowance is a wrong answer, not a repeat, and is still refused.
    expect(() =>
      sanitizeConsultLookPlan(
        { ...raw, paths: [{ ...path, visits: [{ services: Array(40).fill('Dimensional color') }] }] },
        context(),
      ),
    ).toThrowError(expect.objectContaining({ check: 'visit_services_count' }))
  })

  it('names the check that refused', () => {
    const raw = plan()
    const path = raw.paths[0]!
    expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, featureEvidence: ['profile.eyeColor'] }] }, context()))
      .toThrowError(expect.objectContaining({ check: 'path_evidence_enum' }))
    expect(() => sanitizeConsultLookPlan({ ...raw, paths: [{ ...path, visits: [{ services: ['Not on the menu'] }] }] }, context()))
      .toThrowError(expect.objectContaining({ check: 'visit_services_enum' }))
    expect(() => sanitizeConsultLookPlan({ ...raw, blocker: 'NONE', paths: [] }, context()))
      .toThrowError(expect.objectContaining({ check: 'plan_ready_without_paths' }))
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


describe('immutable look-plan snapshots', () => {
  it('round trips all tiers, repeated visits, and alternatives without a current menu', () => {
    const input = plan()
    input.paths.push({ ...input.paths[0]!, title: 'Gradual brightness',
      visits: [{ services: ['Dimensional color'] }, { services: ['Dimensional color', 'Layered cut'] }] })
    for (const tier of ['EXACT', 'CLOSE', 'TOWARD'] as const) {
      const saved = resolveConsultLookPlan({ ...input, tier }, context())
      expect(normalizeStoredConsultLookPlan(JSON.parse(JSON.stringify(saved)), observations())).toEqual(saved)
    }
  })

  it.each(['MORE_INFORMATION', 'PRO_REVIEW', 'NO_MATCHING_OFFERING'] as const)('preserves %s with no path', blocker => {
    const saved = resolveConsultLookPlan({ ...plan(), paths: [], blocker }, context())
    expect(normalizeStoredConsultLookPlan(saved, observations())).toEqual(saved)
  })

  it('rejects inconsistent readiness and derived visit counts', () => {
    const saved = resolveConsultLookPlan(plan(), context())
    expect(() => normalizeStoredConsultLookPlan({ ...saved, provisional: true }, observations())).toThrow()
    expect(() => normalizeStoredConsultLookPlan({ ...saved, paths: [] }, observations())).toThrow()
    // PRO_REVIEW carrying paths is VALID now — the pro reviews the look she
    // can already see. What stays invalid is permission with nothing behind it.
    expect(normalizeStoredConsultLookPlan({ ...saved, status: 'PRO_REVIEW', provisional: true, choosable: false }, observations()).paths)
      .toHaveLength(1)
    expect(() => normalizeStoredConsultLookPlan({ ...saved, status: 'PRO_REVIEW', provisional: true, choosable: true }, observations())).toThrow()
    expect(() => normalizeStoredConsultLookPlan({ ...saved, paths: [], choosable: true }, observations())).toThrow()
    expect(() => normalizeStoredConsultLookPlan({ ...saved, paths: [{ ...saved.paths[0], sessionCount: 2 }] }, observations())).toThrow()
  })

  it('rejects conflicting stored identities across visits', () => {
    const saved = resolveConsultLookPlan(plan(), context())
    const path = saved.paths[0]!
    const visit = path.visits[0]!
    path.visits.push({ steps: [{ ...visit.steps[0]!, offeringId: 'different-offering' }] })
    path.sessionCount = 2
    expect(() => normalizeStoredConsultLookPlan(saved, observations())).toThrow()
  })

  it('rejects fabricated evidence and injected fields instead of dropping them', () => {
    const saved = resolveConsultLookPlan(plan(), context())
    expect(() => normalizeStoredConsultLookPlan({ ...saved, price: 200 }, observations())).toThrow()
    saved.paths[0]!.featureEvidence = ['profile.colorSeason']
    expect(() => normalizeStoredConsultLookPlan(saved, observations())).toThrow()
  })
})
