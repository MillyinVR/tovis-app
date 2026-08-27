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
  'cmq9p645v0002jp04fttoatlq', // founder personal testing account
]

function globalAiConsultFlag(): boolean {
  const raw = process.env.ENABLE_AI_CONSULT
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Checked-in C5 evidence state. Both values intentionally remain false: the
 * repository has only a deterministic fake baseline, and no domain-reviewed
 * authorized live candidate has passed. An environment flag cannot override
 * either missing artifact.
 */
export const AI_CONSULT_C5_LIVE_BASELINE_APPROVED = false
export const AI_CONSULT_C5_LIVE_CANDIDATE_PASSED = false

/**
 * 🔴 Founder eval deferral — Tori, 2026-08-26 (full-analysis launch decisions).
 *
 * Tori explicitly authorized exposing consult briefs/results to the FOUNDER
 * ALLOWLIST ONLY while the formal C5-style evaluation for the full analysis is
 * still outstanding ("you ARE the evaluation"). This deferral:
 *
 *   - applies exclusively to pros on AI_CONSULT_PRO_ALLOWLIST — the global
 *     ENABLE_AI_CONSULT flag deliberately CANNOT ride it; and
 *   - must be revoked (set accepted back to false) before any allowlist growth
 *     or flag-based widening, which again requires a passed, domain-reviewed
 *     evaluation including per-stratum fairness bars for the new traits.
 *
 * The C5 flags above stay false on purpose: no evaluation passed, and this
 * constant records a deferral, not evidence.
 */
export const AI_CONSULT_FOUNDER_EVAL_DEFERRAL = Object.freeze({
  accepted: true,
  authorizedBy: 'Tori',
  decisionDate: '2026-08-26',
  scope: 'AI_CONSULT_PRO_ALLOWLIST members only',
})

export function evaluateAiConsultC6Exposure(args: {
  founderEnabled: boolean
  liveBaselineApproved: boolean
  liveCandidatePassed: boolean
}): boolean {
  return (
    args.founderEnabled &&
    args.liveBaselineApproved &&
    args.liveCandidatePassed
  )
}

export function isAiConsultC6ExposurePossible(): boolean {
  return (
    (AI_CONSULT_C5_LIVE_BASELINE_APPROVED &&
      AI_CONSULT_C5_LIVE_CANDIDATE_PASSED) ||
    AI_CONSULT_FOUNDER_EVAL_DEFERRAL.accepted
  )
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

/**
 * C6/C7 serve gate. Stricter than the C1–C5 founder development gate: a brief,
 * rating, result, or invitation is exposed only when (a) C5's live evidence
 * exists, or (b) the pro is on the founder allowlist and Tori's recorded
 * eval deferral (above) is active. Path (b) never widens via ENABLE_AI_CONSULT.
 */
export function isAiConsultC6ExposureEnabledForPro(
  professionalId: string | null | undefined,
): boolean {
  if (!professionalId) return false
  if (
    AI_CONSULT_FOUNDER_EVAL_DEFERRAL.accepted &&
    AI_CONSULT_PRO_ALLOWLIST.includes(professionalId)
  ) {
    return true
  }
  return evaluateAiConsultC6Exposure({
    founderEnabled: isAiConsultEnabledForPro(professionalId),
    liveBaselineApproved: AI_CONSULT_C5_LIVE_BASELINE_APPROVED,
    liveCandidatePassed: AI_CONSULT_C5_LIVE_CANDIDATE_PASSED,
  })
}

/** Explicit C7 name so client-result routes cannot accidentally use C1–C5's
 * looser founder-development gate. C6 and C7 intentionally share the same
 * exposure rule (live evidence, or the founder-allowlist eval deferral). */
export function isAiConsultC7ExposureEnabledForPro(
  professionalId: string | null | undefined,
): boolean {
  return isAiConsultC6ExposureEnabledForPro(professionalId)
}
