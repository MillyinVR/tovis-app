# Tovis — open-work backlog (web / backend / ops)

> Single source of truth for what's actually left to do on **tovis-app**. Created
> 2026-07-07 by consolidating ~19 "planned"/handoff docs that were scattered across
> `docs/{launch-readiness,audits,performance,refactors,design,security,privacy,mobile}`.
> The app is live (deployed through the PR #508 area). iOS-side open work lives in
> `tovis-ios/BACKLOG.md`. Evergreen reference (runbooks, architecture contracts,
> security/privacy design, policies) stays in its own `docs/` subfolders — this file
> is only the open queue.
>
> Convention: `[ ]` open · `[~]` partially done · **(operator)** needs a human/console
> action, not code.

---

## 1. Personalization epoch
Spec: `docs/launch-readiness/personalization-algorithm-spec-v2.md` (18-step build order).
Foundation shipped (rate-based Bayesian rank scoring); remaining:
- [x] Foundation MERGED (#509, 2026-07-07 — the squash included BOTH branch commits, i.e. impression-floor + cutover sweep `edc6cba8` too). Deployed to prod 2026-07-07 (`tovis-keryxnoqs`); prod `recompute:look-rank` sweep run: 1/1 published looks recomputed (2.98 → 8.49), re-run no-op. Branch `feat/algo-foundation-rate-scoring` fully merged → deletable.
- [~] `viewer_event_date` + board-creation signals (spec §7–8) — **#511 MERGED** (`b2c4bb75`, 2026-07-07). NOT yet deployed: next `vercel --prod` applies migration `20260708000000_add_board_context`. Deferred to later steps: §6.6 self-profile write-through, §8.1 countdown notifications + budget, §7.5 auto-archive, §4.4 board-feed scoring, iOS parity (tovis-ios/BACKLOG.md).
- [x] Cold-start fallback for looks with no impressions (§2.1) — **MERGED #512** (`e5eb9194`, 2026-07-07). Additive visibility-floor boost in `lib/looks/ranking.ts` (`LOOK_POST_RANK_COLD_START`: max 45, tapers to 0 at 50 floored impressions / 14 days; decays via the existing view/engagement recompute loop). Deferred §2.1 prong: similar-user priors (needs user volume); onboarding chips landed with the §6.6 pass below.
- [~] Shared-schema pass: user self-profile (§6.6) + affinity time-decay (§6.2) + per-category prior (§4.1) — **PR #513 open, pending merge** (branch `feat/algo-self-profile-schema-pass`). One migration `20260709000000_add_self_profile_and_category_rank_stats`: `ClientProfile.selfProfile` JSONB (+`selfProfileUpdatedAt`) validated by `lib/personalization/selfProfile.ts`; `LookCategoryRankStat` aggregate refreshed by daily cron `/api/internal/jobs/looks-category-rank-stats` and consumed via `resolveLookPostRankPrior` in every rank recompute. Like/save affinity now time-decays (75-day half-life); self-profile interests feed category affinity (the §2.1 onboarding-chips prong); board answers write through to the profile on explicit opt-in (creation flow). Deferred from this pass: skin-tone-range chip + representation/feasibility SCORING of the hair/skin fields (need look-side attributes → §6.0/§4.4), write-through offer on board re-purpose (creation-only today), iOS parity (tovis-ios/BACKLOG.md).
- [x] Visual-embedding pgvector pipeline (§6.0) — **MERGED #514** (`8af5a2e2`, 2026-07-07; branch deleted local+remote). Migration `20260710000000_add_visual_embedding_vectors`: `CREATE EXTENSION vector` + `LookPostEmbedding` (vector(1024) per look) + `ClientTasteVector`/`BoardTasteVector` (§6.1 global/local taste vectors) + `EMBED_LOOK_POST_IMAGE` LooksSocialJob. Embed-at-upload via the publish mutation policy; provider = Voyage AI `voyage-multimodal-3.5` (`VOYAGE_API_KEY`, graceful no-op when unset); `pnpm backfill:look-embeddings` catches up the corpus. Taste vectors = decayed signal-weighted average (same weights/half-life as forYouFeed affinity), refreshed daily by `/api/internal/jobs/taste-vectors`. Local/CI postgres image switched to `imresamu/postgis:16-3.4-bundle0` (postgis+pgvector). NOT yet deployed: next `vercel --prod` applies the migration. **Operator:** provision `VOYAGE_API_KEY` in Vercel, then run the backfill; recreate local dev/test containers on the new image. Follow-ups: ranking consumption (next item, PR #515), corpus-wide ANN (hnsw index ships with that consumer), look-side attribute schema for representation/feasibility scoring (deferred from §6.6, unblocked by neither tags nor embeddings alone).
- [x] Visual `visual_similarity` ranking consumption (§6.0) — **MERGED #515** (`d284351b`, 2026-07-08; branch deleted local+remote). Additive, confidence-gated cosine boost in the For You re-rank: `computeVisualSimilarityBoost` in `lib/looks/forYouRanking.ts` = `visualMax 20 × clampedCosine[0,1] × confidence`, confidence ramping 0→1 over 10 taste signals (`visualConfidenceFullSignals`) so a thin vector barely steers; true cosine (`dot/‖a‖‖b‖`, scale-invariant — taste vectors are L2-normalized, raw look embeddings aren't). New raw-SQL reader `fetchClientTasteVector`; candidate embeddings fetched BY PK per page, only when the viewer has a taste vector (no corpus-wide ANN yet). Calibrated alongside occasion(20)/below follow(25)/above category cap(15). Null-safe / dark until `VOYAGE_API_KEY` + backfill land (feeds byte-identical today). No migration/flag/client surface. Deferred: §6.3 in-session responsiveness, §6.2 board→global bleed, ANN hnsw index (ships with a corpus-wide consumer).
- [~] Board-feed scoring (§4.4) — **built, PR pending** (branch `feat/algo-board-feed-scoring`). NEW owner-only surface: `GET /api/v1/boards/[id]/feed` + a "Recommended for this board" section on the board page (`app/client/(gated)/boards/[boardId]`). Mirrors the For You architecture: RANKED backbone + occasion/answer/feasibility-tag retrieval injection, then an additive per-candidate re-rank (`lib/looks/boardFeedRanking.ts` → `lib/looks/boardFeed.ts`). Terms (calibrated to the For You band): `occasion_tag_match` (heaviest, 20 × board.type tags × event proximity), `service_specific_match` (12, board.answers → look tags via new `BOARD_ANSWER_FEED_SIGNALS`), `visual_similarity` (20 × cosine × confidence vs `BoardTasteVector`, reuses `computeVisualSimilarityBoost`; new `fetchBoardTasteVector` reader), `feasibility_match` (10, self-profile person-attrs → look tags via new `selfProfileFeasibilityTagSlugs`), freshness (6). All null-safe; the board's own saved looks are excluded. NO migration / flag / schema change (reuses Board.type/answers, BoardTasteVector, ClientProfile.selfProfile, tags/embeddings — check:api-schema stayed in sync). Dark visual term until `VOYAGE_API_KEY` + backfill land; occasion/answer/feasibility terms are LIVE today (tags exist). Deferred: `availability_boost` (spec §4.4 lists it — no per-look availability primitive exists yet; For You omits it too), TRUE attribute-level feasibility/representation scoring (needs look-side before/after start-state attributes — the standing §6.6/§4.4 deferral; this ships the buildable tag-level approximation), a "load more" UI (server-capped top-12 today), corpus-wide ANN. iOS parity DEFERRED (tovis-ios/BACKLOG.md — iOS has no board detail screen yet; API is additive).
- [ ] Deferred: §9 metrics/holdout, source-tagged/windowed impressions, similar-user priors, §6.3 in-session responsiveness, §6.2 board→global taste bleed.

## 2. Outshine launch — step-8 wedges
- [ ] ServicePermission filter: move legal caveat → staged, then flip `ENABLE_SERVICE_PERMISSION_FILTER` in prod. (`lib/services/allowedServices.ts`; `licenseScope.ts` is the de-facto SSOT — no admin UI for rows.)
- [x] Camera-usage web endpoint `GET /pro/camera/usage` — PR #508 MERGED + deployed to prod 2026-07-07 (route live, auth-gated 401 confirmed).
- [ ] Reserve-with-Google integration.
- [ ] Flag flips when ready: `ENABLE_NO_SHOW_PROTECTION`, `ENABLE_MEMBERSHIP_ENFORCEMENT`, `ENABLE_FOR_YOU_FEED`.
- [ ] Pro-migration go-live: confirm catalog min prices; Square/Acuity OAuth (Phase 2); flip `ENABLE_PRO_MIGRATION`.

## 3. Premortem remediation — Phase 3/4 + operator
Source (now superseded): `audits/premortem-2026-06-24-remediation-plan.md`, `audits/HANDOFF-premortem-remediation-2026-06-25.md`.
- [ ] **3D** refund/deposit edges: stamp `stripeRefundId` before the call, shared orphan-recovery idempotency key, model partial deposit refunds.
- [ ] **3E** pooled `connection_limit` + `DATABASE_URL_READ` (read replica) + point `DIRECT_URL` at the true unpooled `:5432` endpoint.
- [ ] **1B-pt2** reconciliation cron: pull each PI and assert captured/refunded totals (today only `payment_intent.succeeded` is re-driven).
- [ ] **4A** pin the $0-platform-fee behavior with a test.
- [ ] **4B** document/harden tenant root-fallback: deny unmatched host + test.
- [ ] **4C** write `docs/accepted-risks.md` + a burn-down process for the plaintext-PII and `no-raw-datetime-format` baselines.
- [ ] Deferred **1D**: pooler-safe drain singleton (needs a lock table + migration); provider-side idempotency (`providerMessageId` for Twilio/Postmark) to close the post-send-crash resend window.
- [ ] **(operator)** confirm Supabase PITR + run a restore drill.
- [ ] **(operator)** subscribe the Stripe webhook to `charge.dispute.*`.
- [ ] **(operator)** confirm `AUTH_TRUSTED_IP_HEADER` set in prod.
- [ ] **(operator)** name a backup on-call owner + build/test a P1 escalation path; run ≥1 rollback drill.

## 4. Security / privacy tail
- [~] Email-at-rest (`security/ticket-encrypt-email-at-rest.md` — phase 1 shipped #400): **(operator)** add `email-aead-v1` key + run backfill → Phase 2 read-swap → Phase 3 contract (move `@unique` off plaintext first).
- [ ] Log redaction: add `check:no-raw-error-log` baseline guard for the ~200 generic raw-error log sites (`security/log-redaction-audit.md`).
- [ ] Privacy phase-1 tail (`privacy/phase-1-remaining-work.md`): pro-client matching-flow proof against launch env; final privacy proof rerun on the launch commit.
- [ ] Deferred privacy: message deletion/retention, storage-object byte-deletion workflow, booking-level anonymization (`privacy/retention-policy.md` records the deferrals).

## 5. Performance
- [ ] Fold `nearbyPros` onto the search-index GIST path (`performance/ticket-consolidate-nearby-onto-search-index.md`) — still on the `take:800` bounding-box impl; closes the duplicate geo impl + the missing `(isPrimary,isBookable,lat,lng)` index.
- [ ] Gate 2 real baseline: the CI gate (`perf-availability.yml`) exists but `performance/baselines/availability-gate2-baseline.json` is still a template — run an approved clean-`main` perf run and record it.
- [ ] Enable `exactOptionalPropertyTypes` and burn down the ~283 errors module-by-module (`architecture/canonical-modules.md`).

## 6. Duplicate-logic consolidation (Tier D high-value)
Source (superseded, was stale at #138): `refactors/duplicate-logic-consolidation-handoff.md`. Reconcile against what actually landed through ~#156 before acting.
- [ ] `withRouteIdempotency` wrapper (#15).
- [ ] Conflict-engine merge / `calculateWindowEnd` latent double-book divergence (#16).
- [ ] Delete dead webhook route (#7).
- [ ] Upload-signing `encodeURIComponent` latent bug (#8).

## 7. Product / legal-gated
- [ ] Client technical-record: legal sign-off before flipping `ENABLE_CLIENT_TECHNICAL_RECORD`; empty the founder dogfood allowlist in `technicalRecord.ts` before other pros (`design/client-chart-record.md`).
- [ ] Multi-state onboarding: legal review of v1 state license-requirement data (`lib/usStates.ts` / `licenseRequirement.ts`).
- [ ] Payments (`design/payments-membership-build-spec.md`): Studio/white-label tier, saved-card SetupIntent (phase 2), exact Stripe processing-fee accuracy, final Pro pricing sign-off.
- [ ] NFC growth (`design/nfc-card-growth-ideas.md`, all unbuilt): Tier-1 attribution leaks (authed-tapper consume + bookability check), abuse hygiene (TTL cleanup, short-code rate-limit), refer-a-pro card type.
- [ ] Unclaimed-client pages Phase 2+ (public payment, SMS delivery, pro visibility) — verify against current code first; local grep found no public-payment route.
- [ ] Client-Me / creator loop (product-gated): gamified influence tier (needs thresholds), $10 credit + credit ledger, trending banner, emit save/featured/remix activity events, social cross-post OAuth, moderation jobs for client looks.
- [ ] Waitlist deferred (product/legal): referral attribution + consent, auto-claim (payments + cancellation policy), presence/"N watching" signals, templated "spot open" offer message.
- [ ] White-label (PARKED until a partner signs): per-tenant sender/domain/Stripe attribution/onboarding.

## 8. Media / misc
- [ ] Orphan-media cleanup job + a media scan/moderation decision.
- [ ] Token hardening: drop legacy `AftercareSummary.publicToken`; migrate `ProClientInvite.token` to hashed storage; confirm NFC card IDs non-enumerable + short-code entropy/rate-limit + duplicate-tap idempotency.
- [ ] Observability: build the live Sentry dashboard sections (`launch-readiness/sentry-dashboard.md` still all TODO) + link provider dashboards; add runbook-link-in-alert-message.
- [ ] Deployed load gate: record per-route p99 (availability/day/hold/finalize/checkout/session-state/media/webhook) into the `traffic-model` "Measured" columns (staging + a deployed run exist per #361; the table is unfilled).

---

### Note on superseded docs
This backlog replaced these now-deleted planning docs — their open items are captured above; their history is in git:
launch-readiness/{phase-2-remaining-work, finish-plan-2026-06-12, roadmap-corrected-2026-06-12, load-test-plan, traffic-model, load-traffic-model} ·
audits/{premortem-2026-06-24-remediation-plan, HANDOFF-premortem-remediation-2026-06-25} ·
performance/ticket-consolidate-nearby-onto-search-index · refactors/duplicate-logic-consolidation-handoff ·
design/{canonical-catalog-expansion, client-chart-record, nfc-card-growth-ideas, payments-membership-build-spec, pro-migration-licensing-handoff} ·
security/ticket-encrypt-email-at-rest · privacy/phase-1-remaining-work · mobile/native-readiness-handoff.
