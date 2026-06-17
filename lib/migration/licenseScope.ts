// lib/migration/licenseScope.ts
//
// The reviewable data artifact behind Phase 2 of the pro migration: which
// catalog services each license type (ProfessionType) may legally offer, and
// where. Distilled from "Barbering & Cosmetology Licensing — Scope of Practice
// Across All 50 States" (June 2026); see docs/design/pro-migration-licensing-handoff.md.
//
// This is DATA, not logic. The gate it feeds (lib/services/allowedServices.ts)
// is FAIL-CLOSED: a service is offerable only if a matching ALLOW exists and no
// matching DENY does. That lets the tables mirror the source doc's shape —
// "baseline scope + per-state exceptions" — instead of pre-exploding every
// "allowed everywhere except X" into one row per jurisdiction:
//   • ALLOW with stateCode null ⇒ permitted in all jurisdictions (the baseline).
//   • ALLOW with a stateCode    ⇒ permitted only there (a per-state addition).
//   • DENY  with a stateCode    ⇒ removes a baseline grant in that state.
//
// Internal only — clients never see license/state/board terms, just the service
// name and its display category.

import type { ProfessionType } from '@prisma/client'

export type PermissionMode = 'ALLOW' | 'DENY'

// ── Jurisdictions ──────────────────────────────────────────────────────────
// The 50 states plus DC. Used to validate state codes in the exception tables;
// the baseline no longer expands across this set (that's the whole point of
// DENY), so this is reference data, not a multiplier.
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

// ── Nationwide baseline (ALLOW, stateCode null) ──────────────────────────────
// The ~95% that is consistent across states. Lash is included for COSMETOLOGIST
// and ESTHETICIAN here (they hold lash in scope nationwide) and removed only
// where a state carved it out — see LICENSE_SCOPE_DENY.
export const LICENSE_SCOPE_BASELINE: Partial<Record<ProfessionType, readonly string[]>> = {
  COSMETOLOGIST: [...HAIR, ...NAILS, ...SKIN, ...BROWS, ...LASH, 'Soft Glam Makeup'],
  BARBER: ['Haircut & Style', "Men's Cut", 'Blowout', 'All-Over Color', 'Toner / Gloss'],
  ESTHETICIAN: [...SKIN, ...BROWS, ...LASH, 'Soft Glam Makeup'],
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

// ── Per-state ADDITIONS (ALLOW with a stateCode) ─────────────────────────────
export const LICENSE_SCOPE_ALLOW_IN: readonly {
  profession: ProfessionType
  services: readonly string[]
  states: readonly Jurisdiction[]
}[] = [
  // AZ barbers have an unusually broad scope that includes skin care/facials and
  // hair removal beyond the typical head/face/neck barber scope.
  { profession: 'BARBER', services: [...SKIN], states: ['AZ'] },
]

// ── Per-state REMOVALS (DENY with a stateCode) ───────────────────────────────
// Only AZ removed lash from cosmetology/esthetics scope (carved out 2023, "even
// for cosmetologists"). MD/MN/TN/TX/UT keep lash within cosmo/esth scope
// alongside a standalone lash license, so they are NOT denied here.
export const LICENSE_SCOPE_DENY: readonly {
  profession: ProfessionType
  services: readonly string[]
  states: readonly Jurisdiction[]
}[] = [
  { profession: 'COSMETOLOGIST', services: [...LASH], states: ['AZ'] },
  { profession: 'ESTHETICIAN', services: [...LASH], states: ['AZ'] },
]

// ── Expansion ────────────────────────────────────────────────────────────────
export type PermissionSpec = {
  serviceName: string
  professionType: ProfessionType
  stateCode: string | null
  mode: PermissionMode
}

function specKey(s: PermissionSpec): string {
  return `${s.serviceName}|${s.professionType}|${s.stateCode ?? '*'}|${s.mode}`
}

// Expand the scope tables into a deduped, deterministic list of permission
// specs. Pure — no DB, no catalog. With DENY semantics this is small: ~one row
// per (profession, service) baseline grant plus a handful of state exceptions.
export function expandLicenseScope(): PermissionSpec[] {
  const out: PermissionSpec[] = []
  const seen = new Set<string>()

  const push = (spec: PermissionSpec) => {
    const key = specKey(spec)
    if (seen.has(key)) return
    seen.add(key)
    out.push(spec)
  }

  // Baseline → ALLOW, null state.
  for (const [professionType, services] of Object.entries(LICENSE_SCOPE_BASELINE)) {
    for (const serviceName of services ?? []) {
      push({ serviceName, professionType: professionType as ProfessionType, stateCode: null, mode: 'ALLOW' })
    }
  }

  // Per-state additions → ALLOW, with state.
  for (const { profession, services, states } of LICENSE_SCOPE_ALLOW_IN) {
    for (const stateCode of states) {
      for (const serviceName of services) {
        push({ serviceName, professionType: profession, stateCode, mode: 'ALLOW' })
      }
    }
  }

  // Per-state removals → DENY, with state.
  for (const { profession, services, states } of LICENSE_SCOPE_DENY) {
    for (const stateCode of states) {
      for (const serviceName of services) {
        push({ serviceName, professionType: profession, stateCode, mode: 'DENY' })
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
