// lib/migration/licenseScope.ts
//
// The reviewable data artifact behind Phase 2 of the pro migration: which
// catalog services each license type (ProfessionType) may legally offer, and
// where. Distilled from "Barbering & Cosmetology Licensing — Scope of Practice
// Across All 50 States" (June 2026); see docs/design/pro-migration-licensing-handoff.md.
//
// This is DATA, not logic. The gate it feeds (lib/services/allowedServices.ts)
// is an ALLOW-LIST: a ServicePermission row = "permitted"; there is no deny row.
// Consequences encoded below:
//   • A null stateCode row ⇒ permitted in all jurisdictions.
//   • "Allowed everywhere EXCEPT X" cannot be a null row minus an exception —
//     it must expand to per-state rows for every allowed jurisdiction.
//   • Every catalog service must be granted to each profession that should keep
//     it; a service with zero rows is open to everyone.
//
// Internal only — clients never see license/state/board terms, just the service
// name and its display category.

import type { ProfessionType } from '@prisma/client'

// ── Jurisdictions ──────────────────────────────────────────────────────────
// The 50 states plus DC. AZ is currently the only exclusion anywhere (lash),
// but expansions resolve against this full set so per-state grants are complete.
export const US_JURISDICTIONS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

export type Jurisdiction = (typeof US_JURISDICTIONS)[number]

// ── Service buckets (names MUST match Service.name exactly) ──────────────────
const HAIR = [
  'Balayage',
  'Partial Highlights',
  'Full Highlights',
  'All-Over Color',
  'Toner / Gloss',
  'Root Touch-Up',
  'Haircut & Style',
  "Men's Cut",
  'Blowout',
  'Keratin Smoothing Treatment',
  'Extension Installation',
] as const

const NAILS = [
  'Gel Manicure',
  'Classic Manicure',
  'Gel Pedicure',
  'Acrylic Full Set',
  'Dip Powder',
  'Gel X Full Set',
] as const

const LASH = [
  'Classic Lash Full Set',
  'Volume Lash Full Set',
  'Lash Fill',
  'Lash Lift',
] as const

const BROWS = ['Brow Lamination', 'Brow Wax & Shape'] as const

// Esthetic skin + waxing services shared by cosmetologist/esthetician.
const SKIN = ['Classic Facial', 'Brazilian Wax'] as const

const MASSAGE = [
  '60-Minute Swedish Massage',
  '60-Minute Deep Tissue',
  'Hot Stone Massage',
] as const

// ── Nationwide baseline (null stateCode) ─────────────────────────────────────
// The ~95% that is consistent across states. NOTE: lash is intentionally absent
// from COSMETOLOGIST/ESTHETICIAN here — it is state-varying (see ALL_EXCEPT).
export const LICENSE_SCOPE_BASELINE: Partial<Record<ProfessionType, readonly string[]>> = {
  COSMETOLOGIST: [...HAIR, ...NAILS, ...SKIN, ...BROWS, 'Soft Glam Makeup'],
  BARBER: ['Haircut & Style', "Men's Cut", 'Blowout', 'All-Over Color', 'Toner / Gloss'],
  ESTHETICIAN: [...SKIN, ...BROWS, 'Soft Glam Makeup'],
  HAIRSTYLIST: [...HAIR],
  MANICURIST: [...NAILS],
  MAKEUP_ARTIST: ['Soft Glam Makeup', 'Bridal Makeup'],
  // Standalone specialty licenses — authorized wherever the license is held.
  LASH_TECHNICIAN: [...LASH],
  HAIR_BRAIDER: ['Box Braids'],
  PERMANENT_MAKEUP_ARTIST: ['Microblading'],
  ELECTROLOGIST: ['Electrolysis'],
  // Massage therapy is a separate licensing regime (not in the scope doc), but
  // its services still must be gated to massage therapists, not left open.
  MASSAGE_THERAPIST: [...MASSAGE],
}

// ── Allowed in all jurisdictions EXCEPT the listed ones ──────────────────────
// Expands to per-state rows for every jurisdiction not excluded.
// Lash: only AZ removed lash from cosmetology/esthetics scope (carved out 2023,
// "even for cosmetologists"). MD/MN/TN/TX/UT keep lash within cosmo/esth scope
// alongside a standalone lash license, so they are NOT excluded here.
export const LICENSE_SCOPE_ALL_EXCEPT: readonly {
  profession: ProfessionType
  services: readonly string[]
  exceptStates: readonly Jurisdiction[]
}[] = [
  { profession: 'COSMETOLOGIST', services: [...LASH], exceptStates: ['AZ'] },
  { profession: 'ESTHETICIAN', services: [...LASH], exceptStates: ['AZ'] },
]

// ── Allowed ONLY in the listed jurisdictions ─────────────────────────────────
// Per-state grants beyond the baseline.
export const LICENSE_SCOPE_ONLY_IN: readonly {
  profession: ProfessionType
  services: readonly string[]
  states: readonly Jurisdiction[]
}[] = [
  // AZ barbers have an unusually broad scope that includes skin care/facials and
  // hair removal beyond the typical head/face/neck barber scope.
  { profession: 'BARBER', services: [...SKIN], states: ['AZ'] },
]

// ── Expansion ────────────────────────────────────────────────────────────────
export type PermissionSpec = {
  serviceName: string
  professionType: ProfessionType
  stateCode: string | null
}

function specKey(s: PermissionSpec): string {
  return `${s.serviceName}|${s.professionType}|${s.stateCode ?? '*'}`
}

// Expand the scope tables into a deduped, deterministic list of permission
// specs (service name + profession + stateCode). Pure — no DB, no catalog.
export function expandLicenseScope(): PermissionSpec[] {
  const out: PermissionSpec[] = []
  const seen = new Set<string>()

  const push = (spec: PermissionSpec) => {
    const key = specKey(spec)
    if (seen.has(key)) return
    seen.add(key)
    out.push(spec)
  }

  // Baseline → null rows.
  for (const [professionType, services] of Object.entries(LICENSE_SCOPE_BASELINE)) {
    for (const serviceName of services ?? []) {
      push({ serviceName, professionType: professionType as ProfessionType, stateCode: null })
    }
  }

  // All-except → per-state rows for every non-excluded jurisdiction.
  for (const { profession, services, exceptStates } of LICENSE_SCOPE_ALL_EXCEPT) {
    const excluded = new Set<string>(exceptStates)
    for (const stateCode of US_JURISDICTIONS) {
      if (excluded.has(stateCode)) continue
      for (const serviceName of services) {
        push({ serviceName, professionType: profession, stateCode })
      }
    }
  }

  // Only-in → per-state rows for the listed jurisdictions.
  for (const { profession, services, states } of LICENSE_SCOPE_ONLY_IN) {
    for (const stateCode of states) {
      for (const serviceName of services) {
        push({ serviceName, professionType: profession, stateCode })
      }
    }
  }

  return out
}

// Every distinct service name referenced anywhere in the scope tables — used to
// detect names that don't resolve to a catalog Service.
export function referencedServiceNames(): string[] {
  const names = new Set<string>()
  for (const spec of expandLicenseScope()) names.add(spec.serviceName)
  return [...names].sort()
}
