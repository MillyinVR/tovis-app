// lib/dto/proWorkingHours.ts
//
// Wire DTO for the pro's working-hours editor
// (GET/POST /api/v1/pro/working-hours) — web `WorkingHoursForm`, iOS
// `ProWorkingHoursView` via `ProScheduleService.workingHours`.
//
// JSON-safe throughout: "HH:MM" strings, ISO-8601 instants, no Date/Decimal
// reaches the wire type.

import type { ProfessionalLocationType } from '@prisma/client'

import type { WorkingHoursObj } from '@/lib/scheduling/workingHoursValidation'

/**
 * One booking that no longer fits the hours the pro just saved.
 *
 * Reported, never acted on: B8's ruling (Tori, 2026-07-25) is warn-and-list —
 * the save always succeeds and the bookings are left exactly as they are.
 */
export type ProStrandedBookingDTO = {
  id: string
  /** ISO-8601 UTC instant. Render it in `timeZone`. */
  scheduledFor: string
  /** The appointment itself, buffer excluded. */
  durationMinutes: number
  locationId: string
  /** IANA zone of that booking's location, for rendering `scheduledFor`. */
  timeZone: string
  clientName: string
  serviceName: string | null
}

/**
 * The bookings the just-saved hours strand.
 *
 * `total` counts them all; `items` is capped (soonest first). The whole field is
 * OMITTED when the save changed no hours, and is `null` when the scan itself
 * failed — a warning we could not compute must not read as "nothing is wrong".
 */
export type ProStrandedBookingsDTO = {
  total: number
  items: ProStrandedBookingDTO[]
}

/** GET /api/v1/pro/working-hours success response. */
export type ProWorkingHoursOk = {
  ok: true
  locationType: 'SALON' | 'MOBILE'
  locationId: string | null
  location: ProWorkingHoursLocationDTO | null
  workingHours: WorkingHoursObj
  /** True when the pro has never saved hours and these are the defaults. */
  usedDefault: boolean
  /** True when no bookable location of that mode exists yet. */
  missingLocation: boolean
}

export type ProWorkingHoursLocationDTO = {
  id: string
  type: ProfessionalLocationType
  isPrimary: boolean
}

/** POST /api/v1/pro/working-hours success response. */
export type ProWorkingHoursSaveOk = {
  ok: true
  locationType: 'SALON' | 'MOBILE'
  locationId: string | null
  location: ProWorkingHoursLocationDTO | null
  workingHours: WorkingHoursObj
  usedDefault: boolean
  /** How many locations this save wrote to. */
  updatedCount: number
  updatedLocationIds: string[]
  /** Absent when the hours did not change; null when the scan failed. */
  strandedBookings?: ProStrandedBookingsDTO | null
}
