import 'server-only'
import { isDeepStrictEqual } from 'node:util'
import { isRecord } from '@/lib/guards'
import { isMoneyString } from '@/lib/money'
import { exactKeys } from './analysisValidation'

import { Prisma, ServiceLocationType } from '@prisma/client'
import { ceilToStepMinutes, pickModePrice } from '@/lib/booking/serviceItems'
import type { ConsultLookPlanDTO, ConsultLookEstimateAmountDTO, ConsultLookPathEstimateDTO } from '@/lib/dto/consult'
import { applyConsultLookOfferingAdjustments, type ConsultLookAdjustment } from './lookAdjustments'
import type { ConsultProMenuOffering } from './proMenu'

export type ConsultLookEstimateAmount = ConsultLookEstimateAmountDTO
export type ConsultLookPathEstimate = ConsultLookPathEstimateDTO

/** The selected location's explicit pro columns. Unset is not complimentary,
 * and a catalog-wide default is not a time this professional has supplied. */
export function readConsultLookOfferingAmount(offering: ConsultProMenuOffering, locationType: ServiceLocationType, stepMinutes: number | null): ConsultLookEstimateAmount {
  const enabled = locationType === ServiceLocationType.MOBILE ? offering.offersMobile : offering.offersInSalon
  const rawPrice = enabled ? pickModePrice({ ...offering, locationType }) : null
  const price = rawPrice?.isFinite() && !rawPrice.isNegative() ? rawPrice : null
  const rawDuration = enabled ? (locationType === ServiceLocationType.MOBILE ? offering.mobileDurationMinutes : offering.salonDurationMinutes) : null
  const durationMinutes = stepMinutes !== null && rawDuration !== null && Number.isSafeInteger(rawDuration) && rawDuration > 0
    ? ceilToStepMinutes(rawDuration, stepMinutes) : null
  return {
    price: price?.toFixed(2) ?? null,
    priceStatus: price === null ? 'UNSET' : price.isZero() ? 'COMPLIMENTARY' : 'PAID',
    knownSubtotal: price?.toFixed(2) ?? '0.00', durationMinutes,
  }
}

function sumAmounts(items: readonly ConsultLookEstimateAmount[]): ConsultLookEstimateAmount {
  const subtotal = items.reduce((sum, item) => sum.plus(item.knownSubtotal), new Prisma.Decimal(0))
  const completePrice = items.length > 0 && items.every(item => item.price !== null)
  const completeDuration = items.length > 0 && items.every(item => item.durationMinutes !== null)
  return {
    price: completePrice ? subtotal.toFixed(2) : null,
    priceStatus: !completePrice ? 'UNSET' : subtotal.isZero() ? 'COMPLIMENTARY' : 'PAID',
    knownSubtotal: subtotal.toFixed(2),
    durationMinutes: completeDuration ? items.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0) : null,
  }
}

/** Each alternative is priced separately; only visit one sizes its appointment.
 * This produces a preview, never a booking write or an availability claim. */
export function estimateConsultLookPaths(args: {
  plan: ConsultLookPlanDTO
  menu: readonly ConsultProMenuOffering[]
  locationType: ServiceLocationType
  stepMinutes: number | null
  adjustments?: readonly ConsultLookAdjustment[]
}): ConsultLookPathEstimate[] {
  const menu = new Map(args.menu.map(offering => [offering.id, offering]))
  return args.plan.paths.map((path, pathIndex) => {
    const visits = path.visits.map((visit, visitIndex) => {
      const steps = visit.steps.map(step => {
        const offering = menu.get(step.offeringId)
        const available = Boolean(offering && offering.serviceId === step.serviceId &&
          offering.service.categoryId === step.serviceCategoryId &&
          (args.locationType === ServiceLocationType.MOBILE ? offering.offersMobile : offering.offersInSalon))
        const amount = available && offering ? readConsultLookOfferingAmount(
          applyConsultLookOfferingAdjustments(offering, args.adjustments ?? [], pathIndex, args.locationType, visitIndex),
          args.locationType, args.stepMinutes,
        ) : sumAmounts([])
        return { ...amount, offeringId: step.offeringId, serviceId: step.serviceId, available }
      })
      return { ...sumAmounts(steps), steps }
    })
    return { pathIndex, locationType: args.locationType, visits,
      firstAppointment: sumAmounts(visits.slice(0, 1)), transformation: sumAmounts(visits) }
  })
}

