// lib/migration/calendarImportServer.ts
//
// Server side of the calendar (Stage 3) import. Preview classifies each parsed
// iCal event against the pro's menu + clock; commit materializes them:
//   - future + salon-mappable + resolvable client → real IMPORTED Booking
//     (silent, price 0) via the shared createProBooking, idempotent on UID;
//   - future + unmapped / mobile-only / no client → a CalendarBlock holding the
//     time (mobile bookings need a client address an import can't supply);
//   - past + resolvable client → client history (upsertProClient, silent);
//   - otherwise skipped.
// All reuse the canonical writes — no booking/client logic is duplicated here.
//
// Two things about time, both learned the hard way in B9:
//   - the feed's unzoned stamps (all-day and floating) mean the PRO's clock, not
//     the server's — see `calendarEventTime.ts`; and
//   - a held block is a real claim on the pro's calendar, so it is written under
//     the pro's schedule lock like every other block in the product.

import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { bumpScheduleVersion } from '@/lib/booking/cacheVersion'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  cancelImportedBookingIfPristine,
  createProBooking,
} from '@/lib/booking/writeBoundary'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
// Through the barrel, per the house rule — `@/lib/time` re-exports the timezone
// -truth resolver as well as the low-level math.
import { DEFAULT_TIME_ZONE, resolveApptTimeZoneFromValues } from '@/lib/time'

import {
  resolveCalendarEventWindow,
  type CalendarEventWindow,
} from './calendarEventTime'
import type { NormalizedCalendarEvent } from './calendarImport'
import { isConfident, suggestServices, type MatchCatalogEntry } from './serviceMatch'

const DEFAULT_BLOCK_MINUTES = 60
const IMPORT_IDEMPOTENCY_PREFIX = 'import:'
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * Per-run event ceiling.
 *
 * Every event costs at least one statement even when it is an idempotent no-op,
 * and the resync cron re-walks each connected feed hourly inside a 60s function
 * shared by up to 25 subscriptions. An unbounded feed is therefore not just slow:
 * a subscription that never finishes never advances `lastSyncedAt`, and the job's
 * oldest-synced-first ordering then hands it the whole window every hour,
 * starving every other pro's feed. Bounding the work per run is what keeps that
 * rotation honest. Overflow is counted as skipped AND logged — a silent
 * truncation would read as "imported everything".
 */
const MAX_IMPORT_EVENTS = 1_000

/**
 * The longest window a single imported event may hold.
 *
 * `endsAt` comes straight from a remote feed's DTEND, so a malformed or joke
 * event ("busy until 2099") would otherwise darken the pro's calendar
 * indefinitely. Skipped rather than clamped: a silently shortened block re-opens
 * exactly the time it was created to hold. Sixty days clears any real leave.
 */
const MAX_IMPORTED_BLOCK_DAYS = 60

/**
 * Mirrors `MAX_NOTE_LENGTH` in `app/api/v1/pro/calendar/blocked/_shared.ts` — a
 * feed's SUMMARY is unbounded and the note is rendered as the block's title, so
 * an import must not store what the pro's own editor would have rejected.
 * (Logged as a duplicate-constant in the B-series dup register rather than
 * refactored mid-card.)
 */
const MAX_BLOCK_NOTE_LENGTH = 500

// The per-event idempotency key used on imported bookings (creationIdempotencyKey).
//
// Scoped to the professional ON PURPOSE. Client identity matching is global by
// design (one client account across all pros), so two pros importing feeds that
// share an event UID AND a client — common when both exports came from the same
// source app — resolve to the SAME (clientId, key) replay pair. An unscoped key
// made the second pro's import hydrate the first pro's booking, report
// `mutated:false`, and count the event skipped: silent data loss reported as
// success. Embedding the professionalId makes the bookmark per-pro while the
// client consolidation stays exactly as global as the product wants it.
function importKey(professionalId: string, uid: string): string {
  return `${IMPORT_IDEMPOTENCY_PREFIX}${professionalId}:${uid}`
}

export type CalendarEventClassification = 'BOOKING' | 'BLOCK' | 'HISTORY' | 'SKIP'

