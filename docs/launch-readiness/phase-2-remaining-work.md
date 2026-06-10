# Phase 2 Remaining Work

Audit date: 2026-06-10  
Current repo audit HEAD: `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf`  
Decision: Private beta remains NO-GO; public rollout remains NO-GO.

This file separates work Codex/repo changes can complete from work that requires a human decision, provider UI access, deployed environment proof, or final risk acceptance.

---

# Current Verified Evidence

| Evidence | Status | Notes |
|---|---|---|
| Current HEAD recorded | PASS | `git rev-parse HEAD` returned `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf` on 2026-06-10. |
| Current worktree clean | TODO | `git status --short` still shows untracked files, including tenant helper files and new launch-readiness docs. Commit, move, or intentionally track/exclude them before final beta signoff. |
| Current typecheck | PASS | `pnpm typecheck` passed on 2026-06-10. |
| Current Phase 1 privacy verification | PASS | `pnpm verify:privacy-phase1` passed on 2026-06-10. |
| Current chaos suite | PASS LOCALLY | `pnpm test:chaos` passed on 2026-06-10. |
| Focused tenant/search tests | PASS LOCALLY | `pnpm exec vitest run --config vitest.config.mts lib/tenant/resolveTenant.test.ts lib/tenant/visibility.test.ts lib/tenant/requestContext.test.ts lib/tenant/bookingAttribution.test.ts app/api/search/route.test.ts`: 5 files / 27 tests passed on 2026-06-10. |
| Last full local launch-ops/load proof | PASS LOCALLY / STALE COMMIT | Full `pnpm verify:launch-ops` proof remains recorded against `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; rerun on the final beta commit. |
| Deployed Sentry intake | PASS DEPLOYED | Synthetic event `e56044a034cb4fb78d1b09801fb43da5`. |
| App-generated synthetic Slack alert | PASS / FOLLOW-UPS TODO | Event `f7a0d19cb4a040a3a21f4679086f166f` reached `#tovis-ops-alerts`; runbook-link-in-message and formal acknowledgement timing remain open. |
| Deployed health/readiness endpoints | PASS DEPLOYED / DASHBOARD LINK TODO | `/api/health/live`, `/api/health`, and `/api/health/ready` passed on `https://www.tovis.app`; dashboard/synthetic monitor link remains open. |

---

# Repo-Owned Work Status

These are tasks Codex can complete or help complete in the repository without making launch decisions for Tori.

| Task | Status | Next action |
|---|---|---|
| Keep readiness docs reconciled | DONE FOR CURRENT AUDIT / ONGOING | Current proof is reflected in `go-no-go.md`, `private-beta-checklist.md`, `checklist.md`, `sentry-dashboard.md`, and this file. Update again whenever new proof lands. |
| Convert new proof into evidence records | DONE FOR CURRENT AUDIT / ONGOING | Current command/proof state is recorded here and linked to `test-proof.md`, `sentry-dashboard.md`, and the go/no-go docs. Future deployed/provider proof still needs new evidence records. |
| Keep alert maps aligned to runbooks | DONE FOR REPO SCAFFOLD / ROUTING PROOF TODO | `slack-alerts.md` now has owners, severity, starter thresholds, runbooks, destinations, first response, and verification expectations. Live alert-rule routing proof remains external/provider work. |
| Keep rollback/support templates concrete | DONE FOR REPO SCAFFOLD / HUMAN DECISIONS TODO | `private-beta-support-rollback.md` defines required support/rollback decisions, pause triggers, comms templates, and post-rollback smoke checks. Tori still must choose the values. |
| Define deployed smoke-proof checklist | DONE FOR REPO SCAFFOLD / EXECUTION TODO | `deployed-smoke-proof.md` defines the required target-environment proof steps, pass criteria, and evidence template. Running the proof remains external/environment work. |
| Verify tenant-readiness doc status | DONE FOR CURRENT AUDIT / UNTRACKED WORK TODO | `tenant-foundation-audit.md` records tracked foundation pieces, untracked tenant files, remaining gaps, and launch-scope treatment. |
| Rerun safe local verification on final beta commit | TODO / FINAL-COMMIT WORK | Run `git status --short`, `git rev-parse HEAD`, `pnpm typecheck`, `pnpm verify:privacy-phase1`, and focused tests after docs/code are final. |
| Rerun full launch-ops proof on final beta commit | TODO / ENV-DEPENDENT | Run `pnpm verify:launch-ops` only against the intended local/staging smoke profile and record data-impact caveats. |

