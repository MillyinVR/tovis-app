# Build plan — AI Consult & Group Bookings (both repos)

> **Status: QUEUED — starts after the round-3 web↔iOS parity chain completes.**
> Created 2026-07-18. One step ≈ one session, run with the session-chaining
> protocol (completion report + updated handoff + printed-and-saved next prompt
> every session). Specs: [`ai-consult.md`](./ai-consult.md) and
> [`group-bookings-spec.md`](./group-bookings-spec.md). The active-chain handoff
> lives in the Claude memory dir (`HANDOFF-consult-groups-build.md`).

Repo tags: **[web]** = tovis-app, **[ios]** = tovis-ios, **[x]** = cross-repo.
Every web step that adds client-facing surface owes iOS parity (or an explicit
deferred note) per the standing parity rule; the queue builds that in rather
than leaving it implicit.

## Ordering logic (why this sequence)

1. **Consult Phase 0 first** — unblocked by any open decision, no billing, and
   §13.8 of the group spec wants the consult to exist so the Vision Board can
   *feed* it rather than grow a second inbox.
2. **Eval before exposure** — the diverse eval harness gates anything
   client-visible; prompts iterate against it, not against real clients.
3. **Web before iOS per slice** — iOS consumes the web APIs (established
   pattern: JSON-backed page → iOS-only; RSC-only → paired read API).
4. **Group bookings after consult MVP** — G-steps also sit behind Tori's
   ratification of the spec's §11/§14 decisions (G0), which can happen any
   time in parallel.
5. **Membership (Phase 1) is metrics- and decision-gated** — C10's readout plus
   Tori's pricing/IAP calls decide when C13+ run; the queue doesn't assume.

## Epic A — AI Consult

### Phase 0: free booking-attached consult (founder-gated)

- **C1 [web] Schema + skeleton.** `ConsultSession` model (+ versioned analysis
  fields: `schemaVersion`/`model`/`promptVersion`), additive migration,
  `CLIENT_CONSULT` UploadSurface value, `app/api/v1/client/consult` create/get
  skeleton, founder allowlist gate (technical-record precedent). DoD: routes
  live behind the gate, guards + typecheck green, zero UI.
- **C2 [web] Intake question packs.** Config-driven packs for hair color +
  brows (chip-style; `cameraShotPacks.ts` pattern), chemical-history questions,
  pre-fill from selfProfile/taste vector/boards (read-only). Answer endpoints +
  validation. DoD: a consult can be created and fully answered via API.
- **C3 [web] Capture + quality gate.** Signed uploads on the new surface →
  `recordMediaAsset` (media-private), Claude vision capture-check endpoint
  (accept / one retake tip; hard-reject color-cast for color work), per-vertical
  shot lists. DoD: photos attach to a consult only through the gate.
- **C4 [web] Analysis engine.** `lib/consult/` core analysis + hair-color/brows
  lenses mirroring `cameraVision.ts` (structured output, sanitizers, quota).
  Recommendations resolve to `Service`/`ServiceCategory`. DoD: a completed
  consult yields a versioned analysis record.
- **C5 [web] Eval harness.** Fitzpatrick-diverse photo eval set + runner
  (script, not CI) scoring undertone/face-shape against known answers; wired to
  prompt versions. DoD: current prompts have a baseline score; ship-gate rule
  written down. ⚠️ Blocks C6/C7 exposure.
- **C6 [web] Brief + pro surface.** Brief generation; `consultId` on
  `bookings/finalize`; brief in pro booking detail + client chart (loader + RSC
  + API twin); one-tap pro rating; consult invite in the booking-confirmation
  notification (quiet-hours-compliant). DoD: a real booking carries a brief the
  pro can see and rate.
- **C7 [web] Client results + metrics.** The 2–3 recommendation screen with
  achievability framing (copy via `lib/brand`), locked-Me-card teaser stub,
  serve-log events (completion, retake rate, booking attribution, teaser taps).
  DoD: full client flow booking→consult→results works end-to-end locally.
- **C8 [ios] Consult parity (lite capture).** Intake + results + "add consult"
  in the booking flow against the C1–C7 APIs; photo-picker capture with the
  server quality gate. DoD: the whole Phase-0 flow works on device.
