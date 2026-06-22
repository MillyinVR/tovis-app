# NFC Card — Growth, Referral Perks & Marketing Ideas

> Status: **ideation / not built.** Captured 2026-06-22. Nothing here is
> committed to product or engineering yet. Reward/perk economics that touch
> money intersect with the pending `Referral` reward thresholds (product +
> legal) and must get a product decision before build.

## Thesis

Most NFC-card products are a physical linktree: tap → vCard / Instagram link →
done. Tovis already has a **social + booking + referral loop** (Looks feed,
follows, `/u/{handle}` client profiles, `/p/{handle}` pro pages, the `Referral`
model with rewards, white-label tenants). The card should be the *physical
on-ramp into that loop* — not a static link. That is the differentiation.

Relevant existing plumbing to build on:
- `NfcCard` types: `UNASSIGNED`, `CLIENT_REFERRAL`, `PRO_BOOKING`, `SALON_WHITE_LABEL`
- `TapIntent` (30-min intents) + `AttributionEvent` audit trail
- `Referral` model (PENDING/CONFIRMED, 7-day expiry, reward hooks) — see
  `lib/tapIntentConsume.ts`
- Pro vanity handles (`name.tovis.me`) + `/p/{handle}` booking pages
- Looks feed + before/after (`AftercareBeforeAfter`, `lib/media/bookingBeforeAfter.ts`)
- Aftercare + rebook flow, client follow / creator model, white-label tenants

---

## 1. Make the tap rewarding in the moment (instant gratification)

Today a tap silently mints a row and redirects. Make the tap visibly *do
something* for the person holding the phone.

- **Tap-to-claim a perk.** First tap → "You just unlocked $10 off your first
  booking" / "first look is free." Reframes the card from "here's my info" to
  "here's a gift."
- **Scratch-card / mystery reward.** Every tap reveals a randomized reward
  (discount, priority waitlist, free aftercare add-on). `AttributionEvent`
  plumbing makes it auditable. People tap because they don't know what they'll get.
- **Streak / collectible "passport."** Tapping different pros' cards fills a
  passport; tap N pros → unlock something. Turns the card into a game across the
  whole network, not one salon.

## 2. Lean into the referral loop already built

`CLIENT_REFERRAL` cards + `Referral` model = a real two-sided engine.

- **"Tap to gift a friend."** Client hands card to a friend; friend taps → both
  credited when the friend books (PENDING referral already modeled in
  `tapIntentConsume.ts`). Market it as *gifting*, not *referring* — "tap my card,
  your first look's on me."
- **Visible referral leaderboard / tiers.** Tie card `referralCount` into the
  planned creator/influence-tier work; referring N people earns a status badge
  on `/u/{handle}`. Card becomes social currency.
- **Reward the moment of tap, not just the booking.** Even an unconverted tap
  gives the referrer a signal ("3 people tapped your card this week"). That
  dopamine keeps them handing cards out.

## 3. Use cards to recruit PROS (the harder marketplace constraint)

- **"Refer-a-pro" cards.** New `PRO_REFERRAL` card type. A pro hands a card to
  another pro (salon, trade show) → tap → pro-signup with the referrer
  attributed. Pro-to-pro is the highest-trust acquisition channel.
- **The card is the pitch / demo.** A client tapping a peer's card and instantly
  landing on a clean booking page (`name.tovis.me`) sells the product to the
  next pro watching.
- **White-label salon card batches (B2B wedge).** Sell salons branded card
  batches — one per chair. Recurring physical hook into the whole salon; tenant
  isolation already enforced in `tapIntentConsume.ts`.

## 4. Tie the card to the after-appointment moment (unique surface)

The magic window is right after a service, when the client loves the result —
nobody else can copy this because they don't have the before/after + Looks content.

- **Tap at checkout → instant before/after Look.** Tap timed to end of visit
  drops them into publishing the look they just got (builds on
  `AftercareBeforeAfter` / `bookingBeforeAfter`). They post → hits Looks feed →
  organic marketing for the pro at peak emotional moment.
- **Tap to rebook / aftercare.** Card on the mirror or in the goodie bag → tap →
  existing aftercare + rebook flow. Card as retention tool, not just acquisition.
- **Tap to follow your artist.** Straight into the follow + creator loop so the
  relationship continues in-app.

## 5. Make the physical object itself interesting

- Mirror clings / tip-tray cards / appointment-confirmation hand-off cards —
  each a different "tap context" that can be encoded in the intent and routed
  differently.
- **Personalized cards** showing the pro's actual best Look (use the media), not
  a generic logo. People keep beautiful cards.
- **"Founding member" / numbered-card drop** for early pros — scarcity + status.

---

## Prioritization (where the leverage is)

- **Cheapest + most differentiating:** #1 instant tap reward + #4
  tap-at-checkout-to-publish-a-Look. Both ride surfaces that already exist and
  make the tap something the holder *feels*.
- **Biggest strategic unlock:** #3 refer-a-pro cards — pro supply is the real
  marketplace constraint; pro-to-pro is the highest-trust channel.
- **Needs product/legal first:** anything attaching real money/discounts to taps
  (perks, scratch-card) intersects the pending `Referral` reward thresholds.
- **Mostly mechanical given what's built:** tap-to-publish-Look, refer-a-pro
  card type + attribution.

---

## Related engineering hardening (agreed build queue, separate from above)

These are the flow-improvement items agreed alongside the growth ideas; see the
conversation / `docs/launch-readiness/sprint-2-nfc-claim-audit.md` for the audit
context. Held until PR #314 lands.

**Tier 1 — correctness / attribution leaks**
1. Already-logged-in tappers never hit `consumeTapIntent` (only register/login
   call it) → referral credit silently drops for the common case. Add a consume
   step for authenticated tappers.
2. `PRO_BOOKING` routes to pros who may be paused/unready/offboarded —
   `proBookingNextUrl` only checks existence + premium. Add a bookability check.

**Tier 2 — abuse & scale hygiene (required before public rollout)**
3. GET side-effects: every tap writes a `TapIntent`; link unfurlers/prefetchers
   /bots create junk rows. Skip the write for `Sec-Purpose: prefetch` + bot UAs.
4. No TTL cleanup for expired `TapIntent`s → unbounded growth. Add an internal
   cleanup job (sibling to `app/api/internal/jobs/handle-reservations`).
5. Rate-limit `/t/[cardId]` and `/c/[code]` (short codes ~40 bits, enumerable).

**Tier 3 — lifecycle & product gaps**
6. Blank cards are claimed first-tapper-wins; allow admin to pre-bind a card/batch
   to a specific pro/tenant at generation.
7. No revoke / transfer / re-issue flow; admin table is read-only. Add
   deactivate + reassign actions.

**Tier 4 — observability**
8. Log tap-intent *creation* as an `AttributionEvent` (gated by the bot filter)
   to measure the tap→claim funnel.
9. Pro/admin dashboard surfacing taps → signups → bookings from `AttributionEvent`.
