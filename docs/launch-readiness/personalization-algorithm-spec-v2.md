# TOVIS Personalization & Discovery Algorithm — Spec v2

**Purpose:** Define the ranking, badging, and board-feed systems that let clients "dream, save, book" while directly helping pros fill their books. This is a working spec intended to be handed to a Claude Code session for implementation against the current TOVIS schema.

**v2 changes at a glance:** visual embeddings alongside tags (§6.0), user-level self-profile + feasibility matching (§6.6), per-user signal normalization (§2.3), re-view/dwell signals added to hierarchy (§2), time decay on affinities (§6.2), learned price band & travel radius (§4.5), session intent detection (§4.3.2), post-booking relationship layer (§6.7), saved-not-booked activation (§6.8), rate-based scoring to kill the rich-get-richer loop (§4.1), impression capping (§4.6), explicit "not for me" control (§2.2), similar-user cold start (§2.1), pro reliability in scoring (§4.2), notification budget (§8.1), badge holdout experiments (§9), small-market fallback (§4.7), revised build order (§11).

---

## 1. Core Principle

TikTok optimizes for watch time because their business model is ads. TOVIS's business model is bookings — so **scroll time and session length are NOT positive ranking signals**. The algorithm's job is to move people down a funnel efficiently, not to maximize time spent in it:

**Dream (discovery) → Want (consideration) → Book (conversion) → Fill (supply-side outcome)**

Everything below serves that funnel.

---

## 2. Signal Hierarchy (Trust Weighting)

Weakest to strongest signal of genuine interest — stronger signals should be weighted more heavily in every scoring function in this doc:

```
time-spent-viewing < like < comment < re-view/zoom/screenshot < share < save < remix < booking
```

**(NEW) Re-view, zoom, and screenshot are near-save-level intent.** Passive raw view time stays lowest, but *returning to the same Look twice*, pinch-zooming into a photo, or screenshotting it are deliberate acts. Score them between comment and share. (Screenshot detection where the platform allows it; re-view and zoom are always available.)

A booking is the strongest, nearly un-fakeable signal and should retroactively strengthen a user's taste graph the most.

---

## 2.1 Cold Start Handling

The whole scoring model assumes engagement history. On day one there isn't any — this needs explicit fallback logic, not just "the formula returns zero."

- **New client:** lean on onboarding chips + broad popular/trending content until ~5–10 real signals (saves, skips, bookings) exist. Don't let an empty taste graph just default to a generic feed with no plan to grow out of it.
- **(NEW) Similar-user priors:** once user volume exists, seed a new client's starting affinities from users with similar onboarding chips + coarse demographics (collaborative filtering), not pure popularity. Goal: the feed feels personal by session 2–3 instead of after 10 signals. The prior should wash out quickly as real signals arrive — weight it like ~3–5 synthetic signals, no more.
- **New pro:** `underbooked_pro_boost` (Section 4.2) needs *some* data to compute. Give every new pro a flat **visibility floor** — a guaranteed minimum impression count for their first N days/posts — rather than relying purely on a formula that has nothing to work with yet.

## 2.2 Negative & Skip Signals

Everything scored so far is positive-only. A fast scroll-past is a real "not interested" vote and should actively suppress, not just fail to boost:

```
skip_penalty = fast_scroll_past(view_duration < user_relative_threshold)   // see 2.3
```

This matters most inside board feeds — if a Bridal board keeps surfacing veils and the client blows past every one, veil content should get suppressed for that board, not just left unboosted.

**(NEW) Explicit "not for me" control.** Skip inference is noisy; give clients a one-tap hide/"not for me" on every card. It's an unambiguous signal, it gives the user agency, and it makes personalization feel respectful rather than surveillant — consistent with Guardrail #5. Apply it at both the item level and (after repeated hides in a category) the category level.

**(NEW) Suppressions decay.** Both skip-derived and explicit suppressions should decay over weeks, not persist forever. One bad veil week shouldn't permanently kill veils. Explicit hides decay slower than inferred skips.