- **C9 [ios] Guided capture native.** TOVISCamera-style live coaching for
  consult shots (on-device exposure/framing + Vision face checks + retake
  tips). DoD: capture UX at parity with the pro camera coach.
- **C10 [x] Founder pilot + readout.** Real consults with Tori's clients;
  prompt iteration against C5; metrics readout vs the go/no-go bars in
  `ai-consult.md`. DoD: written readout; Tori decides Phase 0.5/1 timing.

### Phase 0.5: home entry card (no billing)

- **C11 [web] Home card + mini analysis.** "Need a change?" card, client-picked
  focus (face/hair/hands), caps + cooldown, matched pros via plain
  service+availability. DoD: free standalone flow live behind the gate.
- **C12 [ios] Home card parity.**

### Phase 1: membership + Me card (gated: pricing + IAP decisions, C10 readout)

- **C13 [web] ClientSubscription + entitlements.** Mirror the pro pattern
  (`lib/client/entitlements.ts`); Stripe web purchase using the existing
  client `stripeCustomerId`.
- **C14 [web] Durable profile + Me card.** `ClientBeautyProfile` store
  (AI-inferred, client-owned — never `selfProfile`), Me card surface, teaser →
  unlock, retention policy (photo expiry, deletion cascade) implemented.
- **C15 [ios] Me card + membership.** Applies the IAP-vs-web-purchase decision.
- **C16 [web] Share render.** Opt-in Me-card share image.

### Phase 2 (schedule after G-epic or interleave; each its own step)

Remaining lenses (men's cut/beard, lashes, makeup/bridal, skin, nails — one or
two per session) · outcome loop · suits-you feed filtering · pro skill graph
(own mini-epic: portfolio tagging → evidence terms in matching) · event-mode
consults on dated boards · seasonal refresh.

## Epic B — Group Bookings

- **G0 [decision] Ratify + number.** Tori ratifies the spec's §11 answers and
  §14 recommendations (or amends), assigns the backlog §N. Conversation, not a
  build session. Can happen any time; blocks G1+.
- **G1 [web] Messaging spine.** Generalize threads for multi-party on the
  existing `MessageThreadParticipant` seed (per the §14.1 audit); keep 1:1
  behavior byte-identical. Riskiest step — schema + migration + regression
  tests, no group UI yet.
- **G2 [web] GroupBooking shell + members-as-Bookings.** `GroupBooking`
  coordination shell over real `Booking` rows (§14.2), multi-pro join table
  from day one (§13.1), `ProClientInvite` one-tap joins (§14.6), per-member
  deposit shares (client→pro only, §14.4). DoD: a group with N members exists
  as N linked bookings.
- **G3 [web] Group chat + Vision Board.** Group thread on G1; "+ Add to Vision
  Board" feeds the consult intake pipeline (§13.8) → per-client brief entries.
- **G4 [web] Day-of timeline + claim reflow.** Timeline view over member
  bookings + slot metadata; Start/Complete/Running-Late (both late types);
  claim-based reflow with ~10-min window (no two-party swaps in v1, §14.3);
  buffers + proposed batched shifts (§14.9); day-of push keys on the
  quiet-hours bypass list (§14.8); privacy defaults (§14.5); .ics.
- **G5 [web] Group payments + post-event.** Cover flow, deposit status,
  cancellation per the ratified G0 policy; post-event recap, per-member
  aftercare, review prompts, member→client conversion (§14.7).
- **G6 [ios] Hub + chat + Vision Board parity.**
- **G7 [ios] Day-of timeline + notifications parity.**
- **G8 [ios] Payments + post-event parity.**
- **G9 [x] Group pilot.** One real event end-to-end; readout.

## Standing constraints (every step)

House rules (no type escapes, time via `@/lib/time`, brand/tone rules), booking
write-boundary for anything touching `Booking`, `npm run typecheck && lint &&
check:static-guards` before push, PR-per-session with CI green before merge,
final self-review rule, **no prod deploys without Tori's explicit OK**, and the
web↔iOS parity rule for every client-facing web step.
