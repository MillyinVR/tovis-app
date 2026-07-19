// lib/clients/claimMergeFlag.ts
//
// Kill switch for the claim merge — absorbing a pro-created unclaimed
// ClientProfile into a signed-in client's own identity (#651 + #652).
//
// ## Why this one is inverted
// Every sibling flag here is opt-IN and defaults OFF (`bookinglessClaimEnabled`,
// `noShowProtectionEnabled`, …) because they gate features that are not finished
// being decided. This one is opt-OUT and defaults ON, deliberately: the merge is
// the fix for a live hole — a client who already has an account cannot claim the
// history their pro built for them — so defaulting it off would ship the fix in
// name only and leave the hole open until someone remembered to flip it.
//
// What it buys instead is an escape hatch. The merge is IRREVERSIBLE (it moves
// rows and destroys the husk) and any client holding a claim link can trigger it,
// so it should be stoppable without a revert-and-redeploy. Set
// `DISABLE_CLAIM_MERGE=1` and `acceptClientClaimFromLink` skips the merge and
// returns `merge_paused`, which writes nothing.
//
// ⚠️ It used to return `client_mismatch` — the literal pre-#652 refusal — and
// that quietly made pulling this switch user-hostile: every signed-in claim
// landed on a card telling the viewer to sign in with the right client account,
// which on a `ready` link does not exist. Pulling a kill switch must not blame
// the people it stops, so the refusal now has its own kind, its own wire code
// (`CLAIM_PAUSED`, a 503) and its own blameless, retryable card on both
// platforms. Do not collapse it back into the mismatch case.
//
// ⚠️ Disabling this does NOT roll anything back — merges already committed stay
// committed. It only stops new ones.
//
// ## Why the parsing is inverted too, not just the default
// The opt-in flags accept-list their truthy values (`1`/`true`/`yes`) and treat
// anything else as off — which is fail-SAFE for them, because an unrecognised
// value just leaves a dormant feature dormant. Copying that here would be
// fail-OPEN: `DISABLE_CLAIM_MERGE=y` would parse as "not disabled" and keep an
// irreversible write running during the emergency someone is trying to stop. So
// this reads the other way round — anything set that isn't explicitly "off"
// disables the merge. A kill switch must fail toward safety, and the cost of
// being wrong is asymmetric: over-disabling shows a stale refusal until someone
// notices, under-disabling keeps destroying husks.

/** Explicitly-off values. EVERYTHING else (once set) disables the merge. */
const OFF_VALUES = new Set(['', '0', 'false', 'no', 'off'])

export function claimMergeDisabled(): boolean {
  const raw = process.env.DISABLE_CLAIM_MERGE
  if (typeof raw !== 'string') return false

  return !OFF_VALUES.has(raw.trim().toLowerCase())
}
