// app/(main)/booking/AvailabilityDrawer/types.ts

export type DrawerContext =
  | {
      mediaId: string
      professionalId: string
      serviceId?: string | null
    }
  | null

export type ServiceLocationType = 'SALON' | 'MOBILE'

export type AvailabilityReason = 'OK' | 'MISSING_SERVICE' | 'SERVICE_NOT_OFFERED' | 'NO_BOOKABLE_MODE'

export type ProCard = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string | null
  timeZone?: string | null
  isCreator?: boolean
  // slots are day-specific now, not global
  slots?: string[]
}

export type AvailabilitySummaryResponse = {
  ok: true
  mode: 'SUMMARY'
  mediaId: string | null
  serviceId: string
  professionalId: string

  locationType: ServiceLocationType
  locationId: string
  timeZone: string
  stepMinutes: number
  bufferMinutes: number
  maxDaysAhead: number
  durationMinutes: number

  primaryPro: ProCard & { offeringId: string; isCreator: true; timeZone: string }
  availableDays: Array<{ date: string; slotCount: number }>
  otherPros: Array<ProCard & { offeringId: string }>
  waitlistSupported: boolean
}

export type AvailabilityDayResponse =
  | {
      ok: true
      mode: 'DAY'
      professionalId: string
      serviceId: string
      locationType: ServiceLocationType
      date: string

      locationId: string
      timeZone: string
      stepMinutes: number
      bufferMinutes: number
      maxDaysAhead: number

      durationMinutes: number
      dayStartUtc: string
      dayEndExclusiveUtc: string
      slots: string[]
    }
  | { ok: false; error: string; timeZone?: string; locationId?: string }

export type HoldParsed = {
  holdId: string
  holdUntilMs: number
  scheduledForISO: string
  locationType?: ServiceLocationType | null
}

export type SelectedHold = {
  proId: string
  offeringId: string
  slotISO: string
  proTimeZone: string
  holdId: string
}
