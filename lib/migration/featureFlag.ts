// lib/migration/featureFlag.ts
//
// The pro migration flow is gated while it's still being built. Prod leaves
// ENABLE_PRO_MIGRATION unset → the pages redirect and the import endpoints 404.
// Flip the env var on (1/true/yes) to expose the flow.

export function isProMigrationEnabled(): boolean {
  const raw = process.env.ENABLE_PRO_MIGRATION
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