## 2.3 Per-User Signal Normalization (NEW)

A save from someone who saves everything is worth less than a save from someone who saves twice a month. Same for scroll speed — a "fast scroll-past" for a slow browser is a normal pace for a speed-scroller.

- Maintain per-user baselines: median dwell time, save rate, like rate, session cadence.
- Express every behavioral signal relative to that user's own baseline (z-score or percentile) before it enters any scoring function.
- The skip threshold in 2.2 must be percentile-based per user, not a global constant.

Without this, heavy users' noise drowns out light users' intent — and light users are most of your market.

---

## 3. The Two Feeds

### 3.1 Looks Feed ("Personalized")
- Broad discovery, serendipity, "dream" mode
- Optimized for range and surprise — where someone finds a board topic they didn't know they wanted
- Driven by the **global taste vector** (see Section 6)

### 3.2 Board Feeds
- Narrow, deep, intent-confirmed
- Feels like a personal curator once a client has told TOVIS what they're planning
- Driven by that specific **board's local taste vector**, filtered/boosted by board metadata
- Must actively surface **new, unseen content** — not just a gallery of saved items. This is what makes boards a retention lever (clients check back for new matches).

**Separation rule:** Board activity should NOT flood the general Looks feed. Board interactions bleed into the global vector at a small, tunable weight (start ~0.1–0.2) rather than dominating it. See Section 6.2.

---

## 4. Feed Scoring

### 4.1 Base Engagement Score — rate-based, not count-based (REVISED)

**v1 used raw counts. Raw counts create a rich-get-richer loop:** whatever gets shown most accumulates the most saves and wins forever, and the underbooked-pro boost ends up fighting that headwind instead of working with the ranker. Fix it at the foundation:

- **Log impressions on every card render.** This is non-negotiable instrumentation and must ship before any scoring goes live.
- Score on **engagement rates per impression**, Bayesian-smoothed so a Look with 3 saves on 10 impressions doesn't wildly outrank one with 300 saves on 2,000:

```
weighted_engagement = (booking_rate × 10)
                     + (remix_rate × 6)
                     + (save_rate × 5)
                     + (share_rate × 3)
                     + (comment_rate × 2)
                     + (like_rate × 1)

engagement_score = bayes_smooth(weighted_engagement, impressions, category_prior)
```

`category_prior` = the average rate for that service category, so low-impression content regresses to "typical for its category" rather than to zero or to a lucky spike.

### 4.2 Bookable-Feed Composite Score (Looks Feed, bookable-tagged content)

```
bookable_score = engagement_score
                + (availability_boost × W1)
                + (booking_conversion_rate × W2)
                + (underbooked_pro_boost × W3)
                + (pro_reliability × W4)          // NEW
                + (proximity_fit × W5)            // NEW — see 4.5
                + (price_fit × W6)                // NEW — see 4.5
                - (days_since_post_decay)
```

- `availability_boost`: function of `days_until_next_opening` and `calendar_fullness_next_14_days` — a pro with real open slots should outrank a pro booked out 6 weeks, for the bookable half of the feed specifically.
- `booking_conversion_rate = bookings_from_this_look / (saves + remix_clicks on this look)` — protects against optimizing for "pretty content" over "content that fills chairs."
- `underbooked_pro_boost`: gives new/underbooked pros (e.g., Bellus grads) a fair on-ramp to visibility, same problem TikTok solves for new creators via velocity boosting, but tied to calendar health instead of content novelty.
- **(NEW) `pro_reliability`:** cancellation rate, no-show rate, consult-message response time, rebook rate. Boosting a pro who cancels on clients burns the *client's* trust in TOVIS, not just the pro's. This is also the natural place for post-booking outcome data (ratings, rebooks) to feed back into ranking.

### 4.3 Feed Composition Ratio

