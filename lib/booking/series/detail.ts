// lib/booking/series/detail.ts
//
// K19 (Phase 8) — read one recurring appointment back.
//
// K18 shipped a create route whose response is WRITE-ONLY: it describes what one
// call did and is gone the moment the pro navigates away. Everything the pro
// needs afterwards — which dates are still booked, which were skipped and why,
// what a scoped cancel would touch — had no reader at all. This is it, and it is
// the ONE loader behind both the RSC page and its API twin (the pro-facing read
// pattern), so the page and the wire cannot drift.
//
// 🔴 The skips are loaded from `BookingSeriesException`, not from a remembered
// response body. The exception rows are the durable form of the create
// response's `skipped[]` — same rows, still there tomorrow — which is what makes
// "you got eleven, not twelve" a fact about the series rather than a message the
// pro had one chance to read ([[an-always-empty-key-looks-like-an-export]]).

import { BookingSeriesStatus, Prisma, ServiceLocationType } from '@prisma/client'

import { resolveBookingAddOns } from '@/lib/booking/addOnResolution'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { SERIES_ROLL_FORWARD_LEAD_DAYS } from '@/lib/booking/series/schedule'
import {
  DEPOSIT_CREDIT_SELECT,
  deriveNetDepositHeldCents,
} from '@/lib/booking/depositCredit'
import { isBookingError } from '@/lib/booking/errors'
import { classifySeriesOccurrenceCancel } from '@/lib/booking/series/cancelScope'
import type {
  ProBookingSeriesDetailDTO,
  ProBookingSeriesOccurrenceDetailDTO,
  ProBookingSeriesPricingDTO,
  ProBookingSeriesRollForwardDTO,
  ProBookingSeriesSkippedOccurrenceDTO,
} from '@/lib/dto/proBookingSeries'
import { decimalToCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'
import {
  CLIENT_LINK_SELECT,
  clientPublicHandle,
} from '@/lib/profiles/profileHrefs'

function buildLocationLabel(location: {
  type: string
  formattedAddress: string | null
  city: string | null
}): string {
  const mode =
    location.type === 'MOBILE_BASE'
      ? 'Mobile base'
      : location.type === 'SUITE'
        ? 'Suite'
        : 'Salon'
  const place =
    location.formattedAddress?.trim() || location.city?.trim() || ''
  return place ? `${mode} • ${place}` : mode
}

/**
 * The pro's CURRENT list price for the series' offering + add-ons, in cents.
 *
 * Deliberately the CATALOG figure and labelled as such everywhere it surfaces.
 * What a specific client is actually charged runs through
 * `resolveChargedUnitPrice`, which can apply a price-grace ramp — reproducing
 * that here would be the second copy of a pricing rule, and a wrong second copy
 * is worse than no comparison at all. Returns null when the add-ons no longer
 * resolve (a removed link), which is itself worth showing: the pattern's shape
 * has changed under the series.
 */
async function loadCurrentListTotalCents(args: {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  basePrice: Prisma.Decimal | null
}): Promise<number | null> {
  if (args.basePrice == null) return null

  try {
    const addOns = await resolveBookingAddOns({
      professionalId: args.professionalId,
      offeringId: args.offeringId,
      addOnIds: args.addOnIds,
      locationType: args.locationType,
    })

    const total = addOns.reduce(
      (acc, addOn) => acc.add(addOn.priceSnapshot),
      args.basePrice,
    )

    return decimalToCents(total)
  } catch (error: unknown) {
    if (isBookingError(error)) return null
    throw error
  }
}

/**
 * Load one series for the pro who owns it. Returns null when the series does
 * not exist OR belongs to someone else — the caller answers 404 for both, so a
 * foreign id cannot be used to probe for existence.
 */
export async function loadProBookingSeriesDetail(args: {
  professionalId: string
  seriesId: string
  now?: Date
}): Promise<ProBookingSeriesDetailDTO | null> {
  const now = args.now ?? new Date()

  const series = await prisma.bookingSeries.findFirst({
    where: { id: args.seriesId, professionalId: args.professionalId },
    select: {
      id: true,
      status: true,
      timeZone: true,
      anchorAt: true,
      intervalWeeks: true,
      occurrenceCount: true,
      nextOccurrenceIndex: true,
      depositRequested: true,
      depositPerOccurrence: true,
      addOnIds: true,
      internalNotes: true,
      locationType: true,
      clientId: true,
      offeringId: true,
      locationId: true,
      client: {
        select: { ...CLIENT_LINK_SELECT, firstName: true, lastName: true },
      },
      offering: {
        select: {
          id: true,
          title: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
          service: { select: { name: true } },
        },
      },
      location: {
        select: {
          id: true,
          type: true,
          city: true,
          formattedAddress: true,
        },
      },
    },
  })

  if (!series) return null

  const [bookings, exceptions] = await Promise.all([
    prisma.booking.findMany({
      where: { seriesId: series.id },
      select: {
        id: true,
        seriesOccurrenceIndex: true,
        scheduledFor: true,
        status: true,
        startedAt: true,
        subtotalSnapshot: true,
        ...DEPOSIT_CREDIT_SELECT,
      },
      orderBy: { seriesOccurrenceIndex: 'asc' },
    }),
    prisma.bookingSeriesException.findMany({
      where: { seriesId: series.id },
      select: {
        occurrenceIndex: true,
        intendedStart: true,
        reason: true,
        detail: true,
      },
      orderBy: { occurrenceIndex: 'asc' },
    }),
  ])

  const occurrences: ProBookingSeriesOccurrenceDetailDTO[] = bookings.map(
    (booking) => {
      // A series booking always carries its index (the column pair is written
      // together), but the schema types it nullable because ordinary bookings
      // have neither. -1 keeps it out of every scope rather than defaulting to
      // occurrence 0, which a THIS_AND_FUTURE cancel would then always include.
      const index = booking.seriesOccurrenceIndex ?? -1

      const verdict = classifySeriesOccurrenceCancel(
        {
          occurrenceIndex: index,
          status: booking.status,
          startedAt: booking.startedAt,
          scheduledFor: booking.scheduledFor,
        },
        { scope: 'ALL', now },
      )

      return {
        index,
        bookingId: booking.id,
        scheduledFor: booking.scheduledFor.toISOString(),
        status: booking.status,
        startedAt: booking.startedAt?.toISOString() ?? null,
        bookedTotalCents: decimalToCents(booking.subtotalSnapshot),
        depositHeldCents: deriveNetDepositHeldCents(booking),
        cancellable: verdict.cancellable,
        untouchedReason: verdict.cancellable ? null : verdict.reason,
      }
    },
  )

  const skipped: ProBookingSeriesSkippedOccurrenceDTO[] = exceptions.map(
    (exception) => ({
      index: exception.occurrenceIndex,
      intendedStart: exception.intendedStart?.toISOString() ?? null,
      reason: exception.reason,
      detail: exception.detail,
    }),
  )

  const basePrice =
    series.locationType === ServiceLocationType.MOBILE
      ? series.offering.mobilePriceStartingAt
      : series.offering.salonPriceStartingAt

  const currentListTotalCents = await loadCurrentListTotalCents({
    professionalId: args.professionalId,
    offeringId: series.offeringId,
    addOnIds: series.addOnIds,
    locationType: series.locationType,
    basePrice,
  })

  // The pin is occurrence 0's booked subtotal — the price the client agreed to
  // when the standing appointment was made. It is read off the Booking row
  // rather than stored a second time on the series, so it cannot drift from the
  // money that was actually snapshotted.
  const anchorOccurrence = occurrences.find((row) => row.index === 0) ?? null
  const pinnedTotalCents = anchorOccurrence?.bookedTotalCents ?? null

  const pricing: ProBookingSeriesPricingDTO = {
    pinnedTotalCents,
    currentListTotalCents,
    occurrencesDisagree:
      pinnedTotalCents != null &&
      occurrences.some(
        (row) =>
          row.bookedTotalCents != null &&
          row.bookedTotalCents !== pinnedTotalCents,
      ),
    listPriceMoved:
      pinnedTotalCents != null &&
      currentListTotalCents != null &&
      currentListTotalCents !== pinnedTotalCents,
  }

  // K20: does this series still grow? `willContinue` reads the FEATURE flag as
  // well as the series' own state — the roll-forward is gated on it, so a page
  // that promised more dates while it was off would be promising something
  // nothing would deliver.
  const pendingCount =
    series.occurrenceCount == null
      ? null
      : Math.max(0, series.occurrenceCount - series.nextOccurrenceIndex)

  const rollForward: ProBookingSeriesRollForwardDTO = {
    willContinue:
      recurringAppointmentsEnabled() &&
      series.status === BookingSeriesStatus.ACTIVE &&
      (pendingCount == null || pendingCount > 0),
    pendingCount,
    leadDays: SERIES_ROLL_FORWARD_LEAD_DAYS,
  }

  const addOnNames = series.addOnIds.length
    ? await loadAddOnNames({
        professionalId: args.professionalId,
        offeringId: series.offeringId,
        addOnIds: series.addOnIds,
        locationType: series.locationType,
      })
    : []

  return {
    seriesId: series.id,
    status: series.status,
    timeZone: series.timeZone,
    anchorAt: series.anchorAt.toISOString(),
    intervalWeeks: series.intervalWeeks,
    occurrenceCount: series.occurrenceCount,
    nextOccurrenceIndex: series.nextOccurrenceIndex,
    depositRequested: series.depositRequested,
    depositPerOccurrence: series.depositPerOccurrence,
    clientId: series.clientId,
    clientName: formatClientName(series.client),
    // The client's public `@handle`, or null when they have no public profile.
    // Same separate axis as everywhere else — see lib/pro/proBookingsList.ts.
    clientPublicProfileHandle: clientPublicHandle(series.client),
    offeringId: series.offeringId,
    serviceName:
      series.offering.title?.trim() ||
      series.offering.service.name ||
      'Appointment',
    locationId: series.locationId,
    locationLabel: buildLocationLabel(series.location),
    locationType:
      series.locationType === ServiceLocationType.MOBILE ? 'MOBILE' : 'SALON',
    addOnNames,
    internalNotes: series.internalNotes,
    pricing,
    rollForward,
    occurrences,
    skipped,
  }
}

/**
 * Names for the series' add-on links, for display only. A link that no longer
 * resolves simply drops out of the list — the price side already reports that
 * as a null `currentListTotalCents`, and inventing a placeholder name here
 * would be a second, quieter claim about the same fact.
 */
async function loadAddOnNames(args: {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
}): Promise<string[]> {
  const links = await prisma.offeringAddOn.findMany({
    where: {
      id: { in: args.addOnIds },
      offeringId: args.offeringId,
      offering: { professionalId: args.professionalId },
    },
    select: {
      sortOrder: true,
      addOnService: { select: { name: true } },
    },
    orderBy: { sortOrder: 'asc' },
    take: 50,
  })

  return links
    .map((link) => link.addOnService.name?.trim() || '')
    .filter((name) => name.length > 0)
}
