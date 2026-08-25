// lib/proCapabilities/resolve.ts
//
// The ONE place the pro capability payload is assembled. Both booleans are read
// through the existing flag helpers — this file must never parse an env var
// itself, or the wire could disagree with the routes it describes.

import type { ProCapabilitiesDTO } from '@/lib/dto/proCapabilities'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

/**
 * Snapshot the flag-held pro features for the current deployment.
 *
 * Called per request (the flags are env vars, but `force-dynamic` routes and
 * RSCs both read them at request time, so there is nothing to cache and a cache
 * would only be able to go stale).
 */
export function resolveProCapabilities(): ProCapabilitiesDTO {
  return {
    noShowFees: noShowProtectionEnabled(),
    importFromAnotherApp: isProMigrationEnabled(),
    recurringAppointments: recurringAppointmentsEnabled(),
  }
}
