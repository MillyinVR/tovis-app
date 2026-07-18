# AI Consult & Client Membership — design

> **Status: DESIGN — not started.** Drafted 2026-07-18 from a planning session with
> Tori; updated same day with the home entry card, evidence-based pro matching,
> event/group-event mode, and success metrics. No code exists yet. Open decisions
> for Tori are listed at the bottom; everything else in this doc is settled
> direction. When work starts, follow the session-chaining protocol (one step per
> session) and keep this doc updated.

## Vision

Clients run an AI-guided consult that produces a **full personal analysis** —
face shape, eye shape, jawline, skin tone/texture, undertone, hair type/condition
— and turns it into **service recommendations that lead directly to bookings**:
hair color and cuts, men's cuts and beard shaping, brows, microblading and
permanent makeup, lashes, bridal/event makeup, skin/facials, nails. The framing
is "the best version of yourself," executed by a real pro.

Three outputs per consult:

1. **Pro-facing brief** — what the client wants, their history and constraints,
   quality photos of what the pro will be working on, and the AI's observations.
   Saves the pro chair-side discovery time and makes them look prepared.
2. **Client-facing read** — a few recommendations with the *why*, always framed
   as directions to discuss: the pro is the professional and will tell them
   what's actually achievable.
3. **Durable beauty profile** — the analysis persists (members) and powers the
   **"Me" card**: a private profile surface with the full read and personalized,
   *bookable* recommendations.

**The moat is not the AI analysis** (generic color-analysis apps are commodity).
It is: (a) the client's existing taste graph — saved looks, boards, taste
vector, self-profile chips, booking history — which pre-fills the intake and
personalizes the read; (b) the booking graph — every recommendation maps to a
real `Service`/`ServiceCategory` and bookable pros; (c) the outcome loop —
before/after photos from real appointments ground achievability over time.
Every design choice should deepen those ties.

## Naming

⚠️ "Consultation" already means the **pro-initiated mid-appointment price
approval** (`ConsultationApproval`, plus deprecated `BookingConsultation` that a
static guard protects). This feature is a **pre-visit client intake**. Internal
name: **`ConsultSession`** ("AI consult" in speech; user-facing copy via
`lib/brand`). Never touch or read the legacy consultation models from this
feature.

## Tier model

| | Free client | Member (paid) |
|---|---|---|
| Entry points | Home "need a change?" card (**mini analysis**) + booking flow | Home card + standalone full analysis + booking flow |
| Scope | Booking flow: the booked vertical. Home card: quick mini analysis (client picks a focus — face, hair, hands/nails) | Full analysis — all verticals, any time |
| Client sees | 2–3 recommendations, each with matched services **and pros** to book | Full Me card: undertone/season, face shape, best colors/cuts/shapes per vertical, suits-you looks, outcome history |
| Pro gets | **Full brief** | **Full brief** |
| Persistence | Per-consult record only | Durable beauty profile powering the Me card |

**Home entry card** (Tori, 2026-07-18): every client's home page gets a card —
"Need a change? Want something new? Run an analysis to see what suits you." A
free tap runs a **mini analysis**: a few guided photos (hands explicitly
offered, for nail shape), a light read, and 2–3 recommendations that each
resolve to bookable services *and* matched pros. Nothing durable is saved. A
member tap runs the full analysis / opens the Me card.

> Note: this **revises the original "standalone is member-only" decision** —
> the resolution is that *entry* is for everyone and *depth* is what's tiered.
> The free mini analysis is a pure booking driver (Tovis earns on the booking);
> membership sells depth + persistence. Flagged in open decisions for Tori to
> confirm the mini-analysis depth/caps.

Locked principles:

- **The brief never degrades.** Tiering hits what the *client* sees. The brief
  serves the appointment and the pro; a free client's booking must not arrive
  worse-prepared.
- **Run the full analysis for everyone; gate only presentation + persistence.**
  One engine, no tiered analysis code paths. Makes the locked-Me-card upsell
  nearly free: after a free booking consult the full analysis already exists —
  show the teaser ("Your full analysis is ready — unlock your Me card").
