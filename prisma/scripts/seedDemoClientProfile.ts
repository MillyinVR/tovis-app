// prisma/scripts/seedDemoClientProfile.ts
//
// LOCAL-ONLY demo fixture for the client-surface design walkthrough.
//
// Most client screens render EMPTY today on the dev database (the primary test
// client has no handle, no public profile, no looks, no boards and no follows),
// which makes them impossible to compare against a populated design mockup. This
// seeds one fully-populated demo creator — Maya Reyes — whose content mirrors
// `ClientPublicProfileFrame.dc.html` so every screen in the walkthrough can be
// compared like-for-like instead of "empty state vs mockup".
//
// Everything it writes is additive and carries a `demoseed-` id prefix, so a
// rerun (or `--clean`) removes exactly its own rows and nothing else. It never
// modifies the existing seed accounts.
//
// Usage:
//   pnpm db:dev:seed:demo-client
//   pnpm db:dev:seed:demo-client -- --clean     # remove the demo data, seed nothing
//
// NOTE ON DEVIATIONS FROM THE MOCKUP (deliberate, see the PR):
//   • the mockup's @maya.reyes becomes @maya-reyes — `isValidHandle` allows only
//     [a-z0-9-], so a dotted handle could never exist in this product;
//   • board item counts are the REAL number of looks on each board rather than
//     the mockup's invented 24/15/12/18 — a count that lies is exactly the class
//     of bug this walkthrough exists to find.
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
  BoardVisibility,
  ClientAddressKind,
  ClientClaimStatus,
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  LookPostStatus,
  LookPostVisibility,
  MediaPhase,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  NotificationEventKey,
  OpeningStatus,
  PaymentCollectionTiming,
  Prisma,
  PrismaClient,
  ProNameDisplay,
  ProfessionalLocationType,
  ProfessionType,
  Role,
  ServiceLocationType,
  VerificationStatus,
  ViralRequestApprovalFanOutStatus,
  ViralServiceRequestStatus,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'

import { refreshClientCreatorStats } from '@/lib/clients/creatorTier'
import { normalizeHandle } from '@/lib/handles'
import {
  addDaysToYMD,
  getZonedParts,
  weekdayInTimeZone,
  zonedTimeToUtc,
} from '@/lib/time'

// ── guard ────────────────────────────────────────────────────────────────────
// Own hard guard rather than requireSafeScriptRun: this script must NEVER reach
// a hosted database, and `.env.local` holds the PROD Supabase URL, so the host
// is checked directly. Mirrors seedRetentionRosterPerf.ts.
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function requireLocalDatabase(): void {
  const raw = process.env.DATABASE_URL ?? ''
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error('[seedDemoClientProfile] DATABASE_URL is not a parseable URL.')
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `[seedDemoClientProfile] Refusing non-local database host "${host}". ` +
        'This script only ever runs against localhost:5434 (tovis_dev). ' +
        '.env.local holds the PROD Supabase URL — pass DATABASE_URL explicitly.',
    )
  }
}
requireLocalDatabase()

const prisma = new PrismaClient()

// ── identity ─────────────────────────────────────────────────────────────────
// Every row this script creates is id-prefixed so cleanup is exact.
const P = 'demoseed-'
/** Deliberately not a real Supabase bucket — see the MediaAsset create below. */
const DEMO_LOCAL_BUCKET = 'local-demo-seed'
const TIME_ZONE = 'America/New_York'
const NOW = new Date('2026-08-13T12:00:00.000Z')

// `User.phone` is @unique, so this must not collide with the numbers
// `prisma/seed.cjs` hands the standing dev accounts (+1555555010x).
const DEMO_PHONE = '+15555550190'

const CREATOR = {
  id: `${P}client-maya`,
  handle: 'maya-reyes',
  firstName: 'Maya',
  lastName: 'Reyes',
  city: 'Brooklyn',
  bio:
    'Chasing the perfect lived-in blonde & the next viral look. Everything here ' +
    'is bookable — tap Recreate to get the same look near you. ✦',
  avatarUrl: 'http://localhost:3000/seed-demo/avatar-maya.jpg',
}

/** Every Nth seeded fan has a public profile, so remix rows mix "@handle" with "Someone". */
const PUBLIC_FAN_EVERY = 3

/** Fan indices below this are the ones that actually book — see `bookingRows`. */
const publicFanIndices = (attributedBookings: number): number[] =>
  Array.from({ length: attributedBookings }, (_, i) => i).filter(
    (i) => i % PUBLIC_FAN_EVERY === 0,
  )

/**
 * Which fan each activity-feed row is attributed to.
 *
 * The feed's PII model branches on whether the actor is publicly addressable, so
 * these are not interchangeable: `PRIVATE` must be a fan `publicFanIndices` did
 * NOT make public, every other one must be a fan it did, and `MUTUAL` is the one
 * Maya follows back (so the row offers "View" rather than "Follow"). Asserted at
 * seed time by {@link assertActivityFanRoles} — a change to `PUBLIC_FAN_EVERY`
 * would otherwise silently collapse these rows into one shape.
 */
const ACTIVITY_OPEN_FOLLOW_FAN = 0
const ACTIVITY_PRIVATE_FOLLOW_FAN = 1
const ACTIVITY_COMMENT_FAN = 3
const ACTIVITY_MUTUAL_FAN = 6
const ACTIVITY_LIKE_FAN = 9
const ACTIVITY_REPLY_FAN = 12

