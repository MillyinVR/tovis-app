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
const BOARDS: { key: string; name: string; lookKeys: string[] }[] = [
  {
    key: 'lived-in-blonde',
    name: 'Lived-in blonde',
    lookKeys: ['lived-in-blonde', 'money-piece-blonde', 'cherry-cola-balayage', 'brow-lamination'],
  },
  {
    key: 'viral-looks',
    name: 'Viral looks',
    lookKeys: ['cherry-cola-balayage', 'lived-in-blonde', 'glazed-almond-set', 'lash-lift-tint'],
  },
  { key: 'wedding-hair', name: 'Wedding hair', lookKeys: ['money-piece-blonde', 'lived-in-blonde'] },
  { key: 'nails-2025', name: 'Nails 2025', lookKeys: ['glazed-almond-set'] },
]

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n: number) => new Prisma.Decimal(n.toFixed(2))

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

  await prisma.booking.deleteMany({ where: { id: idPrefix } })
  await prisma.boardItem.deleteMany({ where: { id: idPrefix } })
  await prisma.board.deleteMany({ where: { id: idPrefix } })
  await prisma.clientFollow.deleteMany({ where: { id: idPrefix } })
  await prisma.lookPost.deleteMany({ where: { id: idPrefix } })
  // The look's primary MediaAsset is @unique + cascades TO the look, so the
  // looks above are already gone; drop the assets themselves now.
  await prisma.mediaAsset.deleteMany({ where: { id: idPrefix } })
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
        formattedAddress: '215 Bedford Ave, Brooklyn, NY 11211',
        addressLine1: '215 Bedford Ave',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11211',
        countryCode: 'US',
        timeZone: TIME_ZONE,
        workingHours: workingHoursJson(),
      },
      select: { id: true },
    })
    locationIdByKey.set(pro.key, location.id)
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

    await prisma.professionalServiceOffering.create({
      data: {
        id: `${P}offering-${look.proKey}-${look.serviceKey}`,
        professionalId: proId(look.proKey),
        serviceId: serviceId(look.serviceKey),
        salonPriceStartingAt: money(look.priceStartingAt),
        salonDurationMinutes: svc.durationMinutes,
        offersInSalon: true,
        offersMobile: false,
        isActive: true,
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
        visibility: BoardVisibility.SHARED,
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
  await prisma.clientProfile.createMany({
    data: Array.from({ length: fanCount }, (_, i) => ({
      id: `${P}fan-${String(i).padStart(4, '0')}`,
      homeTenantId: tenantId,
      firstName: 'Demo',
      lastName: `Fan ${i + 1}`,
      claimStatus: ClientClaimStatus.UNCLAIMED,
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
        scheduledFor: new Date(NOW.getTime() - (bookingSeq + 1) * 24 * 60 * 60 * 1000),
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

  // Score the creator tier from the rows just written, using the SAME job the
  // hourly cron runs. Seeding a tier directly would let the fixture disagree
  // with what production would actually compute from this data.
  const stats = await refreshClientCreatorStats(prisma, NOW)

  console.log(
    `[seedDemoClientProfile] seeded @${CREATOR.handle}: ` +
      `${LOOKS.length} looks, ${BOARDS.length} boards, ` +
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