Blend inspiration content and bookable-now content — don't make the feed 100% either:
- Suggested starting ratio: **~60–70% inspiration / 30–40% bookable-now**, tunable once real conversion data exists.
- Pure inspiration → mood-board app. Pure bookable → boring directory. The blend is what makes it work.

### 4.3.1 Diversity Injection (Anti-Filter-Bubble)

Once the taste graph gets confident, feeds risk narrowing too hard and going repetitive — which kills the "dream" magic. Reserve **~10–15% of every feed load** for exploration content outside the person's established graph. This is also the only way someone who's never thought about microblading stumbles into it — pure affinity-matching would never surface it to them on its own.

### 4.3.2 Session Intent Detection (NEW)

The 60/40 ratio shouldn't be static — sessions have moods. Idle Sunday scrolling is "dream" mode; searching "balayage near me open Saturday" is "book" mode. Detect intent per session and shift the ratio dynamically:

- **Entry point:** opened from a push about an opening → bookable-heavy. Opened cold → default. Opened via search → follow the query's specificity.
- **In-session behavior:** taps on availability/pricing/profile → shift bookable. Rapid broad scrolling with occasional saves → stay inspirational.
- Adjust within the session, same mechanism as 6.3. Feeling met *in the moment* is a large part of feeling known.

### 4.4 Board Feed Score

```
board_feed_score = engagement_score
                  + occasion_tag_match(board.type)            // heaviest weight
                  + service_specific_match(board.answers)      // skin type, dress color, hair length, timeline, etc.
                  + visual_similarity(board.saved_items)       // REVISED — embedding-based, see 6.0
                  + availability_boost
                  + feasibility_match(user.self_profile)       // NEW — see 6.6
```

Board answers act as literal filters/boosts, not just profile flavor.

### 4.5 Learned Price Band & Travel Radius (NEW)

Neither price nor distance appears in any v1 scoring function — but surfacing $400 colorists to someone who books $60 services, or pros 40 minutes away, instantly breaks the "knows me" illusion.

- **Price band:** learn a soft per-category price range from the user's bookings (strongest), price-page views, and saves. `price_fit` decays smoothly outside the band — never hard-filter. Aspirational saving is real; a client saving expensive looks is still telling you something.
- **Travel radius:** learn from booking locations and profile views. Default to a metro-sensible radius pre-data.
- Both are **weights, not filters**, and both must be overridable by explicit signals (a bridal board justifies a wider radius and higher spend — big events break normal patterns).

### 4.6 Impression Capping & Freshness (NEW)

Nothing in v1 prevents reshowing the same Look repeatedly. Badge rotation (5.5) changes the label, not the content.

