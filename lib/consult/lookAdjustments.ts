import { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { isMoneyString } from '@/lib/money'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import type { ConsultLookPlanDTO } from '@/lib/dto/consult'
import { ConsultWriteError } from './errors'
import { exactKeys } from './analysisValidation'

export type ConsultLookAdjustment = {
  field: 'PRICE' | 'DURATION' | 'EXPECTATIONS'
  pathIndex: number
  visitIndex: number | null
  offeringId: string | null
  locationType: 'SALON' | 'MOBILE' | null
  value: string
  reason: string | null
  professionalId: string
}

export function lookAdjustmentKey(value: ConsultLookAdjustment): string {
  return `${value.pathIndex}:${value.visitIndex ?? '-'}:${value.offeringId ?? '-'}:${value.locationType ?? '-'}:${value.field}`
}

export function parseConsultLookAdjustments(raw: unknown): ConsultLookAdjustment[] {
  function invalid(): never { throw new ConsultWriteError('INVALID_REQUEST', 'Invalid look adjustment.') }
  if (!Array.isArray(raw) || raw.length > 144) invalid()
  const seen = new Set<string>()
  return raw.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['field','pathIndex','visitIndex','offeringId','value','reason','professionalId','locationType']) ||
      (item.field !== 'PRICE' && item.field !== 'DURATION' && item.field !== 'EXPECTATIONS') ||
      typeof item.pathIndex !== 'number' || !Number.isInteger(item.pathIndex) || item.pathIndex < 0 || item.pathIndex > 2 ||
      typeof item.value !== 'string' || item.value.length > 600 || !item.value.trim() ||
      typeof item.professionalId !== 'string' || !item.professionalId || item.professionalId.length > 128 ||
      (item.reason !== null && (typeof item.reason !== 'string' || item.reason.length > 400))) invalid()
    let visitIndex: number | null = null
    let offeringId: string | null = null
    let locationType: 'SALON' | 'MOBILE' | null = null
    if (item.field === 'EXPECTATIONS') {
      if (item.visitIndex !== null || item.offeringId !== null || item.locationType !== null) invalid()
    } else {
      if (typeof item.visitIndex !== 'number' || !Number.isInteger(item.visitIndex) || item.visitIndex < 0 || item.visitIndex > 7 ||
        typeof item.offeringId !== 'string' || !item.offeringId || item.offeringId.length > 128 ||
        (item.locationType !== 'SALON' && item.locationType !== 'MOBILE')) invalid()
      visitIndex = item.visitIndex; offeringId = item.offeringId; locationType = item.locationType
      if (item.field === 'PRICE' && (!isMoneyString(item.value) || new Prisma.Decimal(item.value).toFixed(2) !== item.value || new Prisma.Decimal(item.value).gt('99999999.99'))) invalid()
      if (item.field === 'DURATION' && (!/^[1-9]\d*$/.test(item.value) || Number(item.value) > MAX_SLOT_DURATION_MINUTES)) invalid()
    }
    const result: ConsultLookAdjustment = { field: item.field, pathIndex: item.pathIndex, visitIndex, offeringId, locationType,
      value: item.value, reason: item.reason, professionalId: item.professionalId }
    const key = lookAdjustmentKey(result)
    if (seen.has(key)) invalid()
    seen.add(key)
    return result
  })
}

export function readStoredLookAdjustments(raw: unknown): ConsultLookAdjustment[] {
  if (!isRecord(raw) || Object.keys(raw).some(key => key !== 'entries')) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid saved look adjustments.')
  return parseConsultLookAdjustments(raw.entries ?? [])
}

export function assertLookAdjustmentTargets(plan: ConsultLookPlanDTO, entries: readonly ConsultLookAdjustment[]) {
  for (const entry of entries) {
    const path = plan.paths[entry.pathIndex]
    if (!path || (entry.field !== 'EXPECTATIONS' && !path.visits[entry.visitIndex ?? -1]?.steps.some(step => step.offeringId === entry.offeringId))) {
      throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'The look changed. Review the current work before adjusting it.')
    }
  }
}

/** Pro overrides remain scoped to one chosen visit and one location mode. */
export function applyConsultLookOfferingAdjustments<T extends {
  id: string; salonPriceStartingAt: Prisma.Decimal | null; mobilePriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null; mobileDurationMinutes: number | null
}>(offering: T, entries: readonly ConsultLookAdjustment[], pathIndex: number, locationType: 'SALON' | 'MOBILE', visitIndex = 0): T {
  const result = { ...offering }
  for (const entry of entries) {
    if (entry.pathIndex !== pathIndex || entry.visitIndex !== visitIndex || entry.offeringId !== offering.id || entry.locationType !== locationType) continue
    if (entry.field === 'PRICE') {
      if (locationType === 'SALON') result.salonPriceStartingAt = new Prisma.Decimal(entry.value)
      else result.mobilePriceStartingAt = new Prisma.Decimal(entry.value)
    }
    if (entry.field === 'DURATION') {
      if (locationType === 'SALON') result.salonDurationMinutes = Number(entry.value)
      else result.mobileDurationMinutes = Number(entry.value)
    }
  }
  return result
}
