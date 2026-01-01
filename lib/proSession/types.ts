// app/lib/proSession/types.ts

export type UiSessionMode = 'IDLE' | 'UPCOMING' | 'ACTIVE'

export type UiSessionCenterAction =
  | 'NONE'
  | 'START' // POST /start then navigate to href
  | 'NAVIGATE' // just go to href
  | 'FINISH' // POST /finish then go to nextHref
  | 'CAPTURE_BEFORE'
  | 'CAPTURE_AFTER'

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
  booking: SessionBooking | null

  targetStep: StepKey | null

  center: {
    label: string
    action: UiSessionCenterAction
    href: string | null
  }
}
