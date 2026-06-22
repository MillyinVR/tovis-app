// lib/handles/reservationExpiry.ts
//
// Reserve-with-expiry for pro vanity handles. A not-yet-premium pro can reserve a
// handle (PATCH /api/pro/profile stamps handleReservedAt). If they never upgrade, the
// handle is reclaimed so it doesn't sit locked forever. Flow:
//   1. WARN  at (grace - warn) days: one heads-up notification (deduped per reservation).
//   2. RELEASE at grace days: clear handle/handleNormalized/handleReservedAt.
// Premium pros are never touched (their handle is live; syncSubscription nulls the timer).
import 'server-only'

import { NotificationEventKey } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { vanityLinkFor } from '@/lib/handles'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

/** Days a reservation is held before release. Confirmed product default: 30. */
export const RESERVATION_GRACE_DAYS = 30
/** How many days before release the heads-up notification fires. */
export const RESERVATION_WARN_DAYS = 7

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY)
}

export type ReservationExpiryResult = {
  warned: number
  released: number
}

/**
 * Run one warn+release pass. Idempotent: the warning is deduped per reservation
 * timestamp, and release only acts on reservations past the full grace window, so
 * repeated cron runs converge without double-sending or clobbering fresh claims.
 */
export async function runHandleReservationExpiry(
  now: Date = new Date(),
  opts: { graceDays?: number; warnDays?: number } = {},
): Promise<ReservationExpiryResult> {
  const graceDays = opts.graceDays ?? RESERVATION_GRACE_DAYS
  const warnDays = opts.warnDays ?? RESERVATION_WARN_DAYS

  const releaseCutoff = daysAgo(now, graceDays)
  const warnCutoff = daysAgo(now, graceDays - warnDays)

  const warned = await warnExpiringReservations({ now, releaseCutoff, warnCutoff })
  const released = await releaseExpiredReservations({ releaseCutoff })

  return { warned, released }
}

/**
 * Notify pros whose reservation has entered the warning window (older than warnCutoff)
 * but is not yet releasable (newer than releaseCutoff). Dedup keyed on the reservation
 * instant so a given reservation is warned at most once.
 */
async function warnExpiringReservations(args: {
  now: Date
  releaseCutoff: Date
  warnCutoff: Date
}): Promise<number> {
  const candidates = await prisma.professionalProfile.findMany({
    // Platform-maintenance sweep across all tenants — an intentional cross-tenant read.
    where: {
      ...platformCrossTenantProVisibilityFilter(),
      isPremium: false,
      handleNormalized: { not: null },
      handleReservedAt: { lte: args.warnCutoff, gt: args.releaseCutoff },
    },
    select: { id: true, handle: true, handleReservedAt: true },
  })

  let warned = 0
  for (const pro of candidates) {
    const vanity = vanityLinkFor(pro.handle)
    if (!vanity || !pro.handleReservedAt) continue

    await createProNotification({
      professionalId: pro.id,
      eventKey: NotificationEventKey.PRO_HANDLE_RESERVATION_EXPIRING,
      title: `Keep ${vanity.host}`,
      body: `Your reserved link ${vanity.host} will be released soon unless you upgrade. Upgrade to make it live and keep it.`,
      href: '/pro/membership',
      // One warning per reservation instant — re-claiming restamps the timer and resets this.
      dedupeKey: `handle-reservation-expiring:${pro.handleReservedAt.getTime()}`,
    })
    warned += 1
  }

  return warned
}

/** Reclaim handles whose reservation has passed the full grace window. */
async function releaseExpiredReservations(args: {
  releaseCutoff: Date
}): Promise<number> {
  const result = await prisma.professionalProfile.updateMany({
    where: {
      isPremium: false,
      handleNormalized: { not: null },
      handleReservedAt: { lte: args.releaseCutoff },
    },
    data: {
      handle: null,
      handleNormalized: null,
      handleReservedAt: null,
    },
  })

  return result.count
}