- Cap exposures per user per Look (e.g., 3–4 unbadged impressions, a couple more if badge state meaningfully changed — new availability, new countdown range).
- After cap, the Look only reappears via a legitimate state change or explicit user navigation (it's still in their board/saves).
- Track a per-session freshness ratio: % of cards the user has never seen. Falling freshness = supply problem in that user's graph → widen retrieval before the feed goes stale.

### 4.7 Small-Market Fallback (NEW)

Dense-metro assumptions fail in smaller markets: strict radius + taste matching can produce a near-empty or instantly-repetitive feed. Define the degradation order explicitly — widen radius first, then relax taste-match strictness, then increase inspiration share (content from anywhere is fine for dreaming; only bookable content needs to be local). An empty feed is worse than a loosely-matched one.

---

## 5. Badges

### 5.1 Two Layers

- **Layer 1 — Universal truths** (same for every viewer): booking fast, distance, rebook rate, "Bellus grad," etc.
- **Layer 2 — Viewer-intent match** (recalculated per person, per view): same content, reframed per what that viewer is actually there for.

The rendered badge is whichever layer wins the priority contest below. Show **one badge, two max** — never a cluttered card.

### 5.2 Badge Library

**Urgency**
- "Booking fast" (X bookings in 24–48h above threshold)
- "3 spots left this week"
- "Only opening left today"
- "Usually booked 2 weeks out"

**Convenience**
- "Available today"
- "Comes to you"
- "5 min from you" / "Less than 5 miles away"
- "Instant book"

**Trust / Social Proof**
- "Booked 40+ times this month"
- "98% rebook rate"
- "New to TOVIS" (paired with underbooked-pro boost — an honest hook for new pros)

**Trend / Cultural Momentum**
- "Trending on TikTok" (cross-reference trending sounds/hashtags against service tags)
- "Most booked look this week in [city]"
- "🔥 X people booked this exact look in the last 7 days"
- Seasonal auto-tagging: prom, wedding season, back-to-school, holiday party

**Permission & Normalization** (for first-timers / long-hesitant clients)
- "Most requested first-timer service"
- "Perfect for your first time"
- "Ask me anything before you book" (consult messaging)
- "Heals in X days" / "Lasts X months" (concrete facts reduce fear of the unknown)

**Bridal / Prom / Big-Event**
- "X days until prom — book your trial now" (countdown tied to `viewer_event_date`)
- "Bridal trial spots filling for [wedding month]"
- "Complete the look" (cross-sell chaining: hair → makeup → nails)
- "Booked for 12 proms this season"

**Confidence / Outcome-Based**
- "94% rebooked within 8 weeks"
- "Color correction specialist" / "Works with curly/textured hair" — precision-matching
- "Transformation Look" tag for dramatic before/after content

**(NEW) Personal-Match** (powered by self-profile, §6.6 — the highest "knows me" badge class)
- "Works with hair like yours" (texture/type match)
- "Before/afters from your starting color"
- "Specializes in [your skin concern]"

**Community / Local Pride**
- "Local favorite in [neighborhood]"
- "Bellus Academy grad"

### 5.3 Commitment Tiers (CRITICAL guardrail)

Every service category gets a `commitment_tier`: **low / medium / high**. This determines which badge types are appropriate.

```
if commitment_tier == "high":       // microblading, permanent makeup, major color correction
    priority_order = [trust_and_info, personal_match, permission, availability, distance]
    // urgency/scarcity badges suppressed or shown only as secondary
elif commitment_tier == "medium":   // bridal, prom, first facial
    priority_order = [event_countdown, availability, personal_match, social_proof, trend]
else:                                // low commitment: blowout, gel manicure, brow wax
    priority_order = [urgency, trending, booking_fast, distance]
```

**Rule: never badge-pressure someone toward a high-commitment/semi-permanent decision with scarcity tactics.** Trust and information beat urgency for anything body-modification-adjacent — this is both an ethical line and a trust-preserving one. Getting this wrong risks feeling manipulative and will backfire.

### 5.4 Badge Selection Logic

```
badge_pool = evaluate_all_true_badges(look, pro, viewer, service_category)
selected_badge = first_qualifying_badge(badge_pool, priority_order[commitment_tier])

// viewer-specific event tags override the default priority order:
if viewer.event_tag matches look.occasion_tags:
    selected_badge = event_specific_badge(viewer.event_tag, look)
```

### 5.5 Badge Rotation (Anti-Fatigue)

If the same Look always shows the same badge to the same repeat viewer, it goes stale fast and starts feeling robotic by the 3rd–4th viewing. Maintain a small rotation pool per qualifying badge set — when multiple badges are true and eligible for a viewer, don't always render the single "best" one; rotate among the qualifying set on repeat views. (Rotation operates within the impression cap of §4.6 — rotate labels across the capped impressions, don't use rotation as a reason to exceed the cap.)

### 5.6 Anti-Gaming

Once engagement counts (saves, remixes, bookings) literally drive visibility *and* money (the 5% booking protection fee), someone will try to inflate their own numbers — fake saves, coordinated remix clicks, etc. Build a basic velocity-anomaly check from day one: flag engagement that spikes far outside a pro's normal historical pattern for manual review, rather than bolting this on after abuse happens.

**(NEW)** Rate-based scoring (§4.1) also weakens the classic attack: fake saves without matching impressions produce impossible rates that the anomaly check catches trivially. Log impression source alongside engagement to make the check cheap.

