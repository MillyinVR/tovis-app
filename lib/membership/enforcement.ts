// lib/membership/enforcement.ts
//
// Master switch for membership ENFORCEMENT — the restrictive side of the paid
// tiers (tax-export gate, AI-camera monthly quotas, priority-discovery ranking).
// Prod leaves ENABLE_MEMBERSHIP_ENFORCEMENT unset → every pro keeps today's
// ungated behavior; checkout/entitlement display works either way. Flip the env
// var on (1/true/yes) at launch to enforce the tiers without a code change.

export function membershipEnforcementEnabled(): boolean {
  const raw = process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
