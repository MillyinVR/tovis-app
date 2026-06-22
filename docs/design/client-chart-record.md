# Client chart — pro-facing record: design & build plan

**Status:** Design approved, not built. 2026-06-21.
**Owner surface:** `app/pro/clients/[id]/` (the pro-facing client chart) + `lib/clientVisibility.ts`.

This turns the pro-facing client page from a contact card into an actual
professional record: a 30-day post-visit access window, a readable redesign,
and a roadmap of relationship/technical/compliance data — with a clear
two-tier access model so safety data travels but craft stays with its author.

---

## Background — what already exists (don't rebuild)

The page is live at `app/pro/clients/[id]/page.tsx` and already renders: pro
notes, allergies, service history (search/filter), product recommendations,
reviews the client left, and cross-pro "pro feedback." It is reached via
`ClientNameLink` (`app/_components/ClientNameLink.tsx`) from the bookings list,
booking detail, reminders, and clients list.

**One switch controls all access:** `visibilityOr()` in
`lib/clientVisibility.ts:12`. It feeds the page gate (`assertProCanViewClient`),
the clickable name, AND every write route — confirmed: `notes`, `allergies`,
`alert`, `service-addresses` under `app/api/pro/clients/[id]/` all call
`assertProCanViewClient`. Widen the window in one place and view + edit + the
clickable name all extend together.

**Current access policy** (the bug the user noticed): access exists only while a
booking is PENDING, in-progress, or accepted-upcoming. The moment a visit
**completes**, access drops to zero and the client disappears from the clients
list. That's why the chart felt "lost" after an appointment.

**Schema reuse already present** (verified in `prisma/schema.prisma`):
- `ClientProfile.dateOfBirth` — birthday is free.
- `ClientProfile.preferredContactMethod` (`ContactMethod`) — contact pref is free.
- `MediaAsset.bookingId` (schema.prisma:645) + `primaryServiceId` — photos are
  already scoped to bookings; a per-visit timeline is a *view*, not new plumbing.
- `ClientNoteVisibility { PROFESSIONALS_ONLY, ADMIN_ONLY, PRIVATE_TO_AUTHOR }` —
  the visibility tiers needed below already exist.
- `Referral` model + `AttributionEvent` + `BookingReason.REQUESTED` /
  `DISCOVERY_SEARCH` — referral source is largely derivable.
- `publicShareGuard.ts` — already enforces that client media may go public only
  when **review-promoted** (`reviewId` set). This is the "client makes it public
  via a review" path; reuse it, don't reinvent.
- PII-at-rest encryption pattern: `lib/security/notesPrivacy.ts`
  (`encryptedNoteInput`), mirrored by `phoneEncrypted`. Any new free-text PII
  (formula notes, consultation notes) must follow this dual-write pattern.

---

## Decisions (locked)

0. **Pros-only — clients never see or edit the chart.** The private chart (notes,
   formula, allergies, history, relationship intelligence) is exclusively a pro
   surface. No client-facing route to it exists, and none may be added. This is
   already enforced and must stay enforced: the page gates on `role === 'PRO'` +
   `professionalProfile` (`app/pro/clients/[id]/page.tsx:802`) and every write
   route gates on `requirePro()` (`app/api/_utils/auth/requirePro.ts`). The only
   client-controlled data anywhere in this feature is the client's OWN public
   profile, which they edit via their own settings — the chart's `?view=public`
   mode merely *reads* it.

1. **30-day post-visit window.** After a visit completes, the pro keeps full
   view + edit access for 30 days. Hard cutoff after that. **Rebooking re-opens**
   full access automatically (a new pending/upcoming booking already matches the
   existing rules — no extra code).

2. **Two-tier retention.**
   - *Ambient chart visibility* (cross-pro history browse, the relationship
     layer) → governed by the 30-day window.
   - *Pro-authored operational records* (formula history, that pro's
     consent/patch-test records, their own notes) → **persist long-term for the
     authoring pro**, independent of the window. This is the lock-in/safety value;
     it must not vanish at 30 days.

