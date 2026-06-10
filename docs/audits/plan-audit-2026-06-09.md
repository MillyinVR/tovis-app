# TOVIS Plan Audit — 2026-06-09

**Scope:** Audit of the repo against the combined 12-month roadmap (asymmetric multi-tenant white-label plan + engineering guardrail plan).
**Baseline commit:** 44f1f93 (HEAD on main)
**Companion doc:** `docs/audits/weekly-audit-2026-06-08.md` (operational launch-readiness audit)

---

## Headline findings

1. **The plan's view of PII encryption is stale — you are further along than the plan assumes.** The plan says "dual-write exists, plaintext envelope still needs AEAD." In reality: AEAD address encryption (`aes-256-gcm-v1`) is implemented, new writes are AEAD-only, the staging backfill ran and was recorded, HMAC contact hash v2 is backfilled with readers cut over, and the legacy SHA-256 lookup columns are already dropped (`docs/privacy/phase-1-remaining-work.md` marks Phase 1 closeout complete). The pgsodium-vs-app-layer decision is moot: app-layer AEAD was chosen and shipped.
2. **The "remove 30 casts" workstream is nearly done.** Production code (`app/` + `lib/`, excluding tests) has **0 `as any`** and only **3 `as unknown as`**. `tools/check-no-type-escape.mjs` exists. What's missing is `lib/typed`, the stricter tsconfig flags, and CI enforcement (see #3).
3. **🔴 Bug: the static-guards CI job has failed on every push since 2026-05-26.** Commit `a5e4f6b` accidentally deleted the `check:static-guards` script from package.json while adding privacy test scripts; `.github/workflows/static-guards.yml` still calls it. All seven guard scripts exist and run locally, but **none of them are actually enforced in CI right now.**
4. **Session refresh has not started.** There is no `GET /api/pro/bookings/[id]/session/state` route and no polling hook. Session start/step/finish routes and a stale-sessions cleanup cron exist.
5. **Multi-tenancy has not started.** No `Tenant` model, no `homeTenantId`/`proTenantId`/`clientHomeTenantId` fields, no `tovis-root`, no tenant resolver or visibility helper, no isolation tests. The only artifact is a `salonSlug` placeholder on `NfcCard`.
6. **Load/chaos/launch-ops work landed early and is substantial — but local-only.** Full load suite (availability, holds, finalize, checkout, media metadata, notifications, Stripe webhook replay, launch runner), chaos suite (Redis, Supabase storage, Stripe webhook storm, Postmark, Twilio, DB degradation), runbooks, go-no-go, risk register, rollout checklists all exist. Per the 2026-06-08 audit, the blockers are operational: no staging/deployed proof, no named backup owner, Sentry→Slack alert routing only partially proven, sign-off tables all TODO.

**Bottom line:** code-wise you have essentially finished Q1 Workstreams 1–2 (types, privacy) and pre-built most of Q3 Workstream 8 (load/chaos, locally). The genuinely missing engineering work is **session refresh (WS-3)** and **everything tenant/white-label (WS-4–6, 9)**. The genuinely missing launch work is **operational proof, not code**.

---

## Workstream-by-workstream status

### Q1 — Launch-blocker foundation

| Workstream | Status | Evidence |
|---|---|---|
| **WS-1: Type & architecture enforcement** | 🟡 ~80% | 0 `as any`, 0 `@ts-ignore`, 3 `as unknown as` in prod code. 7 guard scripts in `tools/` (booking write boundary, media render boundary, consultation canonical, lifecycle field writes, no-type-escape, canonical normalization, PII plaintext reads). **Missing:** `lib/typed` helpers; stricter tsconfig flags (only `strict: true` — no `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`); `docs/architecture/canonical-modules.md` (only booking-lifecycle + availability contracts exist); **CI wiring is broken** (deleted `check:static-guards` script). |
| **WS-2: Phase 12 privacy contract** | 🟢 ~90% | AEAD address envelope shipped (`lib/security/addressEncryption.ts`, `aes-256-gcm-v1`); legacy plaintext envelope is read-only burn-in. Backfills run + recorded in staging. HMAC contact hash v2 cutover complete; legacy SHA-256 columns dropped. `check:pii-plaintext-reads` guard exists (471-entry accepted baseline). Design docs exist (`docs/security/address-encryption-design.md`, `pii-encryption-roadmap.md`). **Missing:** launch-environment reruns (HMAC v2 flows, address encryption dry/write run, final proof commands); identity-field encryption (name/DOB/bio) — Phase 2+ of the roadmap, not started. |
| **WS-3: Session refresh** | 🔴 Not started | No `session/state` route, no `useSessionState` hook, no polling in `app/pro/bookings/[id]/session/`. Existing: session start/step/finish routes, stale-sessions cron. |
| **WS-4: Multi-tenant data foundation** | 🔴 Not started | No Tenant model; no tenant columns on any model; no resolver/visibility helper; no isolation tests. Only `NfcCard.salonSlug` placeholder comment ("white-label salon cards (minimal tenant pointer)"). |