### 5.7 Non-Negotiable Rules
1. Every badge must be computed from real, live data — never manually set by a pro. Manual badges = abuse vector + trust collapse.
2. One badge shown at a time, two max.
3. Badges are per-viewer where relevant (distance, event countdown) and per-post where global (booking velocity).
4. Time-sensitive badges need a TTL — nothing kills trust faster than a stale "available today."
5. A badge state change (pro opens availability after a client saved their Look) is a legitimate, honest re-engagement trigger — not spam.

---

## 6. Taste Graph (The Actual "Algorithm")

### 6.0 Visual Embeddings — taste is visual, not just taggable (NEW)

Everything in v1 scores on tags and occasions, but beauty taste is *visual*: two "balayage" Looks can be opposite aesthetics (warm caramel vs. ashy blonde, subtle vs. dramatic, editorial vs. natural). Tag matching alone will never capture that — and it's the single highest-impact upgrade for the "it knows me" feeling.

- Compute an image embedding (CLIP-style) for every Look at upload time.
- A user's taste vector = decayed, signal-weighted average of the embeddings of what they saved/booked (per the §2 hierarchy) — maintained globally and per board.
- `saved_similarity` / `visual_similarity` in scoring = cosine similarity between candidate Look embedding and the relevant taste vector.
- Tags remain the retrieval/filter layer (occasion, service, bookability); embeddings are the *ranking* layer within candidates. This split keeps the system debuggable.
- Practical note: off-the-shelf CLIP embeddings + a vector index (pgvector is fine at this scale) gets 80% of the value. Fine-tune later only if needed.

### 6.1 Structure

```
user_taste_profile:
  explicit_signals:
    - event_tags: [{ type: "wedding", date: "2026-09-14" }]
    - onboarding_interests: ["bridal", "color", "skincare"]
    - search_history: [...]

  self_profile:                        // NEW — see 6.6
    hair: { type: "curly", texture: "3a", current_color_level: 4, length: "medium" }
    skin: { tone_range: "...", primary_concern: "texture" }
    // all optional, all user-entered, all editable

  behavior_baselines:                  // NEW — see 2.3
    median_dwell_ms, save_rate, like_rate, session_cadence

  global_affinity: { color: 0.6, curly_hair: 0.7, facials: 0.3, ... }
  global_taste_embedding: [ ... ]      // NEW — see 6.0

  price_bands:                         // NEW — see 4.5
    { hair_color: [90, 180], nails: [40, 70], ... }
  travel_radius_miles: 8               // NEW — learned

  board_contexts:
    <board_id>:
      local_affinity: { updos: 0.9, veils: 0.7, ... }
      local_taste_embedding: [ ... ]   // NEW
      board_answers: { ... }           // from creation-time questions
      contributes_to_global: 0.15      // tunable, default low

  pro_relationships:                   // NEW — see 6.7
    - { pro_id, services_booked, last_booked, typical_cadence_weeks, status: "active" }

  conversion_history:
    - booked_services: [...]
    - saved_not_booked: [...]          // the gap between dream and book — see 6.8
```

### 6.2 Update Rules
- Board interactions fully update that board's `local_affinity` and bleed a small fraction (`contributes_to_global`) into the user's `global_affinity`.
- Looks Feed (personalized) interactions fully update `global_affinity` and do **not** write back into any board's `local_affinity`.
- This one-directional, weighted bleed keeps boards feeling personal and separate while still letting the general feed occasionally reflect "I know about your wedding."
- **(NEW) Time decay:** all affinity weights and taste embeddings decay exponentially. Tastes shift; events pass; last year's prom obsession shouldn't shape this year's feed. Suggested half-lives: behavioral signals ~60–90 days, bookings ~6–12 months (decay slowest), event-tag-driven affinities → sharp decay after `event_date` passes (aligned with board archiving, §7.5).

