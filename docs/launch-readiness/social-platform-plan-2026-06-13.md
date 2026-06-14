# TOVIS — Social-platform plan (social first, booking second)

> Authored 2026-06-13. Companion to [`finish-plan-2026-06-12.md`](./finish-plan-2026-06-12.md).
> That plan gets TOVIS **launch-ready as a booking platform**. This plan re-centers the product
> as a **social platform that books**, in the spirit of TikTok/Instagram/Pinterest: the feed is the
> product, booking is the conversion.
>
> Guiding principles:
> 1. **The feed is the product.** Time-in-feed and return-rate are the north-star metrics, not
>    booking conversion alone. Booking is what we monetize; engagement is what we grow.
> 2. **We already paid for the hard part.** The schema, moderation, ranking, async job queue, and
>    engagement primitives exist and are well-built. Most of this plan is *wiring* and *read-layers*,
>    not new architecture. Don't re-build — connect.
> 3. **Every loop must close.** A like with no notification, a follow with no feed, a share with no
>    preview — each is a half-built loop that leaks engagement. Close loops before adding new ones.
> 4. **No fake signals.** Decorative "Booked today" text undermines trust and is a deceptive-practices
>    risk. Social proof must be real or absent.
> 5. **Creators are the supply side.** Pros post the content the whole feed runs on. They go where they
>    can *see growth*. Creator-facing analytics is a growth lever, not a nice-to-have.

## What exists today (verified 2026-06-13)

