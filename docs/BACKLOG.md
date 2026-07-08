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
- [x] `viewer_event_date` + board-creation signals (spec §7–8) — **#511 MERGED** (`b2c4bb75`, 2026-07-07; deployed). Migration `20260708000000_add_board_context`. Deferred to later steps: §6.6 self-profile write-through, §8.1 countdown notifications + budget, §7.5 auto-archive, §4.4 board-feed scoring (shipped #516), iOS parity (tovis-ios/BACKLOG.md).
- [x] Cold-start fallback for looks with no impressions (§2.1) — **MERGED #512** (`e5eb9194`, 2026-07-07). Additive visibility-floor boost in `lib/looks/ranking.ts` (`LOOK_POST_RANK_COLD_START`: max 45, tapers to 0 at 50 floored impressions / 14 days; decays via the existing view/engagement recompute loop). Deferred §2.1 prong: similar-user priors (needs user volume); onboarding chips landed with the §6.6 pass below.
- [x] Shared-schema pass: user self-profile (§6.6) + affinity time-decay (§6.2) + per-category prior (§4.1) — **MERGED #513** (`eeaf5775`, 2026-07-08; branch deleted). One migration `20260709000000_add_self_profile_and_category_rank_stats`: `ClientProfile.selfProfile` JSONB (+`selfProfileUpdatedAt`) validated by `lib/personalization/selfProfile.ts`; `LookCategoryRankStat` aggregate refreshed by daily cron `/api/internal/jobs/looks-category-rank-stats` and consumed via `resolveLookPostRankPrior` in every rank recompute. Like/save affinity now time-decays (75-day half-life); self-profile interests feed category affinity (the §2.1 onboarding-chips prong); board answers write through to the profile on explicit opt-in (creation flow). Deferred from this pass: skin-tone-range chip + representation/feasibility SCORING of the hair/skin fields (need look-side attributes → §6.0/§4.4), write-through offer on board re-purpose (creation-only today), iOS parity (tovis-ios/BACKLOG.md).
- [x] Visual-embedding pgvector pipeline (§6.0) — **MERGED #514** (`8af5a2e2`, 2026-07-07; branch deleted local+remote). Migration `20260710000000_add_visual_embedding_vectors`: `CREATE EXTENSION vector` + `LookPostEmbedding` (vector(1024) per look) + `ClientTasteVector`/`BoardTasteVector` (§6.1 global/local taste vectors) + `EMBED_LOOK_POST_IMAGE` LooksSocialJob. Embed-at-upload via the publish mutation policy; provider = Voyage AI `voyage-multimodal-3.5` (`VOYAGE_API_KEY`, graceful no-op when unset); `pnpm backfill:look-embeddings` catches up the corpus. Taste vectors = decayed signal-weighted average (same weights/half-life as personalizedFeed affinity), refreshed daily by `/api/internal/jobs/taste-vectors`. Local/CI postgres image switched to `imresamu/postgis:16-3.4-bundle0` (postgis+pgvector). NOT yet deployed: next `vercel --prod` applies the migration. **Operator:** provision `VOYAGE_API_KEY` in Vercel, then run the backfill; recreate local dev/test containers on the new image. Follow-ups: ranking consumption (next item, PR #515), corpus-wide ANN (hnsw index ships with that consumer), look-side attribute schema for representation/feasibility scoring (deferred from §6.6, unblocked by neither tags nor embeddings alone).
- [x] Visual `visual_similarity` ranking consumption (§6.0) — **MERGED #515** (`d284351b`, 2026-07-08; branch deleted local+remote). Additive, confidence-gated cosine boost in the personalized re-rank: `computeVisualSimilarityBoost` in `lib/looks/personalizedRanking.ts` = `visualMax 20 × clampedCosine[0,1] × confidence`, confidence ramping 0→1 over 10 taste signals (`visualConfidenceFullSignals`) so a thin vector barely steers; true cosine (`dot/‖a‖‖b‖`, scale-invariant — taste vectors are L2-normalized, raw look embeddings aren't). New raw-SQL reader `fetchClientTasteVector`; candidate embeddings fetched BY PK per page, only when the viewer has a taste vector (no corpus-wide ANN yet). Calibrated alongside occasion(20)/below follow(25)/above category cap(15). Null-safe / dark until `VOYAGE_API_KEY` + backfill land (feeds byte-identical today). No migration/flag/client surface. Deferred: §6.3 in-session responsiveness, §6.2 board→global bleed, ANN hnsw index (ships with a corpus-wide consumer).
- [x] Board-feed scoring (§4.4) — **MERGED #516** (`5db1f617`, 2026-07-08; branch deleted). NEW owner-only surface: `GET /api/v1/boards/[id]/feed` + a "Recommended for this board" section on the board page (`app/client/(gated)/boards/[boardId]`). Mirrors the personalized-feed architecture: RANKED backbone + occasion/answer/feasibility-tag retrieval injection, then an additive per-candidate re-rank (`lib/looks/boardFeedRanking.ts` → `lib/looks/boardFeed.ts`). Terms (calibrated to the personalized-feed band): `occasion_tag_match` (heaviest, 20 × board.type tags × event proximity), `service_specific_match` (12, board.answers → look tags via new `BOARD_ANSWER_FEED_SIGNALS`), `visual_similarity` (20 × cosine × confidence vs `BoardTasteVector`, reuses `computeVisualSimilarityBoost`; new `fetchBoardTasteVector` reader), `feasibility_match` (10, self-profile person-attrs → look tags via new `selfProfileFeasibilityTagSlugs`), freshness (6). All null-safe; the board's own saved looks are excluded. NO migration / flag / schema change (reuses Board.type/answers, BoardTasteVector, ClientProfile.selfProfile, tags/embeddings — check:api-schema stayed in sync). Dark visual term until `VOYAGE_API_KEY` + backfill land; occasion/answer/feasibility terms are LIVE today (tags exist). Deferred: `availability_boost` (spec §4.4 lists it — no per-look availability primitive exists yet; the personalized feed omits it too), TRUE attribute-level feasibility/representation scoring (needs look-side before/after start-state attributes — the standing §6.6/§4.4 deferral; this ships the buildable tag-level approximation), a "load more" UI (server-capped top-12 today), corpus-wide ANN. iOS parity DEFERRED (tovis-ios/BACKLOG.md — iOS has no board detail screen yet; API is additive).
- [x] In-session visual responsiveness (§6.3) — **MERGED #517** (`56ca4727`, 2026-07-08; branch deleted local+remote). Category/occasion affinity was already in-session responsive (`loadPersonalizedAffinity` re-queries likes/saves every page, so a just-saved look boosts its category next page); the one signal that lagged a full day was the *visual* taste vector (`ClientTasteVector`, rebuilt only by the daily taste-vectors cron). New pure module `lib/personalization/tasteVectorMath.ts` (moved `computeWeightedTasteVector` out of `tasteVectors.ts`, re-exported there; added `blendSessionTasteVector` — split out to keep the `personalizedFeed ↔ tasteVectors` import graph acyclic) folds this sitting's freshest like/save embeddings into an in-request taste delta at load time (2h window, capped, client-gated): no fresh signals → stored vector byte-identical; no mature vector → session seeds a low-confidence direction; both → mature direction rotated toward the fresh centroid, bounded by `SESSION_TASTE_STEER_MAX` (0.6, reached at 3 fresh signals). Observ: `sessionVisualSignalCount` on the feed meta + `looks_feed_serve` log. Additive/dark-safe — NO migration/flag/client surface/schema change (check:api-schema in sync); visual term stays near-dark until prod accrues embedded looks + engagement. iOS parity N/A (no client surface, same as #509/#512/#513/#515). Deferred next: §6.2 board→global taste bleed, §9 metrics/holdout, the naming rename below (only after all in-flight personalized* branches merge).
- [x] Board→global taste bleed / separation rule (§6.2) — **MERGED #518** (`90816430`, 2026-07-08; branch deleted). Audit finding that reshaped this step: the mop-up assumed the remaining prong was *adding* `BoardTasteVector` into the global feed, but board saves ALREADY bleed into global at FULL `AFFINITY_SAVE_WEIGHT` through both projections (`loadPersonalizedAffinity` category affinity + `recomputeClientTasteVector` visual vector) — adding would double-count. The spec's actual unshipped prong is the opposite: the "small fraction" *separation* ("board activity should NOT flood the general feed", §0/§6.2). Shipped: one tunable `BOARD_GLOBAL_BLEED_WEIGHT` (0.15) in `lib/looks/personalizedFeed.ts`, applied to the board-save weight in BOTH global projections; `recomputeBoardTasteVector` keeps FULL save weight locally, so the board's own vector/feed (#516) is untouched and the bleed stays one-directional (Looks-feed likes never write to boards — already true). Declared board PURPOSE (`aggregateBoardContextSignals`, event-decayed) is the deliberate "I know about your wedding" channel and is NOT damped — the fraction governs raw save-engagement only. One-directionality (✓) + time decay (✓, #513) were already shipped; this is the last §6.2 rule. NO migration/flag/schema/client surface (check:api-schema in sync); the visual channel stays dark until backfill accrues, the categorical channel is a live re-rank adjustment. Behavioral (not additive): reduces board-save influence on the discovery feed by design. iOS parity N/A (no client surface). Tests: unit (damped categorical bleed fraction, standalone-save, decay compose) + integration (full like now outweighs the damped board save in the global vector). Deferred next: §9 metrics/holdout, source-tagged/windowed impressions, the naming rename below.
- [x] Rename internal "For You" naming → "personalized" (founder decision 2026-07-07: no TikTok-style "For You"/"FYP" naming anywhere; audit confirmed nothing user-facing says it — code-internal only). **DONE 2026-07-08** (branch `refactor/rename-foryou-to-personalized`, sequenced after #518 merged). Pure internal rename, behavior byte-identical (same tests, new names). Renamed files `lib/looks/{personalizedFeed,personalizedRanking,personalizedFlag}(.test).ts`; all exported/local symbols (`buildPersonalizedFeedPage`, `computePersonalizedScore`, `rankPersonalizedRows`, `personalizedFeedEnabled`, `PERSONALIZED_RANK_WEIGHTS`, `Personalized*` types, plus `route.ts` locals `usePersonalized`/`personalizedMeta`); env `ENABLE_PERSONALIZED_FEED`; log cohort `'personalized'`; comment/doc mentions across `boardFeedRanking.ts`/`boardFeed.ts`/`ranking.ts`/`lib/boards/context.ts`/`lib/personalization/*`/`schema.prisma`/spec §3.1/this file. Left untouched (by design): applied migrations' SQL comments and the defensive `'for you'`/`'for-you'` category filters in `LooksFeed.tsx`/`LooksTopBar.tsx` (guard a real UI string).
- [x] Source-tagged / windowed impressions (§5.6 anti-gaming groundwork) — **DONE 2026-07-08** (branch `feat/algo-source-tagged-impressions`). New enum `LookImpressionSource {FEED,DETAIL,BOARD}` + model `LookPostImpressionStat` (`@@id([lookPostId,source,windowDate])`, `count`, `windowDate DATE`; migration `20260711000000_add_look_impression_stats`). `LookPost.viewCount` stays the lifetime rate denominator; the new table is an ADDITIVE per-source, per-day breakdown written by the APPLY_LOOK_VIEWS job (one upsert per eligible (look,source), window stamped server-side from job-run time — clients never trusted with the date). Client `trackLookView(id, source)` tags feed→FEED / detail→DETAIL and dedupes per (source,look); the views route + job payload accept the source-tagged `impressions:[{lookPostId,source}]` shape AND the legacy `lookPostIds` list (iOS + pre-§5.6 web + jobs queued at deploy → read as FEED), so **iOS keeps working with no change** (its feed impressions are correctly FEED-sourced). BOARD reserved in the enum (the owner-only board feed §4.4 doesn't track views yet). This ships the CAPTURE groundwork only — the data is time-sensitive and can't be backfilled (same rationale as embed-at-upload); the velocity-anomaly READER/check is step 14 and lands with its admin-review consumer (no speculative dead reader). NOT yet deployed: next `vercel --prod` applies the migration (additive, safe). Tests: builder dedup/cap/legacy-fold + source coercion, processor windowed-upsert + eligibility gate, route dual-shape parsing, job dispatch reader, + a real-DB runtime check (viewCount +N alongside FEED/DETAIL window rows). **Operator (local, already done this session):** the dev postgres container was still on the old `postgis/postgis:16-3.4` image (no pgvector) — recreated on `imresamu/postgis:16-3.4-bundle0` per #514; CI/test container was already correct. iOS parity: explicit iOS source tagging is a small deferred item (tovis-ios/BACKLOG.md) — legacy shape already sources iOS feed views as FEED.
- [ ] Deferred: §9 metrics/holdout, similar-user priors. §5.6 velocity-anomaly READER/check (consumes `LookPostImpressionStat`; build with its admin-review consumer, step 14).

## 2. Outshine launch — step-8 wedges
- [ ] ServicePermission filter: move legal caveat → staged, then flip `ENABLE_SERVICE_PERMISSION_FILTER` in prod. (`lib/services/allowedServices.ts`; `licenseScope.ts` is the de-facto SSOT — no admin UI for rows.)
- [x] Camera-usage web endpoint `GET /pro/camera/usage` — PR #508 MERGED + deployed to prod 2026-07-07 (route live, auth-gated 401 confirmed).
- [ ] Reserve-with-Google integration.
- [ ] Flag flips when ready: `ENABLE_NO_SHOW_PROTECTION`, `ENABLE_MEMBERSHIP_ENFORCEMENT`, `ENABLE_PERSONALIZED_FEED`.
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
- [ ] Client media capture/upload OUTSIDE before/after flows — scope the product first (audit 2026-07-07): today clients can only upload review media (`ReviewSection.tsx`) and the share-look BEFORE/AFTER sheet (`ShareLookSheet.tsx`); pros already have the standalone `/pro/media/new` portfolio/Looks uploader. Related gaps found: no surface uses `capture=` (no dedicated in-app camera anywhere, pro or client); `app/api/v1/viral-service-requests/upload` is client-callable but has NO UI wiring; upload kinds `DM_PRIVATE`/`AFTERCARE_PRIVATE` are declared in the pro signing route but unwired (messages UI has no composer/file input, aftercare form has no upload).
- [ ] Orphan-media cleanup job + a media scan/moderation decision.
- [ ] Token hardening: drop legacy `AftercareSummary.publicToken`; migrate `ProClientInvite.token` to hashed storage; confirm NFC card IDs non-enumerable + short-code entropy/rate-limit + duplicate-tap idempotency.
- [ ] Observability: build the live Sentry dashboard sections (`launch-readiness/sentry-dashboard.md` still all TODO) + link provider dashboards; add runbook-link-in-alert-message.
- [ ] Deployed load gate: record per-route p99 (availability/day/hold/finalize/checkout/session-state/media/webhook) into the `traffic-model` "Measured" columns (staging + a deployed run exist per #361; the table is unfilled).

## 9. Web↔iOS parity epic (audit 2026-07-08)
Full screen-by-screen audit of both apps (5 parallel agents; findings + Tori's
layout decisions in memory [[HANDOFF-web-ios-parity]]). Goal: every page matches
across web + iOS (camera / IAP / NFC / SEO excepted). Parity = level **up** — port
the better implementation regardless of platform. iOS-side items also tracked in
`tovis-ios/BACKLOG.md §5`. Sequencing: one screen/PR per session; ship each
feature on both platforms together where it touches both.

**Locked decisions (Tori, 2026-07-08):** (1) keep the iOS Appointments list, add
one back to web; (2) client booking detail → web's tabbed IA wins, add
before/after · care notes · product recs · review · rebook CTA · add-to-calendar
to iOS; (3) pro home → Calendar on both (retire dead iOS `ProOverviewView`);
(4) build first-class iOS Settings/Activity/Aftercare-inbox/Offers/Openings/
Referrals screens; (5) full pro-side parity on iOS (build all); (6) full native
auth on iOS (signup + recovery + onboarding + verification); (7) port all four
iOS wins to web; (8) add iOS's consolidated pro self-profile+settings surface to
web; (9) fold minor drift in (inbox role-awareness FIX + filters, home invite
card, notifications day-grouping).
**Accepted divergences (no work):** camera/best-shots/scrubber + wrap-up AI
critique (iOS-only); membership purchase (web-only, Apple IAP); NFC `/t` `/c`
`/nfc/invalid` + claim-accept (web inbound); public SEO `/p` `/u` + public boards.

### Web workstreams
- [x] **W1 — consolidated pro `/pro/profile` self-service surface** (decision 8) —
  **PR #521 OPEN** (`feat/pro-profile-web-parity`). Ported the iOS Profile-tab
  account section (Workspace / Business / Growth / Appearance theme toggle / Sign
  out) below the tabs; extracted shared `clientSignOut()`. Deviations: Working
  hours → `/pro/calendar`; No-show fees omitted (lives in Payment settings modal).
  typecheck/lint/guards/tests green.
- [ ] **W2 — client Appointments list on web** (decision 1) — restore a standalone
  bucketed list (Upcoming / Needs attention / Pre-booked / Waitlist / Past) to
  match iOS `AppointmentsView`; web currently `redirect('/client')`s the old list.
- [ ] **W3 — port iOS UX wins** (decision 7): open-slot picker replacing raw
  `datetime-local` in new-booking + consultation base+add-on-aware service picker.
- [ ] **W4 — port iOS UX wins, pt2** (decision 7): passwordless phone-OTP login +
  clients-list search bar.

### iOS workstreams (detail in `tovis-ios/BACKLOG.md §5`)
- [ ] **A1 — native auth** (decision 6, biggest structural gap): role chooser →
  client signup → pro 3-step signup → phone+email verify → forgot/reset password →
  pro onboarding checklist → license/document verification. App-Store hygiene.
- [ ] **A2 — client screens** (decision 4): Settings hub (biggest) · Activity ·
  Aftercare inbox · Offers · Openings feed · Referrals activity · Boards
  detail/create/share · Share-your-look.
- [ ] **A3 — client booking detail** rebuilt to web tabbed IA + missing aftercare/
  review pieces (decision 2).
- [ ] **A4 — pro parity** (decision 5): Last Minute editor · Waitlist outreach ·
  chart write-forms · calendar reschedule/offer-a-time modals · money-trail
  inspector · manual reminders · referral-reward config · data-migration wizard ·
  media manager + owner-menu edit · review "feature in portfolio" toggle.
- [ ] **A5 — pro home → Calendar** + delete unused `Tovis/ProOverviewView.swift`.
- [ ] **A6 — minor drift**: Inbox role-awareness FIX (pro sees client name) +
  filter tabs/eyebrows · Home InviteFriendCard + two-column · Notifications
  day-grouping + filter chips.

---

### Note on superseded docs
This backlog replaced these now-deleted planning docs — their open items are captured above; their history is in git:
launch-readiness/{phase-2-remaining-work, finish-plan-2026-06-12, roadmap-corrected-2026-06-12, load-test-plan, traffic-model, load-traffic-model} ·
audits/{premortem-2026-06-24-remediation-plan, HANDOFF-premortem-remediation-2026-06-25} ·
performance/ticket-consolidate-nearby-onto-search-index · refactors/duplicate-logic-consolidation-handoff ·
design/{canonical-catalog-expansion, client-chart-record, nfc-card-growth-ideas, payments-membership-build-spec, pro-migration-licensing-handoff} ·
security/ticket-encrypt-email-at-rest · privacy/phase-1-remaining-work · mobile/native-readiness-handoff.
