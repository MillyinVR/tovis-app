// lib/migration/calendarResync.ts
//
// The calendar feed resync job. For each connected subscription it re-fetches
// the feed (SSRF-guarded) and re-runs the import — which is idempotent on the
// event UID, so existing bookings/blocks/history are untouched and only NEW
// appointments are added ("live during the transition").
//
// Additive only: appointments the pro DELETES in their old app are not removed
// here (v1 caveat), and a pro who has fully moved over should disconnect the
// feed. Per-subscription best-effort; one bad feed never blocks the others.

import { CalendarFeedStatus, Prisma } from '@prisma/client'

import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import { fetchCalendarFeed } from './calendarFeed'
import { parseCalendarFeed } from './calendarImport'
import {
  commitCalendarImport,
  reconcileRemovedImportedEvents,
} from './calendarImportServer'

// lastSyncedUids is stored as a JSON string[]; read it back defensively.
function toUidArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export type CalendarResyncSummary = {
  scanned: number
  synced: number
  errored: number
  scannedAt: string
}

export async function runCalendarResync(args: {
  now: Date
  limit?: number
}): Promise<CalendarResyncSummary> {
  const limit = clampInt(args.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT)

  // Active + previously-errored (retry), oldest-synced first so a stuck feed
  // can't starve the rest.
  const subscriptions = await prisma.calendarFeedSubscription.findMany({
    where: {
      status: { in: [CalendarFeedStatus.ACTIVE, CalendarFeedStatus.ERROR] },
    },
    orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }],
    take: limit,
    select: {
      id: true,
      professionalId: true,
      feedUrl: true,
      lastSyncedUids: true,
      professional: { select: { userId: true } },
    },
  })

  let synced = 0
  let errored = 0

  for (const sub of subscriptions) {
    try {
      const fetched = await fetchCalendarFeed(sub.feedUrl)
      if (!fetched.ok) {
        await prisma.calendarFeedSubscription.update({
          where: { id: sub.id },
          data: {
            status: CalendarFeedStatus.ERROR,
            lastSyncError: `${fetched.code}: ${fetched.error}`,
            lastSyncedAt: args.now,
          },
        })
        errored += 1
        continue
      }

      const events = parseCalendarFeed(fetched.ics)
      const currentUids = events.map((event) => event.uid)

      // Reconcile deletions: UIDs that were in the feed last sync but are gone
      // now were deleted in the pro's old app — remove the held block and cancel
      // a still-pristine imported booking. Scoped to the feed's own UID history,
      // so one-shot uploads are never touched.
      const previousUids = toUidArray(sub.lastSyncedUids)
      const currentSet = new Set(currentUids)
      const removedUids = previousUids.filter((uid) => !currentSet.has(uid))
      const reconciled =
        removedUids.length > 0
          ? await reconcileRemovedImportedEvents({
              professionalId: sub.professionalId,
              removedUids,
            })
          : { cancelledBookings: 0, deletedBlocks: 0 }

      const result = await commitCalendarImport({
        professionalId: sub.professionalId,
        actorUserId: sub.professional.userId,
        events,
        now: args.now,
      })

      const counts: Prisma.InputJsonObject = {
        bookings: result.created.bookings,
        blocks: result.created.blocks,
        history: result.created.history,
        failed: result.failed,
        cancelledBookings: reconciled.cancelledBookings,
        deletedBlocks: reconciled.deletedBlocks,
      }
      await prisma.calendarFeedSubscription.update({
        where: { id: sub.id },
        data: {
          status: CalendarFeedStatus.ACTIVE,
          lastSyncError: null,
          lastSyncedAt: args.now,
          lastSyncCounts: counts,
          lastSyncedUids: currentUids,
        },
      })
      synced += 1
    } catch (error: unknown) {
      errored += 1
      console.error('runCalendarResync: subscription sync failed', {
        subscriptionId: sub.id,
        error: safeError(error),
      })
      await prisma.calendarFeedSubscription
        .update({
          where: { id: sub.id },
          data: { status: CalendarFeedStatus.ERROR, lastSyncedAt: args.now },
        })
        .catch(() => undefined)
    }
  }

  return {
    scanned: subscriptions.length,
    synced,
    errored,
    scannedAt: args.now.toISOString(),
  }
}
