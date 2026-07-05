// app/pro/migrate/_types.ts
//
// View-model types for the pro migration / import flow. These are the agreed
// presentational contract — the server builds them from real import data (see
// lib/migration/migrationReview.ts and the stage endpoints), the client
// components render them.

export type MigrationStepKey = 'services' | 'clients' | 'calendar' | 'review'

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