**Strong, already-built (don't rebuild):**
- Normalized feed model: `LookPost` with denormalized `likeCount/commentCount/saveCount/shareCount`,
  separate `rankScore`/`spotlightScore`, all indexed ([`prisma/schema.prisma`](../../prisma/schema.prisma)).
- Engagement primitives server-side: likes (idempotent), comments (full moderation lifecycle),
  saves-to-boards (Pinterest-style), pro-follows.
- Real moderation: report models for posts + comments, auto-flag scan jobs, admin moderation routes.
- Async job queue `LooksSocialJob` for counter/rank/spotlight recompute + moderation scans.
- Cursor pagination + three ranking modes (`RECENT`/`RANKED`/`SPOTLIGHT`) with recency decay
  ([`lib/looks/feed.ts`](../../lib/looks/feed.ts), [`lib/looks/ranking.ts`](../../lib/looks/ranking.ts)).
- A working `FOLLOWING` feed mode and `FOLLOWERS_ONLY` visibility — **built, not surfaced in UI.**
- Well-built feed UX: full-screen snap-scroll, optimistic likes with rollback, double-tap-to-like,
  per-action guest→login gating ([`LooksFeed.tsx`](../../app/(main)/looks/_components/LooksFeed.tsx)).

**The gap:** the client uses a fraction of the backend, and the social loops are mostly half-closed.

---

## Tier S0 — Week-one feed fixes ✅ DONE (2026-06-13)

These were silent engagement leaks. Shipped in this branch:

| Fix | What was wrong | File |
|---|---|---|
| **Infinite scroll** ✅ | Feed was hard-capped at 24 items — `nextCursor` was returned by the API and parsed but never used. No `loadMore`. | [`LooksFeed.tsx`](../../app/(main)/looks/_components/LooksFeed.tsx) |
| **Share deep-link** ✅ | Share produced `/looks?m={id}`, a param nothing reads — every shared link dumped the recipient on the generic feed, not the look. Now points at the working `/looks/[id]` detail page. | [`LooksFeed.tsx`](../../app/(main)/looks/_components/LooksFeed.tsx) |
| **OG / social cards** ✅ | Look detail had no `generateMetadata` — pasted links rendered as naked URLs with no image. Added Open Graph + Twitter card with the look's image + caption (request-memoized via React `cache()`, no double fetch). | [`looks/[id]/page.tsx`](../../app/(main)/looks/[id]/page.tsx) |

**S0.4 — Fake booking signals** ✅ RESOLVED (removed, 2026-06-13)
- `"Booked today" / "Filling fast" / "Popular near you"` and the "future self" tag lines were
  deterministically hashed from the look id — not real data — and (as it turned out) rendered nowhere.
  Removed entirely as dead fabricated code rather than shipped as decorative social proof. Real social
  proof will come from actual engagement/availability data (e.g. genuine save velocity) when that data
  is on the feed payload — tracked under S2 (view tracking) and S1.4 (real share counts).

**S0 follow-up (small):** add a unit test covering the `loadMore` cursor path (existing tests stub
`nextCursor: null`, so the new pagination branch is currently untested). Driving it requires simulating
the `IntersectionObserver`-set `activeIndex`; deferred to avoid a brittle test, but should land before
public ramp.

---

## Tier S1 — Close the loops we already built (highest leverage)

Each of these is mostly *wiring* — the backend exists. This is the cheapest way to make TOVIS *feel*
social.

### S1.1 — Surface the **Following** feed ⭐ ✅ DONE 2026-06-13
**Why:** the follow graph is the core social-network mechanic, and the feed already supported it
(`kind=FOLLOWING`, `FOLLOWERS_ONLY` visibility) — there was just no tab.
**Done:** added a `Following` tab in the fixed tab row (Look · Following · Spotlight) in
[`LooksFeed`](../../app/(main)/looks/_components/LooksFeed.tsx); selecting it fetches
`/api/looks?following=true` (resolved server-side to the followed-pros feed) for both the initial load
and infinite-scroll, via a shared `applyFeedScopeParams` helper that preserves Spotlight's behavior.
Contextual empty state when you follow no one yet, pointing at the Follow button.
**Still to do:** a logged-out viewer currently sees an empty Following feed rather than a sign-in
prompt — wire the guest→login nudge when `isAuthenticated` is false (the feed envelope already carries
`viewerContext.isAuthenticated`). **Effort:** S.

### S1.2 — Follow button + follower counts in-feed and on profiles ⭐ (follow toggle DONE 2026-06-13)
**Why:** the graph can't grow if users can't follow from where they spend time (the feed).
**Done:** the previously fake, non-functional `FOLLOW` pill in
[`LookOverlays.tsx`](../../app/(main)/looks/_components/LookOverlays.tsx) is now a real, stateful
button wired to [`/api/pros/[id]/follow`](../../app/api/pros/[id]/follow/route.ts) with an optimistic
toggle + rollback (mirrors the like pattern) and a guest→login redirect. The feed payload now carries a
real `viewerFollows` per item (computed in [`app/api/looks/route.ts`](../../app/api/looks/route.ts) and
[`lib/search/looks.ts`](../../lib/search/looks.ts)); a pro appearing on multiple slides stays in sync.
The button reads FOLLOW / FOLLOWING from real state.
**Still to do:** surface a real **follower count** on the look overlay and pro public profile (needs a
`followerCount` on the professional in the feed select). Add a follow affordance to the right action
rail too. **Effort:** S.

### S1.3 — Social notifications (like / comment / follow / save) ⭐
**Why:** engagement notifications are *the* retention engine of every platform we want to compete with.
Today notifications exist only for pro **bookings** — no "X liked your look," "new comment," "started
following you."
**Build:** extend the existing notification surface
([`app/pro/notifications/page.tsx`](../../app/pro/notifications/page.tsx)) and add a client-facing
equivalent. Emit notifications from the like/comment/follow/save mutations — fan out **via the existing
`LooksSocialJob` queue**, not inline, to protect write latency. Batch ("3 people liked your look") to
avoid spam. Respect a per-user notification preference.
**Acceptance:** acting on a look notifies the owner (batched, async); a notifications bell with unread
count exists for both roles. **Effort:** M. **Depends:** notification model may need a tenant column
(see finish-plan T2.2) and a generic `actor → verb → target` shape.

### S1.4 — Make `shareCount` real + count it in ranking
**Why:** `shareCount` exists but is never incremented, and shares aren't in the rank formula — yet a
share is the strongest engagement signal there is.
**Build:** `POST /api/looks/[id]/share` (idempotent-enough; fire from the share handler), increment via
the counter job, add a `× weight` term to `rankScore` in
[`lib/looks/ranking.ts`](../../lib/looks/ranking.ts). **Acceptance:** sharing increments the counter and
nudges rank. **Effort:** S.

**S1 Definition of Done:** the four core loops (like, comment, follow, share) each *close* —
action → visible feedback → notification → return path. A user can follow from the feed, see a Following
feed, and get notified when their content lands.

---

## Tier S2 — The retention + identity layer

Now make people *come back* and make creators *want to post*.

### S2.1 — Per-viewer "For You" ranking ⭐ (the moat)
**Why:** we have a *global* `rankScore` but no personalization. The algorithmic, per-viewer feed is the
single biggest differentiator of TikTok/IG. The infra (rankScore, job queue, cursor feed) is already
here — this adds a personalization layer on top.
**Build (start simple, iterate):**
- Phase 1: blend signals into the existing ranked feed — boost looks in categories the viewer engages
  with, looks from followed/affinity pros, and recency; down-rank already-seen looks.
- Phase 2: a lightweight per-viewer affinity table (category + pro affinity, updated from interaction
  events via the job queue). Keep it explainable and debuggable.
- Default the main feed tab to "For You" once it beats chronological on time-in-feed (A/B behind a
  cohort flag — see finish-plan T2.4).
**Acceptance:** the default feed is personalized and measurably beats RECENT on dwell/return. **Effort:** L.

### S2.2 — Creator analytics for pros ⭐ (supply-side growth)
**Why:** creators go where they can see growth. Every counter needed already exists — this is a
read-layer, not new instrumentation.
**Build:** a pro dashboard view: per-look views, likes, comments, saves, shares, follower growth over
time, top-performing looks, profile→booking funnel. **Acceptance:** a pro can see how each look performs
and whether their audience is growing. **Effort:** M (need a `LookView` event if we want true view
counts — otherwise start with the engagement counters we already have).

### S2.3 — Two-way, social-grade profiles
**Why:** profiles today are static portfolio grids. Social profiles are *destinations*: follower/following
counts, a looks grid that opens into the feed, follow CTA, share-profile with OG card.
**Build:** upgrade [`pro/profile/public-profile`](../../app/pro/profile/public-profile/page.tsx) — follower/
following counts, tap-a-look → open in feed context, follow button, OG metadata for shared profiles.
Give **clients** a light public presence too (their public boards / saved looks), so following can be
two-directional over time. **Acceptance:** a profile is a shareable, followable destination, not a static
résumé. **Effort:** M.

### S2.4 — View tracking
**Why:** "views" is table-stakes social proof and the denominator for every meaningful rate (save-rate,
follow-rate). **Build:** a cheap, sampled/debounced `LookView` event (feed impression + detail open),
written via the job queue; feed `viewCount`. **Acceptance:** looks show view counts; rates are
computable. **Effort:** M.

**S2 Definition of Done:** the default feed is personalized; pros can see their growth; profiles are
followable destinations; views are tracked.

---

## Tier S3 — Community & virality

The features that turn an audience into a community and drive organic acquisition.

| Item | Why it matters | Effort |
|---|---|---|
| **@mentions** in captions + comments | creator cross-promotion, notifications, graph growth | M |
| **Hashtags / tags** + tag pages | discovery-by-interest, trending, SEO landing pages | M |
| **Comment replies (threads) + comment likes** | comments are where community forms; flat comments cap it | M |
| **Stories / ephemeral** | low-pressure daily-posting surface keeps the supply side active | L |
| **Trending** (looks, pros, tags) | a discovery surface beyond category browsing | M |
| **External-share growth** | OG cards done (S0) — add per-network share targets + UTM attribution to measure viral coefficient | S |
| **Public / collaborative boards** | Pinterest-style sharing of saved collections drives inbound | M |
| **Creator monetization hooks** | tips / promoted looks / featured placement — once engagement is proven | L |

**S3 sequencing:** do mentions + hashtags + comment threads first (they compound the S1 loops);
stories/trending/monetization after the For You feed proves retention.

---

## Decisions needed from you (blocking)

1. **Fake booking signals (S0.4):** wire to real data, or remove? (recommend: remove for ramp, wire
   later from real booking/save velocity)
2. **Default feed tab:** keep chronological `Look` as default, or make `For You` the default once it
   wins? (recommend: For You default, behind a cohort flag)
3. **Client public presence (S2.3):** do clients get public profiles/boards, or stay private? (affects
   whether following is one- or two-directional)
4. **View tracking scope (S2.4):** impressions + detail-opens, or detail-opens only? (impressions are
   more accurate but higher write volume)
5. **Notification channels (S1.3):** in-app only for launch, or in-app + email/push? (finish-plan defers
   mobile push; in-app + digest email is the cheap middle)

## Immediate next steps (start here)

1. **Decide S0.4** (fake signals) — blocks public ramp credibility.
2. **S1.1 Following tab** + **S1.2 follow button/counts** — cheapest "feels social" wins, backend ready.
3. **S1.3 social notifications** — the retention engine; start the notification-model shape now since
   it intersects finish-plan T2.2 (tenant columns on `Notification`).
4. Spec **S2.1 For You** phase 1 as a ranking blend on the existing `rankScore` — no new infra to start.

These slot alongside the booking-launch finish-plan: S0 is done, S1 is mostly wiring that can land
during private beta, and S2 (For You + creator analytics) is what makes the **public ramp** land as a
social platform rather than a booking tool with a feed bolted on.
