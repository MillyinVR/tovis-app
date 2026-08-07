// lib/consult/access.ts
//
// Founder-gate for the AI Consult pilot (ai-consult.md, Phase 0). Mirrors the
// client technical-record gate (lib/clients/technicalRecord.ts) exactly: a
// global env flag OR a hardcoded allowlist of invited pro ids. Gated on the
// PROFESSIONAL the consult is anchored to (the booking's pro), not the
// requesting client — the pilot brief's decision (§3) is "everyone can run a
// consult once their pro is invited," not a client-side allowlist.

/**
 * ⚠️ TEMPORARY founder-pilot allowlist. Pros listed here get the AI Consult
 * surface in prod even while the global flag is OFF. These are
 * professionalProfile ids (not PII) — same id as the client technical-record
 * allowlist, since it's the same founder account.
 *
 * 🔴 Grow this list only with names Tori has explicitly named for the C10
 *    pilot roster (see the pilot brief §5.6) — do not add pros speculatively.
 *    Emptying this array (one line) fully re-darkens the feature.
 */
export const AI_CONSULT_PRO_ALLOWLIST: readonly string[] = [
  'cmq9p645v0002jp04fttoatlq', // amara619@gmail.com — founder personal testing
]

function globalAiConsultFlag(): boolean {
  const raw = process.env.ENABLE_AI_CONSULT
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Gate for the entire AI Consult surface (routes + future UI). Enabled when
 * the global flag is on (every pro) OR the anchoring pro is on the pilot
 * allowlist above (just them). Pass the professionalId a consult would be
 * anchored to — a consult with no resolvable pro is never enabled.
 */
export function isAiConsultEnabledForPro(
  professionalId: string | null | undefined,
): boolean {
  if (!professionalId) return false
  if (globalAiConsultFlag()) return true
  return AI_CONSULT_PRO_ALLOWLIST.includes(professionalId)
}
