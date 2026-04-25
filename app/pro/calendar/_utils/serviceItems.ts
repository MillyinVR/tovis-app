// app/pro/calendar/_utils/serviceItems.ts
//
// Pure helpers for building, comparing, and summarising BookingServiceItem arrays.
// Zero React dependency.

import type { BookingServiceItem, ServiceOption } from '../_types'

import {
  DEFAULT_DURATION_MINUTES,
  roundDurationMinutes,
} from './calendarMath'

type ComparableServiceItem = {
  serviceId: string
  offeringId: string | null
  itemType: string
  serviceName: string
  priceSnapshot: string
  durationMinutesSnapshot: number
  sortOrder: number
}

const DEFAULT_PRICE_SNAPSHOT = '0.00'

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeDurationMinutes(
  value: number | null | undefined,
  stepMinutes?: number | null,
) {
  const rawDuration = finiteNumber(value) ?? DEFAULT_DURATION_MINUTES

  return roundDurationMinutes(rawDuration, stepMinutes)
}

function normalizeSortOrder(value: number | null | undefined, fallback: number) {
  const raw = finiteNumber(value)

  if (raw === null || raw < 0) return fallback

  return Math.trunc(raw)
}

function normalizeItemType(index: number) {
  return index === 0 ? 'BASE' : 'ADD_ON'
}

function comparableServiceItem(item: BookingServiceItem): ComparableServiceItem {
  return {
    serviceId: normalizeText(item.serviceId),
    offeringId: item.offeringId === null ? null : normalizeText(item.offeringId),
    itemType: normalizeText(item.itemType),
    serviceName: normalizeText(item.serviceName),
    priceSnapshot: normalizeMoneyString(item.priceSnapshot),
    durationMinutesSnapshot: normalizeDurationMinutes(
      item.durationMinutesSnapshot,
    ),
    sortOrder: normalizeSortOrder(item.sortOrder, 0),
  }
}

function hasRequiredDraftFields(item: BookingServiceItem) {
  return (
    normalizeText(item.id).length > 0 &&
    normalizeText(item.serviceId).length > 0 &&
    normalizeText(item.serviceName).length > 0 &&
    normalizeText(item.priceSnapshot).length > 0 &&
    finiteNumber(item.durationMinutesSnapshot) !== null
  )
}

// ── Totals / labels ────────────────────────────────────────────────

export function serviceItemsTotalDuration(items: BookingServiceItem[]): number {
  let total = 0

  for (const item of items) {
    const duration = finiteNumber(item.durationMinutesSnapshot)

    if (duration !== null && duration > 0) {
      total += duration
    }
  }

  return total
}

export function serviceItemsLabel(items: BookingServiceItem[]): string {
  const names: string[] = []

  for (const item of items) {
    const name = normalizeText(item.serviceName)

    if (name) {
      names.push(name)
    }
  }

  return names.length > 0 ? names.join(' + ') : 'Appointment'
}

// ── Draft builders ─────────────────────────────────────────────────

export function normalizeMoneyString(raw: string | null | undefined): string {
  const value = normalizeText(raw)
  return value || DEFAULT_PRICE_SNAPSHOT
}

export function makeDraftItemId(
  serviceId: string,
  offeringId: string,
  sortOrder: number,
): string {
  return `draft:${serviceId}:${offeringId}:${sortOrder}`
}

export function buildDraftItemFromServiceOption(
  service: ServiceOption,
  sortOrder: number,
  stepMinutes: number,
): BookingServiceItem | null {
  const serviceId = normalizeText(service.id)
  const offeringId = normalizeText(service.offeringId)
  const serviceName = normalizeText(service.name)
  const rawDuration = finiteNumber(service.durationMinutes)

  if (!serviceId || !offeringId || !serviceName) return null
  if (rawDuration === null || rawDuration <= 0) return null

  const safeSortOrder = normalizeSortOrder(sortOrder, 0)
  const durationMinutesSnapshot = normalizeDurationMinutes(
    rawDuration,
    stepMinutes,
  )

  return {
    id: makeDraftItemId(serviceId, offeringId, safeSortOrder),
    serviceId,
    offeringId,
    itemType: normalizeItemType(safeSortOrder),
    serviceName,
    priceSnapshot: normalizeMoneyString(service.priceStartingAt),
    durationMinutesSnapshot,
    sortOrder: safeSortOrder,
  }
}

export function normalizeDraftServiceItems(
  items: BookingServiceItem[],
): BookingServiceItem[] {
  const normalized: BookingServiceItem[] = []

  for (const item of items) {
    if (!hasRequiredDraftFields(item)) continue

    const sortOrder = normalized.length
    const offeringId =
      item.offeringId === null ? null : normalizeText(item.offeringId)

    normalized.push({
      ...item,
      serviceId: normalizeText(item.serviceId),
      offeringId,
      itemType: normalizeItemType(sortOrder),
      serviceName: normalizeText(item.serviceName),
      priceSnapshot: normalizeMoneyString(item.priceSnapshot),
      durationMinutesSnapshot: normalizeDurationMinutes(
        item.durationMinutesSnapshot,
      ),
      sortOrder,
    })
  }

  return normalized
}

// ── Comparison ─────────────────────────────────────────────────────

export function sameServiceItems(
  leftItems: BookingServiceItem[],
  rightItems: BookingServiceItem[],
): boolean {
  const left = normalizeDraftServiceItems(leftItems).map(comparableServiceItem)
  const right = normalizeDraftServiceItems(rightItems).map(comparableServiceItem)

  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index]
    const rightItem = right[index]

    if (!leftItem || !rightItem) return false

    if (leftItem.serviceId !== rightItem.serviceId) return false
    if (leftItem.offeringId !== rightItem.offeringId) return false
    if (leftItem.itemType !== rightItem.itemType) return false
    if (leftItem.serviceName !== rightItem.serviceName) return false
    if (leftItem.priceSnapshot !== rightItem.priceSnapshot) return false
    if (
      leftItem.durationMinutesSnapshot !== rightItem.durationMinutesSnapshot
    ) {
      return false
    }
    if (leftItem.sortOrder !== rightItem.sortOrder) return false
  }

  return true
}