function assertActivityFanRoles(publicFans: Set<number>): void {
  const mustBePublic = [
    ACTIVITY_OPEN_FOLLOW_FAN,
    ACTIVITY_COMMENT_FAN,
    ACTIVITY_MUTUAL_FAN,
    ACTIVITY_LIKE_FAN,
    ACTIVITY_REPLY_FAN,
  ]
  for (const index of mustBePublic) {
    if (!publicFans.has(index)) {
      throw new Error(
        `[seedDemoClientProfile] activity fan ${index} must be a PUBLIC fan, ` +
          'but publicFanIndices did not make it one — the named-actor rows ' +
          'would all render as "Someone".',
      )
    }
  }
  if (publicFans.has(ACTIVITY_PRIVATE_FOLLOW_FAN)) {
    throw new Error(
      `[seedDemoClientProfile] activity fan ${ACTIVITY_PRIVATE_FOLLOW_FAN} must ` +
        'be PRIVATE — it exists to exercise the anonymous branch.',
    )
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Shifts every attributed ("recreated this") booking back to 06:00 from NOW's
 * 12:00 — see the exclusion-constraint note where it is used.
 */
const ATTRIBUTED_BOOKING_HOUR_OFFSET_MS = 6 * 60 * 60 * 1000

/**
 * Start of the CURRENT real UTC day.
 *
 * `ProfessionalAvailabilityStat.nextOpeningDate` stores a start-of-local-day
 * instant and the badge engine reads it against the real clock, so it is one of
 * the few fixture values that must not be frozen to {@link NOW}.
 */
function startOfRealDayUtc(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

const FOLLOWER_COUNT = 312
const FOLLOWING_COUNT = 18

/**
 * Background creators seeded purely so the tier percentile means something.
 *
 * `refreshClientCreatorStats` refuses to rank anyone until at least
 * CREATOR_TIER_MIN_RANKED_POPULATION (20) creators qualify — a percentile over a
 * population of one is noise. Without a field to be top OF, Maya's "top 5%"
 * would be an unearned label on a fixture, which is precisely the kind of
 * comfortable lie this walkthrough exists to catch. These creators publish real
 * looks with real (lower) save counts, so her rank is computed, not asserted.
 */
const BACKGROUND_CREATOR_COUNT = 30
const BACKGROUND_LOOKS_EACH = 3

type DemoPro = {
  key: string
  businessName: string
  firstName: string
  lastName: string
  profession: ProfessionType
  /**
   * A photograph of their own work, standing in for a portrait.
   *
   * Not decoration: the home's favourites rail is picture-led (Tori,
   * 2026-08-14), and a pro with no `avatarUrl` renders initials on a gradient —
   * so a fixture without images can only ever prove the fallback. The images
   * are the same `public/seed-demo/` files the looks use, which is why they
   * never touch PROD storage (see the MediaAsset note above).
   */
  avatarUrl: string
  /**
   * The pro's public bio. Screen 6's identity rail leads on it, and every demo
   * pro used to have none — so the block the redesign is largely about had
   * never been looked at with words in it.
   */
  bio: string
  /**
   * How long ago this pro joined, in days.
   *
   * 🔴 Not decoration. `User.createdAt` is what decides whether a pro reads as
   * NEW (`LOOK_BADGE_THRESHOLDS.newToPlatformMaxDays`, 60 days), and the
   * brand-new-pro chips render for them and for nobody else. Left to the
   * default the seed stamps `now()` on every pro, so EVERY demo pro would wear
   * the chips and the established state — the one almost every real profile is
   * in — could never be looked at.
   */
  joinedDaysAgo: number
  /**
   * Days until this pro's next opening, or null for "booked out over the scan
   * horizon" (no `ProfessionalAvailabilityStat` row at all, which is how the
   * real hourly job represents it). Drives the book bar's availability line and,
   * on a new pro, the `Available today` chip.
   */
  nextOpeningInDays: number | null
}

const PROS: DemoPro[] = [
  {
    key: 'noor',
    businessName: 'Noor Haddad Studio',
    firstName: 'Noor',
    lastName: 'Haddad',
    profession: ProfessionType.COSMETOLOGIST,
    avatarUrl: 'http://localhost:3000/seed-demo/lived-in-blonde.jpg',
    bio:
      'Fifteen years behind the chair. I do lived-in colour that grows out like ' +
      'it was always yours — and I will tell you honestly if the photo you ' +
      'brought takes two visits.',
    joinedDaysAgo: 900,
    nextOpeningInDays: 1,
  },
  {
    key: 'sasha',
    businessName: 'Sasha Lim Nails',
    firstName: 'Sasha',
    lastName: 'Lim',
    profession: ProfessionType.MANICURIST,
    avatarUrl: 'http://localhost:3000/seed-demo/glazed-almond-set.jpg',
    bio: 'Gel-X and structured manicures. Nail health first, length second.',
    joinedDaysAgo: 430,
    // Booked out across the horizon: the book bar must fall back to its neutral
    // headline rather than inventing an opening.
    nextOpeningInDays: null,
  },
  {
    key: 'mara',
    businessName: 'Mara Vance Beauty',
    firstName: 'Mara',
    lastName: 'Vance',
    profession: ProfessionType.ESTHETICIAN,
    avatarUrl: 'http://localhost:3000/seed-demo/lash-lift-tint.jpg',
    // Deliberately short: a brand-new pro's page has to hold up with almost
    // nothing on it, and "no bio" is part of that state.
    bio: '',
    // The BRAND-NEW pro — inside the 60-day window, so this is the one profile
    // that wears `Available today` + `New to {brand}`. Every other demo pro
    // shows the established state (no chips at all), which is the point.
    joinedDaysAgo: 5,
    nextOpeningInDays: 0,
  },
]

// Services the frame's looks need. Existing dev services are reused by name;
// the two the dev DB lacks are created (idempotently) alongside their category.
type DemoService = {
  key: string
  name: string
  categoryName: string
  categorySlug: string
  minPrice: number
  durationMinutes: number
}

const SERVICES: DemoService[] = [
  { key: 'balayage', name: 'Balayage', categoryName: 'Color', categorySlug: 'hair-color', minPrice: 180, durationMinutes: 180 },
  { key: 'partial', name: 'Partial Highlights', categoryName: 'Color', categorySlug: 'hair-color', minPrice: 120, durationMinutes: 150 },
  { key: 'gelx', name: 'Gel X Full Set', categoryName: 'Enhancements', categorySlug: 'nails-enhancements', minPrice: 100, durationMinutes: 120 },
  { key: 'lash', name: 'Lash Lift & Tint', categoryName: 'Lash', categorySlug: 'lash', minPrice: 90, durationMinutes: 60 },
  { key: 'brow', name: 'Brow Lamination', categoryName: 'Brow', categorySlug: 'brow', minPrice: 70, durationMinutes: 45 },
]

// Add-ons for the balayage offering — the booking flow's second step renders
// nothing at all without them, and the dev DB has zero `OfferingAddOn` rows.
// Two are `isRecommended` and two are not, because the design groups them into
// "Recommended for you" vs "Make it a moment": a fixture where every add-on is
// recommended would never exercise the second group.
//
// `group` on the wire DTO is the add-on service's `addOnGroup`, and
// `GET /api/v1/offerings/add-ons` only returns services with
// `isAddOnEligible: true` — both are set below. Without the flag the endpoint
// returns an empty list and the step renders "No add-ons for this service right
// now" with the rows sitting in the database, which is indistinguishable from a
// pro who simply offers none.
//
// ⚠️ An add-on's duration cannot be under 15 minutes. The route drops anything
// resolving to <= 0, and `normalizePositiveMinutesOrNull` then
// `clampInt(minutes, 15, …)` raises everything else to a 15-minute floor — seed
// the kit at 5 and the API returns 15, so the fixture would silently disagree
// with the screen. Consequence for the design: a pure retail item (its
// "Take-home gloss kit", priced with no "+N min" line) cannot be expressed
// today; it is seeded at the floor and flagged in the PR rather than papered
// over.
type DemoAddOn = {
  key: string
  name: string
  /** Heading the add-on is filed under on the step (wire DTO's `group`). */
  group: string
  categoryName: string
  categorySlug: string
  /** Starting price for the add-on, rendered "From $X" like every other price. */
  priceStartingAt: number
  minutes: number
  isRecommended: boolean
  sortOrder: number
}

const ADD_ONS: DemoAddOn[] = [
  { key: 'bond-builder', name: 'Olaplex bond builder', group: 'Treatment', categoryName: 'Treatment', categorySlug: 'treatment', priceStartingAt: 30, minutes: 15, isRecommended: true, sortOrder: 1 },
  { key: 'toner-gloss', name: 'Toner & gloss', group: 'Treatment', categoryName: 'Treatment', categorySlug: 'treatment', priceStartingAt: 40, minutes: 30, isRecommended: true, sortOrder: 2 },
  { key: 'scalp-massage', name: 'Scalp + neck massage', group: 'Make it a moment', categoryName: 'Extras', categorySlug: 'extras', priceStartingAt: 20, minutes: 15, isRecommended: false, sortOrder: 3 },
  { key: 'gloss-kit', name: 'Take-home gloss kit', group: 'Make it a moment', categoryName: 'Extras', categorySlug: 'extras', priceStartingAt: 35, minutes: 15, isRecommended: false, sortOrder: 4 },
]

/** Which offering (`proKey:serviceKey`) the add-ons above hang off. */
const ADD_ON_OFFERING_KEY = 'noor:balayage'

// Offerings that also travel, keyed `proKey:serviceKey`. Only one does, which is
// the point: the booking sheet's in-salon/mobile toggle only renders when a pro
// can host BOTH modes, so with a salon-only fixture the toggle — and the "From
// $X" line inside it — is never seen. Mobile costs more and runs longer, as a
// travelling appointment really does.
const MOBILE_OFFERINGS: Record<
  string,
  { priceStartingAt: number; durationMinutes: number }
> = {
  [ADD_ON_OFFERING_KEY]: { priceStartingAt: 290, durationMinutes: 195 },
}

// The frame's six look cards, verbatim.
type DemoLook = {
  key: string
  title: string
  proKey: string
  serviceKey: string
  /** The look's own starting price — rendered as "From $X" (Tori's standing rule). */
  priceStartingAt: number
  saveCount: number
  /** How many bookings cite this look as their source — "N recreated this". */
  recreated: number
  /** The frame's red "Viral" badge, backed by the real admin Spotlight signal. */
  featured: boolean
}

const LOOKS: DemoLook[] = [
  { key: 'lived-in-blonde', title: 'Lived-in blonde', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 250, saveCount: 84, recreated: 12, featured: false },
  { key: 'cherry-cola-balayage', title: 'Cherry Cola Balayage', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 260, saveCount: 56, recreated: 8, featured: true },
  { key: 'glazed-almond-set', title: 'Glazed almond set', proKey: 'sasha', serviceKey: 'gelx', priceStartingAt: 90, saveCount: 41, recreated: 6, featured: false },
  { key: 'money-piece-blonde', title: 'Money-piece blonde', proKey: 'noor', serviceKey: 'partial', priceStartingAt: 180, saveCount: 63, recreated: 9, featured: false },
  { key: 'lash-lift-tint', title: 'Lash lift + tint', proKey: 'mara', serviceKey: 'lash', priceStartingAt: 90, saveCount: 37, recreated: 5, featured: false },
  { key: 'brow-lamination', title: 'Brow lamination', proKey: 'mara', serviceKey: 'brow', priceStartingAt: 70, saveCount: 22, recreated: 3, featured: false },
]

/**
 * The PRO's own portfolio posts — screen 6's grid.
 *
 * 🔴 These are separate from `LOOKS` above and they have to be. Every entry in
 * `LOOKS` carries `clientAuthorId: creator.id`, and `proOwnPublicLooksWhere`
 * filters `clientAuthorId: null` — so none of them reach a pro's portfolio, and
 * the demo pro's public profile grid was EMPTY. The half of the screen the
 * redesign is mostly about had never been looked at with rows in it.
 *
 * `likeCount`/`commentCount` are the denormalized counters the tiles print, and
 * `recreated` becomes real attributed bookings below (a count with no rows
 * behind it is the kind of fixture that flatters the product).
 */
type DemoProLook = {
  key: string
  /**
   * Which file under `public/seed-demo/` this look renders. Reused across looks
   * on purpose: the fixture must not reference an image that does not exist —
   * a 404 tile reads as a broken grid, not a broken fixture.
   */
  image: string
  title: string
  proKey: string
  serviceKey: string
  priceStartingAt: number
  likeCount: number
  commentCount: number
  recreated: number
  /** Renders as a before/after comparison — and only a PAIRED look can. */
  paired: boolean
  /** The pro's chosen Signature. Exactly one per pro, or none. */
  signature: boolean
}

const PRO_LOOKS: DemoProLook[] = [
  // Noor's Signature: paired, so the promoted block renders its comparison
  // slider, and the one look with recreates so the gold line has a number.
  { key: 'pro-root-melt', image: 'lived-in-blonde', title: 'Grown-out root, hand-painted so she can go 4 months between visits.', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 250, likeCount: 214, commentCount: 18, recreated: 12, paired: true, signature: true },
  { key: 'pro-copper-gloss', image: 'cherry-cola-balayage', title: 'Copper on a natural level 5 — no lift, all gloss.', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 210, likeCount: 168, commentCount: 9, recreated: 7, paired: false, signature: false },
  // Zero recreates ON PURPOSE: the tile must render NOTHING there, not a "0".
  { key: 'pro-face-frame', image: 'money-piece-blonde', title: 'Soft money-piece around the face.', proKey: 'noor', serviceKey: 'partial', priceStartingAt: 180, likeCount: 96, commentCount: 4, recreated: 0, paired: false, signature: false },
  { key: 'pro-colour-correction', image: 'cherry-cola-balayage', title: 'Two sessions from box black to this.', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 320, likeCount: 331, commentCount: 41, recreated: 5, paired: true, signature: false },
  { key: 'pro-lived-in', image: 'lived-in-blonde', title: 'Lived-in blonde, six weeks after the first pass.', proKey: 'noor', serviceKey: 'balayage', priceStartingAt: 250, likeCount: 142, commentCount: 6, recreated: 3, paired: false, signature: false },
  // Sasha: a pro with a grid but NO Signature — the ordinary state, and the one
  // that proves the page is still whole without the promoted block.
  { key: 'pro-almond-set', image: 'glazed-almond-set', title: 'Glazed almond set, structured.', proKey: 'sasha', serviceKey: 'gelx', priceStartingAt: 90, likeCount: 77, commentCount: 3, recreated: 0, paired: false, signature: false },
  { key: 'pro-chrome-tips', image: 'glazed-almond-set', title: 'Chrome tips over a milky base.', proKey: 'sasha', serviceKey: 'gelx', priceStartingAt: 110, likeCount: 121, commentCount: 8, recreated: 4, paired: false, signature: false },
  // Mara is the brand-new pro: three looks, no reviews, no Signature. Three good
  // photographs are more persuasive than any empty block would have been.
  { key: 'pro-lash-set', image: 'lash-lift-tint', title: 'Lash lift with a soft tint.', proKey: 'mara', serviceKey: 'lash', priceStartingAt: 90, likeCount: 6, commentCount: 1, recreated: 0, paired: false, signature: false },
  { key: 'pro-brow-lam', image: 'brow-lamination', title: 'Brow lamination, brushed up.', proKey: 'mara', serviceKey: 'brow', priceStartingAt: 70, likeCount: 4, commentCount: 0, recreated: 0, paired: false, signature: false },
  { key: 'pro-glass-skin', image: 'lash-lift-tint', title: 'Dewy finish after a gentle peel.', proKey: 'mara', serviceKey: 'lash', priceStartingAt: 120, likeCount: 9, commentCount: 2, recreated: 0, paired: false, signature: false },
]

// Board covers render as a strip of up to FOUR looks, so the fixture carries
// boards on both sides of that: two full four-look boards and two smaller ones,
// which is what proves the strip narrows honestly instead of leaving dead cells.
//
// `shared` is explicit per board because the client's OWN boards screen badges
// the SHARED ones. Every board being shared would make that badge true of every
// row — a fixture that flatters the product and proves nothing — so exactly one
// board here is PRIVATE. It is a FIFTH board rather than a demotion of one of
// the four, which keeps the public profile (screen 2) showing the same four it
// already shipped against.
const BOARDS: {
  key: string
  name: string
  lookKeys: string[]
  shared: boolean
}[] = [
  {
    key: 'lived-in-blonde',
    name: 'Lived-in blonde',
    lookKeys: ['lived-in-blonde', 'money-piece-blonde', 'cherry-cola-balayage', 'brow-lamination'],
    shared: true,
  },
  {
    key: 'viral-looks',
    name: 'Viral looks',
    lookKeys: ['cherry-cola-balayage', 'lived-in-blonde', 'glazed-almond-set', 'lash-lift-tint'],
    shared: true,
  },
  {
    key: 'wedding-hair',
    name: 'Wedding hair',
    lookKeys: ['money-piece-blonde', 'lived-in-blonde'],
    shared: true,
  },
  { key: 'nails-2025', name: 'Nails 2025', lookKeys: ['glazed-almond-set'], shared: true },
  {
    key: 'maybe-someday',
    name: 'Maybe someday',
    lookKeys: ['lash-lift-tint', 'brow-lamination'],
    shared: false,
  },
]

/**
 * The demo creator's OWN appointments — the two states screen 4 is about.
 *
 * Every one of the 43 bookings above is a FAN's, attributed to one of Maya's
 * looks; she had none of her own, so `/client/bookings` and every appointment
 * screen behind it rendered empty for the very account the walkthrough drives.
 *
 * ⚠️ The upcoming one is timed off the REAL clock, not the fixture's frozen
 * `NOW`. An "in 3 days" appointment pinned to a constant is upcoming for three
 * days and then quietly becomes a past one, and the prep screen it exists to
 * populate disappears — a fixture that rots into a passing empty state.
 */
const OWN_APPOINTMENTS = {
  proKey: 'noor',
  serviceKey: 'balayage',
  /** Days from today, in the appointment's own zone (not +72h — DST). */
  upcomingInDays: 3,
  upcomingHour: 11,
  /** Long enough ago that the rebook window below is live, not expired. */
  pastDaysAgo: 38,
  pastHour: 10,
  /** The MOBILE one, a different day so it can't collide on the pro's clock. */
  mobileInDays: 9,
  mobileHour: 14,
  priceStartingAt: 250,
  /** Mobile costs more, as a travelling appointment really does. */
  mobilePriceStartingAt: 290,
  durationMinutes: 180,
} as const

/**
 * Maya's own service address — where a MOBILE appointment happens. Deliberately
 * NOT the Brooklyn address every demo pro sits at: if the client's address and
 * the pro's salon were the same string, a surface that resolved the wrong one
 * would render identically to one that resolved the right one, and the fixture
 * would prove nothing.
 */
const MAYA_HOME = {
  formattedAddress: '88 Withers St, Brooklyn, NY 11211',
  addressLine1: '88 Withers St',
  city: 'Brooklyn',
  state: 'NY',
  postalCode: '11211',
  countryCode: 'US',
  lat: 40.7175,
  lng: -73.9502,
} as const

/**
 * The care plan Noor published after the past appointment.
 *
 * `notes` is the pro's own free text (the frame's "Noor's note"); the rebook
 * window is a real RECOMMENDED_WINDOW, dated off the past appointment rather
 * than typed, so the range the screen prints is the one the product would
 * compute. Products are the EXTERNAL-link kind — the internal `Product`
 * catalogue is empty on a dev DB, and a recommendation with a null product is
 * the row a real pro writes when they link their own shop.
 */
const CARE_PLAN = {
  notes:
    'Cool water for the first 48 hours and a sulfate-free shampoo will keep ' +
    'the balayage bright. Book your gloss before the eight-week mark and we ' +
    'never have to chase brass.',
  /** Weeks after the appointment that the pro wants her back. */
  rebookWindowStartWeeks: 7,
  rebookWindowEndWeeks: 9,
  /**
   * The pro's own labelled blocks — the care PLAN, above the closing note.
   *
   * 🔴 The labels are TEXT NOOR WROTE, not an enum, and the fixture says so on
   * purpose: "First 48 hours" is a heading any beauty pro could write, while
   * "Washing" and "Heat" are hers. A fixture whose every label happened to be a
   * hairdressing term would make a schema'd version look correct.
   */
  sections: [
    {
      key: '1-first-48',
      label: 'First 48 hours',
      body:
        'Cool water only, and no dry shampoo. If you can skip the gym until ' +
        'Thursday, the toner sets that much harder.',
    },
    {
      key: '2-washing',
      label: 'Washing',
      body:
        'Twice a week, sulfate-free, and rinse cooler than feels nice. ' +
        'Anything else strips the toner and we chase brass in six weeks.',
    },
    {
      key: '3-heat',
      label: 'Heat & styling',
      body:
        'Heat protectant every single time, iron no hotter than 350°F. ' +
        'Air-dry when you can — the ends are the newest part of the colour.',
    },
  ],
  // ⚠️ Keys are ORDER-PREFIXED. Both clients read
  // `recommendedProducts` with `orderBy: { id: 'asc' }`, which on real cuids is
  // creation order — but on a fixture's hand-written ids it is alphabetical, so
  // unprefixed keys silently render the pro's list backwards and invite a bug
  // report against the product for something only the fixture does.
  products: [
    {
      key: '1-shampoo',
      name: 'Olaplex No. 4 Bond Maintenance Shampoo',
      url: 'https://example.com/olaplex-no-4',
      note: 'Twice a week, cool water.',
    },
    {
      key: '2-mask',
      name: 'K18 Leave-In Molecular Repair Mask',
      url: 'https://example.com/k18-mask',
      note: 'Every third wash on the mid-lengths.',
    },
    {
      key: '3-heat',
      name: 'Color Wow Dream Coat',
      url: 'https://example.com/dream-coat',
      note: 'Before any heat over 300°F.',
    },
  ],
} as const

/**
 * The client HOME's five other sections (screen 5).
 *
 * Home renders eight sections and five of them had no rows on this fixture, so
 * the populated half of the screen — the half the frame is mostly about — could
 * only ever be compared as "empty state vs mockup".
 *
 * Favourites are an ODD count on purpose. Both clients lay the pro tiles out
 * two-up, and an even fixture can never show what the last row does with a
 * single tile; the mockup's "· 4" is its own invented number, exactly like the
 * board counts this script already refuses to copy.
 */
const FAVORITE_PRO_KEYS = ['noor', 'sasha', 'mara'] as const
const FAVORITE_SERVICE_KEYS = ['balayage', 'lash', 'brow'] as const

/**
 * Maya's waitlist places — and, crucially, OTHER clients ahead of her.
 *
 * 🔴 `aheadOfMaya` is the whole point of this fixture. Both clients label the row
 * `#{index + 1} in line`, which is the position in MAYA'S OWN list, while the
 * pro's waitlist (`app/api/v1/pro/waitlist/route.ts`: *"FIFO: the client who
 * joined first is rank #1 within their service"*) ranks the same entry against
 * everyone else waiting. With Maya as the only entry those two numbers agree by
 * accident and the screen looks correct; seed people ahead of her and they
 * disagree, which is the only way the bug is visible at all.
 */
const WAITLIST: {
  key: string
  proKey: string
  serviceKey: string
  /** Fans holding an ACTIVE place for the same pro+service, joined earlier. */
  aheadOfMaya: number
  preference: WaitlistPreferenceType
  timeOfDay?: WaitlistTimeOfDay
}[] = [
  {
    key: 'gelx-sasha',
    proKey: 'sasha',
    serviceKey: 'gelx',
    aheadOfMaya: 2,
    preference: WaitlistPreferenceType.TIME_OF_DAY,
    timeOfDay: WaitlistTimeOfDay.EVENING,
  },
  {
    key: 'lash-mara',
    proKey: 'mara',
    serviceKey: 'lash',
    aheadOfMaya: 4,
    preference: WaitlistPreferenceType.ANY_TIME,
  },
]

/**
 * Last-minute openings Maya was notified about.
 *
 * ⚠️ These are read through `filterStillOpenRows`, which re-runs the REAL
 * scheduling gate against the pro's live calendar — so an opening the fixture
 * writes at a time the pro cannot actually serve is silently dropped and the
 * strip renders its empty state, indistinguishable from a seed that never ran.
 * Hence: a service short enough to finish before the 18:00 close, a start on the
 * hour or half hour so it lands on the slot grid, and `dayOffset` counted in
 * OPEN days (Sunday is disabled in `workingHoursJson`, and the demo pros' only
 * bookings are in the past, so nothing else can collide).
 *
 * One opening carries a tier incentive and one does not: `incentiveLabel` is
 * rendered from the matched tier plan, so a fixture where every row had an offer
 * would never show the plain row, and vice versa.
 */
const OPENINGS: {
  key: string
  proKey: string
  serviceKey: string
  /** Open days from today — 1 is the next working day, never a Sunday. */
  dayOffset: number
  hour: number
  minute: number
  note: string
  tier: LastMinuteTier
  offerType: LastMinuteOfferType
  percentOff?: number
}[] = [
  {
    key: 'noor-partial',
    proKey: 'noor',
    serviceKey: 'partial',
    dayOffset: 1,
    // ⚠️ 11:00, not the afternoon: `dayOffset: 1` can land on a SATURDAY, and
    // Saturday closes at 16:00 in `workingHoursJson` — a 150-minute partial
    // starting at 14:30 runs past the close, the liveness gate drops the row,
    // and the strip renders its empty state as if the seed had never run.
    hour: 11,
    minute: 0,
    note: 'Had a cancellation — happy to fit a partial in.',
    tier: LastMinuteTier.WAITLIST,
    offerType: LastMinuteOfferType.PERCENT_OFF,
    percentOff: 15,
  },
  {
    key: 'mara-lash',
    proKey: 'mara',
    serviceKey: 'lash',
    dayOffset: 2,
    hour: 16,
    minute: 30,
    note: 'One lash slot left this week.',
    tier: LastMinuteTier.DISCOVERY,
    offerType: LastMinuteOfferType.NONE,
  },
]

/**
 * The Viral Looks band: one look that is LIVE (anyone's — the live list is
 * global) and one of Maya's own still in review.
 *
 * Both counts come from real `ViralRequestApprovalFanOut` rows rather than a
 * number in the fixture, so "N pros now offer this" and "shared with N pros"
 * are counting something. There are three demo pros, so the honest count is 3 —
 * not the mockup's 12.
 *
 * The two `sourceUrl`s are on DIFFERENT platforms because the cards print
 * "via {platform}" from `platformFromUrl`; one host would leave that branch
 * proven only once.
 */
const VIRAL = {
  /**
   * More than one, because the band changes shape at exactly that point: one
   * approved look is a hero, two or more list as board-style strips. A
   * single-look fixture can only ever prove the hero.
   */
  live: [
    {
      key: 'glazed-donut-skin',
      name: 'Glazed Donut Skin',
      sourceUrl: 'https://www.tiktok.com/@demoseed/video/7300000000000000000',
      /** Pros who picked it up — the "N pros now offer this" row. */
      proKeys: ['noor', 'sasha', 'mara'] as const,
      /** A reviewer's cover, set in /admin/viral-requests. */
      coverImage: 'http://localhost:3000/seed-demo/cherry-cola-balayage.jpg',
    },
    {
      key: 'expensive-brunette',
      name: 'Expensive Brunette',
      sourceUrl: 'https://www.instagram.com/p/DemoSeedExpensiveBrunette/',
      proKeys: ['noor'] as const,
      coverImage: 'http://localhost:3000/seed-demo/money-piece-blonde.jpg',
    },
    {
      // 🔴 Deliberately WITHOUT a cover: an approved look can be published
      // before anyone has a photograph of it, and a fixture where every strip
      // has a picture would never render the gradient fallback the client is
      // supposed to draw.
      key: 'milky-nails',
      name: 'Milky Nails',
      sourceUrl: 'https://www.tiktok.com/@demoseed/video/7300000000000000001',
      proKeys: ['sasha', 'mara'] as const,
      coverImage: null,
    },
  ],
  pending: {
    key: 'cherry-cola-balayage',
    name: 'Cherry Cola Balayage',
    sourceUrl: 'https://www.instagram.com/p/DemoSeedCherryCola/',
    /** Pros it has been shared with while it is IN_REVIEW. */
    proKeys: ['noor', 'sasha', 'mara'] as const,
    /**
     * What the submitter attached — the evidence half of the review queue.
     *
     * 🔴 NOT a cover. `coverImageUrl` stays null on this row on purpose: this
     * is what makes `/admin/viral-requests` render "Sent by the client · not
     * published" with its "Use this" button, while the client's own surfaces
     * still draw their gradient. Without it a shipped panel looks unbuilt.
     */
    submitterMedia: ['http://localhost:3000/seed-demo/cherry-cola-balayage.jpg'],
  },
} as const

// ── the pro Portfolio library (/pro/portfolio) ───────────────────────────────
// Everything above this line is built from work that is already PUBLISHED,
// because screens 1–6 are client-facing. The pro's library is about the states
// publishing leaves behind, and before this block every one of them was
// unreachable: three demo pros, all 100% public, so the screen rendered a
// single zone and four of its five states could not be looked at at all.
//
// 🔴 A held photo is only expressible because the consent gate now keys on
// PROVENANCE (`bookingId`) rather than on `storageBucket`. Under the old rule a
// fixture photo was renderable or held, never both — the sentinel bucket that
// keeps these images off PROD storage also read as "not a session photo".

/**
 * Session photos the CLIENT has not released. These are the majority state in
 * production (65 of 70 assets), not an edge case.
 *
 * 🔴 Every name is DIFFERENT. The tile renders "Waiting on {name}" from the
 * booking's own client, so a fixture where all six say "Maya" would render
 * identically whether the mapping is right or joined to the wrong booking.
 */
const PORTFOLIO_HELD: Array<{
  key: string
  clientFirstName: string
  image: string
  phase: MediaPhase
  /**
   * 🔴 The consent sheet can only offer a nudge when there is an aftercare to
   * RE-send; otherwise it tells the pro to send the first one. Both branches
   * need a row, or only one of them is ever looked at.
   */
  aftercareSent: boolean
  /**
   * 🔴 The SECOND reason a nudge is refused, and the one no gate on this screen
   * checks. `maybeCreateAftercareAccessDeliveryInBoundary` throws
   * AFTERCARE_DELIVERY_FAILED when the client has neither email nor phone — and
   * a pro-created UNCLAIMED client (most of a real book) has neither. A fixture
   * where every client is contactable would never reach it.
   */
  contactable: boolean
}> = [
  { key: 'priya', clientFirstName: 'Priya', image: 'lived-in-blonde', phase: MediaPhase.AFTER, aftercareSent: true, contactable: true },
  { key: 'danielle', clientFirstName: 'Danielle', image: 'cherry-cola-balayage', phase: MediaPhase.AFTER, aftercareSent: true, contactable: true },
  { key: 'renee', clientFirstName: 'Renee', image: 'money-piece-blonde', phase: MediaPhase.BEFORE, aftercareSent: true, contactable: true },
  // Aftercare sent, but nowhere to send it again.
  { key: 'yusuf', clientFirstName: 'Yusuf', image: 'lived-in-blonde', phase: MediaPhase.AFTER, aftercareSent: true, contactable: false },
  // The two no-aftercare rows: the sheet must fall back to "send the aftercare
  // first" rather than offering a button the write boundary would refuse
  // (`nudgeAftercareRebook` throws AFTERCARE_NOT_COMPLETED without one).
  { key: 'camille', clientFirstName: 'Camille', image: 'brow-lamination', phase: MediaPhase.AFTER, aftercareSent: false, contactable: true },
  { key: 'adaeze', clientFirstName: 'Adaeze', image: 'glazed-almond-set', phase: MediaPhase.AFTER, aftercareSent: false, contactable: true },
]

/**
 * Session photos the client HAS released, still unpublished by the pro.
 *
 * 🔴 These are the reason "From sessions" and "Waiting" must not be treated as
 * the same set. A fixture where every session photo is held makes the two
 * indistinguishable, and any code that conflates them looks correct.
 */
const PORTFOLIO_RELEASED: Array<{ key: string; clientFirstName: string; image: string }> = [
  { key: 'imani', clientFirstName: 'Imani', image: 'cherry-cola-balayage' },
  { key: 'theo', clientFirstName: 'Theo', image: 'lash-lift-tint' },
]

/**
 * The pro's own uploads, never published. These drive the "Your uploads" zone,
 * the tile's `+` affordance and the publish sheet — none of which any existing
 * fixture row could reach, since every seeded upload was already public.
 */
const PORTFOLIO_UPLOADS: Array<{ key: string; image: string; caption: string; video?: boolean }> = [
  { key: 'balcony-gloss', image: 'cherry-cola-balayage', caption: 'Gloss refresh in the window light.' },
  { key: 'root-shadow', image: 'lived-in-blonde', caption: 'Root shadow melt, shot on the way out.' },
  { key: 'face-frame-two', image: 'money-piece-blonde', caption: 'Face-frame variation I want to try again.' },
  { key: 'brow-detail', image: 'brow-lamination', caption: 'Brow detail — good light, bad angle.' },
  { key: 'chrome-study', image: 'glazed-almond-set', caption: '' },
  { key: 'lash-macro', image: 'lash-lift-tint', caption: 'Macro on the lash line.' },
  // The one VIDEO. `MediaAsset` stores no duration, so the tile draws a play
  // GLYPH where the frame stamped "0:14" — a fixture with no video at all would
  // have let that decision go unlooked-at.
  { key: 'blowout-clip', image: 'lived-in-blonde', caption: 'Finish shot, 4 seconds.', video: true },
]

/**
 * A pro whose library is entirely private — the LAUNCH state, and the only way
 * to reach the lead card. Separate pros rather than a demotion of noor's set,
 * because screens 1–6 are built against those public fixtures.
 */
const PORTFOLIO_LAUNCH_PRO = {
  key: 'imogen',
  firstName: 'Imogen',
  lastName: 'Bassey',
  businessName: 'Imogen Bassey Hair',
  uploads: ['lived-in-blonde', 'cherry-cola-balayage', 'money-piece-blonde', 'brow-lamination'],
} as const

/** A pro with no media at all — the blank state. */
const PORTFOLIO_BLANK_PRO = {
  key: 'wren',
  firstName: 'Wren',
  lastName: 'Okafor',
  businessName: 'Wren Okafor Studio',
} as const

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n: number) => new Prisma.Decimal(n.toFixed(2))

/**
 * The one Brooklyn address every demo location sits at.
 *
 * 🔴 `lat`/`lng` are NOT decoration. `evaluateProReadinessForEntryPoint` drops
 * any bookable location missing them from `readyLocationIds`, so a geo-less
 * fixture reports NO_BOOKABLE_LOCATION and every `POST /api/v1/holds` comes back
 * 409 "This professional is not currently accepting bookings" — while the
 * availability drawer still lists slots perfectly happily, because reading a
 * day's grid never runs the readiness check. The fixture looks bookable right up
 * to the moment someone clicks a time.
 */
const BROOKLYN = {
  formattedAddress: '215 Bedford Ave, Brooklyn, NY 11211',
  addressLine1: '215 Bedford Ave',
  city: 'Brooklyn',
  state: 'NY',
  postalCode: '11211',
  countryCode: 'US',
  lat: 40.7143,
  lng: -73.9613,
}

function brooklynAddress() {
  return {
    formattedAddress: BROOKLYN.formattedAddress,
    addressLine1: BROOKLYN.addressLine1,
    city: BROOKLYN.city,
    state: BROOKLYN.state,
    postalCode: BROOKLYN.postalCode,
    countryCode: BROOKLYN.countryCode,
    lat: new Prisma.Decimal(BROOKLYN.lat),
    lng: new Prisma.Decimal(BROOKLYN.lng),
  }
}

/**
 * The shape `prisma/seed.cjs` writes and the availability engine reads: three-
 * letter day keys with `enabled`. An invented shape (`monday`/`isOpen`) parses
 * as JSON, stores fine, and then fails at the point it matters — the drawer
 * reported "Working hours are misconfigured for this location" and no slots,
 * which is how a fixture can look seeded and still be unbookable.
 */
function workingHoursJson() {
  const day = { enabled: true, start: '09:00', end: '18:00' }
  return {
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: { enabled: true, start: '10:00', end: '16:00' },
    sun: { enabled: false, start: '09:00', end: '18:00' },
  }
}

/**
 * Removes every row this script has ever created, in FK-safe order. Keyed
 * entirely on the `demoseed-` id prefix, so it can never touch another
 * fixture's data. Bookings/board items/follows cascade from their parents, but
 * are deleted explicitly first so the script stays correct if a cascade rule
 * ever changes.
 */
async function clean(): Promise<void> {
  const idPrefix = { startsWith: P }

  // Holds are NOT id-prefixed — they are created at runtime by whoever drives
  // the booking flow against this fixture, and both their offering and their
  // location are RESTRICT-referenced. Leaving them behind makes the fixture
  // permanently un-cleanable the first time anyone actually picks a time
  // ("BookingHold_offeringId_fkey"), so they are keyed on the demo pros instead.
  await prisma.bookingHold.deleteMany({
    where: { professionalId: idPrefix },
  })
  // Bookings and their reviews are keyed on the demo pros for the SAME reason —
  // it is the same defect one step further along. A hold carried through to
  // "Request to book" becomes a Booking with a runtime cuid, which
  // `id: demoseed-` cannot match, and it RESTRICT-references the pro's
  // location. So the first person to actually COMPLETE a booking against this
  // fixture — the thing the fixture exists to let you do — made it permanently
  // un-cleanable ("Booking_locationId_fkey"). Anything booked against a
  // `demoseed-` pro belongs to this fixture, whoever created it.
  await prisma.review.deleteMany({ where: { professionalId: idPrefix } })
  // An AftercareSummary cascades from its booking, but ProductRecommendation
  // does NOT cascade from the summary (a required relation with no onDelete is
  // Restrict), so deleting the booking would fail on the recommendation rows
  // and take the whole `--clean` down with it. Keyed on the demo pros for the
  // same reason as the bookings themselves: a summary the pro writes at runtime
  // against this fixture carries a cuid, not the prefix, and belongs to it just
  // the same.
  const demoSummaryIds = (
    await prisma.aftercareSummary.findMany({
      where: { booking: { professionalId: idPrefix } },
      select: { id: true },
    })
  ).map((row) => row.id)
  if (demoSummaryIds.length > 0) {
    await prisma.productRecommendation.deleteMany({
      where: { aftercareSummaryId: { in: demoSummaryIds } },
    })
    await prisma.aftercareSummary.deleteMany({
      where: { id: { in: demoSummaryIds } },
    })
  }
  await prisma.booking.deleteMany({ where: { professionalId: idPrefix } })
  // Home's other five sections (screen 5). Openings hold RESTRICT references to
  // the pro's location, offering and service, so they have to go before those —
  // and they are keyed on the PRO, not the id prefix, for the same reason the
  // bookings above are: a pro publishing an opening against this fixture at
  // runtime gets a cuid, and it belongs to the fixture just the same.
  await prisma.lastMinuteRecipient.deleteMany({
    where: { opening: { professionalId: idPrefix } },
  })
  await prisma.lastMinuteTierPlan.deleteMany({
    where: { opening: { professionalId: idPrefix } },
  })
  await prisma.lastMinuteOpeningService.deleteMany({
    where: { opening: { professionalId: idPrefix } },
  })
  await prisma.lastMinuteOpening.deleteMany({ where: { professionalId: idPrefix } })
  // 🔴 `LastMinuteSettings` is created LAZILY BY THE APP — `loadLastMinuteWorkspace`
  // creates one the first time a pro opens their last-minute workspace — so the
  // row carries a cuid, not this script's prefix, and its relation to the pro is
  // RESTRICT. One visit to that screen while driving the fixture permanently
  // blocked `--clean` from removing the demo pro. Keyed on the PRO for the same
  // reason the bookings and openings above are. Neither child cascades, so they
  // go first.
  await prisma.lastMinuteServiceRule.deleteMany({
    where: { settings: { professionalId: idPrefix } },
  })
  await prisma.lastMinuteBlock.deleteMany({
    where: { settings: { professionalId: idPrefix } },
  })
  await prisma.lastMinuteSettings.deleteMany({
    where: { professionalId: idPrefix },
  })
  await prisma.waitlistEntry.deleteMany({ where: { professionalId: idPrefix } })
  await prisma.viralRequestApprovalFanOut.deleteMany({
    where: { professionalId: idPrefix },
  })
  await prisma.viralServiceRequest.deleteMany({ where: { clientId: idPrefix } })
  await prisma.professionalFavorite.deleteMany({ where: { professionalId: idPrefix } })
  // A demo user's favourites, and anyone's favourite of a service this script
  // introduced — the second half matters because ServiceFavorite RESTRICTs
  // nothing but would be orphaned data the next run counts.
  await prisma.serviceFavorite.deleteMany({
    where: { OR: [{ userId: idPrefix }, { serviceId: idPrefix }] },
  })
  await prisma.proNoShowSettings.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalPaymentSettings.deleteMany({ where: { id: idPrefix } })
  await prisma.boardItem.deleteMany({ where: { id: idPrefix } })
  await prisma.board.deleteMany({ where: { id: idPrefix } })
  await prisma.clientFollow.deleteMany({ where: { id: idPrefix } })
  // Both cascade from the client profile below, but are removed explicitly so
  // `--clean` stays honest about everything this script writes.
  await prisma.proFollow.deleteMany({ where: { id: idPrefix } })
  await prisma.clientNotification.deleteMany({ where: { id: idPrefix } })
  await prisma.lookPost.deleteMany({ where: { id: idPrefix } })
  // The look's primary MediaAsset is @unique + cascades TO the look, so the
  // looks above are already gone; drop the assets themselves now.
  await prisma.mediaAsset.deleteMany({ where: { id: idPrefix } })
  // The pro's "Before you go" rows, and the clients' ticks against them. Both
  // cascade from the offering/pro, but removing them explicitly keeps `--clean`
  // honest about what it owns.
  await prisma.bookingPrepCheck.deleteMany({ where: { id: idPrefix } })
  await prisma.proPrepItem.deleteMany({ where: { id: idPrefix } })
  await prisma.aftercareCareSection.deleteMany({ where: { id: idPrefix } })
  await prisma.bookingBoardShare.deleteMany({ where: { id: idPrefix } })
  // Before the offerings they hang off (they would cascade, but the links also
  // hold a RESTRICT reference to their add-on Service, which is deleted below —
  // so they have to be gone before that runs either way).
  await prisma.offeringAddOn.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalServiceOffering.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalLocation.deleteMany({ where: { id: idPrefix } })
  // Cascades from the pro below, but removed explicitly so `--clean` stays
  // honest about everything this script writes. Its @id IS the professionalId,
  // so the prefix matches directly.
  await prisma.professionalAvailabilityStat.deleteMany({
    where: { professionalId: idPrefix },
  })
  await prisma.handleRegistration.deleteMany({
    where: { handleNormalized: { in: [normalizeHandle(CREATOR.handle)] } },
  })
  // 🔴 Threads the APP created against demo rows, which this script did not
  // write and so cannot match by id prefix. `MessageThread.clientId` is a
  // required relation (RESTRICT), so a single thread opened while driving the
  // fixture — e.g. the client home's "Message" button — permanently blocks
  // `--clean` from removing the client. Keyed on the demo client/pro instead of
  // the row's own id for exactly that reason.
  // Messages + participants cascade from the thread.
  await prisma.messageThread.deleteMany({
    where: {
      OR: [{ clientId: idPrefix }, { professionalId: idPrefix }],
    },
  })
  // Before the client profile (cascade would take it, but the bookings above
  // RESTRICT-reference it, so order is load-bearing either way).
  await prisma.clientAddress.deleteMany({ where: { id: idPrefix } })
  await prisma.clientProfile.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalProfile.deleteMany({ where: { id: idPrefix } })
  await prisma.user.deleteMany({ where: { id: idPrefix } })
  // Services/categories are shared, global rows — only the two this script
  // introduces carry the prefix.
  await prisma.service.deleteMany({ where: { id: idPrefix } })
  await prisma.serviceCategory.deleteMany({ where: { id: idPrefix } })
}

async function main(): Promise<void> {
  const wantsClean = process.argv.includes('--clean')

  await clean()
  if (wantsClean) {
    console.log('[seedDemoClientProfile] removed demo rows; nothing seeded.')
    return
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'tovis-root' },
    select: { id: true },
  })
  if (!tenant) {
    throw new Error(
      '[seedDemoClientProfile] tenant "tovis-root" is missing — run `pnpm db:dev:seed` first.',
    )
  }
  const tenantId = tenant.id

  // ── services ───────────────────────────────────────────────────────────────
  const serviceIdByKey = new Map<string, string>()
  for (const svc of SERVICES) {
    const existing = await prisma.service.findUnique({
      where: { name: svc.name },
      select: { id: true },
    })
    if (existing) {
      serviceIdByKey.set(svc.key, existing.id)
      continue
    }

    const category =
      (await prisma.serviceCategory.findUnique({
        where: { slug: svc.categorySlug },
        select: { id: true },
      })) ??
      (await prisma.serviceCategory.create({
        data: {
          id: `${P}category-${svc.categorySlug}`,
          name: svc.categoryName,
          slug: svc.categorySlug,
        },
        select: { id: true },
      }))

    const created = await prisma.service.create({
      data: {
        id: `${P}service-${svc.key}`,
        name: svc.name,
        categoryId: category.id,
        defaultDurationMinutes: svc.durationMinutes,
        minPrice: money(svc.minPrice),
        isActive: true,
      },
      select: { id: true },
    })
    serviceIdByKey.set(svc.key, created.id)
  }

  const serviceId = (key: string): string => {
    const id = serviceIdByKey.get(key)
    if (!id) throw new Error(`[seedDemoClientProfile] unknown service key "${key}"`)
    return id
  }

  // ── pros (+ location, + offerings) ─────────────────────────────────────────
  const proIdByKey = new Map<string, string>()
  const locationIdByKey = new Map<string, string>()

  for (const pro of PROS) {
    const travels = Object.keys(MOBILE_OFFERINGS).some((key) =>
      key.startsWith(`${pro.key}:`),
    )

    await prisma.user.create({
      data: {
        id: `${P}user-pro-${pro.key}`,
        email: `demo-${pro.key}@tovis.app`,
        // Deliberately unusable: these accounts exist to own content, never to
        // be signed into. No seeded password hash is shared with a real login.
        password: 'demo-seed-no-login',
        role: Role.PRO,
        // Verified, because an unverified pro is refused by every pro-side API
        // (VERIFICATION_REQUIRED) — which made the whole pro half of this
        // fixture undemoable. A real approved pro has both of these.
        emailVerifiedAt: NOW,
        phoneVerifiedAt: NOW,
        // 🔴 Explicit, not defaulted. This is the ONLY input to the "New to
        // {brand}" rule, so leaving it at `now()` would badge every demo pro as
        // new and make the established state — what nearly every real profile
        // is — impossible to look at.
        createdAt: new Date(NOW.getTime() - pro.joinedDaysAgo * DAY_MS),
      },
    })

    const professional = await prisma.professionalProfile.create({
      data: {
        id: `${P}pro-${pro.key}`,
        userId: `${P}user-pro-${pro.key}`,
        homeTenantId: tenantId,
        firstName: pro.firstName,
        lastName: pro.lastName,
        businessName: pro.businessName,
        handle: `demo-${pro.key}`,
        handleNormalized: `demo-${pro.key}`,
        location: 'Brooklyn, NY',
        timeZone: TIME_ZONE,
        avatarUrl: pro.avatarUrl,
        bio: pro.bio || null,
        professionType: pro.profession,
        // Solo stylists, so the look's pro line reads "Noor Haddad · Balayage"
        // as the frame shows — the default BUSINESS_NAME would render
        // "Noor Haddad Studio".
        nameDisplay: ProNameDisplay.REAL_NAME,
        licenseState: 'NY',
        licenseVerified: true,
        verificationStatus: VerificationStatus.APPROVED,
        // Required by `evaluateProReadinessForEntryPoint` the moment the pro has
        // a bookable MOBILE_BASE location — without both, readiness reports
        // MOBILE_MISSING_BASE_CONFIG and every hold on this pro 409s.
        ...(travels
          ? { mobileBasePostalCode: BROOKLYN.postalCode, mobileRadiusMiles: 12 }
          : {}),
      },
      select: { id: true },
    })
    proIdByKey.set(pro.key, professional.id)

    const location = await prisma.professionalLocation.create({
      data: {
        id: `${P}location-${pro.key}`,
        professionalId: professional.id,
        type: ProfessionalLocationType.SALON,
        name: pro.businessName,
        isPrimary: true,
        isBookable: true,
        // 🔴 NOT true for everyone. `isAddressPublic` is what decides whether the
        // booking sheet may print a street address at all (the route is
        // unauthenticated, and a "salon" is often a home studio), so a fixture
        // where every pro published one would only ever exercise the published
        // branch — and the redaction would look correct while being untested.
        // Mara is the home-studio case: the sheet must fall back to her CITY.
        isAddressPublic: pro.key !== 'mara',
        ...brooklynAddress(),
        timeZone: TIME_ZONE,
        workingHours: workingHoursJson(),
      },
      select: { id: true },
    })
    locationIdByKey.set(pro.key, location.id)

    // A MOBILE offering is only bookable when the pro has a bookable
    // MOBILE_BASE location — `narrowOfferingModes` derives capability from the
    // locations that exist, not from the offering's flags, so `offersMobile`
    // alone would be narrowed straight back off and the toggle would never
    // appear. Only the pro whose offering travels gets one.
    if (travels) {
      await prisma.professionalLocation.create({
        data: {
          id: `${P}location-${pro.key}-mobile`,
          professionalId: professional.id,
          type: ProfessionalLocationType.MOBILE_BASE,
          name: `${pro.firstName} — mobile`,
          isPrimary: false,
          isBookable: true,
          // A mobile base is where the pro travels FROM; the appointment happens
          // at the client's address, so this one is never shown as the venue.
          isAddressPublic: false,
          ...brooklynAddress(),
          timeZone: TIME_ZONE,
          workingHours: workingHoursJson(),
        },
      })
    }

    // The precomputed availability row the badge engine reads. The real hourly
    // job DROPS a pro with no opening in the horizon rather than storing a null,
    // so "booked out" is modelled here as no row at all — which is what makes
    // the book bar's neutral fallback reachable.
    if (pro.nextOpeningInDays !== null) {
      await prisma.professionalAvailabilityStat.create({
        data: {
          professionalId: professional.id,
          // 🔴 Off the REAL clock, not the fixture's frozen NOW. The badge
          // engine buckets this against `new Date()`, so an opening pinned to
          // NOW + 1 day reads "Available tomorrow" only on the day the fixture
          // was written and collapses to "Available today" every day after.
          nextOpeningDate: new Date(
            startOfRealDayUtc().getTime() + pro.nextOpeningInDays * DAY_MS,
          ),
          openDayCount14d: 6,
          fullness14d: 0.42,
          capacityMinutes14d: 4800,
          // Fresh: the availability badges DISQUALIFY on a stale row rather than
          // rendering old urgency, so a fixture stamped in the past would render
          // no line and look like a bug.
          computedAt: new Date(),
        },
      })
    }
  }

  const proId = (key: string): string => {
    const id = proIdByKey.get(key)
    if (!id) throw new Error(`[seedDemoClientProfile] unknown pro key "${key}"`)
    return id
  }
  const locationId = (key: string): string => {
    const id = locationIdByKey.get(key)
    if (!id) throw new Error(`[seedDemoClientProfile] unknown pro key "${key}"`)
    return id
  }

  // Each pro offers the services their looks are for, so "Recreate this look"
  // lands on a bookable offering rather than a dead end.
  const offeringSeen = new Set<string>()
  for (const look of LOOKS) {
    const key = `${look.proKey}:${look.serviceKey}`
    if (offeringSeen.has(key)) continue
    offeringSeen.add(key)

    const svc = SERVICES.find((s) => s.key === look.serviceKey)
    if (!svc) throw new Error(`[seedDemoClientProfile] unknown service key "${look.serviceKey}"`)

    const mobile = MOBILE_OFFERINGS[key] ?? null

    await prisma.professionalServiceOffering.create({
      data: {
        id: `${P}offering-${look.proKey}-${look.serviceKey}`,
        professionalId: proId(look.proKey),
        serviceId: serviceId(look.serviceKey),
        salonPriceStartingAt: money(look.priceStartingAt),
        salonDurationMinutes: svc.durationMinutes,
        offersInSalon: true,
        offersMobile: mobile !== null,
        mobilePriceStartingAt: mobile ? money(mobile.priceStartingAt) : null,
        mobileDurationMinutes: mobile?.durationMinutes ?? null,
        isActive: true,
      },
    })
  }

  // ── add-ons ────────────────────────────────────────────────────────────────
  // The add-on services first (global catalog rows, reused by name like the
  // service catalog above), then the per-offering links the booking flow reads.
  for (const addOn of ADD_ONS) {
    const existing = await prisma.service.findUnique({
      where: { name: addOn.name },
      select: { id: true, isAddOnEligible: true },
    })

    // `Service.name` is @unique, so a same-named row from another fixture is
    // reused rather than recreated — but if it is not add-on eligible the
    // endpoint filters it out and the step renders "No add-ons for this service
    // right now" with four perfectly good links in the database. Fail loudly
    // instead of seeding something that silently shows nothing.
    if (existing && !existing.isAddOnEligible) {
      throw new Error(
        `[seedDemoClientProfile] service "${addOn.name}" already exists and is ` +
          'not isAddOnEligible — GET /api/v1/offerings/add-ons would filter it ' +
          'out. Remove that row, or flag it eligible, then re-run.',
      )
    }

    const addOnServiceId =
      existing?.id ??
      (
        await prisma.service.create({
          data: {
            id: `${P}service-addon-${addOn.key}`,
            name: addOn.name,
            categoryId: (
              (await prisma.serviceCategory.findUnique({
                where: { slug: addOn.categorySlug },
                select: { id: true },
              })) ??
              (await prisma.serviceCategory.create({
                data: {
                  id: `${P}category-${addOn.categorySlug}`,
                  name: addOn.categoryName,
                  slug: addOn.categorySlug,
                },
                select: { id: true },
              }))
            ).id,
            defaultDurationMinutes: addOn.minutes,
            minPrice: money(addOn.priceStartingAt),
            isActive: true,
            isAddOnEligible: true,
            addOnGroup: addOn.group,
          },
          select: { id: true },
        })
      ).id

    await prisma.offeringAddOn.create({
      data: {
        id: `${P}addon-${addOn.key}`,
        offeringId: `${P}offering-${ADD_ON_OFFERING_KEY.replace(':', '-')}`,
        addOnServiceId,
        isActive: true,
        isRecommended: addOn.isRecommended,
        sortOrder: addOn.sortOrder,
        priceOverride: money(addOn.priceStartingAt),
        durationOverrideMinutes: addOn.minutes,
      },
    })
  }

  // ── the creator ────────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      id: `${P}user-client-maya`,
      email: 'demo-maya@tovis.app',
      password: 'demo-seed-no-login',
      role: Role.CLIENT,
      // Verified, or the demo creator cannot reach a single one of her own
      // screens: `app/client/(gated)/layout` sends an unverified user to
      // "Complete your verification". The server still RENDERS /client/me — a
      // curl of it returns 200 with the board names in the HTML — so this is
      // invisible to anything but an actual browser, and it silently turned the
      // whole gated client surface into a screenshot of the verification page.
      phone: DEMO_PHONE,
      phoneVerifiedAt: NOW,
      emailVerifiedAt: NOW,
    },
  })

  const creator = await prisma.clientProfile.create({
    data: {
      id: CREATOR.id,
      userId: `${P}user-client-maya`,
      homeTenantId: tenantId,
      firstName: CREATOR.firstName,
      lastName: CREATOR.lastName,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: NOW,
      handle: CREATOR.handle,
      handleNormalized: normalizeHandle(CREATOR.handle),
      isPublicProfile: true,
      publicBio: CREATOR.bio,
      publicCity: CREATOR.city,
      avatarUrl: CREATOR.avatarUrl,
    },
    select: { id: true },
  })

  await prisma.handleRegistration.create({
    data: {
      handleNormalized: normalizeHandle(CREATOR.handle),
      clientProfileId: creator.id,
    },
  })

  // ── looks ──────────────────────────────────────────────────────────────────
  const lookIdByKey = new Map<string, string>()
  for (const [lookIndex, look] of LOOKS.entries()) {
    await prisma.mediaAsset.create({
      data: {
        id: `${P}media-${look.key}`,
        professionalId: proId(look.proKey),
        proTenantId: tenantId,
        primaryServiceId: serviceId(look.serviceKey),
        // storageBucket is NOT NULL, but this fixture's images live in the
        // repo's own /public, not in Supabase. A sentinel bucket matching
        // neither BUCKETS.mediaPublic nor BUCKETS.mediaPrivate makes
        // renderMediaUrls skip both the public-URL build and the signing path
        // and resolve to the stored absolute `url` below — so the demo grid
        // never reaches Supabase storage (which locally is PROD's).
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/${look.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${look.key}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
      },
    })

    const created = await prisma.lookPost.create({
      data: {
        id: `${P}look-${look.key}`,
        professionalId: proId(look.proKey),
        clientAuthorId: creator.id,
        primaryMediaAssetId: `${P}media-${look.key}`,
        serviceId: serviceId(look.serviceKey),
        caption: look.title,
        priceStartingAt: money(look.priceStartingAt),
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        publicToFeed: true,
        // Staggered, newest first, so `orderBy: { publishedAt: 'desc' }` is a
        // total order and the grid comes out in the frame's sequence. A shared
        // timestamp leaves the order up to the planner.
        publishedAt: new Date(NOW.getTime() - lookIndex * 60 * 60 * 1000),
        saveCount: look.saveCount,
        // The frame's "Viral" badge rides the existing admin Spotlight signal —
        // a real editorial flag, never a faked engagement count.
        featuredAt: look.featured ? NOW : null,
      },
      select: { id: true },
    })
    lookIdByKey.set(look.key, created.id)
  }

  const lookId = (key: string): string => {
    const id = lookIdByKey.get(key)
    if (!id) throw new Error(`[seedDemoClientProfile] unknown look key "${key}"`)
    return id
  }


  // ── the pros' OWN portfolio posts (screen 6) ───────────────────────────────
  // Pro-authored: `clientAuthorId` stays NULL, which is the whole difference
  // between a look on the CLIENT's /u/[handle] grid and one on the PRO's
  // portfolio (`proOwnPublicLooksWhere`).
  const proLookIdByKey = new Map<string, string>()
  for (const [index, look] of PRO_LOOKS.entries()) {
    // A paired look needs a SECOND asset to be the "before". Without it
    // `beforeAsset` is null and the tile renders as a plain image — so the
    // comparison slider, on the promoted Signature block and the B/A grid flag
    // alike, would look implemented and never appear.
    if (look.paired) {
      await prisma.mediaAsset.create({
        data: {
          id: `${P}media-${look.key}-before`,
          professionalId: proId(look.proKey),
          proTenantId: tenantId,
          primaryServiceId: serviceId(look.serviceKey),
          storageBucket: DEMO_LOCAL_BUCKET,
          // MediaAsset is @@unique([storageBucket, storagePath]) — per-row paths.
          storagePath: `seed-demo/${look.key}-before.jpg`,
          url: `http://localhost:3000/seed-demo/${look.image}.jpg`,
          mediaType: MediaType.IMAGE,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
        },
      })
    }

    await prisma.mediaAsset.create({
      data: {
        id: `${P}media-${look.key}`,
        professionalId: proId(look.proKey),
        proTenantId: tenantId,
        primaryServiceId: serviceId(look.serviceKey),
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/${look.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${look.image}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        caption: look.title,
        ...(look.paired ? { beforeAssetId: `${P}media-${look.key}-before` } : {}),
        // Service TAGS, not just primaryServiceId: the tile's chips and the
        // Signature block's tags read `services`, and the portfolio filter's
        // rows are derived from them. Without these the filter would collapse to
        // "All" and the promoted block would carry no tags.
        services: {
          create: [{ serviceId: serviceId(look.serviceKey) }],
        },
      },
    })

    const created = await prisma.lookPost.create({
      data: {
        id: `${P}prolook-${look.key}`,
        professionalId: proId(look.proKey),
        // 🔴 NULL — this is what makes it the PRO's portfolio post.
        clientAuthorId: null,
        primaryMediaAssetId: `${P}media-${look.key}`,
        serviceId: serviceId(look.serviceKey),
        caption: look.title,
        priceStartingAt: money(look.priceStartingAt),
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        // Staggered so `orderBy: { publishedAt: 'desc' }` is a total order and
        // the grid isn't shuffled by the planner.
        publishedAt: new Date(NOW.getTime() - index * 3 * 60 * 60 * 1000),
        likeCount: look.likeCount,
        commentCount: look.commentCount,
      },
      select: { id: true },
    })
    proLookIdByKey.set(look.key, created.id)

    if (look.signature) {
      await prisma.professionalProfile.update({
        where: { id: proId(look.proKey) },
        data: { signatureMediaAssetId: `${P}media-${look.key}` },
      })
    }
  }

  const proLookId = (key: string): string => {
    const id = proLookIdByKey.get(key)
    if (!id) throw new Error(`[seedDemoClientProfile] unknown pro look key "${key}"`)
    return id
  }

  // ── boards ─────────────────────────────────────────────────────────────────
  for (const board of BOARDS) {
    await prisma.board.create({
      data: {
        id: `${P}board-${board.key}`,
        clientId: creator.id,
        name: board.name,
        slug: board.key,
        visibility: board.shared ? BoardVisibility.SHARED : BoardVisibility.PRIVATE,
      },
    })

    for (const [index, key] of board.lookKeys.entries()) {
      await prisma.boardItem.create({
        data: {
          id: `${P}boarditem-${board.key}-${index}`,
          boardId: `${P}board-${board.key}`,
          lookPostId: lookId(key),
        },
      })
    }
  }

  // ── followers / following ──────────────────────────────────────────────────
  // Lightweight, user-less ClientProfiles (userId is nullable — the same shape a
  // pro-created unclaimed client has), so the follow counts are real rows rather
  // than a hand-written number on the profile.
  const fanCount = FOLLOWER_COUNT + FOLLOWING_COUNT
  const attributedBookings = LOOKS.reduce((sum, look) => sum + look.recreated, 0)
  const publicFans = new Set(publicFanIndices(attributedBookings))
  assertActivityFanRoles(publicFans)

  await prisma.clientProfile.createMany({
    data: Array.from({ length: fanCount }, (_, i) => ({
      id: `${P}fan-${String(i).padStart(4, '0')}`,
      homeTenantId: tenantId,
      firstName: 'Demo',
      lastName: `Fan ${i + 1}`,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      // "Your looks, remixed" names a booker only when their profile is public
      // ("@handle"), and says "Someone" otherwise — the activity-feed PII model.
      // With every fan private the card renders 43 identical "Someone" rows and
      // the handle branch is never exercised, so a visible minority are public.
      // A minority, not all: "Someone" is the common case in the real product
      // and the card has to look right when it dominates.
      ...(publicFans.has(i)
        ? {
            handle: `demo-fan-${i}`,
            handleNormalized: normalizeHandle(`demo-fan-${i}`),
            isPublicProfile: true,
          }
        : {}),
    })),
  })

  // A handle is not a per-table column, it is a claim on ONE global namespace
  // shared with pros — `HandleRegistration` is that namespace. Cleaned up by the
  // cascade from ClientProfile, so `clean()` needs no extra step.
  await prisma.handleRegistration.createMany({
    data: [...publicFans].map((i) => ({
      handleNormalized: normalizeHandle(`demo-fan-${i}`),
      clientProfileId: `${P}fan-${String(i).padStart(4, '0')}`,
    })),
  })

  await prisma.clientFollow.createMany({
    data: Array.from({ length: FOLLOWER_COUNT }, (_, i) => ({
      id: `${P}follow-in-${String(i).padStart(4, '0')}`,
      followerClientId: `${P}fan-${String(i).padStart(4, '0')}`,
      followedClientId: creator.id,
    })),
  })

  await prisma.clientFollow.createMany({
    data: Array.from({ length: FOLLOWING_COUNT }, (_, i) => ({
      id: `${P}follow-out-${String(i).padStart(4, '0')}`,
      followerClientId: creator.id,
      followedClientId: `${P}fan-${String(FOLLOWER_COUNT + i).padStart(4, '0')}`,
    })),
  })

  // 🔴 One follow-back at a PUBLIC fan. The 18 rows above all point at fans
  // 312–329, and `publicFanIndices` only makes fans 0–44 public — so no fan was
  // both nameable AND followed back, and `buildFollowItem`'s
  // `alreadyFollowing: true` branch (the one that renders "View" instead of a
  // Follow button) could not be reached by any fixture row.
  await prisma.clientFollow.create({
    data: {
      id: `${P}follow-out-public`,
      followerClientId: creator.id,
      followedClientId: `${P}fan-${String(ACTIVITY_MUTUAL_FAN).padStart(4, '0')}`,
    },
  })

  // ── pros she follows ───────────────────────────────────────────────────────
  // Me › FOLLOWING reads `ProFollow` (client → PRO), which is a different edge
  // from the client↔client `ClientFollow` above and from `ProfessionalFavorite`
  // (screen 5's "favourite pros"). Nothing in the fixture wrote one, and there
  // were ZERO ProFollow rows in the whole dev database — so the FOLLOWING tab
  // rendered "No follows yet" on both platforms and had never been looked at.
  await prisma.proFollow.createMany({
    data: PROS.map((pro) => ({
      id: `${P}profollow-${pro.key}`,
      clientId: creator.id,
      professionalId: proId(pro.key),
    })),
  })

  // ── activity feed ──────────────────────────────────────────────────────────
  // `/client/activity` reads ClientNotification rows filtered to
  // ACTIVITY_FEED_EVENT_KEYS. The dev DB held ZERO of them for any demo client,
  // so the entire screen rendered its empty state on web AND iOS.
  //
  // One row per builder branch in `lib/notifications/activityFeed.ts`, so every
  // shape the feed can render is on screen at once: named vs anonymous actors,
  // single vs batched engagement, follow-back offered vs already-following, and
  // read vs unread.
  //
  // Timestamps hang off the REAL clock, not the frozen NOW: the rows render as
  // relative times ("2h ago"), and anchoring them to a fixture date three days
  // in the past would make every row say "3d ago" and never exercise the
  // hours/minutes wording.
  const activityNow = Date.now()
  const HOUR_MS = 60 * 60 * 1000
  const ago = (ms: number): Date => new Date(activityNow - ms)
  const lookHref = (key: string): string =>
    `/looks/${encodeURIComponent(lookId(key))}`
  const fanId = (i: number): string => `${P}fan-${String(i).padStart(4, '0')}`

  await prisma.clientNotification.createMany({
    data: [
      // Batched saves → "12 saves" / "on your look" (no actor is nameable).
      {
        id: `${P}activity-saves-batch`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_SAVED,
        title: 'Your look was saved 12 times',
        href: lookHref('lived-in-blonde'),
        dedupeKey: `${P}activity-saves-batch`,
        data: { lookPostId: lookId('lived-in-blonde'), count: 12 },
        createdAt: ago(2 * HOUR_MS),
        readAt: null,
      },
      // A public follower she does NOT follow back → named + Follow button.
      {
        id: `${P}activity-follow-open`,
        clientId: creator.id,
        eventKey: NotificationEventKey.CLIENT_FOLLOW,
        title: 'Someone started following you',
        href: '/client/activity',
        dedupeKey: `${P}activity-follow-open`,
        data: { followerClientId: fanId(ACTIVITY_OPEN_FOLLOW_FAN) },
        createdAt: ago(5 * HOUR_MS),
        readAt: null,
      },
      // A comment carries its (public) snippet as the body.
      {
        id: `${P}activity-comment`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_COMMENTED,
        title: 'Someone commented on your look',
        body: 'what toner did she use on this? it’s perfect',
        href: lookHref('cherry-cola-balayage'),
        dedupeKey: `${P}activity-comment`,
        data: { actorClientId: fanId(ACTIVITY_COMMENT_FAN) },
        createdAt: ago(9 * HOUR_MS),
        readAt: null,
      },
      // Single like by a nameable actor → "@handle liked your look".
      {
        id: `${P}activity-like-single`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_LIKED,
        title: 'Someone liked your look',
        href: lookHref('money-piece-blonde'),
        dedupeKey: `${P}activity-like-single`,
        data: {
          lookPostId: lookId('money-piece-blonde'),
          count: 1,
          actorClientId: fanId(ACTIVITY_LIKE_FAN),
        },
        createdAt: ago(26 * HOUR_MS),
        readAt: ago(20 * HOUR_MS),
      },
      // Batched likes count PEOPLE (saves count saves) — different plural copy.
      {
        id: `${P}activity-like-batch`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_LIKED,
        title: '9 people liked your look',
        href: lookHref('glazed-almond-set'),
        dedupeKey: `${P}activity-like-batch`,
        data: { lookPostId: lookId('glazed-almond-set'), count: 9 },
        createdAt: ago(30 * HOUR_MS),
        readAt: ago(20 * HOUR_MS),
      },
      // A PRIVATE follower: no name, no link, no follow-back — the PII branch.
      {
        id: `${P}activity-follow-private`,
        clientId: creator.id,
        eventKey: NotificationEventKey.CLIENT_FOLLOW,
        title: 'Someone started following you',
        href: '/client/activity',
        dedupeKey: `${P}activity-follow-private`,
        data: { followerClientId: fanId(ACTIVITY_PRIVATE_FOLLOW_FAN) },
        createdAt: ago(2 * 24 * HOUR_MS),
        readAt: ago(24 * HOUR_MS),
      },
      // A public follower she ALREADY follows back → "View", not "Follow".
      {
        id: `${P}activity-follow-mutual`,
        clientId: creator.id,
        eventKey: NotificationEventKey.CLIENT_FOLLOW,
        title: 'Someone started following you',
        href: '/client/activity',
        dedupeKey: `${P}activity-follow-mutual`,
        data: { followerClientId: fanId(ACTIVITY_MUTUAL_FAN) },
        createdAt: ago(3 * 24 * HOUR_MS),
        readAt: ago(24 * HOUR_MS),
      },
      {
        id: `${P}activity-comment-reply`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_COMMENT_REPLIED,
        title: 'Someone replied to your comment',
        body: 'same! booked her for next month',
        href: lookHref('lash-lift-tint'),
        dedupeKey: `${P}activity-comment-reply`,
        data: { actorClientId: fanId(ACTIVITY_REPLY_FAN) },
        createdAt: ago(4 * 24 * HOUR_MS),
        readAt: ago(3 * 24 * HOUR_MS),
      },
      {
        id: `${P}activity-new-look`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
        title: 'A pro you follow posted a new look',
        body: 'Copper on a natural level 5 — no lift, all gloss.',
        href: lookHref('brow-lamination'),
        dedupeKey: `${P}activity-new-look`,
        data: {},
        createdAt: ago(5 * 24 * HOUR_MS),
        readAt: ago(4 * 24 * HOUR_MS),
      },
      {
        id: `${P}activity-milestone`,
        clientId: creator.id,
        eventKey: NotificationEventKey.LOOK_MILESTONE_REACHED,
        title: 'Your look hit 50 saves',
        href: lookHref('lived-in-blonde'),
        dedupeKey: `${P}activity-milestone`,
        data: { metric: 'saves', threshold: 50 },
        createdAt: ago(6 * 24 * HOUR_MS),
        readAt: ago(5 * 24 * HOUR_MS),
      },
    ],
  })

  // ── background creator field ───────────────────────────────────────────────
  // Reuses the demo fans as authors (they are already ClientProfiles) and points
  // every look at one of the existing demo images — nobody views these grids;
  // they exist to give the percentile a population. Save counts stay well under
  // Maya's per-look numbers so her rank is earned rather than arranged.
  const bgMedia: Prisma.MediaAssetCreateManyInput[] = []
  const bgLooks: Prisma.LookPostCreateManyInput[] = []
  for (let c = 0; c < BACKGROUND_CREATOR_COUNT; c += 1) {
    const authorId = `${P}fan-${String(c).padStart(4, '0')}`
    for (let n = 0; n < BACKGROUND_LOOKS_EACH; n += 1) {
      const key = `bg-${c}-${n}`
      const look = LOOKS[(c + n) % LOOKS.length]!
      bgMedia.push({
        id: `${P}media-${key}`,
        professionalId: proId(look.proKey),
        proTenantId: tenantId,
        primaryServiceId: serviceId(look.serviceKey),
        // MediaAsset is @@unique([storageBucket, storagePath]), so the sentinel
        // path is keyed per row even though several rows deliberately RENDER the
        // same file (these grids are never viewed — only counted).
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/${key}.jpg`,
        url: `http://localhost:3000/seed-demo/${look.key}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
      })
      bgLooks.push({
        id: `${P}look-${key}`,
        professionalId: proId(look.proKey),
        clientAuthorId: authorId,
        primaryMediaAssetId: `${P}media-${key}`,
        serviceId: serviceId(look.serviceKey),
        caption: `${look.title} ${c + 1}`,
        priceStartingAt: money(look.priceStartingAt),
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        publicToFeed: true,
        publishedAt: new Date(NOW.getTime() - (c * 10 + n) * 60 * 60 * 1000),
        // A spread from 1 to ~30 per look: every background creator lands below
        // Maya's 303 total, and they are spread out rather than tied, so the
        // tie-splitting branch of the percentile isn't the only path exercised.
        saveCount: 1 + ((c * 7 + n * 3) % 30),
      })
    }
  }
  await prisma.mediaAsset.createMany({ data: bgMedia })
  await prisma.lookPost.createMany({ data: bgLooks })

  // ── attributed bookings ("N recreated this") ───────────────────────────────
  // Real Booking rows citing the look as their source, so the count on the card
  // is derived from the same data the pro's creator analytics reads — not a
  // number typed into a fixture.
  //
  // Both grids are attributed the same way: the CLIENT creator's looks (`LOOKS`)
  // and the PROS' own portfolio posts (`PRO_LOOKS`, screen 6). They share one
  // `bookingSeq` because Booking is @@unique([professionalId, scheduledFor]) —
  // two independent counters would collide the moment two looks share a pro.
  let bookingSeq = 0
  const bookingRows: Prisma.BookingCreateManyInput[] = []

  const pushAttributedBookings = (args: {
    proKey: string
    serviceKey: string
    priceStartingAt: number
    recreated: number
    sourceLookPostId: string
  }): void => {
    const svc = SERVICES.find((s) => s.key === args.serviceKey)
    if (!svc) throw new Error(`[seedDemoClientProfile] unknown service key "${args.serviceKey}"`)

    for (let i = 0; i < args.recreated; i += 1) {
      // 🔴 Booking is not merely @@unique([professionalId, scheduledFor]) — it
      // also carries the `Booking_no_active_professional_overlap` EXCLUSION
      // constraint, so two of a pro's bookings may not overlap as RANGES
      // (duration + buffer included). One a day is not enough on its own: these
      // ran at NOW's 12:00, and the creator's own fixed appointment at 14:00
      // that day is a 180-minute service, so the two ranges collided the moment
      // the pro-look rows below pushed this sequence far enough back to reach
      // it. Pinned to an early morning hour no fixed fixture appointment uses.
      const scheduledFor = new Date(
        NOW.getTime() -
          (bookingSeq + 1) * 24 * 60 * 60 * 1000 -
          ATTRIBUTED_BOOKING_HOUR_OFFSET_MS,
      )

      bookingRows.push({
        id: `${P}booking-${String(bookingSeq).padStart(4, '0')}`,
        clientId: `${P}fan-${String(bookingSeq % fanCount).padStart(4, '0')}`,
        professionalId: proId(args.proKey),
        serviceId: serviceId(args.serviceKey),
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
        sourceLookPostId: args.sourceLookPostId,
        source: BookingSource.DISCOVERY,
        status: BookingStatus.COMPLETED,
        // "Your looks, remixed" times each row off `createdAt` — when the
        // booking was MADE, not when it was served. Left to default it is
        // `now()` for every row and every line reads "today", which is the one
        // thing a recency list must not do.
        createdAt: new Date(scheduledFor.getTime() - 3 * 24 * 60 * 60 * 1000),
        scheduledFor,
        locationType: ServiceLocationType.SALON,
        locationId: locationId(args.proKey),
        locationTimeZone: TIME_ZONE,
        subtotalSnapshot: money(args.priceStartingAt),
        totalDurationMinutes: svc.durationMinutes,
      })
      bookingSeq += 1
    }
  }

  for (const look of PRO_LOOKS) {
    pushAttributedBookings({
      proKey: look.proKey,
      serviceKey: look.serviceKey,
      priceStartingAt: look.priceStartingAt,
      recreated: look.recreated,
      sourceLookPostId: proLookId(look.key),
    })
  }

  for (const look of LOOKS) {
    pushAttributedBookings({
      proKey: look.proKey,
      serviceKey: look.serviceKey,
      priceStartingAt: look.priceStartingAt,
      recreated: look.recreated,
      sourceLookPostId: lookId(look.key),
    })
  }
  await prisma.booking.createMany({ data: bookingRows })

  // ── the creator's OWN appointments (screen 4) ──────────────────────────────
  // One upcoming (the prep screen) and one completed with a published care plan
  // (the aftercare screen). See OWN_APPOINTMENTS for why the upcoming one is
  // timed off the real clock rather than the frozen NOW.
  const ownProKey = OWN_APPOINTMENTS.proKey
  const ownServiceId = serviceId(OWN_APPOINTMENTS.serviceKey)
  const realNow = new Date()
  const today = getZonedParts(realNow, TIME_ZONE)

  const atLocalHour = (daysFromToday: number, hour: number): Date => {
    const { year, month, day } = addDaysToYMD(
      today.year,
      today.month,
      today.day,
      daysFromToday,
    )
    return zonedTimeToUtc({ year, month, day, hour, minute: 0, timeZone: TIME_ZONE })
  }

  const upcomingAt = atLocalHour(
    OWN_APPOINTMENTS.upcomingInDays,
    OWN_APPOINTMENTS.upcomingHour,
  )
  const pastAt = atLocalHour(-OWN_APPOINTMENTS.pastDaysAgo, OWN_APPOINTMENTS.pastHour)

  const ownBookingBase = {
    clientId: creator.id,
    professionalId: proId(ownProKey),
    serviceId: ownServiceId,
    proTenantId: tenantId,
    clientHomeTenantId: tenantId,
    source: BookingSource.DISCOVERY,
    // A booking made through the real flow carries the offering it was booked
    // from, and the prep resolver needs it: without this the appointment falls
    // back to the pro's DEFAULT checklist instead of the balayage's own rows,
    // which is correct behaviour against a wrong fixture.
    offeringId: `${P}offering-${OWN_APPOINTMENTS.proKey}-${OWN_APPOINTMENTS.serviceKey}`,
    locationType: ServiceLocationType.SALON,
    locationId: locationId(ownProKey),
    locationTimeZone: TIME_ZONE,
    // What the finalize path captures, and what the client DTO's
    // `locationAddress`/`locationLat`/`locationLng` read: the place as it was
    // when the appointment was booked, not as the pro's location reads today.
    // Without them the maps link falls back to searching the address TEXT, so a
    // fixture that omits them never exercises the coordinate branch.
    locationAddressSnapshot: { formattedAddress: BROOKLYN.formattedAddress },
    locationLatSnapshot: BROOKLYN.lat,
    locationLngSnapshot: BROOKLYN.lng,
    subtotalSnapshot: money(OWN_APPOINTMENTS.priceStartingAt),
    totalDurationMinutes: OWN_APPOINTMENTS.durationMinutes,
  }

  await prisma.booking.create({
    data: {
      ...ownBookingBase,
      id: `${P}booking-own-upcoming`,
      status: BookingStatus.ACCEPTED,
      sourceLookPostId: lookId('lived-in-blonde'),
      // Booked a couple of weeks ahead, like a colour appointment really is.
      createdAt: new Date(upcomingAt.getTime() - 17 * 24 * 60 * 60 * 1000),
      scheduledFor: upcomingAt,
    },
  })

  // ── "Before you go" ────────────────────────────────────────────────────────
  //
  // Deliberately seeds BOTH scopes so the override rule is exercised rather
  // than merely present: the pro's default list AND a longer one on the
  // balayage offering. A screen reading the wrong scope renders visibly
  // different text, instead of looking identical to a correct one.
  const ownOfferingId = `${P}offering-${ownProKey}-${OWN_APPOINTMENTS.serviceKey}`

  await prisma.proPrepItem.createMany({
    data: [
      // The pro's default list — what any of her OTHER services would show.
      {
        id: `${P}prep-default-1`,
        professionalId: proId(ownProKey),
        offeringId: null,
        text: 'Come with clean, product-free hair.',
        sortOrder: 0,
      },
      {
        id: `${P}prep-default-2`,
        professionalId: proId(ownProKey),
        offeringId: null,
        text: 'Text me if you are running more than 10 minutes late.',
        sortOrder: 1,
      },
      // The balayage's OWN list. Because this exists, the two rows above must
      // NOT appear on this booking.
      {
        id: `${P}prep-balayage-1`,
        professionalId: proId(ownProKey),
        offeringId: ownOfferingId,
        text: 'Arrive with clean, dry hair.',
        sortOrder: 0,
      },
      {
        id: `${P}prep-balayage-2`,
        professionalId: proId(ownProKey),
        offeringId: ownOfferingId,
        text: 'Skip washing for 24 hours before.',
        sortOrder: 1,
      },
      {
        id: `${P}prep-balayage-3`,
        professionalId: proId(ownProKey),
        offeringId: ownOfferingId,
        text: 'Bring your inspiration board.',
        sortOrder: 2,
      },
      {
        id: `${P}prep-balayage-4`,
        professionalId: proId(ownProKey),
        offeringId: ownOfferingId,
        text: "Wear a top you don't mind getting colour on.",
        sortOrder: 3,
      },
    ],
  })

  // One row already ticked, so the progress bar and the struck-through style are
  // both exercised on first load rather than only after a tap.
  await prisma.bookingPrepCheck.create({
    data: {
      id: `${P}prep-check-1`,
      bookingId: `${P}booking-own-upcoming`,
      prepItemId: `${P}prep-balayage-1`,
    },
  })

  // The note. Set on the OFFERING, with a different default on the pro, so a
  // surface reading the wrong one is visibly wrong.
  await prisma.professionalProfile.update({
    where: { id: proId(ownProKey) },
    data: { prepNote: 'Come as you are — I will talk you through everything.' },
  })
  await prisma.professionalServiceOffering.update({
    where: { id: ownOfferingId },
    data: {
      prepNote:
        'Plan for about three hours in the chair. Bring headphones and something to drink — I will handle the rest.',
    },
  })

  // A MOBILE appointment, at MAYA's address rather than Noor's salon. The whole
  // point of resolving the booked place through `resolveBookingLocationMeta`:
  // with only a salon fixture, every client surface can print the pro's address
  // for a booking the pro travels to and still look correct.
  const clientHome = await prisma.clientAddress.create({
    data: {
      id: `${P}address-maya-home`,
      clientId: creator.id,
      kind: ClientAddressKind.SERVICE_ADDRESS,
      isDefault: true,
      formattedAddress: MAYA_HOME.formattedAddress,
      addressLine1: MAYA_HOME.addressLine1,
      city: MAYA_HOME.city,
      state: MAYA_HOME.state,
      postalCode: MAYA_HOME.postalCode,
      countryCode: MAYA_HOME.countryCode,
      lat: new Prisma.Decimal(MAYA_HOME.lat),
      lng: new Prisma.Decimal(MAYA_HOME.lng),
    },
    select: { id: true },
  })

  await prisma.booking.create({
    data: {
      ...ownBookingBase,
      id: `${P}booking-own-mobile`,
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.MOBILE,
      clientAddressId: clientHome.id,
      clientAddressSnapshot: { formattedAddress: MAYA_HOME.formattedAddress },
      clientAddressLatSnapshot: MAYA_HOME.lat,
      clientAddressLngSnapshot: MAYA_HOME.lng,
      createdAt: new Date(
        atLocalHour(OWN_APPOINTMENTS.mobileInDays, OWN_APPOINTMENTS.mobileHour).getTime() -
          9 * 24 * 60 * 60 * 1000,
      ),
      scheduledFor: atLocalHour(
        OWN_APPOINTMENTS.mobileInDays,
        OWN_APPOINTMENTS.mobileHour,
      ),
      subtotalSnapshot: money(OWN_APPOINTMENTS.mobilePriceStartingAt),
    },
  })

  const pastBooking = await prisma.booking.create({
    data: {
      ...ownBookingBase,
      id: `${P}booking-own-past`,
      status: BookingStatus.COMPLETED,
      sourceLookPostId: lookId('lived-in-blonde'),
      createdAt: new Date(pastAt.getTime() - 12 * 24 * 60 * 60 * 1000),
      scheduledFor: pastAt,
      startedAt: pastAt,
      finishedAt: new Date(
        pastAt.getTime() + OWN_APPOINTMENTS.durationMinutes * 60 * 1000,
      ),
    },
    select: { id: true },
  })

  // The before/after pair. `phase` is what `loadBookingBeforeAfterThumbs` reads;
  // PRO_CLIENT visibility is the aftercare world (a session photo is not a
  // portfolio post until the client consents to publish it), and the sentinel
  // bucket keeps the render on /public like every other image here. Distinct
  // storagePaths because MediaAsset is @@unique([storageBucket, storagePath]) —
  // the `url` they resolve to is a real file in public/seed-demo.
  const sessionPhotos: Array<{
    key: string
    phase: MediaPhase
    file: string
    minutesAfterStart: number
  }> = [
    { key: 'before', phase: MediaPhase.BEFORE, file: 'money-piece-blonde', minutesAfterStart: 5 },
    { key: 'after', phase: MediaPhase.AFTER, file: 'lived-in-blonde', minutesAfterStart: 175 },
  ]
  for (const photo of sessionPhotos) {
    await prisma.mediaAsset.create({
      data: {
        id: `${P}media-own-${photo.key}`,
        professionalId: proId(ownProKey),
        proTenantId: tenantId,
        primaryServiceId: ownServiceId,
        bookingId: pastBooking.id,
        phase: photo.phase,
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/own-${photo.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${photo.file}.jpg`,
        thumbUrl: `http://localhost:3000/seed-demo/${photo.file}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        createdAt: new Date(pastAt.getTime() + photo.minutesAfterStart * 60 * 1000),
      },
    })
  }

  // The care plan itself. `sentToClientAt` is the gate — a DRAFT summary is the
  // pro's, and `isClientAftercareVisible` is the only thing standing between the
  // client and an unfinished one.
  const finalizedAt = new Date(
    pastAt.getTime() + (OWN_APPOINTMENTS.durationMinutes + 20) * 60 * 1000,
  )
  const week = 7 * 24 * 60 * 60 * 1000
  await prisma.aftercareSummary.create({
    data: {
      id: `${P}aftercare-own-past`,
      bookingId: pastBooking.id,
      notes: CARE_PLAN.notes,
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookWindowStart: new Date(
        pastAt.getTime() + CARE_PLAN.rebookWindowStartWeeks * week,
      ),
      rebookWindowEnd: new Date(
        pastAt.getTime() + CARE_PLAN.rebookWindowEndWeeks * week,
      ),
      featuredBeforeAssetId: `${P}media-own-before`,
      featuredAfterAssetId: `${P}media-own-after`,
      draftSavedAt: finalizedAt,
      sentToClientAt: finalizedAt,
      lastEditedAt: finalizedAt,
      createdAt: finalizedAt,
      // Order-prefixed keys for the same reason as the products below: both
      // clients read these with a (sortOrder, createdAt) order, and a fixture
      // written in one statement shares a createdAt to the millisecond — so
      // sortOrder is the only thing keeping the pro's plan in the order she
      // wrote it.
      careSections: {
        create: CARE_PLAN.sections.map((section, index) => ({
          id: `${P}care-section-${section.key}`,
          label: section.label,
          body: section.body,
          sortOrder: index,
        })),
      },
      recommendedProducts: {
        create: CARE_PLAN.products.map((product) => ({
          id: `${P}product-rec-${product.key}`,
          externalName: product.name,
          externalUrl: product.url,
          note: product.note,
        })),
      },
    },
  })

  // ── reviews + cancellation policy (the booking sheet's trust row) ──────────
  // The sheet's three chips read `lib/booking/trustSignals`: an approved
  // verification, a COMPLETED-booking count, and the pro's own late-cancel
  // window. Without reviews the rating is honestly null and the star never
  // renders, so a handful are seeded on the pro the demo look books.
  //
  // Ratings are NOT all 5★ — an aggregate that can only ever round to 5.0 is a
  // fixture flattering the product, and it never exercises the one-decimal
  // formatting the frame shows ("4.9★").
  const REVIEW_RATINGS = [5, 5, 5, 4, 5, 5, 4, 5, 5, 5]
  await prisma.review.createMany({
    data: REVIEW_RATINGS.map((rating, i) => ({
      id: `${P}review-${String(i).padStart(3, '0')}`,
      clientId: `${P}fan-${String(i).padStart(4, '0')}`,
      professionalId: proId('noor'),
      rating,
      createdAt: new Date(NOW.getTime() - (i + 1) * 5 * 24 * 60 * 60 * 1000),
    })),
  })

  // ── home's other five sections (screen 5) ─────────────────────────────────
  //
  // Favourites, waitlist places, last-minute openings and Viral Looks. See the
  // consts above for why each one is shaped the way it is.

  await prisma.professionalFavorite.createMany({
    data: FAVORITE_PRO_KEYS.map((key, i) => ({
      id: `${P}fav-pro-${key}`,
      professionalId: proId(key),
      userId: `${P}user-client-maya`,
      // Descending createdAt is the read order, so stagger them: identical
      // timestamps leave the tile order undefined and the grid reshuffles
      // between renders.
      createdAt: new Date(realNow.getTime() - (i + 1) * 36 * 60 * 60 * 1000),
    })),
  })

  await prisma.serviceFavorite.createMany({
    data: FAVORITE_SERVICE_KEYS.map((key, i) => ({
      id: `${P}fav-service-${key}`,
      serviceId: serviceId(key),
      userId: `${P}user-client-maya`,
      createdAt: new Date(realNow.getTime() - (i + 1) * 30 * 60 * 60 * 1000),
    })),
  })

  // Waitlist: the fans ahead of Maya first (older `createdAt`), then hers.
  const waitlistRows: Prisma.WaitlistEntryCreateManyInput[] = []
  let waitlistFanSeq = 0
  for (const [entryIndex, entry] of WAITLIST.entries()) {
    // Staggered per entry: home reads `orderBy: { createdAt: 'desc' }`, so two
    // entries sharing an instant leave the strip's own row order undefined.
    const joinedAt = new Date(
      realNow.getTime() - (6 * 24 + entryIndex * 5) * 60 * 60 * 1000,
    )

    for (let i = 0; i < entry.aheadOfMaya; i += 1) {
      waitlistRows.push({
        id: `${P}waitlist-ahead-${String(waitlistFanSeq).padStart(3, '0')}`,
        clientId: `${P}fan-${String(waitlistFanSeq % fanCount).padStart(4, '0')}`,
        professionalId: proId(entry.proKey),
        serviceId: serviceId(entry.serviceKey),
        status: WaitlistStatus.ACTIVE,
        preferenceType: WaitlistPreferenceType.ANY_TIME,
        // Each one strictly earlier than Maya's, so the FIFO rank is total.
        createdAt: new Date(joinedAt.getTime() - (entry.aheadOfMaya - i) * 60 * 60 * 1000),
      })
      waitlistFanSeq += 1
    }

    waitlistRows.push({
      id: `${P}waitlist-${entry.key}`,
      clientId: creator.id,
      professionalId: proId(entry.proKey),
      serviceId: serviceId(entry.serviceKey),
      status: WaitlistStatus.ACTIVE,
      preferenceType: entry.preference,
      timeOfDay: entry.timeOfDay ?? null,
      createdAt: joinedAt,
    })
  }
  await prisma.waitlistEntry.createMany({ data: waitlistRows })

  // Last-minute openings. `dayOffset` counts OPEN days: Sunday is disabled in
  // workingHoursJson, so a plain +1 lands the fixture outside working hours one
  // day in seven and the strip silently empties.
  const openDayOffsetFromToday = (openDays: number): number => {
    let calendarDays = 0
    let found = 0
    while (found < openDays) {
      calendarDays += 1
      const { year, month, day } = addDaysToYMD(
        today.year,
        today.month,
        today.day,
        calendarDays,
      )
      const probe = zonedTimeToUtc({ year, month, day, hour: 12, minute: 0, timeZone: TIME_ZONE })
      if (weekdayInTimeZone(probe, TIME_ZONE) !== 0) found += 1
    }
    return calendarDays
  }

  for (const opening of OPENINGS) {
    const { year, month, day } = addDaysToYMD(
      today.year,
      today.month,
      today.day,
      openDayOffsetFromToday(opening.dayOffset),
    )
    const startAt = zonedTimeToUtc({
      year,
      month,
      day,
      hour: opening.hour,
      minute: opening.minute,
      timeZone: TIME_ZONE,
    })
    const svc = SERVICES.find((s) => s.key === opening.serviceKey)
    if (!svc) {
      throw new Error(`[seedDemoClientProfile] unknown service key "${opening.serviceKey}"`)
    }

    await prisma.lastMinuteOpening.create({
      data: {
        id: `${P}opening-${opening.key}`,
        professionalId: proId(opening.proKey),
        locationType: ServiceLocationType.SALON,
        locationId: locationId(opening.proKey),
        timeZone: TIME_ZONE,
        startAt,
        endAt: new Date(startAt.getTime() + svc.durationMinutes * 60 * 1000),
        status: OpeningStatus.ACTIVE,
        visibilityMode: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY,
        note: opening.note,
        services: {
          create: [
            {
              id: `${P}opening-service-${opening.key}`,
              serviceId: serviceId(opening.serviceKey),
              offeringId: `${P}offering-${opening.proKey}-${opening.serviceKey}`,
              sortOrder: 0,
            },
          ],
        },
        tierPlans: {
          create: [
            {
              id: `${P}opening-tier-${opening.key}`,
              tier: opening.tier,
              // Already dispatched — the recipient below was notified from it.
              scheduledFor: new Date(realNow.getTime() - 2 * 60 * 60 * 1000),
              processedAt: new Date(realNow.getTime() - 2 * 60 * 60 * 1000),
              offerType: opening.offerType,
              percentOff: opening.percentOff ?? null,
            },
          ],
        },
        recipients: {
          create: [
            {
              id: `${P}opening-recipient-${opening.key}`,
              clientId: creator.id,
              firstMatchedTier: opening.tier,
              notifiedTier: opening.tier,
              // The home strip only reads ENQUEUED / OPENED / CLICKED, and only
              // when `notifiedAt` is set — a PLANNED row is one the fan-out has
              // not sent yet and must not appear.
              status: LastMinuteRecipientStatus.ENQUEUED,
              notifiedAt: new Date(realNow.getTime() - 2 * 60 * 60 * 1000),
            },
          ],
        },
      },
    })
  }

  // Viral Looks — one live (anyone's) and one of Maya's still in review.
  for (const [index, look] of VIRAL.live.entries()) {
    // Staggered `approvedAt`: the list is `orderBy: { approvedAt: 'desc' }`, and
    // a shared instant leaves the strip order undefined between renders.
    const approvedAt = new Date(realNow.getTime() - (3 + index) * 24 * 60 * 60 * 1000)
    await prisma.viralServiceRequest.create({
      data: {
        id: `${P}viral-${look.key}`,
        clientId: `${P}fan-0000`,
        name: look.name,
        sourceUrl: look.sourceUrl,
        coverImageUrl: look.coverImage,
        status: ViralServiceRequestStatus.APPROVED,
        moderationStatus: ModerationStatus.APPROVED,
        approvedAt,
        createdAt: new Date(approvedAt.getTime() - 6 * 24 * 60 * 60 * 1000),
        approvalFanOuts: {
          create: look.proKeys.map((key) => ({
            id: `${P}viral-fanout-${look.key}-${key}`,
            professionalId: proId(key),
            status: ViralRequestApprovalFanOutStatus.NOTIFICATION_ENQUEUED,
            sentAt: approvedAt,
          })),
        },
      },
    })
  }

  await prisma.viralServiceRequest.create({
    data: {
      id: `${P}viral-${VIRAL.pending.key}`,
      clientId: creator.id,
      name: VIRAL.pending.name,
      sourceUrl: VIRAL.pending.sourceUrl,
      mediaUrlsJson: [...VIRAL.pending.submitterMedia],
      // IN_REVIEW, not REQUESTED: the pipeline's current node is derived from
      // the status, and REQUESTED sits on the first step, so a REQUESTED-only
      // fixture never renders a part-completed pipeline at all.
      status: ViralServiceRequestStatus.IN_REVIEW,
      moderationStatus: ModerationStatus.APPROVED,
      createdAt: new Date(realNow.getTime() - 2 * 24 * 60 * 60 * 1000),
      approvalFanOuts: {
        create: VIRAL.pending.proKeys.map((key) => ({
          id: `${P}viral-fanout-pending-${key}`,
          professionalId: proId(key),
          status: ViralRequestApprovalFanOutStatus.NOTIFICATION_ENQUEUED,
          sentAt: new Date(realNow.getTime() - 1 * 24 * 60 * 60 * 1000),
        })),
      },
    },
  })

  // ── the pro's accepted payment methods + tip config ───────────────────────
  //
  // 🔴 Without this row the fixture could not demo the client checkout at all.
  // `buildClientPaymentOptions(null)` falls back to CASH ONLY, so the method
  // picker rendered a single row on both platforms and looked like a product
  // that offers no choice — when in fact WHICH methods appear, and which tip
  // percentages, are entirely the pro's settings
  // (/pro/profile/public-profile → Payments).
  //
  // Deliberately more than one method, and two of them carrying HANDLES, so the
  // off-platform deep-link/copy affordance is exercised rather than merely
  // present. The tip percentages are NOT the 15/20/25 fallback either — a
  // fixture that matches the default can't tell "the pro configured this" from
  // "nobody configured anything".
  await prisma.professionalPaymentSettings.create({
    data: {
      id: `${P}payment-settings-noor`,
      professionalId: proId(ownProKey),
      collectPaymentAt: PaymentCollectionTiming.AFTER_SERVICE,
      acceptCash: true,
      acceptVenmo: true,
      venmoHandle: '@noor-haddad',
      acceptZelle: true,
      zelleHandle: 'noor@studiolumen.example',
      tipsEnabled: true,
      allowCustomTip: true,
      tipSuggestions: [{ label: '18%', percent: 18 }, { label: '22%', percent: 22 }, { label: '25%', percent: 25 }],
      paymentNote: 'Cash or Venmo is easiest for me — Zelle works too.',
    },
  })

  // Charging a late-cancel fee is what GIVES the pro a free-cancellation window
  // to advertise; with fees off the chip honestly reads "Free cancellation".
  await prisma.proNoShowSettings.create({
    data: {
      id: `${P}noshow-noor`,
      professionalId: proId('noor'),
      enabled: true,
      feeFlatAmount: money(25),
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    },
  })

  // ── the pro Portfolio library's states (/pro/portfolio) ────────────────────
  // See PORTFOLIO_HELD above for why each of these exists. Everything here is
  // ADDITIVE — no existing public asset is demoted, because screens 1–6 render
  // from those.
  const libraryProId = proId('noor')
  const libraryServiceId = serviceId('balayage')
  const libraryLocationId = locationId('noor')

  // 🔴 300+ days back, one day apart. `Booking` carries an exclusion constraint
  // on overlapping (pro, time-range) pairs, and the attributed bookings above
  // already occupy the last ~75 days at 06:00 — so a fixture appended anywhere
  // near NOW collides and the whole seed aborts.
  const libraryBookingAt = (index: number): Date =>
    new Date(NOW.getTime() - (300 + index) * DAY_MS)

  const libraryClients = [
    ...PORTFOLIO_HELD.map((row) => ({
      key: row.key,
      firstName: row.clientFirstName,
      contactable: row.contactable,
    })),
    ...PORTFOLIO_RELEASED.map((row) => ({
      key: row.key,
      firstName: row.clientFirstName,
      contactable: true,
    })),
  ]

  await prisma.clientProfile.createMany({
    data: libraryClients.map((client) => ({
      id: `${P}libclient-${client.key}`,
      homeTenantId: tenantId,
      firstName: client.firstName,
      lastName: 'Demo',
      // Unclaimed, like the pro-created clients a real book is full of — the
      // tile only ever needs their first name.
      claimStatus: ClientClaimStatus.UNCLAIMED,
      // Plaintext is still the source of truth for these columns during the
      // encryption burn-in, so the fixture sets them directly like the demo
      // client above. Contactless clients get NOTHING, which is the point.
      ...(client.contactable ? { email: `demo-${client.key}@tovis.app` } : {}),
    })),
  })

  await prisma.booking.createMany({
    data: libraryClients.map((client, index) => {
      const scheduledFor = libraryBookingAt(index)

      return {
        id: `${P}libbooking-${client.key}`,
        clientId: `${P}libclient-${client.key}`,
        professionalId: libraryProId,
        serviceId: libraryServiceId,
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
        source: BookingSource.REQUESTED,
        status: BookingStatus.COMPLETED,
        createdAt: new Date(scheduledFor.getTime() - 3 * DAY_MS),
        scheduledFor,
        locationType: ServiceLocationType.SALON,
        locationId: libraryLocationId,
        locationTimeZone: TIME_ZONE,
        subtotalSnapshot: money(250),
        totalDurationMinutes: 180,
        // 🔴 The consent tick itself, and the ONLY difference between the held
        // rows and the released ones. Null here is what makes the tile dim,
        // name the client and refuse to publish.
        mediaUseConsentAt: PORTFOLIO_HELD.some((held) => held.key === client.key)
          ? null
          : new Date(scheduledFor.getTime() + 2 * DAY_MS),
      }
    }),
  })

  // The aftercare each nudge would re-issue. Only for the rows that carry one:
  // `nudgeAftercareRebook` throws AFTERCARE_NOT_COMPLETED without a
  // `sentToClientAt`, so seeding one for every booking would make the sheet's
  // other branch unreachable AND hide a button that 500s.
  await prisma.aftercareSummary.createMany({
    data: libraryClients
      // 🔴 The booking index comes from the ORIGINAL position, not the filtered
      // one — `.filter().map((_, i) => …)` would re-number the survivors and
      // stamp an aftercare hours BEFORE the appointment it belongs to.
      .map((client, index) => ({ client, index }))
      .filter(
        ({ client }) =>
          !PORTFOLIO_HELD.some((held) => held.key === client.key && !held.aftercareSent),
      )
      .map(({ client, index }) => {
        const sentAt = new Date(libraryBookingAt(index).getTime() + 4 * 60 * 60 * 1000)

        return {
          id: `${P}libaftercare-${client.key}`,
          bookingId: `${P}libbooking-${client.key}`,
          notes: 'Sulphate-free shampoo, and book the gloss at six weeks.',
          rebookMode: AftercareRebookMode.NONE,
          draftSavedAt: sentAt,
          sentToClientAt: sentAt,
          lastEditedAt: sentAt,
          createdAt: sentAt,
        }
      }),
  })

  await prisma.mediaAsset.createMany({
    data: [
      ...PORTFOLIO_HELD.map((row, index) => ({
        id: `${P}media-held-${row.key}`,
        professionalId: libraryProId,
        proTenantId: tenantId,
        primaryServiceId: libraryServiceId,
        bookingId: `${P}libbooking-${row.key}`,
        phase: row.phase,
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/held-${row.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${row.image}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        // 🔴 The PRO shot it at the chair. A CLIENT-uploaded photo is already
        // theirs to publish (the upload is the consent), so seeding these as
        // CLIENT would silently release every one of them.
        uploadedByRole: Role.PRO,
        createdAt: new Date(libraryBookingAt(index).getTime() + 3 * 60 * 60 * 1000),
      })),
      ...PORTFOLIO_RELEASED.map((row, index) => ({
        id: `${P}media-released-${row.key}`,
        professionalId: libraryProId,
        proTenantId: tenantId,
        primaryServiceId: libraryServiceId,
        bookingId: `${P}libbooking-${row.key}`,
        phase: MediaPhase.AFTER,
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/released-${row.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${row.image}.jpg`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        uploadedByRole: Role.PRO,
        createdAt: new Date(
          libraryBookingAt(PORTFOLIO_HELD.length + index).getTime() + 3 * 60 * 60 * 1000,
        ),
      })),
      ...PORTFOLIO_UPLOADS.map((row, index) => ({
        id: `${P}media-upload-${row.key}`,
        professionalId: libraryProId,
        proTenantId: tenantId,
        primaryServiceId: libraryServiceId,
        storageBucket: DEMO_LOCAL_BUCKET,
        storagePath: `seed-demo/upload-${row.key}.jpg`,
        url: `http://localhost:3000/seed-demo/${row.image}.jpg`,
        mediaType: row.video ? MediaType.VIDEO : MediaType.IMAGE,
        // Not public and not featured: the pro shot it and has not decided yet.
        visibility: MediaVisibility.PRO_CLIENT,
        isEligibleForLooks: false,
        isFeaturedInPortfolio: false,
        caption: row.caption || null,
        uploadedByRole: Role.PRO,
        createdAt: new Date(NOW.getTime() - (index + 1) * 60 * 60 * 1000),
      })),
    ],
  })

  // The desktop side rail's Cover slot. Signature is already set on
  // `pro-root-melt`; pointing Cover at a DIFFERENT asset is what renders the
  // two single marks as distinct chips rather than collapsing to one.
  await prisma.professionalProfile.update({
    where: { id: libraryProId },
    data: { coverMediaAssetId: `${P}media-pro-copper-gloss` },
  })

  // The two extra pros: one at launch (photos, none public → the lead card) and
  // one with nothing at all (the blank state). Minimal but VALID pros — no
  // offerings or availability, because neither screen reads them.
  for (const [index, extra] of [PORTFOLIO_LAUNCH_PRO, PORTFOLIO_BLANK_PRO].entries()) {
    await prisma.user.create({
      data: {
        id: `${P}user-pro-${extra.key}`,
        email: `${extra.key}@demo.tovis.local`,
        password: 'demo-seed-no-login',
        role: Role.PRO,
        emailVerifiedAt: NOW,
        phoneVerifiedAt: NOW,
        createdAt: new Date(NOW.getTime() - (40 + index) * DAY_MS),
      },
    })

    await prisma.professionalProfile.create({
      data: {
        id: `${P}pro-${extra.key}`,
        userId: `${P}user-pro-${extra.key}`,
        homeTenantId: tenantId,
        firstName: extra.firstName,
        lastName: extra.lastName,
        businessName: extra.businessName,
        handle: `demo-${extra.key}`,
        handleNormalized: `demo-${extra.key}`,
        location: 'Brooklyn, NY',
        timeZone: TIME_ZONE,
        professionType: ProfessionType.COSMETOLOGIST,
        nameDisplay: ProNameDisplay.REAL_NAME,
        licenseState: 'NY',
        licenseVerified: true,
        // APPROVED so the side rail's "View public profile" link renders — that
        // href is gated on `isPubliclyApprovedProStatus`, and an unapproved
        // fixture would leave the rail's own CTA permanently unlooked-at.
        verificationStatus: VerificationStatus.APPROVED,
      },
    })

    await prisma.professionalLocation.create({
      data: {
        id: `${P}location-${extra.key}`,
        professionalId: `${P}pro-${extra.key}`,
        type: ProfessionalLocationType.SALON,
        name: extra.businessName,
        isPrimary: true,
        isBookable: true,
        isAddressPublic: true,
        ...brooklynAddress(),
        timeZone: TIME_ZONE,
        workingHours: workingHoursJson(),
      },
    })

    // 🔴 Load-bearing, not decoration. `app/pro/layout` runs
    // `checkProReadiness` on EVERY pro route and redirects a pro with no active
    // offering to onboarding — so without this the two fixture pros never reach
    // /pro/portfolio at all, and a screenshot of them is a screenshot of
    // "My services". Which is exactly what the first pass captured.
    await prisma.professionalServiceOffering.create({
      data: {
        id: `${P}offering-${extra.key}-balayage`,
        professionalId: `${P}pro-${extra.key}`,
        serviceId: libraryServiceId,
        salonPriceStartingAt: money(200),
        salonDurationMinutes: 180,
        offersInSalon: true,
        offersMobile: false,
        isActive: true,
      },
    })
  }

  await prisma.mediaAsset.createMany({
    data: PORTFOLIO_LAUNCH_PRO.uploads.map((image, index) => ({
      id: `${P}media-launch-${index}`,
      professionalId: `${P}pro-${PORTFOLIO_LAUNCH_PRO.key}`,
      proTenantId: tenantId,
      primaryServiceId: libraryServiceId,
      storageBucket: DEMO_LOCAL_BUCKET,
      storagePath: `seed-demo/launch-${index}.jpg`,
      url: `http://localhost:3000/seed-demo/${image}.jpg`,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
      uploadedByRole: Role.PRO,
      createdAt: new Date(NOW.getTime() - (index + 1) * 60 * 60 * 1000),
    })),
  })

  // Score the creator tier from the rows just written, using the SAME job the
  // hourly cron runs. Seeding a tier directly would let the fixture disagree
  // with what production would actually compute from this data.
  const stats = await refreshClientCreatorStats(prisma, NOW)

  console.log(
    `[seedDemoClientProfile] seeded @${CREATOR.handle}: ` +
      `${LOOKS.length} looks, ${BOARDS.length} boards ` +
      `(${BOARDS.filter((b) => b.shared).length} shared), ${ADD_ONS.length} add-ons, ` +
      `${FOLLOWER_COUNT} followers, ${bookingRows.length} attributed bookings, ` +
      `${FAVORITE_PRO_KEYS.length} favourite pros, ` +
      `${FAVORITE_SERVICE_KEYS.length} favourited services, ` +
      `${WAITLIST.length} waitlist places, ${OPENINGS.length} last-minute openings, ` +
      `${VIRAL.live.length + 1} viral looks; ` +
      `creator tiers: ${stats.ranked} ranked of ${stats.scored} scored.`,
  )
  console.log('  → http://localhost:3000/u/' + CREATOR.handle)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