3. **Safety travels, craft stays with its author.**

   | Data | Same pro returning | A *different* booked pro | Public profile |
   |---|---|---|---|
   | **Safety** — allergies, patch-test result, consent, photo-release status | ✅ always | ✅ **travels** | ❌ |
   | **Craft** — formula history | ✅ always | ❌ private to author | ❌ (never public) |
   | **Craft** — before/after photos | ✅ always | ❌ private to author | ✅ only if client promotes via a review |
   | Reviews the client left | ✅ | ✅ | already public per review |

   - Safety data travels to any pro with access — liability, not IP.
   - Craft defaults `PRIVATE_TO_AUTHOR`. Photos go public **only** through the
     existing review-promotion path (`reviewId` set, `publicShareGuard.ts`).
     Formula text never goes public.

4. **Readability:** pinned safety strip (always visible) + tabbed sections.

5. **Dual-view mode toggle.** A prominent segmented toggle at the top of the
   chart lets the pro switch how they're viewing the client:
   - **Chart** — the private professional record (safety strip + tabs: notes,
     formula, allergies, history…). What the pro is building.
   - **Public profile** — what the world sees: the client's public handle, bio,
     avatar, follower/look counts, looks grid, and public reviews.
   Reuse the existing public-profile rendering — `app/u/[handle]/page.tsx` +
   `app/u/[handle]/_data/loadPublicClientProfile.ts` + its `_components` — rather
   than duplicating (house rule: no duplicate logic). The loader returns null
   when the client hasn't opted into a public profile, which drives a clean
   "this client hasn't made a public profile yet" empty state. No new PII
   exposure: the pro already knows the client (they're booked), and this content
   is literally public.

---

## Open / deferred (needs product or legal input)

- Consent waivers, patch-test records, photo-release: **legal review still
  required before prod** (liability, retention, audit, photo-consent law e.g.
  BIPA). PR4 is BUILT but ships **behind `ENABLE_CLIENT_TECHNICAL_RECORD`
  (off in prod)** and the migration is held for a separate apply — do not flip
  the flag in prod until legal signs off.
- "Do not rebook" flag: must stay strictly factual (discrimination liability).
- ~~Exact long-tier retention duration (indefinite vs. 18mo) — pick before PR4.~~
  **Decided 2026-06-21: INDEFINITE.** Encoded as the single `TECHNICAL_RECORD_RETENTION`
  constant in `lib/clients/technicalRecord.ts`; switching to 18mo later is a
  one-line change plus a cleanup job. Still pending legal confirmation alongside
  the flag flip.
- Cross-pro exposure widens under a 30-day window (more pros hold an open window
  at once). Confirm the existing all-pros "pro feedback" sharing is still wanted
  at that wider access before PR1 ships.

---

## Build sequence

Four PRs. PR1 is the behavioral core and is independently shippable. PR2 is the
redesign. PR3 is light data adds. PR4 is the compliance/differentiator track.

Each step below has a **ready-to-paste prompt** for a fresh Claude Code session.
Paste one at a time; let it open a PR before moving to the next.

---

### PR1 — 30-day window + consolidate visibility to one source of truth

> **Prompt — paste into Claude Code:**
>
> Read `docs/design/client-chart-record.md` first, then implement **PR1** only.
>
> Goal: pros keep full view + edit access to a client's chart for **30 days
> after a visit completes**, then hard cutoff; rebooking re-opens access.
>
> 1. In `lib/clientVisibility.ts`, the visibility rule currently lives in THREE
>    diverged places: `visibilityOr()`, the inline `visibleBookingWhere` in
>    `app/pro/clients/page.tsx:46`, and the batch `getVisibleClientIdSetForPro`.
>    Consolidate them into ONE exported `proClientVisibilityWhere(now)` that all
>    three consume, so the clients list, the clickable name, and the page gate
>    can never disagree.
> 2. Add a 4th clause to that rule: `status COMPLETED AND
>    COALESCE(finishedAt, scheduledFor) >= now - 30 days`. In Prisma express the
>    fallback as `{ status: COMPLETED, OR: [{ finishedAt: { gte: cutoff } },
>    { finishedAt: null, scheduledFor: { gte: cutoff } }] }`. CANCELLED/no-show
>    never count. Use a single `RECENT_COMPLETED_WINDOW_DAYS = 30` constant.
> 3. Add a `RECENT_COMPLETED` reason and have `getProClientVisibility` also
>    return `accessUntil: Date | null` (the cutoff) for the UI to show a
>    countdown. Keep priority deterministic: ACTIVE > PENDING > UPCOMING_ACCEPTED
>    > RECENT_COMPLETED.
> 4. Do NOT touch the chart's data queries (`bookingWhereForFilter` etc.) — only
>    the gate/visibility. Once the gate passes, existing data rendering is
>    unchanged.
> 5. Tests (`lib/clientVisibility.test.ts` or sibling): completed 29 days ago =
>    visible, 31 = not, cancelled = never, `finishedAt: null` falls back to
>    `scheduledFor`, pending re-opens. Add a guard/grep note that no 4th copy of
>    the rule reappears.
>
> Scope guard: this PR is visibility only. No schema migration (uses existing
> `finishedAt`/`status`). Run `npm run typecheck`, `npm run check:static-guards`,
> and vitest before opening the PR. Title: `feat(pro): 30-day post-visit client
> chart access window`.

---

### PR2 — Chart redesign: pinned safety strip + tabs + derived intelligence

> **Prompt — paste into Claude Code:**
>
> Read `docs/design/client-chart-record.md` first, then implement **PR2** only.
> Assumes PR1 (30-day window + `accessUntil`) is merged.
>
> Redesign `app/pro/clients/[id]/page.tsx` for fast reading mid-appointment:
>
> 0. **Dual-view mode toggle** — a prominent segmented control at the very top
>    (above the safety strip), switching the whole body between two modes via a
>    URL param `?view=chart` (default) and `?view=public`:
>    - **Chart** = the private record below (safety strip + tabs).
>    - **Public profile** = what the world sees. **Reuse**
>      `app/u/[handle]/_data/loadPublicClientProfile.ts` and the
>      `app/u/[handle]/_components` — do NOT duplicate. The loader keys off
>      `handle`; either resolve the client's handle from `clientId` first, or add
>      a `loadPublicClientProfileByClientId` sibling that shares the same body.
>      Extract the public-profile render into a shared component if needed so both
>      `/u/[handle]` and the chart use one source.
>    - When the client isn't public (`isPublicProfile` false / no handle, loader
>      returns null), show a clean empty state: "This client hasn't made a public
>      profile yet." Don't error.
>    - The pinned safety strip + tabs belong to Chart mode; the window-countdown
>      badge stays visible in both. Make the toggle visually unmistakable
>      (segmented control, not a subtle link).
>
> 1. **Pinned safety strip** at the very top of Chart mode, always visible above
>    the tabs:
>    the ⚠ alert banner (when set), allergy chips (label + severity), and a
>    **window-countdown badge** built from `accessUntil` ("Access open · 24 days
>    left" / "Closes Jul 21"). Replace the meaningless `Visibility: Granted`
>    line (page.tsx:937) with this badge.
> 2. **Convert the anchor nav (page.tsx:1021) into real tabs.** Prefer
>    **URL-param tabs** (`?tab=notes`, server-rendered, deep-linkable, back-button
>    works) over a client component — and only query the active tab's data
>    (today all 5 queries with `take: 2000` run every load). Default tab = Notes.
> 3. **Derived "relationship intelligence"** (no schema — pure aggregation over
>    bookings/reviews already loaded), surfaced in the summary/flags area:
>    - Lifetime value: sum of `totalAmount`/`subtotalSnapshot`, with-you
>      (`professionalId`) vs platform-wide.
>    - Booking patterns: cadence ("~every 6 wks"), lead time, no-show/cancel
>      count, preferred day/time.
>    - Rebooking status: did they return after the last visit; flag retention
>      risk ("hasn't rebooked in 8 wks, usual interval 6").
>    - Surface existing `dateOfBirth` (birthday) and `preferredContactMethod`.
>    - Referral source from `Referral`/`AttributionEvent` if cheaply derivable.
> 4. **Smart-flags strip** (computed, no new tables): lapsed-vs-usual-interval,
>    low-review-no-note, birthday-soon, referred-N-people. Put it in/near the
>    pinned zone.
> 5. **Before/after photo timeline:** per-visit gallery using
>    `MediaAsset.bookingId`, gated by photo-release/visibility (see design doc
>    access matrix). Read-only here.
>
> Scope guard: presentation + derivation only, no schema changes. Keep it
> server-rendered where possible. typecheck + static-guards + vitest before PR.
> Title: `feat(pro): client chart redesign — chart/public toggle, safety strip,
> tabs, relationship intelligence`.

---

### PR3 — Light data adds: typed notes, profile fields, do-not-rebook

> **Prompt — paste into Claude Code:**
>
> Read `docs/design/client-chart-record.md` first, then implement **PR3** only.
>
> Low-risk schema/data additions. Follow the existing PII encryption pattern
> (`lib/security/notesPrivacy.ts` `encryptedNoteInput`, dual-write) for any new
> free-text PII.
>
> 1. **Typed notes:** add a `kind`/`category` discriminator to
>    `ClientProfessionalNote` (e.g. GENERAL / CONSULTATION / COMMUNICATION_STYLE)
>    rather than new tables; render grouped on the chart. Expand-phase migration.
> 2. **ClientProfile fields:** `occupation` (optional, encrypted),
>    pro-captured social handle for tagging (distinct from the client's own
>    creator `handle`). Surface in the chart + edit forms.
> 3. **"Do not rebook" flag:** private-to-author boolean + reason note using
>    `ClientNoteVisibility.PRIVATE_TO_AUTHOR`, author-scoped. Render only to the
>    authoring pro. Keep copy strictly factual — discrimination liability; add a
>    short helper text to that effect in the form.
>
> Scope guard: additive migrations only (expand pattern — see
> `docs/design/` precedents and CLAUDE.md sync rules). No prod migration apply in
> this PR; flag it for separate apply. typecheck + static-guards + vitest.
> Title: `feat(pro): client chart — typed notes, profile context, do-not-rebook`.

---

### PR4 — Technical record + compliance (legal-gated track)

> **Prompt — paste into Claude Code:**
>
> Read `docs/design/client-chart-record.md` first, then implement **PR4**.
> **This track needs legal sign-off before prod** (liability, retention, audit,
> photo-consent law). Build behind a feature flag; do not enable in prod without
> confirmation.
>
> Implement the **two-tier retention** model from the design doc: these records
> are authored by a pro and **persist beyond the 30-day ambient window** for that
> pro, enforced via `visibility` (`PRIVATE_TO_AUTHOR`) + author `professionalId`,
> separate from `proClientVisibilityWhere`.
>
> 1. **Formula history:** new model, per booking — brand, developer, ratio,
>    processing time, result/notes (encrypted free-text). Default
>    `PRIVATE_TO_AUTHOR`; NEVER public. Per-visit log on the chart's History tab.
> 2. **Consent / waivers + patch-test records:** new model(s) with timestamp,
>    service-type scope, signature/proof capture (reuse `ConsultationApprovalProof`
>    /`clientActionToken` patterns where possible), and result + validity date for
>    patch tests. **Safety fields travel** to any pro with access (per the access
>    matrix); the signed artifact stays author-scoped.
> 3. **Photo-release consent:** explicit per-client release state driving whether
>    before/after photos may surface; public path remains review-promotion only
>    (`reviewId` + `publicShareGuard.ts`).
>
> Before coding: confirm the long-tier retention duration (indefinite vs 18mo)
> and get the legal review noted in the design doc. Gate everything behind a flag.
> typecheck + static-guards + vitest. Open as draft pending legal.
> Title: `feat(pro): client technical record — formula history + consent (flagged)`.

---

## Cross-cutting guardrails (all PRs)

- CLAUDE.md session-sync rules: work on a branch, point every PR at `main`
  (avoid the stacked-PR squash-orphan trap noted in repo memory), leave the
  checkout in sync at the end.
- Prod DB == dev DB — never `prisma db push`; migrations via `migrate deploy`.
  Don't apply prod migrations as part of these PRs without explicit go-ahead.
- Run `npm run check:static-guards` (not just typecheck + vitest) before every push.
- Keep the 30-day window as the SINGLE source — grep for re-divergence each PR.
