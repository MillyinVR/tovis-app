// lib/reminderSettings/applyReminderCadence.ts
//
// The cadence WRITE path: save a pro's appointment-reminder cadence AND re-plan
// the bookings already on their calendar, in one schedule-locked transaction.
//
// Why this module exists rather than a few lines in the route: saving the
// cadence alone is a silent no-op for every existing booking. Reminder rows are
// planned once, at the booking write, from the cadence in force at that moment;
// nothing re-reads the cadence afterwards except the drain, and the drain can
// only judge rows that already exist. So turning a lead time ON used to reach
// nobody who was already booked, while the settings card promises "automatically
// remind clients before their appointment" and names only "already in the past"
// as an exclusion.
//
// It lives beside the settings module instead of inside it because
// `lib/notifications/appointmentReminders` already imports the cadence resolver
// from there — importing back the other way would close an import cycle.
import { syncUpcomingBookingRemindersForProfessional } from '@/lib/notifications/appointmentReminders'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  normalizeProReminderSettingsUpdate,
  updateProReminderSettings,
  type ProReminderSettingsUpdate,
} from '@/lib/reminderSettings/settings'
import type { ProReminderSettingsDTO } from '@/lib/dto/reminderSettings'

export type ApplyProReminderCadenceResult = {
  settings: ProReminderSettingsDTO
  /** Upcoming bookings re-planned against the new cadence. */
  resyncedBookingCount: number
  /** True when the pro has more upcoming bookings than one save re-plans. */
  hitResyncCap: boolean
}

/**
 * Save the cadence and re-plan the pro's upcoming bookings against it.
 *
 * Runs under the professional's schedule lock so the re-plan can't read a
 * booking mid-move and write a reminder for a time that no longer exists: every
 * writer that moves an appointment holds the same lock.
 */
export async function applyProReminderCadence(args: {
  professionalId: string
  update: ProReminderSettingsUpdate
}): Promise<ApplyProReminderCadenceResult> {
  // Reject a bad payload BEFORE taking the schedule lock: an invalid save must
  // not make the pro's booking writes queue behind a transaction that only ever
  // rolls back. The write below re-runs this — it is pure.
  normalizeProReminderSettingsUpdate(args.update)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      // Validate + persist FIRST: the resync below reads the cadence back out of
      // this transaction, so it must see the new values, and an invalid update
      // must throw before anything is re-planned.
      const settings = await updateProReminderSettings({
        professionalId: args.professionalId,
        update: args.update,
        db: tx,
      })

      const { syncedCount, hitCap } =
        await syncUpcomingBookingRemindersForProfessional({
          tx,
          professionalId: args.professionalId,
          now,
        })

      return {
        settings,
        resyncedBookingCount: syncedCount,
        hitResyncCap: hitCap,
      }
    },
  )
}