export type CalendarPreviewRow = {
  uid: string
  summary: string
  start: string
  end: string | null
  classification: CalendarEventClassification
  matchedServiceId: string | null
  matchedServiceName: string | null
  clientName: string | null
  isRecurring: boolean
  reason: string
}

export type CalendarImportPreview = {
  rows: CalendarPreviewRow[]
  summary: {
    total: number
    bookings: number
    blocks: number
    history: number
    skipped: number
  }
}

export type CalendarCommitResult = {
  created: { bookings: number; blocks: number; history: number }
  skipped: number
  failed: number
}

// One of the pro's offerings, keyed by the canonical service it maps to.
type OfferingMatch = {
  offeringId: string
  serviceId: string
  serviceName: string
  offersInSalon: boolean
}

type ResolvedClient = {
  firstName: string
  lastName: string
  email: string | null
}

// Attendee → client. upsertProClient requires first + last name plus a contact
// channel, so we need a two-token CN and an email; otherwise there's no client.
function resolveClientFromEvent(event: NormalizedCalendarEvent): ResolvedClient | null {
  if (!event.attendeeName || !event.attendeeEmail) return null
  const parts = event.attendeeName.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    email: event.attendeeEmail,
  }
}

async function loadOfferingMatches(professionalId: string): Promise<OfferingMatch[]> {
  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId, isActive: true },
    select: {
      id: true,
      serviceId: true,
      offersInSalon: true,
      service: { select: { name: true } },
    },
  })
  return offerings.map((o) => ({
    offeringId: o.id,
    serviceId: o.serviceId,
    serviceName: o.service.name,
    offersInSalon: o.offersInSalon,
  }))
}

function bestOfferingMatch(
  summary: string,
  offerings: OfferingMatch[],
  entries: MatchCatalogEntry[],
): OfferingMatch | null {
  const suggestions = suggestServices(summary, entries, { limit: 1 })
  const top = suggestions[0] ?? null
  if (!isConfident(top)) return null
  return offerings.find((o) => o.serviceId === top!.entry.id) ?? null
}

// Pure classification for one event given its (already resolved) match + client.
function classifyEvent(args: {
  window: CalendarEventWindow
  match: OfferingMatch | null
  client: ResolvedClient | null
  now: Date
}): { classification: CalendarEventClassification; reason: string } {
  const { window, match, client, now } = args

  // Whether the event is OVER, not whether it has started. An all-day "closed"
  // marker for today starts at local midnight, so a start-based test binned the
  // pro's whole day off as history from midnight onwards — and left the rest of
  // that day bookable. An event still running is current: hold what is left of
  // it. Once it ends, the next resync reclassifies it and seeds the history row.
  const endUtc =
    window.endUtc ??
    new Date(window.startUtc.getTime() + DEFAULT_BLOCK_MINUTES * MINUTE_MS)

  if (endUtc.getTime() <= now.getTime()) {
    return client
      ? { classification: 'HISTORY', reason: 'Past appointment — added to client history.' }
      : { classification: 'SKIP', reason: 'Past appointment with no identifiable client — skipped.' }
  }

  if (match && match.offersInSalon && client) {
    return {
      classification: 'BOOKING',
      reason: `Matched to ${match.serviceName} — will create an appointment.`,
    }
  }

  if (match && !match.offersInSalon) {
    return {
      classification: 'BLOCK',
      reason: `${match.serviceName} is mobile-only — time blocked (add the client's address to book).`,
    }
  }
  if (!match) {
    return { classification: 'BLOCK', reason: 'No matching service — time blocked.' }
  }
  return { classification: 'BLOCK', reason: 'No identifiable client — time blocked.' }
}

/**
 * Everything one import run needs that does not vary per event — including the
 * timezone the feed's unzoned stamps are read in.
 */
type ImportContext = {
  offerings: OfferingMatch[]
  entries: MatchCatalogEntry[]
  salonLocationId: string | null
  timeZone: string
}

function resolveEvent(
  event: NormalizedCalendarEvent,
  context: ImportContext,
  now: Date,
): {
  match: OfferingMatch | null
  client: ResolvedClient | null
  window: CalendarEventWindow
} & ReturnType<typeof classifyEvent> {
  const match = bestOfferingMatch(event.summary, context.offerings, context.entries)
  const client = resolveClientFromEvent(event)
  const window = resolveCalendarEventWindow({
    time: event.time,
    timeZone: context.timeZone,
  })
  return {
    match,
    client,
    window,
    ...classifyEvent({ window, match, client, now }),
  }
}

