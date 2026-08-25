# OPEN-WORK — carried out of the drive-migration-wizard session (2026-08-25)

## 🔴 1. TOP PRIORITY — Pro-scope the calendar-import idempotency key

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