### Q2 — Tenancy enforcement + white-label basics

| Workstream | Status | Evidence |
|---|---|---|
| **WS-5: Enforce tenant visibility** | 🔴 Not started | No `tenantVisibilityFilter`, no `check-tenant-aware-discovery.mjs`. Blocked on WS-4. |
| **WS-6: White-label presentation** | 🟡 Foundation only | `lib/brand/` exists with `BrandProvider`, tokens, types, per-surface CSS — a real brand abstraction — but exactly one brand (`brands/tovis.ts`) and no tenant resolution. Emails/SMS not tenant-aware; no hardcoded-brand-string scanner; no custom domain resolver. |
| **WS-7: Jobs + observability** | 🟡 ~50% | Jobs: 7 Vercel crons (`vercel.json`) — hold-cleanup, stripe-orphan-recovery, notifications, client-reminders, verification-email retry, looks-social, stale-sessions. No Inngest/queue with retry+dead-letter semantics. Observability: Sentry intake proven in production; Slack alert routing **partially** proven; 4 incident runbooks exist but all list `Backup owner: TODO`; dashboards still TODO. |

### Q3 — Scale proof + white-label beta

| Workstream | Status | Evidence |
|---|---|---|
| **WS-8: Load & chaos** | 🟡 Built, unproven deployed | Full load suite + chaos suite implemented; `verify:launch-ops` PASS **LOCALLY** at `ae30aff`. Load/chaos test plans exist in `docs/launch-readiness/`. **Missing:** staging/production runs, recorded p95/p99 evidence in `docs/deployment-checklist.md` (all evidence fields blank), explicit traffic model with per-route targets. |
| **WS-9: White-label partner beta** | 🔴 Not started | Blocked on WS-4–6. |

### Q4 — Launch operations

| Workstream | Status | Evidence |
|---|---|---|
| **WS-10: Go/no-go & rollout** | 🟡 Docs done, proof missing | go-no-go, private-beta + public-rollout checklists, risk register, on-call plan, rollback template, Slack alert map, 4 runbooks — all exist. **Missing:** every sign-off table is TODO; backup owner unnamed (repeated across 4 runbooks); no deployed proof cycle; overall status 🔴 NO-GO per 2026-06-08 audit. |

### Items the plan listed as "outstanding" that are actually done

- **Upload-token binding:** `app/api/pro/uploads/route.ts` enforces booking ownership (`booking.professionalId !== proId → 403`) before issuing a signed upload token, and booking-scoped uploads are path-scoped to `bookings/<id>/...`. Verify the client/admin upload routes match, but the pattern exists.
- **pgsodium decision:** resolved by implementation — application-layer AEAD with key-version metadata (`address-aead-v1`). No decision doc named `pii-encryption-implementation-decision.md` exists, but `address-encryption-design.md` covers it. Optional: add a one-paragraph ADR noting pgsodium was not chosen.

---

## The new plan to finish

Ordering principle: unbreak enforcement first, then close the two real Q1 engineering gaps (session refresh, tenant foundation), run operational proof in parallel since it requires decisions more than code, and only then build white-label on top.

### Sprint 0 (this week) — unbreak and decide. Small, all unblockers.

1. **Restore `check:static-guards` in package.json** (deleted in `a5e4f6b`; CI red since 2026-05-26). Aggregate all 7 guards. Confirm CI green.
2. **Name the backup on-call owner.** Zero engineering; unblocks 4 runbooks + public-rollout sign-off.
3. **Fix `scripts/create-super-admin.ts`** — remove the `password123` fallback; require `ADMIN_PASSWORD`.
4. **Finish Sentry→Slack proof** — production-safe app-generated synthetic alert with threshold, runbook link, acknowledgement recorded in `docs/launch-readiness/slack-alerts.md`.

