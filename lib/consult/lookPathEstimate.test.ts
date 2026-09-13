import { Prisma, ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import type { ConsultLookPlanDTO } from '@/lib/dto/consult'
import type { ConsultProMenuOffering } from './proMenu'
import { estimateConsultLookPaths, normalizeConsultLookPathEstimates } from './lookPathEstimate'
import { UNSPECIFIED_SERVICE_FACTS } from './testServiceFacts'

const menu: ConsultProMenuOffering[] = [
  { id: 'color', serviceId: 'color', offersInSalon: true, offersMobile: true,
    salonPriceStartingAt: new Prisma.Decimal('120.50'), mobilePriceStartingAt: new Prisma.Decimal('150'),
    salonDurationMinutes: 62, mobileDurationMinutes: 80,
    service: { name: 'Color', categoryId: 'hair', description: null, defaultDurationMinutes: 20, ...UNSPECIFIED_SERVICE_FACTS } },
  { id: 'cut', serviceId: 'cut', offersInSalon: true, offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal('0'), mobilePriceStartingAt: null,
    salonDurationMinutes: 20, mobileDurationMinutes: null,
    service: { name: 'Cut', categoryId: 'hair', description: null, defaultDurationMinutes: 20, ...UNSPECIFIED_SERVICE_FACTS } },
]
const step = (id: string) => ({ offeringId: id, serviceId: id, serviceCategoryId: 'hair', serviceName: id })
const path = (visits: string[][]) => ({ title: 'Warm dimension', whyThisWorksForYou: 'Your chosen warmth.',
  featureEvidence: [], sessionCount: visits.length, visits: visits.map(ids => ({ steps: ids.map(step) })) })
const plan: ConsultLookPlanDTO = { schemaVersion: 1, tier: 'EXACT', status: 'READY_TO_CHOOSE', provisional: false, choosable: true, safetyRouted: false,
  summary: 'Warm dimension.', nextStep: 'Confirm your look.', paths: [path([['color', 'cut'], ['color']]), path([['cut']])] }
const estimate = (offerings = menu, locationType: ServiceLocationType = 'SALON') => estimateConsultLookPaths({ plan, menu: offerings, locationType, stepMinutes: 15 })

describe('look path price and time', () => {
  it('sums required steps and visits, preserving complimentary work and keeping alternatives separate', () => {
    const result = estimate()
    expect(result[0]?.firstAppointment).toEqual({ price: '120.50', priceStatus: 'PAID', knownSubtotal: '120.50', durationMinutes: 105 })
    expect(result[0]?.transformation).toEqual({ price: '241.00', priceStatus: 'PAID', knownSubtotal: '241.00', durationMinutes: 180 })
    expect(result[1]?.transformation).toEqual({ price: '0.00', priceStatus: 'COMPLIMENTARY', knownSubtotal: '0.00', durationMinutes: 30 })
  })
  it('keeps unset price independent of known time and never calls a partial subtotal the full estimate', () => {
    const result = estimate(menu.map(item => item.id === 'cut' ? { ...item, salonPriceStartingAt: null } : item))
    expect(result[0]?.firstAppointment).toEqual({ price: null, priceStatus: 'UNSET', knownSubtotal: '120.50', durationMinutes: 105 })
  })
  it('does not replace a missing pro duration with the catalog default', () => {
    const result = estimate(menu.map(item => item.id === 'color' ? { ...item, salonDurationMinutes: null } : item))
    expect(result[0]?.firstAppointment.durationMinutes).toBeNull()
    expect(result[0]?.firstAppointment.price).toBe('120.50')
  })
  it('reads mobile columns and refuses to silently drop required work unavailable there', () => {
    const result = estimate(menu, 'MOBILE')
    expect(result[0]?.visits[0]?.steps[0]?.price).toBe('150.00')
    expect(result[0]?.visits[0]?.steps[0]?.durationMinutes).toBe(90)
    expect(result[0]?.visits[0]?.steps[1]?.available).toBe(false)
    expect(result[0]?.firstAppointment.price).toBeNull()
    expect(result[0]?.firstAppointment.durationMinutes).toBeNull()
  })
  it('does not substitute another service when a stored offering identity changes', () => {
    const result = estimate(menu.map(item => item.id === 'color' ? { ...item, serviceId: 'new-service' } : item))
    expect(result[0]?.visits[0]?.steps[0]?.available).toBe(false)
    expect(result[0]?.firstAppointment.price).toBeNull()
  })
})

describe('immutable look estimate snapshots', () => {
  it('round-trips both modes including missing required prices', () => {
    const snapshots = [...estimate(), ...estimate(menu, 'MOBILE')]
    expect(normalizeConsultLookPathEstimates(JSON.parse(JSON.stringify(snapshots)))).toEqual(snapshots)
  })
  it('rejects a total that silently drops an unset required price', () => {
    const snapshots = estimate(menu, 'MOBILE')
    if (!snapshots[0]) throw new Error('Missing fixture')
    snapshots[0].firstAppointment = { price: '150.00', priceStatus: 'PAID', knownSubtotal: '150.00', durationMinutes: 90 }
    expect(() => normalizeConsultLookPathEstimates(snapshots)).toThrow()
  })
  it('rejects duplicated alternatives and negative step prices', () => {
    expect(() => normalizeConsultLookPathEstimates([estimate()[0], estimate()[0]])).toThrow()
    const snapshots = estimate()
    const step = snapshots[0]?.visits[0]?.steps[0]
    if (!step) throw new Error('Missing fixture')
    step.price = '-1.00'
    expect(() => normalizeConsultLookPathEstimates(snapshots)).toThrow()
  })
})