### 6.3 Real-Time Adjustment
The graph should feel responsive within a single session, not just "smarter next time." If someone saves 3 bridal Looks in one sitting, the next few cards in that same scroll should already lean bridal-adjacent.

### 6.4 Cross-Board Intelligence (use carefully)
Connective suggestions across a client's boards are fine at the **service/occasion level** ("here's a pro who does bridal facials"). Avoid anything that reads as a personal-narrative inference ("we noticed you're planning two things at once") — that crosses from helpful into surveillance-feeling, even if technically harmless.

### 6.5 Pro-Side Transparency

Pros will ask "why aren't I showing up." An opaque ranking system creates support load and erodes trust fast. Build a simple internal dashboard signal for pros, e.g.:
- "Your visibility is down because your booked-out percentage is high"
- "Add more Looks to widen your tag matches"
- "Your response time to consult messages is affecting your ranking"

This gives pros a lever to pull instead of feeling punished by a black box — worth building alongside the scoring system, not after complaints start.

### 6.6 Self-Profile & Feasibility Matching (NEW)

Section 7 collects hair length/color per board — promote this to the **user level**, optional and fully user-entered: hair type/texture/length/current color level, skin tone range, primary skin concern.

Two uses, both high-"knows me" payoff:

1. **Representation matching:** prefer Looks shown on models who resemble the viewer (hair texture, skin tone). "It showed me this look on hair like mine" is the moment people say the app gets them. This comes from content attributes (pro-tagged at upload + embedding-assisted), never from analyzing the client's photos.
2. **Feasibility scoring:** a level-2 brunette dreaming of platinum needs color-correction specialists and realistic multi-session expectations — a different feed than a level-8 blonde wanting the same look. `feasibility_match` boosts pros whose before/afters start where the viewer starts, and pairs naturally with Permission badges ("takes 2–3 sessions from dark hair" is trust-building information, not discouragement).