### Sprint 1–2 — Session refresh + close out WS-1

5. **Session state endpoint:** `GET /api/pro/bookings/[id]/session/state` — `requirePro`, ownership check, compact state + state hash, tests.
6. **`useSessionState` polling hook:** 5–10s while active, pause on hidden tab, stop on terminal state; wire into consultation/checkout/cancel/aftercare Pro views. Done when consultation approval and checkout/payment update the Pro UI within 10s.
7. **`lib/typed` + remove the 3 remaining `as unknown as`** (this is a day, not a quarter — the plan's "30 casts" estimate is stale).
8. **Enable stricter tsconfig flags** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`) and fix fallout incrementally; gate new code via CI.
9. **Write `docs/architecture/canonical-modules.md`** indexing the existing contracts and write boundaries.

### Sprint 3–4 — Tenant foundation (WS-4), isolation-tested from PR #1

10. **Tenant model design doc:** finalize field semantics — `tenantId` vs `homeTenantId` vs `proTenantId` vs `clientHomeTenantId` vs `issuerTenantId` per model (not blanket `homeTenantId` everywhere); document the asymmetric visibility rule (tovis-root clients see all Pros; white-label clients see only their tenant's Pros); decide what happens to `NfcCard.salonSlug` (migrate to `tenantId`).
11. **Expand-contract migration:** add `Tenant` + reserved `tovis-root` + nullable columns → backfill → NOT NULL → indexes.
12. **Tenant resolver skeleton + `tenantVisibilityFilter` helper.**
13. **Tenant isolation test matrix in the first tenant PR** (not deferred): cross-tenant profile/booking/media/action-token denial; tovis-root discovery breadth; white-label discovery scoping.
14. **`tools/check-tenant-aware-discovery.mjs`** guard, wired into `check:static-guards`.

### Parallel track (any sprint) — operational proof, mostly decisions + runs

15. **One staging proof cycle** for `verify:launch-ops` (chaos + load) with environment/commit/date recorded in `go-no-go.md`, `test-proof.md`, and the blank `docs/deployment-checklist.md` evidence fields.
16. **Define the traffic model before claiming concurrency targets:** registered users, peak concurrent sessions, RPS by endpoint, booking attempts/min, webhook burst — then set per-route p95/p99 targets in `docs/launch-readiness/load-test-plan.md`. Do not adopt "10k concurrent" as an acceptance criterion without this shape.
17. **Launch-env privacy reruns** (the three unchecked items in `docs/privacy/phase-1-remaining-work.md`).
18. **Build the live Sentry dashboard sections** listed as TODO in `docs/runbooks/booking-funnel.md`; define the TODO alert thresholds.
19. **Complete go-no-go sign-off tables** once 15–18 land.

### After tenant foundation — Q2 scope (white-label enforcement + presentation)

20. Wire `tenantVisibilityFilter` into every discovery route; scope search index, NFC/claim, media/action tokens by tenant.
21. Tenant-resolved brand (extend `lib/brand` from single `tovis.ts` to tenant lookup), tenant-aware email/SMS templates, `check-no-hardcoded-brand-strings.mjs`, custom-domain resolver skeleton.
22. Additional write boundaries (media/notifications/payments/auth) **incrementally, as files are touched** — `writeBoundary.ts` + `contracts.ts` + `queries.ts` shape, no god files. This is hygiene, not a launch blocker; the lifecycle-field-writes guard already covers the riskiest fields.

### Deferred / explicitly de-prioritized

- **Inngest migration:** Vercel crons are adequate for launch. Migrate after session refresh and tenant foundation land, starting with notification processing. Do not put it on the critical path (matches the plan's own correction).
- **Identity field encryption (name/DOB/bio):** Phase 2+ of the PII roadmap; design doc first.
- **TENANT_OWNED Stripe mode:** after PLATFORM_OWNED proves out in partner beta.

### Critical path

```
Sprint 0 fixes ──► staging proof cycle ──► go-no-go sign-offs ──► private beta (tovis-root only)
Session refresh ──┘
Tenant foundation ──► visibility enforcement ──► tenant brand/email/SMS ──► white-label partner beta
```

Private beta does **not** need to wait for any tenant work — it ships as tovis-root. White-label beta gates on the tenant track.