/**
 * Events beyond `MAX_IMPORT_EVENTS`, reported rather than dropped in silence.
 */
function boundEvents(
  professionalId: string,
  events: NormalizedCalendarEvent[],
): { events: NormalizedCalendarEvent[]; overflow: number } {
  if (events.length <= MAX_IMPORT_EVENTS) return { events, overflow: 0 }
  const overflow = events.length - MAX_IMPORT_EVENTS
  console.warn('calendarImport: feed exceeded the per-run event ceiling', {
    professionalId,
    received: events.length,
    imported: MAX_IMPORT_EVENTS,
    overflow,
  })
  return { events: events.slice(0, MAX_IMPORT_EVENTS), overflow }
}

export async function previewCalendarImport(args: {
  professionalId: string
  events: NormalizedCalendarEvent[]
  now: Date
}): Promise<CalendarImportPreview> {
  const context = await loadImportContext(args.professionalId)
  const { events, overflow } = boundEvents(args.professionalId, args.events)

  const rows: CalendarPreviewRow[] = events.map((event) => {
    const { match, client, window, classification, reason } = resolveEvent(
      event,
      context,
      args.now,
    )
    return {
      uid: event.uid,
      summary: event.summary,
      start: window.startUtc.toISOString(),
      end: window.endUtc ? window.endUtc.toISOString() : null,
      classification,
      matchedServiceId: match?.serviceId ?? null,
      matchedServiceName: match?.serviceName ?? null,
      clientName: client ? `${client.firstName} ${client.lastName}` : event.attendeeName,
      isRecurring: event.isRecurring,
      reason,
    }
  })

  const summary = {
    // `total` counts what the feed held, so an over-ceiling preview does not
    // claim the feed was smaller than it is; `skipped` carries the overflow.
    total: rows.length + overflow,
    bookings: rows.filter((r) => r.classification === 'BOOKING').length,
    blocks: rows.filter((r) => r.classification === 'BLOCK').length,
    history: rows.filter((r) => r.classification === 'HISTORY').length,
    skipped: rows.filter((r) => r.classification === 'SKIP').length + overflow,
  }

  return { rows, summary }
}

/**
 * The pro's offerings, their bookable salon location, and the timezone their
 * feed's unzoned stamps mean.
 *
 * Timezone precedence is the shared one (location → professional → fallback), so
 * this does not invent a fourth answer to "whose clock". The blocks an import
 * writes are global (`locationId: null` — the pro cannot be in two places at
 * once), so a multi-location pro's all-day events are read on their PRIMARY
 * bookable location's clock. The clock query is deliberately NOT the
 * salon/suite one below it: a mobile-only pro has no salon to book into but
 * still has a location whose timezone is better than a fallback. The `UTC`
 * fallback only bites a pro with no timezone anywhere, for whom no better answer
 * exists — and who cannot take a booking either, since the booking path refuses
 * without a valid one.
 */
