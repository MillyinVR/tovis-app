// Shared data layer for the pro bookings list — the single source of truth for
// BOTH the server-rendered web page (app/pro/bookings/page.tsx) and the native
// read API (GET /api/v1/pro/bookings). Keeping the Prisma select, the
// today/upcoming/past/cancelled bucketing, the at-a-glance stats and the
// per-row derivations (add-on names, total, needs-closeout) here means the two
// surfaces never drift (CLAUDE.md: no duplicate logic).
import {
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import {
  resolveBookingLocationMeta,
  type BookingLocationMeta,
} from '@/lib/booking/locationMeta'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  getZonedParts,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import { isCloseoutPaymentAndAftercareComplete } from '@/lib/booking/closeoutState'
import { labelForBookingStatus } from '@/lib/booking/statusLabel'

export type BookingsListStatusFilter =
  | 'ALL'
  | 'PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'

const BOOKING_STATUS = {
  PENDING: BookingStatus.PENDING,
  ACCEPTED: BookingStatus.ACCEPTED,
  IN_PROGRESS: BookingStatus.IN_PROGRESS,
  COMPLETED: BookingStatus.COMPLETED,
  CANCELLED: BookingStatus.CANCELLED,
} as const satisfies Record<Exclude<BookingsListStatusFilter, 'ALL'>, BookingStatus>

export function normalizeBookingsStatusFilter(
  raw: unknown,
): BookingsListStatusFilter {
  const s = String(raw || '').toUpperCase().trim()
  if (
    s === 'PENDING' ||
    s === 'ACCEPTED' ||
    s === 'IN_PROGRESS' ||
    s === 'COMPLETED' ||
    s === 'CANCELLED'
  ) {
    return s
  }
  return 'ALL'
}

export const bookingsListSelect = {
  id: true,
  status: true,
  sessionStep: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  locationTimeZone: true,

  checkoutStatus: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      sentToClientAt: true,
    },
  },

  locationType: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  clientAddressSnapshot: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,

  totalDurationMinutes: true,
  subtotalSnapshot: true,
  totalAmount: true,
  discountAmount: true,
  taxAmount: true,
  tipAmount: true,

  service: {
    select: {
      name: true,
    },
  },

  serviceItems: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      itemType: true,
      sortOrder: true,
      service: { select: { name: true } },
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      parentItemId: true,
    },
    take: 50,
  },

  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      user: { select: { email: true } },
    },
  },
} satisfies Prisma.BookingSelect

export type BookingsListRow = Prisma.BookingGetPayload<{
  select: typeof bookingsListSelect
}>

// --- derivations shared by the page JSX and the API serializer ----------------

function durationMinutes(totalDurationMinutes: unknown): number {
  const n = Number(totalDurationMinutes ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0))
}

export function getBaseAndAddOnNames(booking: BookingsListRow): {
  baseName: string
  addOnNames: string[]
} {
  const items = Array.isArray(booking.serviceItems) ? booking.serviceItems : []

  const baseItem =
    items.find((item) => item.itemType === BookingServiceItemType.BASE) ??
    items[0] ??
    null

  const addOnItems = items.filter(
    (item) => item.itemType === BookingServiceItemType.ADD_ON,
  )

  const baseName = baseItem?.service?.name ?? booking.service?.name ?? 'Service'
  const addOnNames = addOnItems
    .map((item) => item.service?.name ?? '')
    .map((name) => name.trim())
    .filter(Boolean)

  return { baseName, addOnNames }
}

/**
 * The booking's displayed total. Prefers the explicit `totalAmount`; otherwise
 * subtotal (or summed item prices) minus discount, plus tax and tip — the same
 * math the web `PriceBlock` renders. Returns null when nothing can be computed.
 */
export function computeBookingTotal(
  booking: BookingsListRow,
): Prisma.Decimal | null {
  if (booking.totalAmount != null) return booking.totalAmount

  const items = Array.isArray(booking.serviceItems) ? booking.serviceItems : []
  const subtotal =
    booking.subtotalSnapshot ??
    (items.length ? sumDecimal(items.map((item) => item.priceSnapshot)) : null)

  if (subtotal == null) return null

  const zero = new Prisma.Decimal(0)
  return subtotal
    .minus(booking.discountAmount ?? zero)
    .plus(booking.taxAmount ?? zero)
    .plus(booking.tipAmount ?? zero)
}

/**
 * A booking "needs closeout" when the pro has sent aftercare (so it drops out
 * of the active-session footer) but payment + checkout aren't finished yet — the
 * warn-styled "Payment due" surface. Mirrors the web page exactly.
 */
export function needsCloseout(booking: BookingsListRow): boolean {
  if (
    booking.status !== BookingStatus.ACCEPTED &&
    booking.status !== BookingStatus.IN_PROGRESS
  ) {
    return false
  }
  if (booking.finishedAt) return false

  const aftercareSentAt = booking.aftercareSummary?.sentToClientAt ?? null
  if (!aftercareSentAt) return false

  return !isCloseoutPaymentAndAftercareComplete({
    aftercareSentAt,
    checkoutStatus: booking.checkoutStatus,
    paymentCollectedAt: booking.paymentCollectedAt,
  })
}

export function computeTodayTomorrowBoundsUtc(
  nowUtc: Date,
  scheduleTz: string,
): { startOfTodayUtc: Date; startOfTomorrowUtc: Date } {
  const tz = sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
  const parts = getZonedParts(nowUtc, tz)

  const startOfTodayUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const startOfTomorrowUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { startOfTodayUtc, startOfTomorrowUtc }
}

// --- query + bucketing (shared by page and API) -------------------------------

