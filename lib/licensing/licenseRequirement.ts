// lib/licensing/licenseRequirement.ts
//
// Whether a given profession needs a credential to onboard in a given state —
// the multi-state replacement for the old global `requiresCaBbcLicense` boolean.
// Same source as lib/migration/licenseScope.ts ("Barbering & Cosmetology
// Licensing — Scope of Practice Across All 50 States", June 2026), different
// axis: this is the *licensure requirement*, not the scope of practice.
//
// Pure data + functions, no DB / no prisma runtime — safe to import in client
// components (the signup form) and on the server alike.
//
// ⚠️ v1 distillation — needs legal review before it gates production onboarding,
// especially the braiding/PMU per-state lists (several states changed law in
// 2024–2026 and the source doc flags some as "verify").

import type { ProfessionType } from '@prisma/client'

import { isUsStateCode } from '@/lib/usStates'

// LICENSED  — state issues a full license; provide license number.
// REGISTERED — lighter registration/permit/certificate required.
// EXEMPT    — no state credential required for this profession here.
export type LicenseRequirement = 'LICENSED' | 'REGISTERED' | 'EXEMPT'

// The core barbering/cosmetology licenses every state issues. Online auto-verify
// (CA BreEZe today) is limited to these in CA; everything else is manual review.
const CORE_BBC_PROFESSIONS = new Set<ProfessionType>([
  'COSMETOLOGIST',
  'BARBER',
  'ESTHETICIAN',
  'MANICURIST',
  'HAIRSTYLIST',
  'ELECTROLOGIST',
])

// Baseline requirement per profession — the common case across states.
const BASELINE: Record<ProfessionType, LicenseRequirement> = {
  COSMETOLOGIST: 'LICENSED',
  BARBER: 'LICENSED',
  ESTHETICIAN: 'LICENSED',
  MANICURIST: 'LICENSED',
  HAIRSTYLIST: 'LICENSED',
  ELECTROLOGIST: 'LICENSED',
  // Makeup artistry isn't a licensed profession anywhere — certificate only.
  MAKEUP_ARTIST: 'EXEMPT',
  // Massage therapy is licensed in most states, but under a separate (non-BBC)
  // regime we don't model yet; treated as certificate/attestation for now.
  MASSAGE_THERAPIST: 'EXEMPT',
  // Specialty licenses: in MOST states these sit within esthetician/cosmetology
  // scope or are deregulated, so EXEMPT is the baseline; the states that DO
  // issue a standalone credential are the overrides below.
  LASH_TECHNICIAN: 'EXEMPT',
  HAIR_BRAIDER: 'EXEMPT',
  PERMANENT_MAKEUP_ARTIST: 'EXEMPT',
}

// Per-state overrides where a specialty profession DOES need a credential.
const OVERRIDES: readonly {
  profession: ProfessionType
  requirement: LicenseRequirement
  states: readonly string[]
}[] = [
  // Standalone eyelash license/permit/registration states.
  {
    profession: 'LASH_TECHNICIAN',
    requirement: 'LICENSED',
    states: ['AZ', 'CT', 'KY', 'MD', 'MN', 'OK', 'TN', 'TX', 'UT'],
  },
  // States that still license natural hair braiding.
  {
    profession: 'HAIR_BRAIDER',
    requirement: 'LICENSED',
    states: ['AL', 'AK', 'IL', 'LA', 'MI', 'MO', 'NV', 'NJ', 'NY', 'NC', 'OH', 'OR', 'TN'],
  },
  // States that register (rather than fully license) braiding.
  {
    profession: 'HAIR_BRAIDER',
    requirement: 'REGISTERED',
    states: ['MS', 'SC'],
  },
  // States whose cosmetology board issues a permanent-makeup credential
  // (elsewhere PMU is tattoo/body-art, outside these boards → EXEMPT here).
  {
    profession: 'PERMANENT_MAKEUP_ARTIST',
    requirement: 'LICENSED',
    states: ['VA', 'AK'],
  },
]

// Index overrides for O(1) lookup: `${profession}|${state}` → requirement.
const OVERRIDE_INDEX = new Map<string, LicenseRequirement>()
for (const { profession, requirement, states } of OVERRIDES) {
  for (const state of states) OVERRIDE_INDEX.set(`${profession}|${state}`, requirement)
}

export function getLicenseRequirement(
  profession: ProfessionType,
  stateCode: string | null | undefined,
): LicenseRequirement {
  if (stateCode && isUsStateCode(stateCode)) {
    const override = OVERRIDE_INDEX.get(`${profession}|${stateCode}`)
    if (override) return override
  }
  return BASELINE[profession] ?? 'EXEMPT'
}

// Does the pro need to provide a credential (license or registration) to
// onboard for this (profession, state)?
export function requiresLicense(
  profession: ProfessionType,
  stateCode: string | null | undefined,
): boolean {
  return getLicenseRequirement(profession, stateCode) !== 'EXEMPT'
}

// Can we auto-verify this credential online right now? Only CA BreEZe, only the
// core BBC licenses. Everything else is attestation + manual admin review.
export function supportsOnlineVerification(
  profession: ProfessionType,
  stateCode: string | null | undefined,
): boolean {
  return stateCode === 'CA' && CORE_BBC_PROFESSIONS.has(profession)
}