/** Parse snapshots without looking at today's menu or recalculating from it. */
export function normalizeConsultLookPathEstimates(raw: unknown): ConsultLookPathEstimate[] {
  function invalid(): never { throw new Error('Look estimate snapshot is unavailable.') }
  if (!Array.isArray(raw) || raw.length > 6) invalid()
  const amount = (value: unknown): ConsultLookEstimateAmount => {
    if (!isRecord(value) || !exactKeys(value, ['price', 'priceStatus', 'knownSubtotal', 'durationMinutes'])) invalid()
    const money = (input: unknown): string => {
      if (typeof input !== 'string' || input.length > 20 || !isMoneyString(input) || new Prisma.Decimal(input).toFixed(2) !== input) invalid()
      return input
    }
    const price = value.price === null ? null : money(value.price)
    const knownSubtotal = money(value.knownSubtotal)
    if (price === null ? knownSubtotal !== '0.00' : price !== knownSubtotal) invalid()
    const priceStatus = price === null ? 'UNSET' : new Prisma.Decimal(price).isZero() ? 'COMPLIMENTARY' : 'PAID'
    if (value.priceStatus !== priceStatus || (value.durationMinutes !== null &&
      (typeof value.durationMinutes !== 'number' || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes <= 0))) invalid()
    return { price, priceStatus, knownSubtotal, durationMinutes: value.durationMinutes }
  }
  const unique = new Set<string>()
  return raw.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['pathIndex','locationType','firstAppointment','transformation','visits']) ||
      typeof item.pathIndex !== 'number' || !Number.isInteger(item.pathIndex) || item.pathIndex < 0 || item.pathIndex > 2 ||
      (item.locationType !== 'SALON' && item.locationType !== 'MOBILE') || !Array.isArray(item.visits) || item.visits.length < 1 || item.visits.length > 8) invalid()
    const key = `${item.pathIndex}:${item.locationType}`
    if (unique.has(key)) invalid()
    unique.add(key)
    const visits = item.visits.map(visit => {
      if (!isRecord(visit) || !exactKeys(visit, ['price','priceStatus','knownSubtotal','durationMinutes','steps']) ||
        !Array.isArray(visit.steps) || visit.steps.length < 1 || visit.steps.length > 6) invalid()
      const steps = visit.steps.map(step => {
        if (!isRecord(step) || !exactKeys(step, ['price','priceStatus','knownSubtotal','durationMinutes','offeringId','serviceId','available']) ||
          typeof step.offeringId !== 'string' || !step.offeringId || step.offeringId.length > 256 ||
          typeof step.serviceId !== 'string' || !step.serviceId || step.serviceId.length > 256 || typeof step.available !== 'boolean') invalid()
        const { offeringId, serviceId, available, ...fields } = step
        const parsed = amount(fields)
        if (!available && (parsed.price !== null || parsed.durationMinutes !== null)) invalid()
        return { ...parsed, offeringId, serviceId, available }
      })
      const parsed = { ...sumAmounts(steps), steps }
      if (!isDeepStrictEqual(parsed, visit)) invalid()
      return parsed
    })
    const result: ConsultLookPathEstimate = { pathIndex: item.pathIndex, locationType: item.locationType, visits,
      firstAppointment: sumAmounts(visits.slice(0, 1)), transformation: sumAmounts(visits) }
    if (!isDeepStrictEqual(result, item)) invalid()
    return result
  })
}