export type ProBookingsBuckets = {
  today: BookingsListRow[]
  upcoming: BookingsListRow[]
  past: BookingsListRow[]
  cancelled: BookingsListRow[]
  stats: { today: number; inSession: number; paymentDue: number }
}

/**
 * Loads the bucketed bookings + stats for a pro, honoring the status filter.
 * Buckets are computed in the pro's schedule timezone. The web page renders
 * these raw rows; the API serializes them (below).
 */
export async function loadProBookingsBuckets(args: {
  professionalId: string
  scheduleTz: string
  statusFilter: BookingsListStatusFilter
  nowUtc?: Date
}): Promise<ProBookingsBuckets> {
  const { professionalId, scheduleTz, statusFilter } = args
  const nowUtc = args.nowUtc ?? new Date()

  const { startOfTodayUtc, startOfTomorrowUtc } = computeTodayTomorrowBoundsUtc(
    nowUtc,
    scheduleTz,
  )

  const nonCancelledStatusWhere:
    | { status: { not: BookingStatus } }
    | { status: BookingStatus }
    | null =
    statusFilter === 'ALL'
      ? { status: { not: BOOKING_STATUS.CANCELLED } }
      : statusFilter === 'CANCELLED'
        ? null
        : { status: statusFilter }

  const activeBucketsPromise: Promise<
    [BookingsListRow[], BookingsListRow[], BookingsListRow[]]
  > =
    nonCancelledStatusWhere == null
      ? Promise.resolve([[], [], []])
      : Promise.all([
          prisma.booking.findMany({
            where: {
              professionalId,
              ...nonCancelledStatusWhere,
              scheduledFor: { gte: startOfTodayUtc, lt: startOfTomorrowUtc },
            },
            orderBy: { scheduledFor: 'asc' },
            select: bookingsListSelect,
          }),
          prisma.booking.findMany({
            where: {
              professionalId,
              ...nonCancelledStatusWhere,
              scheduledFor: { gte: startOfTomorrowUtc },
            },
            orderBy: { scheduledFor: 'asc' },
            select: bookingsListSelect,
          }),
          prisma.booking.findMany({
            where: {
              professionalId,
              ...nonCancelledStatusWhere,
              scheduledFor: { lt: startOfTodayUtc },
            },
            orderBy: { scheduledFor: 'desc' },
            select: bookingsListSelect,
          }),
        ])

  const cancelledPromise: Promise<BookingsListRow[]> =
    statusFilter === 'ALL' || statusFilter === 'CANCELLED'
      ? prisma.booking.findMany({
          where: { professionalId, status: BOOKING_STATUS.CANCELLED },
          orderBy: { scheduledFor: 'desc' },
          select: bookingsListSelect,
        })
      : Promise.resolve([])

  const [[today, upcoming, past], cancelled] = await Promise.all([
    activeBucketsPromise,
    cancelledPromise,
  ])

  const active = [...today, ...upcoming, ...past]

  return {
    today,
    upcoming,
    past,
    cancelled,
    stats: {
      today: today.length,
      inSession: active.filter((b) => b.status === BookingStatus.IN_PROGRESS)
        .length,
      paymentDue: active.filter((b) => needsCloseout(b)).length,
    },
  }
}

// --- API serialization --------------------------------------------------------

export type ProBookingListItemDTO = {
  id: string
  status: BookingStatus
  statusLabel: string
  sessionStep: SessionStep | null
  scheduledFor: string
  timeZone: string
  whenLabel: string
  serviceName: string
  addOnNames: string[]
  durationMinutes: number
  total: string | null
  client: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
    canViewClient: boolean
  }
  location: BookingLocationMeta
  needsCloseout: boolean
  startedAt: string | null
  finishedAt: string | null
}

export type ProBookingsListResponse = {
  scheduleTimeZone: string
  statusFilter: BookingsListStatusFilter
  stats: { today: number; inSession: number; paymentDue: number }
  today: ProBookingListItemDTO[]
  upcoming: ProBookingListItemDTO[]
  past: ProBookingListItemDTO[]
  cancelled: ProBookingListItemDTO[]
}

export function serializeBookingsListRow(
  booking: BookingsListRow,
  args: { scheduleTz: string; visibleClientIdSet: ReadonlySet<string> },
): ProBookingListItemDTO {
  const tz = resolveAppointmentDisplayTimeZone(
    booking.locationTimeZone,
    args.scheduleTz,
  )
  const safeTz = isValidIanaTimeZone(tz) ? tz : DEFAULT_TIME_ZONE
  const { baseName, addOnNames } = getBaseAndAddOnNames(booking)
  const total = computeBookingTotal(booking)
  const fullName = `${booking.client.firstName ?? ''} ${
    booking.client.lastName ?? ''
  }`.trim()

  return {
    id: booking.id,
    status: booking.status,
    statusLabel: labelForBookingStatus(String(booking.status)),
    sessionStep: booking.sessionStep ?? null,
    scheduledFor: booking.scheduledFor.toISOString(),
    timeZone: safeTz,
    whenLabel: formatAppointmentWhen(booking.scheduledFor, safeTz),
    serviceName: baseName,
    addOnNames,
    durationMinutes: durationMinutes(booking.totalDurationMinutes),
    total: total != null ? moneyToString(total) : null,
    client: {
      id: booking.client.id,
      fullName: fullName || 'Client',
      email: booking.client.user?.email ?? null,
      phone: booking.client.phone ?? null,
      canViewClient: args.visibleClientIdSet.has(String(booking.client.id)),
    },
    location: resolveBookingLocationMeta(booking),
    needsCloseout: needsCloseout(booking),
    startedAt: booking.startedAt ? booking.startedAt.toISOString() : null,
    finishedAt: booking.finishedAt ? booking.finishedAt.toISOString() : null,
  }
}
