// app/pro/calendar/_utils/serviceItems.ts
//
// Pure helpers for building, comparing, and summarising BookingServiceItem arrays.
// Zero React dependency.

import type { BookingServiceItem, ServiceOption } from '../_types'
import { roundDurationMinutes } from './calendarMath'

// ── Totals / labels ────────────────────────────────────────────────

export function serviceItemsTotalDuration(items: BookingServiceItem[]): number {
  return items.reduce(
    (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
    0,
  )
}

export function serviceItemsLabel(items: BookingServiceItem[]): string {
  const names = items.map((item) => item.serviceName.trim()).filter(Boolean)
  return names.length ? names.join(' + ') : 'Appointment'
}

// ── Draft builders ─────────────────────────────────────────────────

export function normalizeMoneyString(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  return value ? value : '0.00'
}

export function makeDraftItemId(serviceId: string, offeringId: string, sortOrder: number): string {
  return `draft:${serviceId}:${offeringId}:${sortOrder}`
}

export function buildDraftItemFromServiceOption(
  service: ServiceOption,
  sortOrder: number,
  stepMinutes: number,
): BookingServiceItem | null {
  const offeringId = service.offeringId?.trim() ?? ''
  const durationMinutesSnapshot = Number(service.durationMinutes ?? 0)
  const priceSnapshot = normalizeMoneyString(service.priceStartingAt)

  if (!service.id || !service.name || !offeringId) return null
  if (!Number.isFinite(durationMinutesSnapshot) || durationMinutesSnapshot <= 0) {
    return null
  }

  return {
    id: makeDraftItemId(service.id, offeringId, sortOrder),
    serviceId: service.id,
    offeringId,
    itemType: sortOrder === 0 ? 'BASE' : 'ADD_ON',
    serviceName: service.name,
    priceSnapshot,
    durationMinutesSnapshot: roundDurationMinutes(durationMinutesSnapshot, stepMinutes),
    sortOrder,
  }
}

export function normalizeDraftServiceItems(items: BookingServiceItem[]): BookingServiceItem[] {
  return items.map((item, index) => ({
    ...item,
    itemType: index === 0 ? 'BASE' : 'ADD_ON',
    sortOrder: index,
  }))
}

// ── Comparison ─────────────────────────────────────────────────────

export function sameServiceItems(a: BookingServiceItem[], b: BookingServiceItem[]): boolean {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (!left || !right) return false

    if (left.serviceId !== right.serviceId) return false
    if ((left.offeringId ?? null) !== (right.offeringId ?? null)) return false
    if (left.serviceName !== right.serviceName) return false
    if (left.priceSnapshot !== right.priceSnapshot) return false
    if (
      Number(left.durationMinutesSnapshot) !== Number(right.durationMinutesSnapshot)
    ) {
      return false
    }
    if (Number(left.sortOrder) !== Number(right.sortOrder)) return false
    if (String(left.itemType) !== String(right.itemType)) return false
  }

  return true
}
