// lib/dto/proMigration.ts
//
// Wire DTO for the pro migration wizard's read surface. The web migrate flow's
// two "bookend" screens — the entry/landing page and the review/go-live page —
// are RSC-only: app/pro/migrate/page.tsx + review/page.tsx query Prisma directly
// via loadMigrationReviewSummary and pass a view-model into a client component,
// so there is no JSON endpoint the native app can read. This DTO is the shared
// shape behind a paired native read route (GET /api/v1/pro/migrate/summary): the
// same counts both web screens derive from — active offerings, booking-visible
// clients, imported bookings + blocked time, and the in-flight price-grace
// raises. Native derives BOTH the entry progress cards (services = offerings,
// clients = clients, calendar = importedBookings + importedBlocks) and the review
// summary from it, exactly as web does. Mirrors lib/migration/migrationReview.ts
// (MigrationReviewSummary / MigrationRaise) — those are the SSOT shapes; this DTO
// is the JSON-safe echo the route builds with `satisfies`.

// One in-flight price-grace raise — a below-minimum imported price that was
// grandfathered then ramped up to the platform minimum. `stepMode` is the ramp's
// unit (percent- or dollar-per-step); `from`/`to` are the current and target
// prices; `cadenceWeeks` is how often a step applies.
export type ProMigrationRaiseDTO = {
  serviceName: string
  from: number
  to: number
  stepMode: 'PCT' | 'USD'
  stepValue: number
  cadenceWeeks: number
}

// The migration summary — the real counts the pro will see post-import. `clients`
// uses the same booking-gated visibility the pro clients list applies, so the
// wizard and the roster never disagree.
export type ProMigrationSummaryDTO = {
  offerings: number
  clients: number
  importedBookings: number
  importedBlocks: number
  raises: ProMigrationRaiseDTO[]
}

// GET /api/v1/pro/migrate/summary — the whole read surface for the native
// wizard's entry + review screens in one envelope.
export type ProMigrationSummaryResponseDTO = {
  summary: ProMigrationSummaryDTO
}
