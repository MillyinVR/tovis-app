// lib/aftercare/aftercareRebookSeed.ts
//
// What the aftercare editor should show as the "booked next appointment", and
// therefore what an untouched form round-trips back on save.
//
// `AftercareSummary.rebookedFor` + `AftercareRebookSlot` are a SNAPSHOT taken
// the last time the pro saved aftercare. The real appointment they created —
// `AftercareSummary.rebookedBooking` — keeps moving after that: the client can
// reschedule it, and so can the pro from the calendar. Nothing syncs the
// snapshot back, so it drifts.
//
// That drift is harmless while the editor is only open for the minutes between
// finishing a session and closing it out. It stops being harmless once a
// completed booking's aftercare stays editable for weeks
// ([[aftercare-edit-window]]): the pro opens the finished aftercare to fix a
// typo, the form seeds the STALE slot, and the save hands the write boundary a
// startsAt that no longer matches the appointment. The boundary reads that as a
// deliberate time change and reschedules the client's appointment BACK to the
// old slot — a notes-only edit silently moving someone's booking.
//
// So the seed reads from the live appointment whenever there is one, and the
// snapshot only fills in what the appointment doesn't carry (the offering and
// the picked duration). An untouched form then round-trips the CURRENT truth,
// and the boundary's "did the pro move it?" comparison means what it says.
//
// ⚠️ What this does NOT close: the appointment can still move between the
// editor LOADING and the pro saving, and the save would then read as a
// deliberate move back. That race is pre-existing and narrow (it needs a
// reschedule inside one editing session), and it is not what this module is
// for — this removes the SYSTEMATIC staleness, which for a weeks-old completed
// booking would otherwise hit essentially every rescheduled plan. Closing the
// race properly needs the submitted slot to carry a concurrency token for the
// appointment, the way `AftercareSummary.version` guards the summary itself.
import { BookingStatus, type ServiceLocationType } from '@prisma/client'

/** The live appointment a BOOKED_NEXT_APPOINTMENT plan created. */
export type AftercareRebookedBookingSnapshot = {
  id: string
  status: BookingStatus
  scheduledFor: Date
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
}

/** The frozen slot the pro picked at their last aftercare save. */
export type AftercareRebookSlotSnapshot = {
  offeringId: string | null
  locationId: string
  locationType: ServiceLocationType
  clientAddressId: string | null
  startsAt: Date
  endsAt: Date
}

export type AftercareRebookSeed = {
  /** Canonical rebook instant to seed the editor with. */
  rebookedFor: Date | null
  /** Slot to seed the editor with — already reconciled with the appointment. */
  slot: AftercareRebookSlotSnapshot | null
  /**
   * True when the live appointment has moved away from the saved snapshot, so
   * the editor can tell the pro their plan was rescheduled after they wrote it
   * rather than silently showing a different date than the one they saved.
   */
  rescheduledSinceSaved: boolean
}

/**
 * Does this appointment still hold calendar time?
 *
 * Mirrors the write boundary's `priorRebookedBooking` filter exactly — the seed
 * and the sync have to agree on which appointment is "the" one, or the editor
 * shows a booking the save then ignores.
 */
export function isActiveAftercareRebookedBooking(
  booking: { status: BookingStatus } | null | undefined,
): boolean {
  if (!booking) return false

  return (
    booking.status !== BookingStatus.CANCELLED &&
    booking.status !== BookingStatus.NO_SHOW
  )
}

export function resolveAftercareRebookSeed(args: {
  rebookedFor: Date | null | undefined
  slot: AftercareRebookSlotSnapshot | null | undefined
  rebookedBooking: AftercareRebookedBookingSnapshot | null | undefined
}): AftercareRebookSeed {
  const slot = args.slot ?? null
  const rebookedFor = args.rebookedFor ?? null
  const live = isActiveAftercareRebookedBooking(args.rebookedBooking)
    ? args.rebookedBooking ?? null
    : null

  // Nothing to reconcile without both halves. No live appointment means the
  // snapshot is all there is (never booked, or it was cancelled / no-showed),
  // and no snapshot slot means there is no BOOKED plan to re-point — a slot
  // synthesized here would have no offering and no picked width, which the
  // write boundary refuses outright.
  if (!live || !slot) {
    return { rebookedFor, slot, rescheduledSinceSaved: false }
  }

  // Keep the duration the pro actually picked and shift it onto the live start.
  // The appointment's own end isn't a substitute: `endsAt` here records the
  // picked slot width, while the created booking derives its duration from the
  // offering and carries a separate buffer.
  const durationMs = Math.max(
    0,
    slot.endsAt.getTime() - slot.startsAt.getTime(),
  )

  const startsAt = live.scheduledFor
  const endsAt = new Date(startsAt.getTime() + durationMs)

  const rescheduledSinceSaved =
    slot.startsAt.getTime() !== startsAt.getTime() ||
    slot.locationType !== live.locationType ||
    (slot.clientAddressId ?? null) !== live.clientAddressId

  return {
    rebookedFor: startsAt,
    slot: {
      // The offering lives only on the snapshot — the seed must carry it or the
      // boundary refuses the save with OFFERING_ID_REQUIRED.
      offeringId: slot.offeringId,
      locationId: live.locationId,
      locationType: live.locationType,
      clientAddressId: live.clientAddressId,
      startsAt,
      endsAt,
    },
    rescheduledSinceSaved,
  }
}
