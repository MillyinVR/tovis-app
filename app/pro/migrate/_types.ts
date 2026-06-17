// app/pro/migrate/_types.ts
//
// View-model types for the pro migration / import flow. These are the agreed
// presentational contract — the server builds them (mock data for now), the client
// components render them. Field shapes mirror docs/design/pro-migration-import.md.

export type MigrationStepKey = 'services' | 'clients' | 'calendar' | 'review'

export type StepStatus = 'not-started' | 'active' | 'done'

export type SourceApp =
  | 'Vagaro'
  | 'GlossGenius'
  | 'Booksy'
  | 'Square'
  | 'StyleSeat'
  | 'Fresha'
  | 'Acuity'
  | 'Other'

// Curated catalog entry (powers every service dropdown). Global + name-unique.
export type CanonicalService = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  minPrice: number
  licensedForPro: boolean // false => disabled option (pro not licensed)
}

export type RaiseStepMode = 'PCT' | 'USD'

// Below-minimum price → grandfathered + ramped (never blocked). New clients pay the
// platform minimum immediately; existing clients ramp up gently to it.
export type PriceGrace = {
  platformMin: number
  grandfatheredPrice: number
  step: { mode: RaiseStepMode; value: number } // floor: PCT>=10, USD>=10% of price
  cadenceWeeks: number // floor: <=10
}

export type ServiceRowStatus =
  | 'OK' // clean auto-match
  | 'PRICE_GRACE' // below-min — celebratory, NOT an error, does not block confirm
  | 'UNLICENSED' // license-locked
  | 'NEEDS_ATTENTION' // no confident match — blocks confirm
  | 'REQUEST_PENDING' // "request new service" sent to admin
  | 'SKIPPED'

export type ServiceSelection =
  | { kind: 'MAP'; serviceId: string }
  | { kind: 'REQUEST_NEW' }
  | { kind: 'SKIP' }

export type OfferingDraft = {
  salonPrice?: number
  salonDurationMinutes?: number
  mobilePrice?: number
  mobileDurationMinutes?: number
  offersInSalon: boolean
  offersMobile: boolean
}

export type ServiceMapRow = {
  rowId: string
  sourceName: string
  sourcePrice?: number
  sourceDurationMinutes?: number
  suggestedServiceId: string | null
  selection: ServiceSelection
  offering: OfferingDraft
  priceGrace?: PriceGrace // present iff status === 'PRICE_GRACE'
  status: ServiceRowStatus
}

// What the Services page server passes to the client.
export type MigrateServicesViewModel = {
  sourceApp: SourceApp | null
  catalog: CanonicalService[]
  columnMappings: Array<{ src: string; dest: string }>
  rows: ServiceMapRow[]
}

// ── Clients (step 2) ────────────────────────────────────────────────────────

export type ClientMatchStatus =
  | 'AUTO_MATCHED'
  | 'NEW'
  | 'POSSIBLE_DUPE'
  | 'MISSING_INFO'

export type DupeResolution = 'UNRESOLVED' | 'MERGE' | 'SEPARATE'

export type ClientImportRow = {
  rowId: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  lastVisit?: string
  visitCount?: number
  match: ClientMatchStatus
  dupeResolution?: DupeResolution
  included: boolean
}

export type MigrateClientsViewModel = {
  columnMappings: Array<{ src: string; dest: string }>
  rows: ClientImportRow[]
  contactsFound: number
}

// ── Calendar (step 3) ───────────────────────────────────────────────────────

export type WorkingDay = {
  key: string
  label: string
  enabled: boolean
  hours?: string
}

export type TimeBlock = {
  id: string
  label: string
  range: string
  cadence: string
}

export type BookingTransferStatus = 'CONFIRMED' | 'PENDING' | 'SKIPPED'

export type BookingTransferRow = {
  rowId: string
  startLabel: string
  clientName: string
  serviceName: string
  durationMinutes: number
  status: BookingTransferStatus
  transfer: boolean
  conflictNote?: string
}

export type MigrateCalendarViewModel = {
  workingHours: WorkingDay[]
  bufferMinutes: number
  advanceWeeks: number
  timeBlocks: TimeBlock[]
  bookings: BookingTransferRow[]
  pastVisitsCount: number
}

// ── Review (step 4) ─────────────────────────────────────────────────────────

export type ReviewCardTone = 'gold' | 'accent' | 'violet'

export type ReviewSummaryCard = {
  key: MigrationStepKey
  tone: ReviewCardTone
  title: string
  subtitle: string
  stats: Array<{ value: string; label: string }>
  editLabel: string
  editHref: string
}

export type MigrateReviewViewModel = {
  cards: ReviewSummaryCard[]
  raiseRecap: Array<{
    serviceName: string
    from: number
    to: number
    cadenceLabel: string
  }>
  checklist: Array<{ label: string; done: boolean }>
}
