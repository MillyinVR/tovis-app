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
  BookingSource,
  BookingStatus,
  BoardVisibility,
  ClientClaimStatus,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  Prisma,
  PrismaClient,
  ProNameDisplay,
  ProfessionalLocationType,
  ProfessionType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import { refreshClientCreatorStats } from '@/lib/clients/creatorTier'
import { normalizeHandle } from '@/lib/handles'

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
}

const PROS: DemoPro[] = [
  {
    key: 'noor',
    businessName: 'Noor Haddad Studio',
    firstName: 'Noor',
    lastName: 'Haddad',
    profession: ProfessionType.COSMETOLOGIST,
  },
  {
    key: 'sasha',
    businessName: 'Sasha Lim Nails',
    firstName: 'Sasha',
    lastName: 'Lim',
    profession: ProfessionType.MANICURIST,
  },
  {
    key: 'mara',
    businessName: 'Mara Vance Beauty',
    firstName: 'Mara',
    lastName: 'Vance',
    profession: ProfessionType.ESTHETICIAN,
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
  await prisma.booking.deleteMany({ where: { professionalId: idPrefix } })
  await prisma.proNoShowSettings.deleteMany({ where: { id: idPrefix } })
  await prisma.boardItem.deleteMany({ where: { id: idPrefix } })
  await prisma.board.deleteMany({ where: { id: idPrefix } })
  await prisma.clientFollow.deleteMany({ where: { id: idPrefix } })
  await prisma.lookPost.deleteMany({ where: { id: idPrefix } })
  // The look's primary MediaAsset is @unique + cascades TO the look, so the
  // looks above are already gone; drop the assets themselves now.
  await prisma.mediaAsset.deleteMany({ where: { id: idPrefix } })
  // Before the offerings they hang off (they would cascade, but the links also
  // hold a RESTRICT reference to their add-on Service, which is deleted below —
  // so they have to be gone before that runs either way).
  await prisma.offeringAddOn.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalServiceOffering.deleteMany({ where: { id: idPrefix } })
  await prisma.professionalLocation.deleteMany({ where: { id: idPrefix } })
  await prisma.handleRegistration.deleteMany({
    where: { handleNormalized: { in: [normalizeHandle(CREATOR.handle)] } },
  })
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
        isAddressPublic: true,
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
  let bookingSeq = 0
  const bookingRows: Prisma.BookingCreateManyInput[] = []
  for (const look of LOOKS) {
    const svc = SERVICES.find((s) => s.key === look.serviceKey)
    if (!svc) throw new Error(`[seedDemoClientProfile] unknown service key "${look.serviceKey}"`)

    for (let i = 0; i < look.recreated; i += 1) {
      // Booking is @@unique([professionalId, scheduledFor]) — a pro can't be in
      // two places at once. Spacing off the GLOBAL sequence (not the per-look
      // index) keeps every instant distinct across looks that share a pro.
      const scheduledFor = new Date(
        NOW.getTime() - (bookingSeq + 1) * 24 * 60 * 60 * 1000,
      )

      bookingRows.push({
        id: `${P}booking-${String(bookingSeq).padStart(4, '0')}`,
        clientId: `${P}fan-${String(bookingSeq % fanCount).padStart(4, '0')}`,
        professionalId: proId(look.proKey),
        serviceId: serviceId(look.serviceKey),
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
        sourceLookPostId: lookId(look.key),
        source: BookingSource.DISCOVERY,
        status: BookingStatus.COMPLETED,
        // "Your looks, remixed" times each row off `createdAt` — when the
        // booking was MADE, not when it was served. Left to default it is
        // `now()` for all 43 rows and every line in the card reads "today",
        // which is the one thing a recency list must not do. Booked a few days
        // before the appointment, like a real one.
        createdAt: new Date(scheduledFor.getTime() - 3 * 24 * 60 * 60 * 1000),
        scheduledFor,
        locationType: ServiceLocationType.SALON,
        locationId: locationId(look.proKey),
        locationTimeZone: TIME_ZONE,
        subtotalSnapshot: money(look.priceStartingAt),
        totalDurationMinutes: svc.durationMinutes,
      })
      bookingSeq += 1
    }
  }
  await prisma.booking.createMany({ data: bookingRows })

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

  // Score the creator tier from the rows just written, using the SAME job the
  // hourly cron runs. Seeding a tier directly would let the fixture disagree
  // with what production would actually compute from this data.
  const stats = await refreshClientCreatorStats(prisma, NOW)

  console.log(
    `[seedDemoClientProfile] seeded @${CREATOR.handle}: ` +
      `${LOOKS.length} looks, ${BOARDS.length} boards ` +
      `(${BOARDS.filter((b) => b.shared).length} shared), ${ADD_ONS.length} add-ons, ` +
      `${FOLLOWER_COUNT} followers, ${bookingRows.length} attributed bookings; ` +
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
