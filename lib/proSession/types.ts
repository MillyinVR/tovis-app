// app/lib/proSession/types.ts

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