---

# Human Or External Tasks Remaining

These cannot be honestly completed from repo edits alone.

| Task | Required owner/action | Blocks |
|---|---|---|
| Final private-beta decision | Tori chooses GO, GO WITH ACCEPTED RISKS, NO-GO, or DEFER. | Private beta |
| Beta cohort and scope | Tori defines max users, invite/pro/client list, geography, included flows, and known limitations. | Private beta |
| Support path | Tori chooses support hours, channel, bug intake, payment/refund handling, privacy escalation, and off-hours behavior. | Private beta |
| Rollback path | Tori identifies rollback owner, last-known-good commit, deploy rollback process, pause criteria, and user comms path. | Private beta |
| Risk acceptance | Tori reviews the risk register and explicitly accepts or closes private-beta blockers. | Private beta |
| Live dashboard proof | Sentry/provider dashboard URLs, section links, thresholds, owners, and live data must be recorded. | Private beta/public rollout |
| Runbook link in Slack messages | Sentry alert rule/messages must include or otherwise point responders to the right runbook. | Private beta unless explicitly accepted as follow-up |
| Formal acknowledgement timing | A real or synthetic alert must record who acknowledged it and time-to-ack, or Tori must accept the gap for private beta. | Private beta unless explicitly accepted as follow-up |
| Deployed core-flow smoke proof | Booking lifecycle, payment/webhook, media/private-media, notifications, and export/delete authorization must be proven against target environment or explicitly narrowed. | Private beta |
| Provider/dashboard proof | Stripe, Postmark, Twilio, Supabase, Vercel, Redis/database, and relevant quotas/capacity must be verified in provider UIs or APIs. | Private beta/public rollout |
| Final clean-worktree decision | Existing untracked files must be committed, moved out of scope, or intentionally left out with that decision recorded. | Private beta |
| Backup owner | A named backup owner must exist. Solo-owner risk is accepted only for private beta. | Public rollout |
| Public P1 escalation | Backup/escalation path must be tested end-to-end with runbook, threshold, destination, and acknowledgement evidence. | Public rollout |

---

# Finish Plan

1. Commit or intentionally track current untracked work before the final beta evidence run.
2. Re-run safe local verification on the intended beta commit.
3. Rerun `pnpm verify:launch-ops` only when the local/staging data-impact profile is understood and acceptable.
4. Fill private-beta human decisions: cohort, scope, support path, rollback path, accepted risks, and final decision.
5. Link live dashboard sections and provider dashboards in `sentry-dashboard.md`.
6. Prove route-specific alert rules include thresholds, destinations, runbook path, and acknowledgement evidence.
7. Run deployed smoke proof for booking, payment/webhook, media/private-media, notifications, and export/delete authorization.
8. Update `go-no-go.md` and `private-beta-checklist.md` with final evidence.
9. Only change the private-beta decision from NO-GO after every required blocker is closed or explicitly accepted.

---

# Repo-Owned Supporting Docs

| Doc | Purpose | Status |
|---|---|---|
| `docs/launch-readiness/deployed-smoke-proof.md` | Exact target-environment smoke-proof checklist and evidence template. | READY / EXECUTION TODO |
| `docs/launch-readiness/private-beta-support-rollback.md` | Support, rollback, pause, and user-communication decision record. | READY / HUMAN DECISIONS TODO |
| `docs/launch-readiness/tenant-foundation-audit.md` | Tenant foundation audit, untracked tenant-file inventory, and white-label scope treatment. | READY / FINAL WORKTREE DECISION TODO |
| `docs/launch-readiness/slack-alerts.md` | Alert map with severity, owner, destination, starter thresholds, runbooks, response steps, and verification templates. | READY / LIVE ALERT-RULE PROOF TODO |
