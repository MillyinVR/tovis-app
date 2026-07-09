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
Referrals screens + the public client profile `/u/[handle]` viewer + public
boards (social surfaces, not SEO); (5) full pro-side parity on iOS (build all),
incl. the pro's private client view (chart + `view=public` toggle to that
client's public profile); (6) full native
auth on iOS (signup + recovery + onboarding + verification); (7) port all four
iOS wins to web; (8) add iOS's consolidated pro self-profile+settings surface to
web; (9) fold minor drift in (inbox role-awareness FIX + filters, home invite
card, notifications day-grouping).
**Accepted divergences (no work):** camera/best-shots/scrubber + wrap-up AI
critique (iOS-only); membership purchase (web-only, Apple IAP); NFC `/t` `/c`
`/nfc/invalid` + claim-accept (web inbound); public SEO `/p` pro-vanity mirror
(iOS renders the native pro profile instead). NOTE: the public *client* profile
`/u/[handle]` and public boards are NOT accepted divergences — they're iOS build
items (A2), since they're social surfaces (looks/stats/follow), not SEO mirrors.

### Web workstreams
- [x] **W1 — consolidated pro `/pro/profile` self-service surface** (decision 8) —
  **MERGED #521** (`7f4a0382`, 2026-07-08; branch `feat/pro-profile-web-parity`
  deletable). Ported the iOS Profile-tab
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
  - **pt1 SHIPPED (iOS PR #4, branch `native/client-auth-signup`):** role chooser
    (Client / Pro) + client signup screen (name · geocoded ZIP · phone · SMS
    consent · email · password · TOS), wired to `POST /api/v1/auth/register` +
    `PlacesService.resolveClientZip` (geocode + timezone). Pro card points to web
    for now. Routes into the existing phone-verification screen (opens at the code
    step post-signup). swift test 103 pass; xcodebuild green.
  - ⚠️ **BLOCKED end-to-end on the captcha gate — needs an App Attest PR next.**
    `POST /auth/register` hard-requires a Turnstile token (`lib/auth/turnstile.ts`:
    no token → `CAPTCHA_REQUIRED`, even locally) — the reason signup was web-only.
    **Decision (Tori, 2026-07-08): Apple App Attest** is the durable answer (native
    threat model > captcha, no Cloudflare-in-app, reusable for other native-only
    sensitive endpoints — beats WKWebView-Turnstile or a shared-secret bypass).
    Next PR: `lib/auth/appAttest.ts` verify helper + a register-route native branch
    that accepts a valid attestation *in lieu of* `turnstileToken`, plus the iOS
    `DCAppAttestService` provider feeding `registerClient`. That PR flips signup on.
- [ ] **A2 — client screens** (decision 4): Settings hub (biggest) · Activity ·
  Aftercare inbox · Offers · Openings feed · Referrals activity · Boards
  detail/create/share · **public client profile `/u/[handle]` viewer** (looks /
  stats / follow; guest + client viewer modes) · Share-your-look.
- [ ] **A3 — client booking detail** rebuilt to web tabbed IA + missing aftercare/
  review pieces (decision 2).
- [ ] **A4 — pro parity** (decision 5): Last Minute editor · Waitlist outreach ·
  pro's private client view — chart write-forms + technical-record decryption +
  **`view=public` toggle** (chart ↔ that client's public profile) · calendar
  reschedule/offer-a-time modals · money-trail inspector · manual reminders ·
  referral-reward config · data-migration wizard · media manager + owner-menu
  edit · review "feature in portfolio" toggle.
- [ ] **A5 — pro home → Calendar** + delete unused `Tovis/ProOverviewView.swift`.
- [ ] **A6 — minor drift**: Inbox role-awareness FIX (pro sees client name) +
  filter tabs/eyebrows · Home InviteFriendCard + two-column · Notifications
  day-grouping + filter chips.

## 10. Post-appointment payment confirmation + aftercare rebooking (audit 2026-07-08)
> ✅ **COMPLETE (2026-07-08).** PF1 #527 · PF2 #528 · PF3 #529 (web) · PF4 iOS #10 all
> merged. Deferred niceties (need read-endpoint fields) tracked in `tovis-ios/BACKLOG.md §6`.
> ⚠️ Web prod deploy still pending Tori's go-ahead.

Audit of the client post-appointment checkout → aftercare rebooking flow (3 parallel
agents). **Gap:** for off-platform / unverifiable methods (Venmo / Zelle / Cash /
Apple Cash / PayPal) the client checkout route drives the booking straight to `PAID` +
stamps `paymentCollectedAt` on the client's word alone
([checkout/route.ts:327-332](../app/api/v1/client/bookings/%5Bid%5D/checkout/route.ts#L327-L332)),
yet the UI already *promises* pro confirmation
([ClientCheckoutCard.tsx:789](../app/client/(gated)/bookings/%5Bid%5D/ClientCheckoutCard.tsx#L789):
"Once your pro confirms they received payment, your booking will close out") — backend
contradicts UI. There is **no "awaiting pro confirmation of receipt" checkout state**.
Stripe card already correctly waits for the webhook. (Rebooking itself already lives in
aftercare and the session-authenticated path is NOT payment-gated — that half of the ask
already works; no change there.)

**Locked decisions (Tori, 2026-07-08):** (1) **payment-only pending** — the CURRENT
appointment's checkout enters a new `AWAITING_CONFIRMATION` state, not the next
appointment; (2) the client can still book the next appointment **immediately** through the
aftercare summary, but for **aftercare-sourced** next appointments approval is **coupled to
payment confirmation**: the appointment stays `PENDING` until the pro approves the payment,
and approving the payment auto-approves it (`ACCEPTED`) — non-aftercare bookings keep the
normal pro-accept flow; (3) a **new dedicated pro "Confirm payment received" action**
(separate from Mark-paid); (4) ship **web + iOS in parity**.
**Definitions:** "unverifiable" = off-platform set `CASH / VENMO / ZELLE / APPLE_CASH /
PAYPAL`; card rails (`STRIPE_CARD` / `CARD_ON_FILE` / `TAP_TO_PAY`) stay verifiable and
unchanged. **Open Q:** fold `CARD_ON_FILE`/`TAP_TO_PAY` (currently accepted in the client
manual-confirm path) into the pending flow? Left as-is for now — flag before PF1.
**Coupling linkage** = `Booking.rebookOfBookingId` (the `RebookChain` self-relation,
[schema.prisma:2992/3050](../prisma/schema.prisma#L2992)) + `source = AFTERCARE`. All
booking/checkout writes must stay inside `lib/booking/writeBoundary.ts` (respect
`check:booking-boundary` + `check:lifecycle-field-writes`). One PR/session.

### Web workstreams
- [ ] **PF1 — backend foundation: pending-payment state.** Add
  `AWAITING_CONFIRMATION` to `enum BookingCheckoutStatus`
  ([schema.prisma:396-402](../prisma/schema.prisma#L396-L402)) + a Prisma migration
  (additive; **never `db push`** — prod = Supabase "tovis-dev"). Add
  `isUnverifiablePaymentMethod(method)` to `lib/payments/acceptedMethods.ts` (off-platform
  set above). In [checkout/route.ts:322-332](../app/api/v1/client/bookings/%5Bid%5D/checkout/route.ts#L322-L332),
  when `confirmPayment` and the effective method is unverifiable, call
  `updateClientBookingCheckout` with `checkoutStatus: AWAITING_CONFIRMATION`,
  `markPaymentAuthorized: true`, `markPaymentCollected: false` (stamp `paymentAuthorizedAt`
  only, NOT `paymentCollectedAt`; verifiable methods keep the `PAID` path; STRIPE_CARD still
  rejected here). Teach `performLockedUpdateClientBookingCheckout`
  ([writeBoundary.ts ~11943](../lib/booking/writeBoundary.ts)) to accept the new status
  (closeout keys on `paymentCollectedAt`, so it correctly waits). Relax the token-rebook gate
  (`writeBoundary.ts ~11928-11940`) to accept `AWAITING_CONFIRMATION` so the client can rebook
  while payment is pending. Update `lib/dto/checkout.ts` then `npm run gen:api-schema`.
  Tests: unverifiable confirm → `AWAITING_CONFIRMATION` with no `paymentCollectedAt`;
  verifiable path unchanged; rebook allowed while pending.
- [ ] **PF2 — pro confirm action + payment↔appointment coupling.** New write-boundary fn
  `confirmProBookingPaymentReceived(...)` (distinct from `markProBookingCheckoutPaid`
  ~12988): in one locked tx — (a) require `checkoutStatus = AWAITING_CONFIRMATION`, set
  `PAID` + `paymentCollectedAt`, run `maybeCompleteBookingCloseout` + closeout audit
  (`PAYMENT_COLLECTED`); (b) find coupled next appointments
  (`rebookOfBookingId = <this booking>` AND `source = AFTERCARE` AND `status = PENDING`) and
  transition each `PENDING → ACCEPTED` via `recordStatusTransition` (actor PRO/SYSTEM — legal
  per [lifecycleContract.ts:59-87](../lib/booking/lifecycleContract.ts#L59-L87)), emitting
  `BOOKING_CONFIRMED`; (c) emit `PAYMENT_COLLECTED` to the client. New route
  `POST /api/v1/pro/bookings/[id]/checkout/confirm-payment` mirroring
  [mark-paid/route.ts](../app/api/v1/pro/bookings/%5Bid%5D/checkout/mark-paid/route.ts)
  (auth + rate limit + new `IDEMPOTENCY_ROUTES` entry). In
  [finalize/route.ts](../app/api/v1/bookings/finalize/route.ts) `getFinalizeProNotificationMeta`
  (324-339): when a new AFTERCARE-sourced booking's `rebookOf` is `AWAITING_CONFIRMATION`,
  keep it `PENDING` but **suppress the standard `BOOKING_REQUEST_CREATED`** (payment confirm
  is the single approval surface) and emit new key `PAYMENT_CONFIRMATION_REQUIRED`. Add that
  key to `NotificationEventKey` (schema) + `lib/notifications/eventKeys.ts`. Tests: confirm →
  `PAID` + coupled aftercare booking `PENDING→ACCEPTED`; multiple coupled rebooks all approve;
  non-aftercare booking untouched.
- [ ] **PF3 — client + pro UI.** Client:
  [ClientCheckoutCard.tsx](../app/client/(gated)/bookings/%5Bid%5D/ClientCheckoutCard.tsx)
  renders the `AWAITING_CONFIRMATION` state (the 789 copy becomes truthful); aftercare
  "What's next" ([bookings/[id]/page.tsx:1667-1725](../app/client/(gated)/bookings/%5Bid%5D/page.tsx#L1667-L1725),
  `AftercareRebookButton` / `AftercareNextAppointmentCard`) keeps offering rebooking while
  payment is pending and labels a coupled next appointment "pending — your pro will confirm
  after payment" (`loadClientBookingPage.ts` already selects `checkoutStatus`). Pro: a
  "Confirm payment received" control near
  [MarkPaidButton.tsx](../app/pro/bookings/%5Bid%5D/session/MarkPaidButton.tsx) and in the pro
  notifications card, shown when `checkoutStatus = AWAITING_CONFIRMATION`, noting it also
  approves the coupled next appointment. New strings via `lib/copy.ts` (white-label); tone
  utilities only (no raw colors).

### iOS workstream (detail in `tovis-ios/BACKLOG.md §6`)
- [x] **PF4 — iOS parity** — SHIPPED (tovis-ios PR #10). Client AWAITING_CONFIRMATION banner;
  pro session wrap-up "Confirm payment received" → confirm-payment route (auto-approves the
  coupled next booking); PAYMENT_CONFIRMATION_REQUIRED labelled. Used the repo's stringly-typed
  checkout-status/event-key convention (no new enum). Deferred: pro booking-detail confirm
  button + coupled next-booking card + client "Pending confirmation" label (need `checkoutStatus`
  + `rebookOfBookingId` on the pro/client read endpoints — a future backend PR).

## 11. Custom appointment-reminder timing for pros (design 2026-07-08)
Today a pro's client-reminder cadence is three on/off switches — **7 / 3 / 1 days** before
an appointment — stored as `ProReminderSettings.offsetDays Int[]` and surfaced identically on
web ([ReminderCadenceSettings.tsx](../app/pro/notifications/settings/ReminderCadenceSettings.tsx))
and iOS (`ProReminderSettingsView.swift`), via `/api/v1/pro/reminder-settings`. Each reminder
fires at the appointment's own local wall-clock time N calendar days earlier
([appointmentReminders.ts](../lib/notifications/appointmentReminders.ts)); the 15-min drain cron
+ per-minute delivery worker send it, deferring anything landing in quiet hours (22:00–08:00).
The whole send path is welded to three symbolic "kinds" (`ONE_WEEK`/`THREE_DAYS`/`DAY_BEFORE`).
**Gap:** pros can only flip the three fixed switches — they can't choose *when* reminders go out.
Clients have no timing control (on/off + channel only); out of scope.

**Locked decisions (Tori, 2026-07-08):** (1) pros build a **fully custom add/remove list** of
reminders, each with an **arbitrary lead time** — any number of days OR hours before (e.g. "10
days", "2 days", "4 hours"), not limited to 7/3/1; (2) reminders still fire at the appointment's
own local time for day-scale leads (preserve current DST-safe behavior); hour-scale leads fire
exactly that many hours before the appointment instant; (3) keep the current `[7,3,1]`-days
cadence as the **default pre-fill** before a pro personalizes; keep the master enable toggle;
(4) ship **web + iOS in parity**. **Core refactor:** replace the 3 symbolic kinds with a single
scalar unit of identity — **minutes before appointment** (`offsetMinutes`; day = `*1440`, hour =
`*60`, distinguished by `% 1440`). Full design in `~/.claude/plans/the-pros-can-choose-virtual-willow.md`.

### Web workstreams
- [ ] **RT1 — data model + scheduler refactor.** Prisma: `ProReminderSettings.offsetDays Int[]` →
  `offsetMinutes Int[] @default([10080,4320,1440])` ([schema.prisma:2162](../prisma/schema.prisma#L2162));
  hand-edit the migration to backfill `offsetDays*1440` (never auto-drop; **never `db push`** —
  prod = Supabase "tovis-dev"). [settings.ts](../lib/reminderSettings/settings.ts): rename
  `offsetDays`→`offsetMinutes` throughout; replace the `ALLOWED_OFFSET_DAYS` menu-check with
  numeric bounds (int > 0, **min 60 min**, **max 129600 min / 90d**, **multiples of 15**, **max 10**
  per pro, dedupe + sort desc); `REMINDER_OFFSET_OPTIONS` becomes suggested presets. Kill the kind
  model in [appointmentReminders.ts](../lib/notifications/appointmentReminders.ts): delete
  `AppointmentReminderKind`/`APPOINTMENT_REMINDER_KINDS`/`APPOINTMENT_REMINDER_OFFSET_DAYS`/
  `resolveEnabledReminderKinds`; payload `reminderKind`→`offsetMinutes`; dedupe key
  `CLIENT_REMINDER:M${offsetMinutes}:${bookingId}`; `computeAppointmentReminderRunAt` takes minutes
  (whole-day → keep exact DST-safe `shiftLocalCalendarDate` path; sub-day → instant subtraction);
  `buildAppointmentReminderContent` uses a `humanizeLeadTime(offsetMinutes)` humanizer (tomorrow /
  in one week / in N days / in N hours / in N minutes); `parseAppointmentReminderPayload` +
  `payloadsMatch` read `offsetMinutes` and stay **legacy-tolerant** (map old kinds→minutes);
  thread `enabledOffsetMinutes` through `planBookingAppointmentReminders` / `validateDueAppointmentReminder`.
  One-shot data migration rewrites pending `ScheduledClientNotification` rows (kind→`offsetMinutes`
  + new dedupe key) so no reminder is missed across deploy. Drain cron unchanged. Tests: bounds,
  runAt whole-day (incl. DST cross) vs sub-day, dedupe-key format, humanizer copy, legacy parse.
- [ ] **RT2 — quiet-hours cap + API/DTO.** In
  [claimDeliveries.ts](../lib/notifications/delivery/claimDeliveries.ts) `maybeDeferCandidateForQuietHours`:
  for `APPOINTMENT_REMINDER`, if the computed quiet-hours resume `>=` appointment start, **do not
  defer** (send now) so a short-lead reminder never lands after the appointment; plumb the appt
  instant from the payload `scheduledFor` into the candidate select. (In-app is never deferred;
  affects SMS/EMAIL only. Product call: on-time pre-dawn beats useless morning-after.)
  [reminderSettings.ts DTO](../lib/dto/reminderSettings.ts): response `offsetDays`→`offsetMinutes`
  (+ humanized `label` per item, `options`→suggested `presets {value,unit,label}`); request accepts
  structured `reminders:{value,unit:'days'|'hours'}[]` → minutes server-side. Update
  [route.ts](../app/api/v1/pro/reminder-settings/route.ts) GET/PUT; **re-run `npm run gen:api-schema`**
  (else `check:api-schema` fails CI).
- [ ] **RT3 — web UI.** [ReminderCadenceSettings.tsx](../app/pro/notifications/settings/ReminderCadenceSettings.tsx):
  replace the fixed preset toggles with an editable list (number input + days/hours unit selector +
  remove per row; "Add reminder" offering presets as quick-adds); master toggle + empty-list copy
  unchanged; POST the structured `reminders[]`. Tone utilities only (no raw colors), no hardcoded
  brand strings.

### iOS workstream (detail in `tovis-ios/BACKLOG.md`)
- [ ] **RT4 — iOS parity.** `TovisKit/…/ProSettings/ProReminderSettings.swift`: `offsetDays`→
  `offsetMinutes`, add a lead `{value,unit,label}` decodable + structured update payload;
  `ProSettingsService.updateReminderSettings` sends the structured list;
  `ProReminderSettingsView.swift`: editable list (Stepper/Picker per row: value + days/hours + delete;
  "Add reminder" preset quick-adds), master toggle unchanged. `BrandColor`/`BrandFont`, no raw hex.
  Ships alongside RT1–RT3.

## 12. Notification system rework (audit + copy walkthrough 2026-07-08)
Full audit of every notification (email/SMS/push/in-app) across web + iOS (6 parallel
agents) + a one-at-a-time copy walkthrough with Tori over all 46 notification types.
**Full per-notification decision table + feature specs (C1–C5) in
`~/.claude/plans/can-you-do-an-mossy-music.md`.** Pipeline = single choke point
(`enqueueDispatch` → `NotificationDispatch`/`NotificationDelivery` → per-minute drain →
per-channel senders); copy lives at emit sites + `lib/notifications/delivery/renderNotificationContent.ts`;
channel policy in `lib/notifications/eventKeys.ts`. Two auth emails (`lib/auth/{emailVerification,passwordReset}.ts`)
+ OTP (Twilio Verify Console — not in repo) are separate.

### Copy & channel rework — one focused PR (web + iOS), low-risk
- [ ] **NC1 — notification copy pass (web).** Apply the ~35 copy reworks from the plan's
  decision table (add who/what/when specifics + personalize with actor names) across emit
  sites + `renderNotificationContent.ts`. Unify #3/#4 booking-confirmed into one enriched
  string; enrich booking-request/confirmed/rescheduled/cancelled (both sides), consult
  proposal (personalize, no amount), reminders (drop "Reminder:" + manage nudge), aftercare
  (align headlines, stop dumping raw notes — privacy win), payments (fuller receipt/earnings
  lines), waitlist offer (show offered time + urgency), social/looks (actor names + keep
  count aggregation), digest headline, claim invite (**lead with pro, not "TOVIS"** — highest-
  stakes first-touch), handle-expiry (days-remaining). Light polish to the two auth emails
  (greeting + sign-off, keep deliverability-safe). Keep as-is: payment-action-required, OTP,
  admin copy. Respect `check:no-hardcoded-brand-strings` (keep `{brandName}`) + tone utilities.
- [ ] **NC2 — channel moves** (`eventKeys.ts`). Consult approved/declined → in-app only (drop
  EMAIL). Last-minute opening → **+PUSH +EMAIL** on both variants, **+SMS only on the 1:1
  priority offer** (NOT the mass broadcast — Twilio cost + promo-consent/TCPA); needs split
  channel policy by variant. Admin ops (verification/support/viral) → **+PUSH** (EMAIL+in-app
  already on). Push additions only deliver once APNs creds live (see §2 push go-live).
- [ ] **NC3 — removal + link fixes.** Delete the `BOOKING_STARTED` emit (`writeBoundary.ts:5873-5875`
  — client is physically present, redundant). Repoint #15 review-received link → the actual
  review (not `/pro/bookings/{id}`); #37 referred-by → `/client/referrals` (not `/looks`).
- [ ] **NC4 — iOS parity.** Mirror in-app notification strings (`NotificationsView.swift`/
  `ProNotificationsView.swift` are server-fed, so mostly free) + fix the stale "Push —
  Coming soon" disabled label in `NotificationPreferencesView.swift:105` (APNs registration
  ships). Follow the web↔iOS parity rule.

### Push deep-link routing (from the audit)
- [ ] **NC5 — expand iOS push deep-link coverage.** Today only `/client/bookings/{id}` routes
  on tap; query strings are dropped and `ProMainTabView` ignores `pushDeepLink`. Parse
  `?step=`, add `.proBooking`/`.look`/`.offers`/`.referrals`/`.membership`/`.proProfile`
  targets, role-aware cross-shell routing (client↔pro workspace switch before routing), and
  tab-level fallbacks for destinations with no focused screen. Design (parser/router seams,
  per-path destinations) in plan **Part B**. Pairs with NC3's review-received link.

### Feature spin-offs — each its own PR (surfaced during the walkthrough)
> **C2 (off-platform "confirm payment received" notification) is already tracked as §10
> PF2's `PAYMENT_CONFIRMATION_REQUIRED` — do NOT duplicate; align there.**
- [ ] **NC-C1 — last-minute reschedule = late cancellation + fill-the-slot.** A client
  reschedule inside the pro's cancellation-policy window (`ProNoShowSettings.cancelWindowHours`,
  default 24) is treated like a late cancel: same fee **by default**, pro can waive.
  **Waive mechanism DECIDED (Tori): grace-hold-then-charge** — assess + notify, charge only
  after a grace window (~1h, configurable) unless the pro waives; no charge-then-reverse.
  Reuse `isWithinCancelWindow` + `computeNoShowFeeAmount` (`lib/noShowProtection/fee.ts`);
  new deferred-charge path (existing `assessAndChargeNoShowFee` is synchronous) + pre-charge
  waive state; hook `performLockedRescheduleBookingFromHold` (`writeBoundary.ts:7310`, has old
  time). Add `NoShowFeeReason.RESCHEDULE` (or reuse `LATE_CANCEL`). Plus: from the reschedule/
  cancel notification, surface pro **fill-the-slot** actions (seed `createWaitlistOffer` /
  `createLastMinuteOpening` with the freed slot). **Gated on `ENABLE_NO_SHOW_PROTECTION`
  (§2, off in prod).** Real payments logic — flag before build.
- [ ] **NC-C3 — pro resolution actions on failed payment** (from #21). On
  `PAYMENT_ACTION_REQUIRED` (pro side), add "Message {client}" (reuse messaging) and/or a
  "Nudge to update payment" that re-sends the client the resolve link (rate-limited). Pro
  cannot enter card data (Stripe/PCI).
- [ ] **NC-C4 — refund routing: app-collected vs off-platform** (from #23; ties §10, §3D).
  App-collected (Stripe) refunds pull from the pro's connected account / reverse transfer —
  platform must NOT eat the cost. Off-platform (Venmo/cash, `AWAITING_CONFIRMATION` path):
  app never held the funds, so no Stripe refund — pro refunds the client directly; app
  records + notifies (#22/#23) but moves no money ("mark refunded directly" flow distinct
  from Stripe refund). Financial correctness — flag before build.
- [ ] **NC-C5 — booking-time cancellation-policy disclosure + consent capture** (from #24).
  At every client confirm/schedule, surface the pro's cancellation/no-show policy (window +
  fee) and capture explicit acknowledgment (policy snapshot/version + timestamp, persisted
  per booking) for chargeback defense. Web booking finalize + iOS booking flow. Only
  meaningful when the pro has a policy enabled — ties to NC-C1 / `ENABLE_NO_SHOW_PROTECTION`.

## 13. Messaging refinement epic (2026-07-08)
Refine the shared `/messages` inbox + thread for BOTH roles, web + iOS in parity. Kicked off
after Tori flagged the Inbox "feels off" — the root cause was a real bug: iOS showed the wrong
counterparty (a pro saw their own name) because the thread list DTO omitted participant user
ids. iOS side tracked in `tovis-ios/BACKLOG.md §7`. 5 increments, one PR-pair each:
- [x] **M1 — role-aware counterparty + thread polish** — SHIPPED (web #531 + iOS #11). DTO gained
  `isViewerPro` (thread list) + `counterpartyLastReadAt` (thread detail); server derives the
  role from the viewer's user id (dual-role/admin safe). Extracted shared
  `lib/messages/counterparty.ts` (removed the two inlined copies). ThreadClient: read receipts,
  day separators (Today/Yesterday/date), optimistic send + failed/retry. iOS mirrors all of it.
- [x] **M2 — realtime on the messages screens** — SHIPPED web (#533). Extracted a shared
  `useLiveChannels` hook out of `LiveRefresh` (subscribe/debounce/visibility, no dup logic);
  mounted `RefreshOnFocus` + `LiveRefresh` on the inbox and wired the thread to `fetchLatest()`
  on a `user:{id}` broadcast (poll/focus stay as a fail-open safety net). iOS was already at
  parity: its app-global `user:{id}` subscriber (iOS commit `5033dc0`) bumps `refreshTick`, which
  the inbox + thread both observe — so M2 was web catching up, no iOS PR.
- [ ] **M3 — inbox polish parity.** iOS gains web's 4 filter tabs + context eyebrows (M3 also
  clears the A6/§7 inbox-filter item on iOS). Consider adding search + a numeric per-row unread
  count (both platforms only show a binary dot) + surfacing zero-message threads.
- [ ] **M4 — richer thread + composer.** Attachment/media composer (both platforms only RENDER
  attachments — can't send) + "load older" history paging (server cursor `nextCursor`/`hasMore`
  exists but neither UI uses it). A message deep-link/push target so a notification opens the thread.
- [ ] **M5 — dedup + hardening.** Extract the remaining duplicated eyebrow/context logic across
  `app/messages/page.tsx` + `thread/[id]/page.tsx`; reconcile the inbox `take` mismatch (SSR 60 vs
  `/threads` API 50); add route-level tests for the messaging endpoints (currently none).

---

## 14. Finance tab restructure epic (audit 2026-07-08)
Restructure the Pro Finance & Tax tab from Overview · Expenses · Write-Offs · Export
into Overview · Tax · Expenses · Export — no two tabs with overlapping jobs. Data model,
expense CRUD, income aggregation, category config, and export are already built (shipped
early July); this epic is UI/aggregation only. Decisions locked with Tori 2026-07-08:
Tax v1 = recommended set-aside + deadline only (NO saved-amount input / no real gap, no
new persistence); merge UX = category-first detail views. iOS parity tracked in
`tovis-ios/BACKLOG.md §8`.

### Web workstreams
- [ ] **F1 — Merge Expenses + Write-Offs into a category-first flow.** Replace the flat
  add-expense form with a clickable list of IRS categories (reuse `EXPENSE_CATEGORIES` /
  risk colors from `lib/finance/expenseCategories.ts`). Tapping a row opens a category
  detail view: add/edit expense entries for that category with the category's risk
  guidance (tooltip + examples + green/yellow/red) surfaced inline. Retire the standalone
  Write-Offs tab (fold its content into the detail views). Keep the existing expenses CRUD
  API unchanged. One PR.
- [ ] **F2 — Receipt photo capture in the category detail view.** Wire the existing media
  pipeline (`lib/media/uploadSession` + `RemoteImage`) into F1's detail view: camera
  capture or device image upload → `recordMediaAsset` → pass `receiptMediaId` on expense
  create/edit (API + schema already accept it). Render the attached receipt thumbnail on
  each expense row and in the receipt-inbox review section (currently stores
  `receiptMediaId` but never displays it). One PR; can stack on F1.
- [ ] **F3 — Split Overview into monthly Overview + quarterly Tax tabs.** Add a Tax
  sub-tab; move the est-tax card + quarterly reminder OUT of Overview into it. Overview
  keeps monthly Services/Tips/Products income, expenses, net. Add a `quarter` scope
  (reuse `monthKeysForScope` / `ensureProfessionalMonthlyAnalytics` summing pattern from
  `lib/finance/financeExportData.ts`) so the Tax tab shows, per IRS quarter
  (`ESTIMATED_TAX_DUE_DATES`): income earned, recommended set-aside (~28% via
  `SELF_EMPLOYMENT_ESTIMATE_RATE`), and the next estimated-payment deadline. v1 =
  recommended amount only (no "actually saved" / gap). One PR.
- [ ] **F4 (later / deferred) — Real set-aside tracking + live gap.** Let the pro log the
  amount actually set aside per quarter so gap = recommended − saved is real. Needs a new
  Prisma field/model + save API + UI. Explicitly OUT of v1 (Tori 2026-07-08); park until
  the recommended-only Tax view has shipped and there's demand.

### iOS workstream (detail in `tovis-ios/BACKLOG.md §8`)
- [ ] Mirror F1–F3 in the native Finance screens (category-first merge, receipt capture
  via native camera/photo picker, Overview/Tax split). Defer F4 with web.

## 15. iOS signup / new-user registration audit (2026-07-08)
End-to-end audit of the native new-user registration flow (context: iOS had **no**
signup at all in early July — a hard launch blocker: "if a new client on iOS can't
create an account, nothing else matters"; built 2026-07-07/08). Bottom line: **the
native signup flow is real and mostly PASSES** — it is NOT the "biggest structural
gap" that §9 `A1` / `tovis-ios §5 A1` still imply (that framing is stale, written
pre-build). Verified working: role chooser → client + pro (3-step) email/password
signup (real `POST /api/v1/auth/register`, App Attest in lieu of Turnstile) · phone
OTP verification · **Sign in with Apple** (creates the account) · forgot/reset
password. New CLIENT correctly lands on the **Looks feed** (`MainTabView` defaults
to `.looks`). No stubs/TODOs in the signup path. Three gaps remain (below); none
block the Apple or phone-login paths, one blocks the primary email/password path.

**Pass/fail:** phone OTP ✅ · Apple ✅ (creates accounts) · email/password account
creation ✅ but **email-verification finish ❌ (A7)** · Google ❌ absent (A8) ·
TikTok ➖ absent on both platforms, parked (A9) · client→Looks landing ✅.

### iOS workstreams (build later; mirror into `tovis-ios/BACKLOG.md §5` when scheduled)
- [ ] **A7 — email-verification completion path (REAL DEFECT; blocks the primary
  email/password signup).** A new email/password user verifies phone, then
  dead-ends: `SessionModel.verifyPhoneCode` finds email still unverified and only
  sets `errorMessage = "Your phone is verified. Check your email to finish."`
  (`tovis-ios Tovis/ContentView.swift:362-366`), stranding them on the phone-verify
  screen. There is no in-app way to finish: `AuthService` has no email
  send/verify/status method (only phone + password-reset); `.onOpenURL` is scoped
  only to `/reset-password/*` (`ContentView.swift:109-111,643`) so the emailed verify
  link opens web, not the app; and there's no verification-status re-poll. App entry
  is gated on `isFullyVerified`, and the shared register endpoint always returns
  `requiresEmailVerification:true` / `isFullyVerified:false` for email/password
  signups (`app/api/v1/auth/register/route.ts:1358-1361`) — so this is the normal
  path, not an edge case. Only current escape: tap the web email link → force-quit →
  re-login. Apple/phone-login dodge it (Apple pre-verifies email). **Build:** a
  verify-email screen (or extend the phone-verify screen) with an in-app "resend
  email" action + a status re-check (`GET /auth/verification/status`) that advances
  to `.signedIn` once email is confirmed — or an email-verify deep link (extend AASA
  + `onOpenURL`). Mirror web `app/(auth)/verify-phone/page.tsx` (handles phone +
  email resend/status). Endpoints already exist: `/auth/email/send`,
  `/auth/email/verify`, `/auth/verification/status`.
- [ ] **A8 — Google Sign-In (web-parity port; mostly client-side).** Web offers
  Google account creation on client signup; iOS has none (no Google SDK anywhere).
  The server endpoint already exists and is documented native-reusable: `POST
  /api/v1/auth/google` verifies the Google identity token, find-or-creates a CLIENT
  user (email pre-verified, phone not), and returns the same session payload as Apple
  (`app/api/v1/auth/google/route.ts`, `lib/auth/findOrCreateGoogleUser.ts`). iOS work
  ≈ clone the working Apple path: Google Sign-In SDK → ID token → `POST /auth/google`
  with `deviceId` → `handleAuthResult` (lands at phone verify → Looks). Gate the
  button on a configured client id (parity with web's inert-until-provisioned
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
- [ ] **A9 — TikTok login (PARKED, Tori 2026-07-08; greenfield, NOT a drop-in).**
  Exists on neither platform (TikTok is only a pro profile social link today). ⚠️
  Unlike Apple/Google (verifiable `id_token` carrying a verified email), TikTok Login
  Kit is an OAuth2 auth-code + PKCE flow whose `user.info.basic` scope returns only
  `open_id`/`union_id`/name/avatar — **no email**. Tovis accounts are email-keyed
  (contact-lookup hash + email-at-rest), so a TikTok-only account can't satisfy the
  `findOrCreate*` invariants → needs a post-auth collect-email(+phone) step, a new
  `POST /api/v1/auth/tiktok` (code→token exchange + user-info fetch — a different
  shape from apple/google token-verify), `findOrCreateTikTokUser`, a TikTok for
  Developers app (client key/secret, redirect URI, **app review** before prod), and
  the iOS TikTok LoginKit SDK + URL scheme. Decide the email-collection UX with Tori
  before scheduling; parked for now.

### Web workstream
- [ ] Nothing required for A7/A8 — web is the parity leader (both already ship:
  `SocialSignIn.tsx` + `/auth/google`; `app/(auth)/verify-phone/page.tsx` email
  resend/status). A9 (TikTok) would additionally need the web `/auth/tiktok` half,
  but is parked with the iOS side.

## 16. Pro account menu can't scroll — bottom items unreachable (audit 2026-07-08)
The pro account dropdown (⋯ menu in `ProHeader`) renders a fixed, fairly tall list —
identity header → View as client → Studio (3) → Content (4: Looks, Upload, Messages,
Referral rewards) → footer (Switch workspace + **Sign out**), ~650–720px of content.
The panel is `absolute`, top-anchored, `overflow-hidden` with **no `max-height` and
no internal scroll region** (`panelBase`, `app/pro/_components/ProAccountMenu.tsx:205-206`),
and opening it locks page scroll via `document.documentElement.style.overflow = 'hidden'`
(same file, `:125-134`). Result: on any viewport shorter than ~780px usable height, the
bottom of the list — including **Sign out** — is painted off-screen with no way to reach it.

- **Affects:** mobile web (most phones once address-bar chrome counts) and short/zoomed
  desktop windows. Not iOS. Width (`w-[min(384px,92vw)]`) is fine; height is the issue.
- **Scope:** pro-only. Audited the client side — there is no equivalent client account
  dropdown (client account lives in the `ClientSessionFooter` tab bar + the scrollable
  `ClientMeDashboard` "Me" page, whose container is `h-full overflow-y-auto`), so the bug
  does not reproduce there.
- **Root cause:** no bounded height + no `overflow-y-auto` on the panel, plus the
  page-scroll lock removes the fallback of scrolling the page.

**Fix (decided with Tori — sticky header/footer, scroll the middle):**
- [ ] **`ProAccountMenu.tsx` (the bug).** Split the panel into `flex flex-col` with a
  `max-h-[calc(100dvh-~88px)]` bound; pin header (`shrink-0`) and footer (`shrink-0`,
  keep border-top); wrap the middle sections in a `flex-1 overflow-y-auto` region. Keep
  `overflow-hidden` on the outer panel for the rounded corners; keep the page-scroll lock
  (now correct). Use `dvh` not `vh`. Single-file change; no new deps. Confirm the real
  header height before hardcoding the `max-h` offset.
- [ ] **`SwitchAccountSheet.tsx` (latent hardening; shared pro+client).** The panel `<div>`
  (`app/_components/AdminSessionFooter/SwitchAccountSheet.tsx:130-142`) has `maxWidth: 380`
  but **no `maxHeight` and no `overflowY`**, and its container is `fixed inset-0;
  align-items: flex-end`, so a list taller than the viewport would push the header off the
  top with no scroll. Harmless today (workspace options cap at the 3 roles), but cheap to
  harden while in the area: add `maxHeight: 'min(70dvh, …)'` + `overflowY: 'auto'` to the
  panel. Not blocking; do it in the same PR.
- **Verify at:** mobile portrait + a ~700px-tall desktop window; confirm Sign out is always
  visible and the middle list scrolls in the pro menu. For the sheet, no behavior change
  expected with ≤3 rows.

---

### Note on superseded docs
This backlog replaced these now-deleted planning docs — their open items are captured above; their history is in git:
launch-readiness/{phase-2-remaining-work, finish-plan-2026-06-12, roadmap-corrected-2026-06-12, load-test-plan, traffic-model, load-traffic-model} ·
audits/{premortem-2026-06-24-remediation-plan, HANDOFF-premortem-remediation-2026-06-25} ·
performance/ticket-consolidate-nearby-onto-search-index · refactors/duplicate-logic-consolidation-handoff ·
design/{canonical-catalog-expansion, client-chart-record, nfc-card-growth-ideas, payments-membership-build-spec, pro-migration-licensing-handoff} ·
security/ticket-encrypt-email-at-rest · privacy/phase-1-remaining-work · mobile/native-readiness-handoff.
