// lib/notifications/reEngagementDispatchFlag.ts
//
// Cutover switch for the UNIFIED re-engagement notification dispatcher (spec §8.1).
//
// We ship three re-engagement triggers as three daily crons (event-countdown 5 10,
// saved-look 20 10, rebook-cadence 35 10). They already share the pooled weekly
// budget LEDGER, but each cron only arbitrates priority WITHIN its own scan; strict
// cross-trigger priority is approximated by CRON ORDERING (design decision (a)). The
// unified dispatcher (reEngagementDispatcher.ts) gathers every trigger's candidates
// and runs the priority allocator ONCE per user, so priority is enforced globally.
//
// This flag governs the cutover, reversibly:
//   - OFF (default, prod-unset): the three per-trigger crons run exactly as today
//     and the unified dispatch cron is a registered NO-OP → deploy is byte-identical.
//   - ON: the unified dispatch cron does all the work and the three per-trigger
//     crons early-return without sending, so a client's daily budget is allocated by
//     ONE global priority pass (no double-send — the crons also share the idempotent
//     dedupeKey ledger, so this is belt-and-suspenders).
//
// Mirrors feedDiversityInjectionEnabled() (lib/looks/feedDiversityFlag.ts) /
// personalizedFeedEnabled(). Per the runtime-flags convention it stays an env var
// until the first deliberate flip; only then does it graduate to the admin
// runtime-flags surface. Flipping it on is Tori's call.

export function unifiedReEngagementDispatchEnabled(): boolean {
  const raw = process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
