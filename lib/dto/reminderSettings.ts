// lib/dto/reminderSettings.ts
//
// Wire contract for the pro appointment-reminder cadence endpoints:
// GET/PUT /api/v1/pro/reminder-settings. Lets a pro choose which client
// reminders fire ahead of a booking (see lib/reminderSettings/settings.ts).

/** A single selectable reminder offset, for rendering the cadence menu. */
export type ReminderOffsetOptionDTO = {
  /** Days before the appointment this reminder fires (1 / 3 / 7). */
  days: number
  /** Human label for the option, e.g. "1 week before". */
  label: string
}

/** A pro's account-level appointment-reminder cadence. */
export type ProReminderSettingsDTO = {
  /** Master opt-in. While false, no reminders are scheduled for this pro. */
  enabled: boolean
  /** Days-before-appointment offsets that fire a reminder (sorted, deduped). */
  offsetDays: number[]
}

/** Response for GET /api/v1/pro/reminder-settings. */
export type ProReminderSettingsResponseDTO = {
  settings: ProReminderSettingsDTO
  /** The full menu of offsets a pro may enable, so the UI need not hardcode it. */
  options: ReminderOffsetOptionDTO[]
}

/** Request body for PUT /api/v1/pro/reminder-settings. */
export type ProReminderSettingsUpdateRequestDTO = {
  enabled: boolean
  offsetDays: number[]
}