Guardrail alignment: everything here is explicit and user-entered (Guardrail #5). Never infer body attributes from user photos. Frame onboarding as "get better matches," keep it skippable, keep it editable.

### 6.7 Post-Booking Relationship Layer (NEW)

The beauty industry runs on rebooking, but v1 ends at conversion. Knowing someone's *pro and rhythm* is deeper personalization than knowing their taste. After a booking:

- **Feed:** boost that pro's new Looks in the client's feed; surface "your pro has a Thursday opening" as a first-class card.
- **Cadence-aware rebook prompts:** time prompts to real service rhythms (roots ~6–8 weeks, gel ~2–3 weeks, lash fills ~2–4 weeks) — learn each pair's actual cadence from repeat bookings, fall back to category defaults.
- **Outcome loop:** post-appointment "how did it go?" feeds `pro_reliability` (§4.2) and confirms/corrects the taste graph (booked-and-rebooked = strongest positive; booked-and-never-again = quiet negative on that style/pro pairing).
- **Churn-risk moment:** if a client's cadence with a pro lapses well past normal, that's a re-engagement opportunity — handled gently ("time for a refresh?"), never guilt-based, and within the notification budget (§8.1).

### 6.8 Activating `saved_not_booked` (NEW)

v1 flags this gap as the key metric to watch but defines no mechanism. For each aging save, infer the likely blocker and respond to *that*:

| Likely blocker | Detectable how | Response |
|---|---|---|
| Pro booked out | calendar state at save time | Notify when availability opens (already sanctioned by §5.7.5) |
| Too far | distance vs. learned radius | Surface visually similar Looks (§6.0) from closer pros |
| Price | price vs. learned band | Surface similar looks in-band — never frame as "cheaper than what you wanted" |
| Hesitation (high-commitment) | commitment tier + long dwell, no booking tap | Permission/education content, consult-message nudge — never urgency |
| Just dreaming | inspiration-mode session context | Leave it alone — dreams are allowed |

One blocker-response per save, rate-limited by the notification budget (§8.1).

---

## 7. Boards — Creation Flow & Contextual Questions

### 7.1 Timing
Ask contextual questions **once, at board creation only**. Never re-interrogate. Let clients passively refine via ongoing saves/search, and make board settings trivially editable if something changes (e.g., wedding date moves).

### 7.2 Design Rules
- 2–3 questions max, always skippable
- Chips/taps over text fields wherever possible (dates are the one clear exception — use a native picker)
- The very next thing the client sees should visibly reflect their answer — if the payoff isn't immediate, people stop answering
- For sensitive/high-commitment boards (microblading, permanent makeup), word "hesitation" questions with warmth: *"What do you want to feel confident about before booking?"* — not *"What are your hesitations?"*

### 7.3 Question Sets by Board Type

| Board Type | Questions |
|---|---|
| **Bridal** | Wedding date · Hair length/current color · Trial timeline preference |
| **Prom** | Prom date · Dress color · Hair length |
| **Facial / Skincare** | Skin type · Main concern (acne, aging, dullness, redness, texture) · Ever had a facial before? |
| **Microblading / Permanent Makeup** | Ever had it done before? · What do you want to feel confident about before booking? (chips: healing process, pain level, natural look, cost) · Current brow situation |
| **Color / Transformation** | Current hair color/level · Dream color · How big a change are you looking for? (subtle vs. total — maps to commitment tier) |
| **Nails** | Length preference · Occasion (everyday, event, vacation) |

**(NEW)** Board answers that describe the *person* (hair length, current color, skin type) should offer to write through to the user-level `self_profile` (§6.6) — "save this to your profile so all your boards get better matches?" One tap, never silent.

### 7.4 Data Model

```
board.metadata = {
  type: "bridal",
  event_date: "2026-09-14",
  answers: {
    hair_length: "long",
    current_color: "brunette",
    trial_timeline_preference: "6-8 weeks before"
  }
}
```

This feeds directly into `board_contexts.<board_id>` in the taste graph (Section 6.1) and into `board_feed_score` filtering (Section 4.4).

### 7.5 Board Lifecycle After the Event Passes

A Bridal board with a wedding date of 9/14 shouldn't just sit there stale on 9/15, still trying to surface bridal content. Options:
- Auto-archive with a prompt: *"How did it go? Leave a review?"*
- Convert into a permanent style-history record the client can revisit or reference later

This is also a clean, honest re-engagement moment — don't leave it on the table. **(NEW)** Archiving also triggers the sharp affinity decay for that event's tags (§6.2) so the global feed moves on when the client does.

---

## 8. The `viewer_event_date` Field — Priority Build

This single field (prom date, wedding date, etc.) is the highest-leverage, lowest-creepiness personalization unlock in this entire spec:
- Powers countdown badges everywhere ("42 days until prom")
- Justifies honest re-engagement notifications ("18 days until prom — here's who still has openings")
- Makes TOVIS feel like it has a *relationship* to the biggest days in someone's life, not just a content feed

**Recommendation: build this before the more inferential/implicit signal work.** It's explicit, low-risk, and high-payoff.

### 8.1 Notification Budget (NEW)

This spec now sanctions several re-engagement triggers: availability changes (§5.7.5), event countdowns (§8), saved-not-booked responses (§6.8), rebook cadence prompts (§6.7), board archiving (§7.5). Individually honest; collectively they can become spam and burn every "knows me" gain.

- Hard cap: **max 2–3 pushes per user per week**, all trigger types pooled.
- Priority when competing: event-date countdowns > availability-opened-on-a-save > rebook cadence > everything else.
- One-tap per-trigger-type mute in every notification.
- Track opt-out rate per trigger type as a first-class health metric (§9) — a rising opt-out rate on a trigger means that trigger is mistimed or mistargeted, not that "users don't like notifications."

---

## 9. Success Metrics (Define Before Building)

Without this defined up front, the team will default to measuring vanity metrics (saves, scroll depth) that actively work against the stated goal. Track from day one:

- **Save-to-book conversion rate, broken out by badge type** — tells you which badges actually work vs. which just feel good
- **Time from board creation to first booking**
- **`saved_not_booked` gap size over time** — shrinking = algorithm is working; growing = feed is dreaming without delivering
- **New/underbooked pro fill-rate lift** — is the boost mechanic actually filling books, not just impressions
- **(NEW) Exposure-normalized engagement** — all engagement metrics reported per impression, never as raw counts (consistent with §4.1)
- **(NEW) Feed freshness** — % never-before-seen cards per session (§4.6); falling freshness predicts churn before churn happens
- **(NEW) Hide rate & category-suppression rate** — rising hide rate = personalization degrading; it's the cheapest early-warning signal you have
- **(NEW) Notification opt-out rate per trigger type** (§8.1)
- **(NEW) Rebook rate through TOVIS** — did the client book the same pro again *via the platform*; measures whether the relationship layer (§6.7) is working and whether pairs are being driven off-platform

**(NEW) Measure badges causally, not correlationally.** "Booking fast" badges will correlate with bookings because they're *assigned* to already-booking-fast content. Run a permanent small holdout (e.g., 5% of impressions render badge-eligible cards without the badge) so every badge type has a measured causal lift. Kill badges that don't lift — a badge that doesn't work is pure visual noise.

---

## 10. Guardrails Summary (read before building)

1. Scroll time is not success — booking is success. Don't import TikTok's engagement-maximization goal wholesale.
2. Never let urgency/scarcity badges apply to high-commitment services. Trust and information first.
3. Never let a pro manually set their own badges.
4. Keep global and board taste vectors separate with a one-directional, low-weight bleed.
5. Lean on explicit signals (event dates, search, onboarding answers) over inferred behavioral signals wherever possible — it's both higher-signal and non-creepy by construction.
6. Every "personal-feeling" moment should be traceable to something the client actively told TOVIS or did on-platform toward their own stated goal — never a cross-platform or background inference.
7. **(NEW)** Self-profile attributes are always user-entered and editable — never inferred from a client's photos.
8. **(NEW)** Price and distance are soft weights, never hard filters. Don't decide what someone can afford.
9. **(NEW)** All re-engagement triggers share one notification budget (§8.1). Honest triggers in aggregate can still be spam.
10. **(NEW)** Every suppression decays. No permanent invisible penalties — for clients' categories or for pros' content.

---

## 11. Suggested Build Order (REVISED)

Impression logging and rate-based scoring moved to the foundation — they change the math everything else sits on. Self-profile and decay slot in alongside the board-metadata work they share a schema with.

1. **Impression logging + rate-based engagement scoring (§4.1)** — the foundation; retrofitting this later means re-deriving every score
2. Success metrics instrumentation incl. holdout scaffolding (§9)
3. `viewer_event_date` field + board creation question flow (§7–8)
4. Cold start fallback logic for new clients and new pros (§2.1)
5. Board metadata schema + board-scoped taste vector + **user self-profile schema (§6.6)** + **affinity time decay (§6.2)** — one schema pass
6. **Visual embedding pipeline (§6.0)** — start early as its own track; embed at upload from day one so the corpus is ready when ranking consumes it
7. Board feed scoring/filtering + negative/skip/hide signal handling + per-user baselines (§4.4, 2.2, 2.3)
8. Badge library + commitment-tier priority logic + rotation + impression caps (§5, 4.6)
9. Bookable-score additions: availability, conversion rate, underbooked boost, reliability, price/proximity fit (§4.2, 4.5)
10. Diversity injection + session intent detection (§4.3.1–4.3.2)
11. Real-time session-level graph adjustment (§6.3)
12. Notification budget + saved-not-booked activation (§8.1, 6.8)
13. Post-booking relationship layer (§6.7)
14. Anti-gaming velocity checks (§5.6)
15. Pro-side transparency dashboard (§6.5)
16. Board lifecycle/archiving (§7.5)
17. Small-market fallback tuning (§4.7)
18. Cross-board suggestion layer (§6.4) — lowest priority, highest care needed