async function loadImportContext(professionalId: string): Promise<ImportContext> {
  const [offerings, salonLocation, clockLocation, profile] = await Promise.all([
    loadOfferingMatches(professionalId),
    // Where an imported appointment can actually be booked.
    prisma.professionalLocation.findFirst({
      where: {
        professionalId,
        isBookable: true,
        type: { in: [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE] },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    // Whose clock the feed's unzoned stamps are on — any bookable location.
    prisma.professionalLocation.findFirst({
      where: { professionalId, isBookable: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { timeZone: true },
    }),
    prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { timeZone: true },
    }),
  ])

  const timeZoneResult = resolveApptTimeZoneFromValues({
    locationTimeZone: clockLocation?.timeZone,
    professionalTimeZone: profile?.timeZone,
    fallback: DEFAULT_TIME_ZONE,
  })

  return {
    offerings,
    entries: offerings.map((o) => ({ id: o.serviceId, name: o.serviceName })),
    salonLocationId: salonLocation?.id ?? null,
    timeZone: timeZoneResult.ok ? timeZoneResult.timeZone : DEFAULT_TIME_ZONE,
  }
}

/**
 * The block's note, which the pro calendar renders as its TITLE
 * (`app/api/v1/pro/calendar/route.ts`) — so it is user-facing copy and carries
 * no internal identifiers. The source UID lives in `importedEventUid`.
 */
function blockNote(args: {
  event: NormalizedCalendarEvent
  reason: string
  overlapsBooking: boolean
}): string {
  const who = args.event.attendeeName ? ` — ${args.event.attendeeName}` : ''
  const label = args.event.summary || 'Imported appointment'
  // The one thing the pro must act on, said plainly, and only when true.
  const overlap = args.overlapsBooking
    ? ' Overlaps an existing appointment.'
    : ''
  return `${label}${who} (${args.reason})${overlap}`.slice(
    0,
    MAX_BLOCK_NOTE_LENGTH,
  )
}

/**
 * Plain pro-facing copy for a feed event that could not become a clean booking.
 *
 * The codes are internal and this string is a calendar title, so it is mapped
 * rather than interpolated. An unrecognised code falls through to the generic
 * line instead of leaking itself — which is what the previous
 * `imported appointment needs review (${code})` did.
 *
 * `TIME_BOOKED` is the code an overlap actually arrives as:
 * `mapBookingOverlapBlockedCodeToBookingError` folds the overlap policy's
 * `IMPORT_OVERLAP_NOT_ALLOWED` into it (writeBoundary.ts:5139). The policy code
 * is listed too — it is unreachable today, and cheap insurance if that fold is
 * ever split ([[one-code-two-meanings-add-a-code]]).
 */
function bookingFallbackReason(code: string): string {
  switch (code) {
    case 'TIME_BOOKED':
    case 'IMPORT_OVERLAP_NOT_ALLOWED':
      return 'imported over an existing appointment — needs review'
    case 'TIME_BLOCKED':
      return 'this time was already blocked — needs review'
    case 'TIME_HELD':
      return 'this time was being booked — needs review'
    case 'STEP_MISMATCH':
    case 'TIME_NOT_AVAILABLE':
      return "doesn't fit your appointment times — needs review"
    case 'TIME_IN_PAST':
      // An event already under way. Its remaining time is still held.
      return 'already started — needs review'
    default:
      return 'imported appointment — needs review'
  }
}

/**
 * Hold an imported event's time as a block, once per source event.
 *
 * Runs under the professional's schedule lock, like every other block writer
 * (`POST`/`PATCH /pro/calendar/blocked`) — without it the existence check, the
 * conflict read and the write are three separate moments, and a booking
 * committing between them is invisible to all three.
 *
 * Unlike those routes it does NOT refuse a conflict. That is deliberate and is
 * the product's decision (Tori, 2026-07-25), and it is what `overlapPolicy.ts`
 * already promises the pro when it turns an import's booking away: "the imported
 * appointment was held as blocked time for you to review". Dropping the block
 * would drop the only trace of the disagreement between the two calendars. So
 * the conflict read here informs the NOTE instead of the outcome — which is also
 * why it is the read every other writer runs rather than a private one.
 */
async function createBlockIfAbsent(args: {
  professionalId: string
  event: NormalizedCalendarEvent
  window: CalendarEventWindow
  reason: string
}): Promise<'created' | 'skipped'> {
  const startsAt = args.window.startUtc
  const endsAt =
    args.window.endUtc ??
    new Date(startsAt.getTime() + DEFAULT_BLOCK_MINUTES * MINUTE_MS)

  if (endsAt.getTime() - startsAt.getTime() > MAX_IMPORTED_BLOCK_DAYS * DAY_MS) {
    console.warn('calendarImport: refusing to hold an implausibly long event', {
      professionalId: args.professionalId,
      uid: args.event.uid,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      maxDays: MAX_IMPORTED_BLOCK_DAYS,
    })
    return 'skipped'
  }

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }): Promise<'created' | 'skipped'> => {
      const existing = await tx.calendarBlock.findFirst({
        where: {
          professionalId: args.professionalId,
          importedEventUid: args.event.uid,
        },
        select: { id: true },
      })
      if (existing) return 'skipped'

      // `locationId: null` — the import holds the pro's own time, and they cannot
      // be in two places at once, so the block applies at every location. A null
      // locationId also widens the conflict read to every location, which is the
      // truthful question here.
      const conflict = await getTimeRangeConflict({
        tx,
        professionalId: args.professionalId,
        locationId: null,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        // Buffer excluded: this asks whether the APPOINTMENT windows overlap, the
        // same question B8's stranded-bookings scan asks. Counting turnaround
        // time would report an overlap the pro can see is not one.
        defaultBufferMinutes: 0,
      })

      if (conflict) {
        logBookingConflict({
          action: 'BLOCK_CREATE',
          professionalId: args.professionalId,
          locationId: null,
          requestedStart: startsAt,
          requestedEnd: endsAt,
          conflictType: conflict,
          note: 'calendar import held the time anyway (deliberate)',
          meta: { uid: args.event.uid },
        })
      }

      try {
        await tx.calendarBlock.create({
          data: {
            professionalId: args.professionalId,
            startsAt,
            endsAt,
            note: blockNote({
              event: args.event,
              reason: args.reason,
              overlapsBooking: conflict === 'BOOKING',
            }),
            importedEventUid: args.event.uid,
          },
        })
      } catch (error: unknown) {
        // Two runs of the same feed racing (an interactive commit while the
        // resync cron walks it). The unique index is the backstop the note-tag
        // `contains` check never was.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return 'skipped'
        }
        throw error
      }
      return 'created'
    },
  )
}

