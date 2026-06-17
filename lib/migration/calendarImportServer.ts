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

import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

import { createProBooking } from '@/lib/booking/writeBoundary'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import type { NormalizedCalendarEvent } from './calendarImport'
import { isConfident, suggestServices, type MatchCatalogEntry } from './serviceMatch'

const DEFAULT_BLOCK_MINUTES = 60
const IMPORT_IDEMPOTENCY_PREFIX = 'import:'

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
  event: NormalizedCalendarEvent
  match: OfferingMatch | null
  client: ResolvedClient | null
  now: Date
}): { classification: CalendarEventClassification; reason: string } {
  const { event, match, client, now } = args
  const isPast = event.start.getTime() < now.getTime()

  if (isPast) {
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

function resolveEvent(
  event: NormalizedCalendarEvent,
  offerings: OfferingMatch[],
  entries: MatchCatalogEntry[],
  now: Date,
): { match: OfferingMatch | null; client: ResolvedClient | null } & ReturnType<typeof classifyEvent> {
  const match = bestOfferingMatch(event.summary, offerings, entries)
  const client = resolveClientFromEvent(event)
  return { match, client, ...classifyEvent({ event, match, client, now }) }
}

export async function previewCalendarImport(args: {
  professionalId: string
  events: NormalizedCalendarEvent[]
  now: Date
}): Promise<CalendarImportPreview> {
  const offerings = await loadOfferingMatches(args.professionalId)
  const entries: MatchCatalogEntry[] = offerings.map((o) => ({
    id: o.serviceId,
    name: o.serviceName,
  }))

  const rows: CalendarPreviewRow[] = args.events.map((event) => {
    const { match, client, classification, reason } = resolveEvent(
      event,
      offerings,
      entries,
      args.now,
    )
    return {
      uid: event.uid,
      summary: event.summary,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
      classification,
      matchedServiceId: match?.serviceId ?? null,
      matchedServiceName: match?.serviceName ?? null,
      clientName: client ? `${client.firstName} ${client.lastName}` : event.attendeeName,
      isRecurring: event.isRecurring,
      reason,
    }
  })

  const summary = {
    total: rows.length,
    bookings: rows.filter((r) => r.classification === 'BOOKING').length,
    blocks: rows.filter((r) => r.classification === 'BLOCK').length,
    history: rows.filter((r) => r.classification === 'HISTORY').length,
    skipped: rows.filter((r) => r.classification === 'SKIP').length,
  }

  return { rows, summary }
}

async function findBookableSalonLocationId(professionalId: string): Promise<string | null> {
  const location = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE] },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  return location?.id ?? null
}

function blockNote(event: NormalizedCalendarEvent, reason: string): string {
  // Embed the UID so re-running the import dedupes blocks on the source event.
  const who = event.attendeeName ? ` — ${event.attendeeName}` : ''
  const label = event.summary || 'Imported appointment'
  return `${label}${who} [${IMPORT_IDEMPOTENCY_PREFIX}${event.uid}] (${reason})`
}

async function createBlockIfAbsent(args: {
  professionalId: string
  event: NormalizedCalendarEvent
  reason: string
}): Promise<'created' | 'skipped'> {
  const tag = `${IMPORT_IDEMPOTENCY_PREFIX}${args.event.uid}`
  const existing = await prisma.calendarBlock.findFirst({
    where: { professionalId: args.professionalId, note: { contains: tag } },
    select: { id: true },
  })
  if (existing) return 'skipped'

  const startsAt = args.event.start
  const endsAt =
    args.event.end && args.event.end.getTime() > startsAt.getTime()
      ? args.event.end
      : new Date(startsAt.getTime() + DEFAULT_BLOCK_MINUTES * 60_000)

  await prisma.calendarBlock.create({
    data: {
      professionalId: args.professionalId,
      startsAt,
      endsAt,
      note: blockNote(args.event, args.reason),
    },
  })
  return 'created'
}

export async function commitCalendarImport(args: {
  professionalId: string
  actorUserId: string
  events: NormalizedCalendarEvent[]
  excludeUids?: string[]
  now: Date
}): Promise<CalendarCommitResult> {
  const offerings = await loadOfferingMatches(args.professionalId)
  const entries: MatchCatalogEntry[] = offerings.map((o) => ({
    id: o.serviceId,
    name: o.serviceName,
  }))
  const salonLocationId = await findBookableSalonLocationId(args.professionalId)
  const excluded = new Set(args.excludeUids ?? [])

  const created = { bookings: 0, blocks: 0, history: 0 }
  let skipped = 0
  let failed = 0

  for (const event of args.events) {
    if (excluded.has(event.uid)) {
      skipped += 1
      continue
    }

    const { match, client, classification, reason } = resolveEvent(
      event,
      offerings,
      entries,
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

        await createProBooking({
          professionalId: args.professionalId,
          actorUserId: args.actorUserId,
          overrideReason: null,
          clientId: clientResult.clientId,
          offeringId: match.offeringId,
          locationId: salonLocationId,
          locationType: ServiceLocationType.SALON,
          scheduledFor: event.start,
          clientAddressId: null,
          internalNotes: null,
          requestedBufferMinutes: null,
          requestedTotalDurationMinutes: null,
          // A migrating pro hasn't necessarily configured working hours yet;
          // honor their real calendar. Pros self-authorize these two overrides.
          allowOutsideWorkingHours: true,
          allowShortNotice: true,
          allowFarFuture: false,
          importMode: true,
          idempotencyKey: `${IMPORT_IDEMPOTENCY_PREFIX}${event.uid}`,
        })
        created.bookings += 1
        continue
      }

      // Everything else (unmapped, mobile-only, no client, or no salon
      // location) holds the time as a block.
      const outcome = await createBlockIfAbsent({
        professionalId: args.professionalId,
        event,
        reason,
      })
      if (outcome === 'created') created.blocks += 1
      else skipped += 1
    } catch (error: unknown) {
      failed += 1
      console.error('commitCalendarImport: failed to import event', {
        uid: event.uid,
        classification,
        error: safeError(error),
      })
    }
  }

  return { created, skipped, failed }
}

// ── request parsing (shared by the preview + commit routes; no casts) ─────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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
