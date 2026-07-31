// app/lib/proSession/types.ts

import type { UnsignedConsentForm } from '@/lib/consentForms/requirement'

export type UiSessionMode = 'IDLE' | 'UPCOMING' | 'UPCOMING_PICKER' | 'ACTIVE'

export type UiSessionCenterAction =
  | 'NONE'
  | 'START' // POST /start then navigate to href
  | 'NAVIGATE' // just go to href
  | 'FINISH' // POST /finish then go to nextHref
  | 'CAPTURE_BEFORE'
  | 'CAPTURE_AFTER'
  | 'PICK_BOOKING' // open explicit booking picker; do not auto-start

export type StepKey = 'consult' | 'session' | 'aftercare'

export type SessionBooking = {
  id: string
  serviceName?: string
  clientName?: string
  scheduledFor?: string | null
  sessionStep?: string | null
  /**
   * K17-web — consent forms this client still owes for this appointment (K15).
   * Web's session page renders the same list as `UnsignedConsentBanner`; this is
   * how the native session hub gets it.
   *
   * OPTIONAL and ABSENT when there is nothing outstanding, so a pro who has
   * bound no form sees a payload byte-identical to pre-K17. Absent means
   * "nothing to sign", never an error — and it WARNS, never blocks.
   *
   * 🔴 Not the calendar's `significant`-gated badge: at session start the
   * appointment time has arrived, which is exactly when that gate would suppress
   * the warning. See the note above `loadUnsignedConsentFormsForBookings`.
   */
  unsignedConsentForms?: UnsignedConsentForm[]
}

export type ProSessionPayload = {
  ok: true
  mode: UiSessionMode

  // ACTIVE or single UPCOMING
  booking: SessionBooking | null

  // multiple eligible UPCOMING bookings requiring explicit choice
  eligibleBookings: SessionBooking[] | null

  targetStep: StepKey | null

  center: {
    label: string
    action: UiSessionCenterAction
    href: string | null
  }
}