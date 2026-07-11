// lib/dto/reminderSettings.ts
//
// Wire contract for the pro appointment-reminder cadence endpoints:
// GET/PUT /api/v1/pro/reminder-settings. Lets a pro build a fully custom list of
// client reminders, each with an arbitrary lead time — any number of days or
// hours before a booking (see lib/reminderSettings/settings.ts). The scalar unit
// of identity is minutes before the appointment (offsetMinutes).

/** The unit a reminder lead time is expressed in when editing. */
export type ReminderLeadUnit = 'days' | 'hours'

/**
 * A single configured reminder lead time, both as the scalar SSOT (minutes) and
 * humanized/structured for display + editing.
 */
export type ReminderLeadDTO = {
  /** Minutes before the appointment this reminder fires. The scalar SSOT. */
  minutes: number
  /** The lead time as a whole number of {unit}, for the value + unit editor. */
  value: number
  /** Whether {value} counts days or hours before the appointment. */
  unit: ReminderLeadUnit
  /** Human label, e.g. "1 week before", "4 hours before". */
  label: string
}

/** A suggested lead-time preset offered as a quick-add in the editor. */
export type ReminderPresetDTO = {
  /** The lead time as a whole number of {unit}. */
  value: number
  /** Whether {value} counts days or hours before the appointment. */
  unit: ReminderLeadUnit
  /** Human label, e.g. "1 week before". */
  label: string
}

/** A pro's account-level appointment-reminder cadence. */
export type ProReminderSettingsDTO = {
  /** Master opt-in. While false, no reminders are scheduled for this pro. */
  enabled: boolean
  /** Lead-time offsets that fire a reminder, in minutes (sorted desc, deduped). */
  offsetMinutes: number[]
  /** The same offsets, humanized + structured for display/editing (longest first). */
  leads: ReminderLeadDTO[]
}

/** Response for GET/PUT /api/v1/pro/reminder-settings. */
export type ProReminderSettingsResponseDTO = {
  settings: ProReminderSettingsDTO
  /** Suggested lead-time presets the UI can offer as quick-adds. */
  presets: ReminderPresetDTO[]
}

/** A single reminder lead time as submitted by the editor. */
export type ReminderLeadInputDTO = {
  /** A whole number of {unit} before the appointment. */
  value: number
  /** Whether {value} counts days or hours. */
  unit: ReminderLeadUnit
}

/** Request body for PUT /api/v1/pro/reminder-settings. */
export type ProReminderSettingsUpdateRequestDTO = {
  enabled: boolean
  reminders: ReminderLeadInputDTO[]
}
