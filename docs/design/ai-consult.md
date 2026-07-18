# AI Consult & Client Membership — design

> **Status: DESIGN — not started.** Drafted 2026-07-18 from a planning session with
> Tori. No code exists yet. Open decisions for Tori are listed at the bottom;
> everything else in this doc is settled direction. When work starts, follow the
> session-chaining protocol (one step per session) and keep this doc updated.

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
| Entry point | Booking flow only | Standalone "Me" surface + booking flow |
| Scope | The vertical of the service being booked | Full analysis — all verticals |
| Client sees | 2–3 recommendations framed around the upcoming appointment | Full Me card: undertone/season, face shape, best colors/cuts/shapes per vertical, suits-you looks, outcome history |
| Pro gets | **Full brief** | **Full brief** |
| Persistence | Per-booking consult record only | Durable beauty profile powering the Me card |

Locked principles:

- **The brief never degrades.** Tiering hits what the *client* sees. The brief
  serves the appointment and the pro; a free client's booking must not arrive
  worse-prepared.
- **Run the full analysis for everyone; gate only presentation + persistence.**
  One engine, no tiered analysis code paths. Makes the locked-Me-card upsell
  nearly free: after a free booking consult the full analysis already exists —
  show the teaser ("Your full analysis is ready — unlock your Me card").
- **Free-tier limits are self-scoping:** vertical comes from the booked
  offering's service category; photo count per vertical needs; recommendations
  capped; no durable profile write.

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

## Phasing

1. **Phase 0 — free booking-attached consult (MVP).** No billing work. Universal
   core analysis + 1–2 vertical lenses — hair color (richest analysis, founder's
   domain) + brows (pure shape mapping, cheap, covers microblading interest).
   Question packs → guided capture with quality gate → analysis → brief →
   `consultId` on finalize → brief in pro booking detail. Founder-gated first
   (allowlist precedent: technical record). Validates AI quality with real pros
   before any money changes hands; builds the corpus and the teaser audience.
2. **Phase 1 — membership + Me card.** `ClientSubscription` + entitlements, the
   durable profile, full Me card, standalone entry, teaser upsell from free
   consults, share render. Requires the IAP decision.
3. **Phase 2 — breadth + loops.** Remaining vertical lenses (men's cut/beard,
   lashes, makeup/bridal, skin, nails), outcome loop, suits-you feed filtering,
   pro feedback → prompt iteration, seasonal refresh.

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