export async function commitCalendarImport(args: {
  professionalId: string
  actorUserId: string
  events: NormalizedCalendarEvent[]
  excludeUids?: string[]
  now: Date
}): Promise<CalendarCommitResult> {
  const context = await loadImportContext(args.professionalId)
  const salonLocationId = context.salonLocationId
  const excluded = new Set(args.excludeUids ?? [])
  const bounded = boundEvents(args.professionalId, args.events)

  const created = { bookings: 0, blocks: 0, history: 0 }
  let skipped = bounded.overflow
  let failed = 0

  for (const event of bounded.events) {
    if (excluded.has(event.uid)) {
      skipped += 1
      continue
    }

    const { match, client, window, classification, reason } = resolveEvent(
      event,
      context,
      args.now,
    )

    try {
      if (classification === 'SKIP') {
        skipped += 1
        continue
      }

      if (classification === 'HISTORY' && client) {
        const result = await upsertProClient({
          professionalId: args.professionalId,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
        })
        if (result.ok) created.history += 1
        else failed += 1
        continue
      }

      // A salon booking needs a bookable salon location; without one, hold the
      // time as a block instead of failing.
      if (classification === 'BOOKING' && match && client && salonLocationId) {
        const clientResult = await upsertProClient({
          professionalId: args.professionalId,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
        })
        if (!clientResult.ok) {
          failed += 1
          continue
        }

        try {
          const bookingResult = await createProBooking({
            professionalId: args.professionalId,
            actorUserId: args.actorUserId,
            overrideReason: null,
            clientId: clientResult.clientId,
            offeringId: match.offeringId,
            locationId: salonLocationId,
            locationType: ServiceLocationType.SALON,
            scheduledFor: window.startUtc,
            clientAddressId: null,
            internalNotes: null,
            requestedBufferMinutes: null,
            requestedTotalDurationMinutes: null,
            // A migrating pro hasn't necessarily configured working hours yet;
            // honor their real calendar. Pros self-authorize these two overrides.
            allowOutsideWorkingHours: true,
            allowShortNotice: true,
            allowFarFuture: false,
            // Also refuses to overlap an existing booking/hold: an unattended
            // import must not inherit the pro's authority to double-book, so a
            // collision throws TIME_BOOKED and lands in the block fallback
            // below (see decideBookingOverlapPermission's CALENDAR_IMPORT
            // branch). Replays are unaffected — the idempotency short-circuit
            // in performLockedCreateProBooking runs before any schedule check,
            // so re-importing an already-imported UID never re-evaluates it.
            importMode: true,
            idempotencyKey: importKey(args.professionalId, event.uid),
          })
          // "Succeeded" is not "created". A re-import of an already-imported UID
          // short-circuits on the idempotency key and writes nothing, and the
          // resync re-walks the whole feed hourly — so counting every success as
          // a creation made `lastSyncCounts` report the same appointment as newly
          // imported, forever. The blocks below already report `skipped`; this is
          // the same distinction on the booking half.
          if (bookingResult.meta.mutated) created.bookings += 1
          else skipped += 1
          continue
        } catch (bookingError: unknown) {
          // The appointment couldn't become a clean booking — its start time
          // doesn't sit on the pro's slot grid (STEP_MISMATCH), it collides with
          // an existing booking/hold (TIME_BOOKED), or the pro has already
          // blocked that time (TIME_BLOCKED). Never drop it: hold the time as a
          // block so the pro sees + can fix it, rather than losing the slot.
          const code =
            bookingError && typeof bookingError === 'object' && 'code' in bookingError
              ? String((bookingError as { code: unknown }).code)
              : 'UNKNOWN'
          const outcome = await createBlockIfAbsent({
            professionalId: args.professionalId,
            event,
            window,
            reason: bookingFallbackReason(code),
          })
          if (outcome === 'created') created.blocks += 1
          else skipped += 1
          continue
        }
      }

      // Everything else (unmapped, mobile-only, no client, or no salon
      // location) holds the time as a block.
      const outcome = await createBlockIfAbsent({
        professionalId: args.professionalId,
        event,
        window,
        reason,
      })
      if (outcome === 'created') created.blocks += 1
      else skipped += 1
    } catch (error: unknown) {
      failed += 1
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : undefined
      console.error('commitCalendarImport: failed to import event', {
        uid: event.uid,
        classification,
        code,
        error: safeError(error),
      })
    }
  }

  // Imported BOOKINGS bump inside the write boundary, but imported BLOCKS are
  // written here, so a block-only import (every event unmapped or mobile-only)
  // would leave cached availability offering time the import just took. One
  // bump per run, after every write — not one per event.
  if (created.blocks > 0) {
    await bumpScheduleVersion(args.professionalId)
  }

  return { created, skipped, failed }
}