- **Free-tier limits:** booking-flow consults are self-scoping (vertical from
  the booked offering's category); home-card mini analyses are client-picked
  focus with tight caps (photos, recommendation count, cooldown between runs);
  neither writes the durable profile.

## Analysis engine: universal core + vertical lenses

Not N independent analyzers. One **core analysis** every vertical consumes:

- Face shape / geometry, jawline
- Eye shape
- Skin tone, undertone (with confidence + range — never one confident label),
  skin texture/concerns (strictly cosmetic — no medical/derma territory)
- Hair: type, density, current level/tone, visible condition

**Vertical lenses** map core traits + intake answers to service-shaped
recommendations: face shape → cuts (women's and men's) and brow shapes;
jawline → beard shaping; eye shape → lash styles and liner; undertone → hair
color palettes and makeup; geometry → microblading/permanent-makeup shapes;
hand/nail-bed shape → nail shapes. Lenses are additive and cheap once the core
exists — build the core first, add verticals incrementally.

**Every recommendation resolves to a bookable entity** (`ServiceCategory` /
`Service`) so the Me card is a booking surface, not a quiz result. Men's
grooming (cuts, beard) is a first-class lens — most competitors are
femme-targeted; Tovis serves barbers.

Mechanics (mirror `lib/pro/cameraVision.ts`):

- Claude vision via `@anthropic-ai/sdk`, structured output
  (`output_config.format` json_schema), server-side `ANTHROPIC_API_KEY`,
  default model `claude-opus-4-8` with env override, sanitizers on every field,
  images in-flight for the quality gate; analysis photos persist via the normal
  media pipeline (below).
- **Version everything on the analysis record**: `schemaVersion`, `model`,
  `promptVersion`. Prompts will iterate; re-runs and A/B need this from day one.
- Intake is **not free-form chat**: deterministic per-vertical question packs
  (config-driven, like `lib/pro/cameraShotPacks.ts`; chip-style like
  `selfProfile` / `Board.answers`) with Claude choosing bounded adaptive
  follow-ups. Predictable UX, bounded cost.
- **Pre-fill from existing signal**: self-profile chips, taste vector, boards,
  saved looks, booking history. The consult should *open* knowing the client
  ("You've been saving warm copper balayage…"). This is the wow moment.
- Hair-color intake must ask **chemical history** (box dye, prior lightening,
  last service dates) — the single highest-value brief content for a colorist
  and the biggest want-vs-achievable gap.

## Guided capture

Two-layer quality gate, same pattern as TOVISCamera (pro camera coach):

1. **On-device** (iOS): exposure/framing checks, face detection via Vision
   framework, live coaching. Web falls back to plain upload.
2. **Claude vision capture check** per photo: accept or return one specific
   retake tip ("window light is behind you — face it"). For color work,
   **hard-reject color-cast/warm-indoor-light photos** — lighting is the
   accuracy bottleneck for undertone.

Per-vertical shot lists (hair: back/sides/crown in daylight; skin: bare-faced
indirect light; nails: hands flat; beard: front + profile). The same photos
double as the pro's preview of what they'll work on.

Storage: `media-private` bucket, new `UploadSurface` value (e.g.
`CLIENT_CONSULT`), signed uploads via the existing `UploadSession` flow, all
writes through `lib/media/recordMediaAsset.ts`. Never auto-published;
`publicShareGuard` conventions apply.

## Pro brief

- Client's **own words first**, AI observations second. The AI must make the pro
  look prepared, never second-guessed.
- Achievability framing is **structural**, not a disclaimer: recommendations are
  "directions to discuss with your pro," each with a why; copy consistently
  positions the pro as the authority.
- **One-tap pro feedback** (brief accurate / off) — adoption insurance and a
  quality signal for prompt iteration.
- Surfaces: booking detail + client chart, via the standard pro-facing read
  pattern (loader + RSC section + API twin sharing the loader).

## Me card (membership anchor)

Private profile surface rendering the durable beauty profile: full analysis,
per-vertical recommendations (each tap-to-book), suits-you looks (taste vector
∩ suitability — a novel combination of the personalization engine and this
analysis), and outcome history.

- **Opt-in share render.** Personal-color cards are proven viral mechanics; a
  beautiful branded share image is an acquisition channel for one template's
  cost. Private by default.
- **Recurring value is designed, not assumed** (renewal risk — an analysis is
  one-shot): seasonal refreshes, trend-adapted recommendations, outcome
  tracking, per-booking consults. See open decisions (subscription vs hybrid).

## Outcome loop

After appointments, before/after photos already flow through the platform. Feed
results back: the Me card records what was actually achieved ("level 7 copper,
June — how it held"), and achievability framing gets grounded in what pros
actually delivered for similar clients. Unique to Tovis; also the strongest
renewal story.

## Evidence-based pro matching (the pro skill graph)

Recommendations resolve to **pros with demonstrated results**, not just pros who
list the service (Tori, 2026-07-18). "Highlights would suit you" should surface
the colorists whose *portfolios show work in the client's color range* and whose
*outcomes prove it* — not everyone with a highlights offering.

Evidence sources, all existing or near-existing:

- **Portfolio analysis**: run analysis over pro media (`MediaAsset` has
  `primaryServiceId`; look embeddings already exist via Voyage) to tag what each
  pro demonstrably does — color ranges/levels, hair textures, skin tones served,
  styles. This builds a per-pro **skill graph**.
- **Outcome evidence**: reviews, rebook rates (`ProfessionalBadgeStat`,
  REBOOK_RATE badge), and bookings by clients with **similar analysis profiles**
  — "clients with your color profile rebook this pro."
- The ranking engine already has the fairness machinery to blend this:
  `underbooked_pro_boost` exists precisely so evidence-rich busy pros don't
  bury newer pros. Skill-graph match becomes another soft term, never a hard
  filter.

Guardrails:

- **Similar-client matching is aggregate and anonymous** — never expose any
  individual client's analysis to anyone; only "pros with strong results for
  profiles like yours."
- **Cold start / fairness**: thin-portfolio pros must not vanish — blend
  evidence score with the existing underbooked/availability terms.
- **Pro-side flywheel**: the skill graph doubles as pro value — "your portfolio
  shows strong warm-blonde work; clients searching for X can't see evidence of
  it yet — post more X" is a coaching surface (and pairs with the TOVISCamera
  portfolio critique).

This is meaty enough to be its own future epic ("pro skill graph") that the
consult *consumes*; design it so the consult works with plain
service+availability matching first and upgrades transparently.

## Event & group-event mode

Boards already carry the event machinery: `BoardType` (BRIDAL, PROM,
PERMANENT_MAKEUP, COLOR_TRANSFORMATION, NAILS, SKINCARE), `Board.eventDate`, and
the 30/14/7/3-day event countdown notifications (§8, PR #621). An **event
consult** ties into that:

- Anchored to a dated board: the analysis + goal feed a **run-up timeline**
  ("book your trial 8 weeks out, color 2 weeks out, brows 1 week out") with each
  step bookable. Countdown notifications can reference consult recommendations.
- Event clients are the highest-intent, highest-ticket users; bridal/prom is
  where "the best version of yourself" framing lands hardest.

**Group events (bridal parties, quinceañeras, proms) are a separate,
not-yet-started epic** — spec'd (nothing implemented) in
[`group-bookings-spec.md`](./group-bookings-spec.md). Its §13.8 and this doc
agree on the integration: the group Vision Board **feeds** the consult layer
(one pro-facing brief per client, never two inspiration inboxes), and a member
tapping "+ Add to Vision Board" is feeding the same intake pipeline a consult
uses. Design hook: one event, many members — each member runs their own consult,
the event holds a shared context (palette/theme), and the AI coordinates
("looks that suit each member *and* the shared palette"). Per-member analyses
stay private to each member; only the shared goal is group-visible.

## Data model sketch

- **`ConsultSession`** — clientId, optional serviceCategoryId (vertical),
  optional bookingId/professionalId, status, intake answers (Json), media links,
  analysis (Json, versioned), brief (Json/text), timestamps.
- **`ClientBeautyProfile`** (name TBD) — the durable, **AI-inferred** store
  behind the Me card. ⚠️ Must be separate from `ClientProfile.selfProfile`,
  whose contract is *explicit client-declared only, never inferred*
  (`lib/personalization/selfProfile.ts`). Client-owned: viewable, editable,
  deletable.
- **Booking attach**: `POST /api/v1/bookings/finalize` gains `consultId` —
  additive, mirrors the existing `lookPostId`/`mediaId` pattern. (Note:
  `Booking.clientNotes` exists but is dead — nothing writes it; the only
  client-note+media precedent is `WaitlistEntry`.)
- Routes: new `app/api/v1/client/consult/*` namespace.
- Async (if needed): new job type on the `LooksSocialJob` queue + the
  `/api/internal/jobs/*` cron fabric.

Privacy/consent (decide before build, not after):

- Consult photos: `media-private`, pro read access scoped to the booking
  relationship; auto-expire if never attached to a booking; client deletion
  cascades (photos + analysis + profile).
- Face photos of possibly-minor clients → age gate the feature.
- Analysis is client-owned data, not pro-authored chart data (so the
  author-scoped encryption pattern doesn't apply, but PII-guard conventions do).
- Cross-pro "overall read" legally sees only the client's own declared data
  (selfProfile, allergies, taste, consult history) — encrypted chart free-text
  is author-scoped. This is the correct posture; don't fight it.

## Membership & billing

- Mirror the pro pattern: `SubscriptionPlan` + `ProfessionalSubscription` +
  code-defined entitlements (`lib/pro/entitlements.ts`) → add
  `ClientSubscription` + `lib/client/entitlements.ts`. Clients already have
  `ClientProfile.stripeCustomerId` from booking checkout — web billing is a
  mirror job, not new territory.
- ⚠️ **Apple IAP decision required before building purchase flow.** Booking
  payments ride Stripe legitimately (real-world services). A membership whose
  benefits are digital falls under IAP rules if sold in-app: StoreKit + 15–30%
  cut + StoreKit↔Stripe entitlement sync, vs web-only purchase (US external-link
  steering now permitted, but friction). Affects pricing.
- Membership is the **client-side premium umbrella**: AI analysis anchors it;
  priority access to openings / early booking windows / waitlist priority can
  fold in later for non-AI renewal value.

## Quality & risk guardrails

- **Diverse eval set before launch** — photos spanning Fitzpatrick skin types
  with known-correct undertone/face-shape answers, run against every prompt
  revision. Color analysis across all skin tones is where naive prompting fails
  and where the reputational cost is highest.
- Confidence ranges on color outputs, never a single confident "season."
- Cost: a full multi-vertical consult ≈ tens of vision calls ≈ well under $1 at
  Opus pricing — fine against a membership price, but quota anyway (mirror
  `lib/pro/cameraQuota.ts`; per-tier daily/refresh limits).
- Pro adoption risk → brief framing rules + one-tap feedback (above).
- Cyber/med safety: skin analysis stays cosmetic; no diagnosis language.

## Success metrics (instrument from day one)

Each phase has a small set of numbers that decide whether the next phase
deserves investment. Emit serve-log events (the `looks_feed_serve` pattern) from
the start.

**Phase 0 — "does the AI help bookings?"** (decides whether membership is worth
building)

- **Consult completion rate**: of clients who start a consult, % who finish.
  Low completion = intake too long or capture too frustrating; fix before
  anything else.
- **Consult → booking conversion**: do consulted bookings happen (and complete)
  at a higher rate than non-consulted ones?
- **Pro brief rating**: % of briefs the pro one-taps as accurate/useful. This is
  the quality bar — pros are the adoption risk.
- **Photo retake rate**: how many quality-gate rejections per accepted photo
  (capture-UX health).

**Teaser — "is membership viable?"** (measurable before billing exists)

- **Teaser tap rate**: % of free consulters who tap the locked Me card.
- Optionally a "notify me when membership launches" list — signup rate is the
  cheapest demand signal there is.

**Phase 1 — "is membership a business?"**

- Teaser → paid conversion; month-2 retention/churn; Me-card return rate
  (weekly actives among members); share-card usage (growth loop).

**Always-on guardrails**

- Analysis accuracy on the diverse eval set (per prompt revision, before ship).
- Pro negative-brief-rating rate trending down, not up.
- Complaint/report rate on analyses.

Rough go/no-go: if consulted bookings convert meaningfully better AND pros rate
briefs positively, Phase 1 is justified. If teaser taps are high but bookings
don't lift, the product is entertainment, not a booking driver — rethink before
billing.

## Phasing

> Session-by-session execution queue (both repos, both epics):
> [`consult-groups-build-plan.md`](./consult-groups-build-plan.md) — C-steps.

1. **Phase 0 — free booking-attached consult (MVP).** No billing work. Universal
   core analysis + 1–2 vertical lenses — hair color (richest analysis, founder's
   domain) + brows (pure shape mapping, cheap, covers microblading interest).
   Question packs → guided capture with quality gate → analysis → brief →
   `consultId` on finalize → brief in pro booking detail. Pro-driven
   distribution from day one: the booking confirmation invites the client to
   consult before their appointment. Founder-gated first (allowlist precedent:
   technical record). Validates AI quality with real pros before any money
   changes hands; builds the corpus and the teaser audience.
2. **Phase 0.5 — home entry card (free mini analysis).** Still no billing. The
   "need a change?" card with the capped mini analysis (face / hair / hands
   focus), recommendations resolving to services + pros (plain
   service+availability matching at first). Ships once Phase 0 proves the
   engine; this is the booking-driver + teaser-audience surface.
3. **Phase 1 — membership + Me card.** `ClientSubscription` + entitlements, the
   durable profile, full Me card, standalone full analysis, teaser upsell from
   free consults, share render. Requires the IAP decision.
4. **Phase 2 — breadth + loops.** Remaining vertical lenses (men's cut/beard,
   lashes, makeup/bridal, skin, nails), outcome loop, suits-you feed filtering,
   evidence-based pro matching (skill graph), event-mode consults on dated
   boards, pro feedback → prompt iteration, seasonal refresh. Group-event
   consults land whenever the group-events epic exists.

Web ↔ iOS: client-facing → parity rule applies. Capture is dramatically better
native (reuse TOVISCamera geometry + coaching); scope web to upload + AI quality
feedback, iOS to full guided capture.

## Open decisions (Tori)

1. **Pricing shape** — subscription vs hybrid (one-time full analysis + optional
   membership for the living layer) vs subscription-only. Interacts with
   renewal-value design.
2. **Apple IAP vs web-only membership purchase** (see Membership & billing).
3. **Membership umbrella perks** — which non-AI perks (priority offers, early
   windows) fold in, and when.
4. **Vertical rollout order** after hair color + brows.
5. **Consult photo retention window** specifics (auto-expiry duration).
6. **Free-tier caps** — exact recommendation count / photo counts / refresh
   limits.
7. **Mini-analysis depth** — confirm the home-card free tier (what a mini
   analysis includes, run cooldown) since it revises the original
   standalone-is-member-only decision.
8. **Group-events epic** — scope and timing (Tori has her own planning started;
   nothing in the repo yet). The consult's event mode doesn't wait for it.

## Grounding map (for the implementing session)

| Existing piece | Where | Reuse |
|---|---|---|
| Claude vision engine | `lib/pro/cameraVision.ts` | Client pattern, structured output, sanitizers, error kinds |
| Vision quotas | `lib/pro/cameraQuota.ts` | Per-tier consult quotas |
| Guided-capture config | `lib/pro/cameraShotPacks.ts` | Question-pack + shot-list config shape |
| Signed uploads | `app/api/v1/client/uploads/route.ts`, `lib/media/uploadSession.ts` | New `CLIENT_CONSULT` surface |
| Media write choke point | `lib/media/recordMediaAsset.ts` | All consult photo writes |
| Self-profile (explicit-only contract) | `lib/personalization/selfProfile.ts` | Read for pre-fill; **never write inferred data here** |
| Taste vectors | `lib/personalization/tasteVectors.ts`, `ClientTasteVector` | Pre-fill + suits-you feed |
| Booking finalize | `app/api/v1/bookings/finalize/route.ts` | Add `consultId` (mirrors `lookPostId`) |
| Entitlements pattern | `lib/pro/entitlements.ts`, `SubscriptionPlan`, `ProfessionalSubscription` | Mirror for clients |
| Async jobs | `LooksSocialJob` + `/api/internal/jobs/*` crons | Optional async analysis |
| Legacy consultation (do not touch) | `ConsultationApproval`, `BookingConsultation` (deprecated, guard-protected) | Naming collision only |
