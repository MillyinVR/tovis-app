// lib/messages/inboxContext.ts
//
// Single source of truth for the inbox thread list's *context* concerns — the
// filter tabs (All / Bookings / Waitlists / Pros) and the per-row "eyebrow"
// (booking time · waitlist status · service name). Shared by the SSR inbox
// page (app/messages/page.tsx) and the JSON list route
// (app/api/v1/messages/threads/route.ts, which iOS consumes) so the two never
// drift and the eyebrow copy is computed exactly once, server-side. The clients
// just render the resolved `eyebrow` string.

import {
  MessageThreadContextType,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
  type Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { formatInTimeZone } from '@/lib/time'
import { labelForWaitlistStatus } from '@/lib/waitlist/statusLabel'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'

export type InboxFilter = 'all' | 'bookings' | 'waitlists' | 'pros'

/**
 * How many inbox threads a single page returns. Shared by the SSR inbox
 * (app/messages/page.tsx) and the JSON list route
 * (app/api/v1/messages/threads/route.ts) so both surface the exact same set —
 * 50 is the API's paged contract; the SSR page matches it rather than diverge.
 */
export const INBOX_THREADS_PAGE_SIZE = 50

/** Whether a context type gets the accent-tinted eyebrow (actionable threads). */
const ACCENT_CONTEXT_TYPES: ReadonlySet<MessageThreadContextType> = new Set([
  MessageThreadContextType.BOOKING,
  MessageThreadContextType.OFFERING,
  MessageThreadContextType.WAITLIST,
])

export function isAccentContextType(contextType: MessageThreadContextType): boolean {
  return ACCENT_CONTEXT_TYPES.has(contextType)
}

/** Parse an untrusted `filter` value (query param / search param) to a tab. */
export function parseInboxFilter(raw: string | null | undefined): InboxFilter {
  const value = (raw ?? '').trim().toLowerCase()

  if (value === 'bookings') return 'bookings'
  if (value === 'waitlists') return 'waitlists'
  if (value === 'pros') return 'pros'

  return 'all'
}

/** Prisma `where` for the viewer's threads under the active filter tab. */
export function whereForInboxFilter(params: {
  userId: string
  filter: InboxFilter
}): Prisma.MessageThreadWhereInput {
  const { userId, filter } = params

  const where: Prisma.MessageThreadWhereInput = {
    participants: { some: { userId } },
    lastMessageAt: { not: null },
  }

  if (filter === 'bookings') {
    where.contextType = MessageThreadContextType.BOOKING
  }

  if (filter === 'waitlists') {
    where.contextType = MessageThreadContextType.WAITLIST
  }

  if (filter === 'pros') {
    where.contextType = {
      in: [
        MessageThreadContextType.PRO_PROFILE,
        MessageThreadContextType.SERVICE,
        MessageThreadContextType.OFFERING,
      ],
    }
  }

  return where
}

// The minimal context-id-bearing shape each thread must provide to resolve an
// eyebrow. Both callers already select these columns.
export type InboxEyebrowThread = {
  id: string
  contextType: MessageThreadContextType
  bookingId: string | null
  serviceId: string | null
  offeringId: string | null
  waitlistEntryId: string | null
}

export type InboxEyebrow = {
  /** Human context label, e.g. "BOOKING CONFIRMED — Balayage — Fri 2:00 PM". */
  eyebrow: string
  /** Whether the eyebrow should render in the accent tone (actionable context). */
  isAccentContext: boolean
}

type BookingLookup = {
  id: string
  scheduledFor: Date | null
  locationTimeZone: string | null
  service: { name: string | null } | null
}

type ServiceLookup = {
  id: string
  name: string | null
}

type OfferingLookup = {
  id: string
  title: string | null
  service: { name: string | null } | null
}

type WaitlistLookup = {
  id: string
  status: WaitlistStatus
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
  service: { name: string | null } | null
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function mapById<TItem extends { id: string }>(items: TItem[]): Map<string, TItem> {
  const map = new Map<string, TItem>()
  for (const item of items) map.set(item.id, item)
  return map
}

function formatBookingTime(
  date: Date | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  if (!date) return null

  // Snapshot timezone first; formatInTimeZone sanitizes null/invalid to UTC.
  return formatInTimeZone(date, timeZone ?? 'UTC', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildEyebrow(params: {
  thread: InboxEyebrowThread
  bookingMap: Map<string, BookingLookup>
  serviceMap: Map<string, ServiceLookup>
  offeringMap: Map<string, OfferingLookup>
  waitlistMap: Map<string, WaitlistLookup>
}): string {
  const { thread, bookingMap, serviceMap, offeringMap, waitlistMap } = params

  if (thread.contextType === MessageThreadContextType.BOOKING) {
    const booking = thread.bookingId ? bookingMap.get(thread.bookingId) ?? null : null
    const serviceName = booking?.service?.name ?? null
    const when = formatBookingTime(booking?.scheduledFor, booking?.locationTimeZone)

    return ['BOOKING CONFIRMED', serviceName, when].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.WAITLIST) {
    const waitlist = thread.waitlistEntryId
      ? waitlistMap.get(thread.waitlistEntryId) ?? null
      : null

    if (!waitlist) return 'Waitlist'

    const serviceName = waitlist.service?.name ?? null
    const status = labelForWaitlistStatus(waitlist.status)
    const preference = formatWaitlistPreferenceLabel(waitlist)

    return ['Waitlist', status, serviceName, preference].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.OFFERING) {
    const offering = thread.offeringId ? offeringMap.get(thread.offeringId) ?? null : null
    const name = offering?.title ?? offering?.service?.name ?? null

    return ['Service', name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.SERVICE) {
    const service = thread.serviceId ? serviceMap.get(thread.serviceId) ?? null : null

    return ['Service', service?.name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.PRO_PROFILE) {
    return 'Pro'
  }

  return 'Message'
}

/**
 * Batch-resolve the context eyebrow for a list of threads in one round of
 * lookups (booking · service · offering · waitlist), keyed by thread id. Threads
 * that share a context row share a lookup, and empty id sets skip their query.
 */
export async function resolveInboxEyebrows(
  threads: InboxEyebrowThread[],
): Promise<Map<string, InboxEyebrow>> {
  const bookingIds = threads.map((t) => t.bookingId).filter(isPresentString)
  const serviceIds = threads.map((t) => t.serviceId).filter(isPresentString)
  const offeringIds = threads.map((t) => t.offeringId).filter(isPresentString)
  const waitlistEntryIds = threads.map((t) => t.waitlistEntryId).filter(isPresentString)

  const [bookingRows, serviceRows, offeringRows, waitlistRows] = await Promise.all([
    bookingIds.length === 0
      ? Promise.resolve<BookingLookup[]>([])
      : prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: {
            id: true,
            scheduledFor: true,
            locationTimeZone: true,
            service: { select: { name: true } },
          },
        }),
    serviceIds.length === 0
      ? Promise.resolve<ServiceLookup[]>([])
      : prisma.service.findMany({
          where: { id: { in: serviceIds } },
          select: { id: true, name: true },
        }),
    offeringIds.length === 0
      ? Promise.resolve<OfferingLookup[]>([])
      : prisma.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: { id: true, title: true, service: { select: { name: true } } },
        }),
    waitlistEntryIds.length === 0
      ? Promise.resolve<WaitlistLookup[]>([])
      : prisma.waitlistEntry.findMany({
          where: { id: { in: waitlistEntryIds } },
          select: {
            id: true,
            status: true,
            preferenceType: true,
            specificDate: true,
            timeOfDay: true,
            windowStartMin: true,
            windowEndMin: true,
            service: { select: { name: true } },
          },
        }),
  ])

  const bookingMap = mapById(bookingRows)
  const serviceMap = mapById(serviceRows)
  const offeringMap = mapById(offeringRows)
  const waitlistMap = mapById(waitlistRows)

  const result = new Map<string, InboxEyebrow>()

  for (const thread of threads) {
    result.set(thread.id, {
      eyebrow: buildEyebrow({ thread, bookingMap, serviceMap, offeringMap, waitlistMap }),
      isAccentContext: isAccentContextType(thread.contextType),
    })
  }

  return result
}

/**
 * Single-thread variant of resolveInboxEyebrows. The SSR thread page
 * (app/messages/thread/[id]/page.tsx) uses this so its header eyebrow is
 * computed by the exact same logic as the inbox rows — the two can never drift.
 * Thin wrapper: one thread, one round of lookups.
 */
export async function resolveInboxEyebrow(
  thread: InboxEyebrowThread,
): Promise<InboxEyebrow> {
  const byId = await resolveInboxEyebrows([thread])
  return byId.get(thread.id) ?? { eyebrow: 'Message', isAccentContext: false }
}
