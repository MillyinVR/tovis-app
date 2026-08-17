// lib/migration/featureFlag.ts
//
// The pro migration flow is gated while it's still being built. Prod leaves
// ENABLE_PRO_MIGRATION unset → the pages redirect and the import endpoints 404.
// Flip the env var on (1/true/yes) to expose the flow.

import { envFlagEnabled } from '@/lib/env'

export function isProMigrationEnabled(): boolean {
  return envFlagEnabled('ENABLE_PRO_MIGRATION')
}
