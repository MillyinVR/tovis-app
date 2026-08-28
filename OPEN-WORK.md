# OPEN-WORK — carried out of the drive-migration-wizard session (2026-08-25)

## 🔴 1. Pro-scope the calendar-import idempotency key — CODE DONE, cutover owed

**Status (2026-08-25, PR #1002, merged as caa3c9a4):** the fix is live on main.
`importKey()` now returns `import:<professionalId>:<uid>`; regression tests
(two pros × one shared client + one UID against real Postgres) prove each pro
gets its own booking and per-pro replay still dedupes.

**⏳ Still owed at deploy time:** run the one-time rename once, in the next
deploy window:

```
node scripts/migration-drive/renameImportIdempotencyKeys.mjs          # dry run
node scripts/migration-drive/renameImportIdempotencyKeys.mjs --yes    # apply
```

Verified 2026-08-25: dev DB has **0** `import:*` bookings, so this is a
near-no-op right now — but it must actually run after the first prod deploy
that carries #1002, BEFORE any pro imports a feed on new code. The script is
idempotent and safe to re-run. Once it has run cleanly in prod, delete this
section (and consider removing the script's entry from
`TEMP_ALLOWED_FILES` in `tools/check-booking-write-boundary.mjs`).

**Why top:** two pros importing calendars that share an event UID *and* a client
(same email/phone — common when both exported from the same source app) will
silently drop the second pro's appointments, reported as success. Unexplained
silent data loss at import time is exactly the "duplicate trash / confusing
clients-and-pros" failure mode we do not want live when real pros start
uploading. Fix it BEFORE real pros import at scale.

**What is wrong** (proven by drive run 2, see docs/STATE.md):

- Imported bookings are deduped on `creationIdempotencyKey = import:<uid>`
  (`importKey()` in `lib/migration/calendarImportServer.ts`). The key does NOT
  contain the professional, so `import:same-uid@x` means "done" for EVERY pro.
- Client identity matching (`upsertProClient` → `findMatchedClientProfile`,
  `lib/clients/upsertProClient.ts`) is global by email/phone **by design** — that
  half is CORRECT (one client account across all pros, per product goal) and
  must not be changed. The bug is only the booking bookmark.
- Replay lookup is `(clientId, creationIdempotencyKey)`
  (`lib/booking/writeBoundary.ts`, `tryHydrateProBookingByIdempotency`). With a
  shared client + shared UID, pro B hydrates pro A's booking, gets
  `mutated:false`, and the event is counted `skipped`. No error anywhere.
- Note: CalendarBlocks are already safe — they dedupe on
  `(professionalId, importedEventUid)`.

**The fix:** make `importKey()` return `import:<professionalId>:<uid>` (thread
the pro id through `commitCalendarImport`'s call sites, including
`cancelImportedBookingIfPristine`). Add a regression test: same UID + same
client email across two pros ⇒ each pro gets its own booking.

**Cutover (do NOT skip this part):** after deploy, existing bookmarks under the
old name would no longer match, so the hourly resync would re-import every
already-imported feed once — a wave of duplicate "needs review" entries. Two
options:

1. **Recommended — one-time rename in the deploy window:** update every
   `Booking.creationIdempotencyKey LIKE 'import:%'` to embed its own
   `professionalId`. Today prod has effectively zero imported bookings (the
   wizard is live-but-unexercised), so this is a near-no-op RIGHT NOW and gets
   expensive only once real pros have imported. This is the argument for doing
   item 1 soon rather than later.
2. Fallback — accept a single post-deploy cleanup pass (delete pristine imported
   dupes). Messier; only if the rename can't be scheduled.

## 2. Rollback criteria + staged flip for `ENABLE_RECURRING_APPOINTMENTS`

Switch: `recurringAppointmentsEnabled()` reads the env var
(`lib/booking/series/flag.ts`; truth-teller at runtime:
`GET /api/v1/pro/capabilities` → `recurringAppointments`). K18 scope = series
route + write boundary, NO UI yet — nothing user-visible can go wrong beyond
the API surface itself.

**Flag state today:** OFF everywhere (absent from prod Vercel env listing,
2026-08-25; capabilities probe returns `false`).

**Rollback criteria — flip OFF immediately if any of:**

- A series create/write path produces a booking without a valid
  `seriesId`+occurrence pair, or any non-series booking acquires a `seriesId`.
- Any error spike or 5xx on `/api/v1/pro/series*` attributable to the flag.
- The capabilities endpoint disagrees with the env var (truth-teller broken).
- Anything corrupts schedule cache/version semantics around series occurrences
  (`bumpScheduleVersion` behavior changes vs. baseline).

Rollback = remove/unset the env var (Vercel env + redeploy, or redeploy prior
build); zero migrations involved, so rollback is pure config. Verify OFF via
capabilities probe returning `"recurringAppointments": false`.

**Staged flip plan (staging first, then prod):**

1. Set `ENABLE_RECURRING_APPOINTMENTS=1` on STAGING → redeploy staging.
2. Probe staging capabilities → expect `true`. Exercise the series route on
   staging (create standing appointment; verify occurrence materialization,
   overlap policy, and resync behavior).
3. Tori's explicit OK for prod (deploys are NEVER implied by merge).
4. Prod: set env var in Vercel → deploy → probe prod capabilities → expect
   `true`.
5. Watch error rates for one cycle of the K20 cron before declaring done.

iOS follow-up (needed only when K19 approaches): TovisKit's `ProCapabilities`
(`TovisKit/Sources/TovisKit/ProSettings/ProCapabilities.swift`) decodes only
`noShowFees` + `importFromAnotherApp` today and safely ignores the new third
wire field, so this PR needs no iOS change. Before any native UI reads the
flag, a tiny tovis-ios PR must decode `recurringAppointments` into that struct
(defaulting `ProCapabilities.none` to `false`, per its own rule).

## 3. Owed hygiene

- ✅ **DONE 2026-08-25** — the two stray `mig_*` User rows on the REMOTE dev
  Supabase DB were deleted via
  `node scripts/migration-drive/cleanupRemoteMigRows.mjs` (SELECT-first,
  exact-match-or-abort; removed 2 Users + 2 ProfessionalProfiles + 1 location;
  0 mig_* users remain). Keep the script: any future seed run that forgets
  `seedProLocal.sh` will recreate the problem, and the same script cleans it.

---

# console.error/warn alerting triage (2026-08-28, PR: audit/console-error-triage)

Follow-up to the SENTRY_ENABLE_LOGS audit and the 5-site promotion in
#1020/#1021. `SENTRY_ENABLE_LOGS` defaults to **false** — a deliberate,
documented privacy control (`docs/reference/launch-readiness/risk-register.md`)
— which is **not** in question here. It means `console.error`/`console.warn` is
a debug-only channel with nobody watching, so every site had to be judged on
whether it is the *only* signal for something that actually matters.

## Fresh enumeration (re-derived, not carried over)

| | sites | files |
|---|---|---|
| all non-test `console.error`/`console.warn` | **899** | **507** |
| …in files with no `capture*`/`Sentry.capture*` anywhere | 792 | 456 |

(The prior audit's 649/436 is stale; the tree grew. Test files, `tests/`,
`__tests__/` excluded. Regenerate with a `console\.(error|warn)` grep over
`*.ts,*.tsx,*.mts,*.mjs,*.js` minus `node_modules`.)

## 🔴 The finding that reframed the whole audit

**No unhandled server error in this app has ever reached Sentry.** Not "the
console ones don't" — *none* of them. `@sentry/nextjs` has exactly two routes
into a server error and this app had neither:

1. **Build-time wrapping.** `withSentryConfig` installs `wrappingLoader` only
   through its **webpack** config (`build/cjs/config/webpack.js` lines 221-286);
   the Turbopack path (`build/cjs/config/turbopack/*`) does value injection
   only. Next 16 defaults to Turbopack when no bundler flag is set
   (`next/dist/lib/bundler.js`: *"The default is turbopack when nothing is
   configured"*), `package.json`'s build script passes no flag, and
   `next.config.ts` sets no `webpack` key.
2. **The `onRequestError` hook.** It was not exported from `instrumentation.ts`.

**Proof, on the shipped artifact — not inference:** in the committed build,
**0 of 436** built `route.js` files contain `wrapRouteHandlerWithSentry`, and
`.next/server/instrumentation.js` (plus its chunk) exports `register` with
**0** occurrences of `onRequestError`. The SDK does warn about a missing
`onRequestError` — but that warning also lives in `webpack.js`, so under
Turbopack nobody is ever told.

Consequence: `console.error(err); throw err` was no more visible than
`console.error(err); return jsonFail(500)`. The 15 route catches that
conscientiously rethrew were reaching exactly the same audience as the ones
that swallowed: nobody.

**Fixed in this PR** (`instrumentation.ts` + `lib/observability/requestErrors.ts`).
Headers are dropped before the event is built — `Sentry.captureRequestError`
copies the whole header dict, which here means the `tovis_token` session cookie.
`beforeSend: scrubSentryEvent` would very likely redact it (auditRedaction's
JWT pattern matches an `eyJ…` substring), but "a regex probably catches it" is
not the bar this repo holds PII to, and the headers buy nothing that the route
path and method do not.

## TIER 1 — fixed in this session (9 console sites + 1 wiring fix)

Each one clears the `warnOnDivergentCronSecrets` bar: background or
post-commit, no second signal, and something real breaks while it is down.

| site | why it is silent | why it matters |
|---|---|---|
| `instrumentation.ts` (new export) | see above | every server error, app-wide |
| `internal/jobs/notifications/health` ×2 | **the watchdog's own failure** — while the probe is down every downstream signal reads healthy *because* nothing is measuring | this probe is the reason `notifications/process` is safe to leave console-only |
| `internal/jobs/client-reminders` | it *creates* the reminders the delivery-health probe later measures; a probe over a queue that was never filled reports healthy | appointment reminders, review requests, deposit reminders → no-shows, unpaid deposits |
| `internal/jobs/waitlist-offer-expiry` | the file's own header: this job is the ONLY thing that acts on `expiresAt` | client sits NOTIFIED forever and silently stops being offerable |
| `internal/jobs/last-minute/process` ×2 | sole actor on priority-offer expiry *and* opening fill | client blocked on a countdown that never lands; pro sees an opening nobody took |
| `lib/credit/creditSettlement.ts` ×2 | the module header claims *"FAILURE IS VISIBLE, NOT SILENT… reported by the job as an outstanding liability"* — but that liability is a number in a cron's 200 body that nobody reads | money the platform owes a pro; the client's bill is a destination charge with no application fee, so an unfunded credit is a **pro pay cut** |
| `webhooks/stripe` "failed to mark event failed" | the processing error *has* a backstop (`markEventFailed` + the requeue cron); **this** failure removes it — neither processed nor recorded, so the sweep never sees it | a payment/refund/payout event lost outright |

Helpers: new `lib/observability/scheduledJobEvents.ts`
(`captureScheduledJobException`, mirroring `captureNotificationException`) and
new `lib/observability/requestErrors.ts`. The two money paths reuse the existing
`captureBookingException` rather than inventing a domain.

Every fix has a unit test asserting the capture fires under the failure
condition, and each was **negative-controlled**: with the capture calls stripped,
exactly those 8 assertions fail and nothing else.

## TIER 2 — worth fixing, needs its own session(s): **131 sites**

Counted after this PR. "Covered" = a `capture*` in the same catch region.

| cluster | remaining | notes |
|---|---|---|
| `lib/` background + domain helpers | 56 | biggest and highest-value; `booking/writeBoundary.ts` ×5, `booking/createProBookingWithClient.ts` ×5, `pro/cameraQuota.ts` ×4, `migration/calendarImportServer.ts` ×3, `noShowProtection/charge.ts` ×2, `booking/refunds.ts` ×2 |
| fire-and-forget in request handlers | 39 | `.catch(err => console.error(…))` after the commit — post-booking notifications, referral conversion + reward on `bookings/finalize`, idempotency failure-record updates on the checkout routes. **The absence of a notification is invisible to the user**, so "the client will complain" does not apply here |
| cron routes | 27 (in 11 routes) | of the 27, most are the tidy-up sweeps; see Tier 3 |
| webhooks | 9 | Twilio/Postmark status + inbound; Stripe signature-verification failure (Stripe's own dashboard is a second signal, hence not Tier 1) |

**Cron scoreboard after this PR:** 39 crons = 14 with an explicit `capture*`
+ 14 whose catch rethrows (**now genuinely covered by the new `onRequestError`**,
where before they were not) + 11 still console-only.

### Recommended scheduling — split by domain, not one big session

The clusters need different judgement, and a single 131-site PR is
unreviewable. In priority order:

1. **Money & booking `lib/`** (~15 sites: `refunds.ts`, `cancelRefund.ts`,
   `noShowProtection/charge.ts`, `writeBoundary.ts`). Needs care: several
   already have a *retry sweep* backstop, so the right answer is often
   `level: 'warning'` or nothing at all. Check the sweep before promoting.
2. **Fire-and-forget notification dispatch** (~25 of the 39). One batch, one
   helper (`captureNotificationException` already exists and fits), mostly
   mechanical. Highest ratio of real silence to effort.
3. **Referral conversion / reward + idempotency failure-records** (~8). Money
   and data integrity; deserves a scoped review of its own.
4. **Webhooks + the remaining crons** (~12 worth doing of the 36).

Do **not** batch 1 with 2 — over-alerting is its own failure mode, and the
money paths need per-site judgement that a mechanical sweep will get wrong.

## TIER 3 — correctly left as console-only: **~731 sites**

| cluster | sites | why it is correct |
|---|---|---|
| request-scoped route catch-alls | 431 | the caller gets a 500 and complains; the console line is genuinely supplementary. Now **also** captured when the handler rethrows, thanks to `onRequestError` |
| `tools/` build-time guards | 169 | a human is at a terminal reading the output; a failure fails CI |
| `scripts/` + `prisma/` CLI | 79 | same — run by hand, stdout is the interface |
| client components (`'use client'`) | 47 | browser-side; server Sentry cannot see these regardless of this control |
| server pages / misc | 5 | render-path fallbacks with a visible UI consequence |

Deliberately left alone with a specific reason, and documented in
`scheduledJobEvents.ts` so the next person does not "fix" them:

- `internal/jobs/notifications/process` — every-minute drain, but the
  `notifications/health` probe measures the queue it drains and raises its own
  Sentry alert. **That probe's own failure is now captured (Tier 1), which is
  what makes leaving this one alone safe.**
- `internal/jobs/membership-comp-expiry` — its own header: entitlement reads
  already ignore an expired comp, so the job "only keeps rows tidy".
- `idempotency-retention`, `upload-sessions/cleanup`, `nfc/tap-intent-cleanup`,
  `migration/ramp-step`, `migration/calendar-resync` — housekeeping; nothing
  user-facing degrades while they are down.
- `webhooks/stripe` signature-verification failure — Stripe's own dashboard
  shows failed deliveries.

## Not checked

- **Vercel cron-failure notification settings.** A non-2xx marks a cron run
  failed in Vercel, which is a pull-based signal at best. Whether anyone is
  emailed cannot be established from the repo. If cron-failure alerts *are*
  configured, several Tier 2 crons drop to Tier 3; if not, a couple rise.
  Worth settling before session 4 above.
- **Sentry event volume after `onRequestError`.** This turns on alerting that
  has never been on, so the first days may be noisy. That is the control
  working, but expect to tune `beforeSend` sampling rather than to switch it
  back off.
- **Sentry event volume from the two credit-settlement captures.** Bounded, not
  unbounded: `MAX_TOP_UPS_PER_RUN = 100` caps events per hourly run, Sentry
  groups by exception message so a systemic failure is 1–2 issues rather than
  100, and the transfer leg has never run in prod, so today's volume is zero.
  `CREDIT_TOP_UP_UNPAYABLE` is a *standing* condition and will re-fire hourly
  until a human acts — which is the intent, but it is the first place to look
  if the Sentry quota gets tight.