export type CalendarReconcileResult = {
  cancelledBookings: number
  deletedBlocks: number
}

// Reconcile feed deletions during resync: for events that were imported before
// but have now disappeared from the feed (the pro deleted them in their old
// app), delete the held block and cancel the imported booking — but ONLY if the
// booking is still pristine (untouched since import: ACCEPTED, never started,
// still source=IMPORTED). A booking the pro has engaged with is left alone, and
// client history is never removed.
export async function reconcileRemovedImportedEvents(args: {
  professionalId: string
  removedUids: string[]
}): Promise<CalendarReconcileResult> {
  let cancelledBookings = 0
  let deletedBlocks = 0

  for (const uid of args.removedUids) {
    // Cancellation goes through the booking write boundary (lifecycle writes are
    // owned there); it only cancels a still-pristine imported booking.
    cancelledBookings += await cancelImportedBookingIfPristine({
      professionalId: args.professionalId,
      idempotencyKey: importKey(args.professionalId, uid),
    })

    // Matched on the dedicated column, not on the note: a pro who renamed the
    // block used to orphan it from its source event, so the removal could never
    // find it again and the next resync added a second copy.
    const deleted = await prisma.calendarBlock.deleteMany({
      where: {
        professionalId: args.professionalId,
        importedEventUid: uid,
      },
    })
    deletedBlocks += deleted.count
  }

  // Deleting the held blocks RELEASES that time. `cancelImportedBookingIfPristine`
  // bumps for the bookings it cancels, but a resync that only removed blocks
  // would leave the freed slots hidden until the day cache expires.
  if (deletedBlocks > 0) {
    await bumpScheduleVersion(args.professionalId)
  }

  return { cancelledBookings, deletedBlocks }
}

// ── request parsing (shared by the preview + commit routes; no casts) ─────────

export type CalendarImportRequest = {
  icsText: string
  excludeUids: string[]
}

export function parseCalendarImportRequest(body: unknown): CalendarImportRequest | null {
  if (!isRecord(body)) return null
  const icsText = typeof body.ics === 'string' ? body.ics : ''
  if (!icsText.trim()) return null
  const excludeUids = Array.isArray(body.excludeUids)
    ? body.excludeUids.filter((v): v is string => typeof v === 'string')
    : []
  return { icsText, excludeUids }
}
