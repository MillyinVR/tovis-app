// lib/proCapabilities/resolve.ts
//
// The ONE place the pro capability payload is assembled. Both booleans are read
// through the existing flag helpers — this file must never parse an env var
// itself, or the wire could disagree with the routes it describes.

import type { ProCapabilitiesDTO } from '@/lib/dto/proCapabilities'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

/**
 * Snapshot the flag-held pro features for the current deployment, answered for
 * the acting pro.
 *
 * Called per request (the flags are env vars, but `force-dynamic` routes and
 * RSCs both read them at request time, so there is nothing to cache and a cache
 * would only be able to go stale).
 *
 * `professionalId` is what makes `clientTechnicalRecord` answerable: that gate
 * is the global flag OR a per-pro allowlist. Omitting it is not an error — it
 * resolves to the global flag alone, which is the same answer the allowlist
 * helper gives a caller with no pro in hand.
 */
export function resolveProCapabilities(
  professionalId?: string,
): ProCapabilitiesDTO {
  return {
    noShowFees: noShowProtectionEnabled(),
    importFromAnotherApp: isProMigrationEnabled(),
    recurringAppointments: recurringAppointmentsEnabled(),
    clientTechnicalRecord: isClientTechnicalRecordEnabled(professionalId),
  }
}
