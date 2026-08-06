// prisma/scripts/seedRetentionRosterPerf.ts
//
// LOCAL-ONLY perf/visual fixture for the paid "Retention & Rebooking" analytics
// (lib/analytics/proRetentionInsights.ts, app/pro/dashboard/ProRetentionSection.tsx —
// membership-value-brief.md §10.4's two unverified items).
//
// Seeds ONE dedicated pro with up to RETENTION_ROSTER_LIMIT clients and a 24-month
// booking history spread across all five states the retention roster can classify
// a client into (single-visit / lapsing / due-now / already-rebooked / not-due-yet),
// then calls the SAME recompute function the app uses
// (recomputeProfessionalMonthlyAnalytics) to backfill six real
// ProfessionalMonthlyAnalytics snapshots from that booking data — never fabricating
// snapshot numbers separately, so the roster buckets and the trend line stay
// internally consistent the way they would in production.
//
// Idempotent: reruns wipe and rebuild this pro's own bookings/clients/snapshots by
// scoping every delete to this script's dedicated professionalId + client email
// prefix. It never touches any other seeded data.
//
// Usage:
//   pnpm db:dev:seed:retention-perf [-- --count=650]
//
// (equivalent to, if you need to point at a different local DB:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev" \
//   DIRECT_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev" \
//   NODE_OPTIONS="--import tsx --require ./prisma/scripts/_serverOnlyCjsHook.cjs" \
//     node prisma/scripts/seedRetentionRosterPerf.ts --count=650)
import bcrypt from 'bcryptjs'

import {
  BookingSource,
  BookingStatus,
  ClientClaimStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  ProfessionType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import { recomputeProfessionalMonthlyAnalytics } from '@/lib/analytics/proMonthlyAnalytics'
import { recentMonthKeys } from '@/lib/analytics/proRetentionInsights'

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function requireLocalDatabase(): void {
  const raw = process.env.DATABASE_URL ?? ''
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error(`[seedRetentionRosterPerf] DATABASE_URL is not a parseable URL.`)
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `[seedRetentionRosterPerf] Refusing non-local database host "${host}". ` +
        `This script only ever runs against localhost:5434 (tovis_dev). ` +
        `.env.local holds the PROD Supabase URL — pass DATABASE_URL explicitly.`,
    )
  }
}
requireLocalDatabase()

const prisma = new PrismaClient()

const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
const TENANT_SLUG = 'tovis-root'
const PRO_EMAIL = 'retention-perf-pro@tovis.app'
const PRO_HANDLE = 'retention-perf-pro'
const CLIENT_EMAIL_PREFIX = 'retention-perf-client-'
const SERVICE_NAME = 'Retention Perf Stress Service'
const CATEGORY_SLUG = 'retention-perf-category'

const SLOT_MINUTES = 45
const SERVICE_DURATION_MINUTES = 30
const SERVICE_BUFFER_MINUTES = 10

function parseCount(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith('--count='))
  if (!flag) return 500
  const n = Number(flag.slice('--count='.length))
  if (!Number.isFinite(n) || n <= 0) throw new Error('--count must be a positive number')
  // Capped above RETENTION_ROSTER_LIMIT (500) on purpose: ~13% of the kind mix
  // (`deep_history`) is deliberately invisible to the roster query (see the
  // ClientKind doc comment below), and a "not due yet" client is visible but
  // renders in no bucket — so seeding exactly 500 total clients does NOT
  // exercise the loader's `take: 500` cap. A count in the 550-650 range does.
  return Math.min(Math.floor(n), 650)
}

// ── deterministic RNG (mulberry32) — stable output across reruns so before/after
// profiling compares like-for-like data, not a new random draw each time. ──────
function mulberry32(seed: number) {
  let a = seed
  return function rand(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(0x52455453) // 'RETS'

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}
function randFloat(min: number, max: number): number {
  return rand() * (max - min) + min
}
function pick<T>(arr: readonly T[]): T {
  const item = arr[randInt(0, arr.length - 1)]
  if (item === undefined) throw new Error('pick() from empty array')
  return item
}

// ── name pools ───────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Ava', 'Liam', 'Sofia', 'Noah', 'Mia', 'Elijah', 'Zoe', 'Lucas', 'Amara', 'Kai',
  'Priya', 'Diego', 'Nia', 'Mateo', 'Yuki', 'Fatima', 'Owen', 'Layla', 'Theo', 'Ines',
  'José', 'Chloé', 'Nguyễn', 'Björn', 'Aoife', 'Renée', 'Xiomara', 'Dmitri', 'Amina', 'Rafael',
  'Harper', 'Wren', 'Sage', 'Jasper', 'Ruby', 'August', 'Nora', 'Emile', 'Talia', 'Rosalind',
]
const LAST_NAMES = [
  "O'Brien", 'García', 'Nakamura', 'Okafor', 'Petrova', 'Silva', 'Kowalski', 'Haddad',
  'Larsson', 'Delacroix', 'Whitfield', 'Abernathy', 'Zúñiga', 'Yamamoto', 'Ferreira',
  'Novak', 'Mensah', 'Šimić', 'Villanueva', 'Castellano', 'Beaumont', 'Kirkpatrick',
  'Nakashima', 'Odigie', 'Larkspur', 'Fitzgerald', 'Montgomery', 'Bergström', 'Adeyemi', 'Rousseau',
]
// Deliberately long names — layout stress test (requirement #2: "layout holds with
// long client names").
const LONG_NAMES: Array<[string, string]> = [
  ['Anastasia-Wilhelmina', 'Featherstonehaugh-Montgomery'],
  ['Maximilian-Alexander', 'Kirkpatrick-Rutherford'],
  ['Guadalupe-Esperanza', 'Villanueva-Castellano-Reyes'],
  ['Bartholomew-Winchester', 'Abernathy-Wolstenholme'],
  ['Nnamdi-Chukwuemeka', 'Okonkwo-Adeyemi-Balogun'],
  ['Persephone-Marigold', 'Ashworth-Underwood'],
  ['Jean-Baptiste-Etienne', 'de la Fontaine-Rousseau'],
  ['Seraphina-Anneliese', 'von Hohenzollern-Bergström'],
]

// ── client "kind" plan — determines cadence + recency, which determines which
// bucket (or none) the client lands in. See proRetentionInsights.ts bucketing +
// proClientVisibilityWhere's 30-day RECENT_COMPLETED window (lib/clientVisibility.ts)
// — a client is only visible in the roster query at all if their most recent
// completed visit is within that window (or they have an active/pending/upcoming
// booking). That interacts with retentionRisk = daysSinceLastVisit > cadence*1.5:
// for the "lapsing" bucket to be reachable, cadence must be short enough that
// 1.5x still lands inside 30 days. 'deep_history' deliberately uses a longer
// cadence whose lapse falls OUTSIDE that window, to empirically exercise (and
// document) that edge — see the seed summary printed at the end.
type ClientKind =
  | 'single'
  | 'lapsing'
  | 'due_now'
  | 'on_books'
  | 'not_due'
  | 'deep_history'

const KIND_WEIGHTS: Array<[ClientKind, number]> = [
  ['single', 12],
  ['lapsing', 16],
  ['due_now', 16],
  ['on_books', 26],
  ['not_due', 18],
  ['deep_history', 12],
]

function pickKind(): ClientKind {
  const total = KIND_WEIGHTS.reduce((sum, [, w]) => sum + w, 0)
  let roll = rand() * total
  for (const [kind, weight] of KIND_WEIGHTS) {
    if (roll < weight) return kind
    roll -= weight
  }
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1]![0]
}

const DAY_MS = 24 * 60 * 60 * 1000

type DesiredVisit = {
  /** Filled in once the client row exists — empty during plan construction. */
  clientId: string
  desiredDate: Date
  status: 'COMPLETED' | 'CANCELLED' | 'ACCEPTED' | 'PENDING'
}

type ClientPlan = {
  index: number
  firstName: string
  lastName: string
  kind: ClientKind
  visits: DesiredVisit[]
}

function buildClientPlan(index: number, now: Date): ClientPlan {
  const long = index < LONG_NAMES.length
  const [firstName, lastName] = long
    ? LONG_NAMES[index]!
    : [pick(FIRST_NAMES), `${pick(LAST_NAMES)}${index % 37 === 0 ? '-Vance' : ''}`]

  const kind = pickKind()
  const visits: DesiredVisit[] = []

  const pushHistory = (anchorDaysAgo: number, cadenceDays: number, count: number) => {
    let daysAgo = anchorDaysAgo
    for (let i = 0; i < count; i += 1) {
      if (daysAgo > 24 * 30) break // stay inside the 24-month roster lookback
      visits.push({
        clientId: '',
        desiredDate: new Date(now.getTime() - daysAgo * DAY_MS),
        status: 'COMPLETED',
      })
      daysAgo += cadenceDays * randFloat(0.75, 1.3)
    }
  }

  switch (kind) {
    case 'single': {
      visits.push({
        clientId: '',
        desiredDate: new Date(now.getTime() - randInt(8, 26) * DAY_MS),
        status: 'COMPLETED',
      })
      break
    }
    case 'lapsing': {
      const cadence = randInt(8, 16)
      const anchor = Math.min(28, cadence * randFloat(1.6, 2.3))
      pushHistory(anchor, cadence, randInt(3, 9))
      break
    }
    case 'due_now': {
      const cadence = randInt(8, 24)
      const anchor = Math.min(29, cadence * randFloat(1.0, 1.4))
      pushHistory(anchor, cadence, randInt(3, 9))
      break
    }
    case 'on_books': {
      const cadence = randInt(10, 45)
      const anchor = cadence * randFloat(0.6, 1.8)
      pushHistory(anchor, cadence, randInt(2, 14))
      visits.push({
        clientId: '',
        desiredDate: new Date(now.getTime() + randInt(3, 45) * DAY_MS),
        status: rand() < 0.7 ? 'ACCEPTED' : 'PENDING',
      })
      break
    }
    case 'not_due': {
      const cadence = randInt(14, 40)
      const anchor = cadence * randFloat(0.2, 0.85)
      pushHistory(anchor, cadence, randInt(2, 10))
      break
    }
    case 'deep_history': {
      // Long cadence: by the time these clients are "at risk" (1.5x cadence),
      // they have already aged out of the 30-day chart-visibility window, so
      // they will NOT appear in the roster at all. Deliberate — see header.
      const cadence = randInt(30, 60)
      const anchor = cadence * randFloat(1.6, 2.4)
      pushHistory(anchor, cadence, randInt(2, 8))
      break
    }
  }

  // Occasional extra cancellation, scattered in the client's own history window —
  // realistic volume, doesn't affect bucket classification (CANCELLED is excluded
  // from isCompleted()).
  if (rand() < 0.15 && visits.length > 0) {
    const near = visits[randInt(0, visits.length - 1)]!
    visits.push({
      clientId: '',
      desiredDate: new Date(near.desiredDate.getTime() - randInt(5, 40) * DAY_MS),
      status: 'CANCELLED',
    })
  }

  return { index, firstName, lastName, kind, visits }
}

// ── slot assignment: sort every desired booking (past + future, all clients)
// ascending, then walk forward with a monotonic cursor so no two bookings for
// this ONE pro ever overlap (Booking_no_active_professional_overlap). ─────────
function assignSlots(all: DesiredVisit[]): Map<DesiredVisit, Date> {
  const sorted = [...all].sort((a, b) => a.desiredDate.getTime() - b.desiredDate.getTime())
  const assigned = new Map<DesiredVisit, Date>()
  let cursor: number | null = null
  for (const visit of sorted) {
    const start: number = cursor !== null && visit.desiredDate.getTime() < cursor
      ? cursor
      : visit.desiredDate.getTime()
    assigned.set(visit, new Date(start))
    cursor = start + SLOT_MINUTES * 60 * 1000
  }
  return assigned
}

async function main() {
  const count = parseCount(process.argv.slice(2))
  const now = new Date()
  console.log(`[seedRetentionRosterPerf] target client count: ${count}`)

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG, name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  // Password login is unreachable for a locally seeded user anyway (looked up by
  // emailHashV2, a PII-keyring HMAC — see pnpm dev:mint-jwt's header), so this
  // hash is never checked; it just needs to BE a real bcrypt hash so nothing
  // downstream throws on a malformed one.
  const proPasswordHash = await bcrypt.hash('unused-retention-perf-seed-password', 10)

  const proUser = await prisma.user.upsert({
    where: { email: PRO_EMAIL },
    update: { role: Role.PRO },
    create: {
      email: PRO_EMAIL,
      password: proPasswordHash,
      role: Role.PRO,
      phone: '+15555559100',
      phoneVerifiedAt: now,
      emailVerifiedAt: now,
    },
    select: { id: true },
  })

  const pro = await prisma.professionalProfile.upsert({
    where: { userId: proUser.id },
    update: {},
    create: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Retention',
      lastName: 'PerfPro',
      phone: '+15555559100',
      phoneVerifiedAt: now,
      businessName: 'Retention Perf Studio',
      handle: PRO_HANDLE,
      handleNormalized: PRO_HANDLE,
      location: 'Los Angeles, CA',
      timeZone: DEFAULT_TIME_ZONE,
      professionType: ProfessionType.COSMETOLOGIST,
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedAt: now,
      licenseVerifiedSource: 'SEED',
      licenseStatusCode: 'CURRENT',
    },
    select: { id: true },
  })

  let location = await prisma.professionalLocation.findFirst({
    where: { professionalId: pro.id, type: ProfessionalLocationType.SALON },
    select: { id: true },
  })
  if (!location) {
    location = await prisma.professionalLocation.create({
      data: {
        professionalId: pro.id,
        type: ProfessionalLocationType.SALON,
        name: 'Retention Perf Salon',
        isPrimary: true,
        isBookable: true,
        formattedAddress: '500 Perf Test Ave, Los Angeles, CA 90001',
        addressLine1: '500 Perf Test Ave',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        lat: new Prisma.Decimal('34.0522350'),
        lng: new Prisma.Decimal('-118.2436830'),
        timeZone: DEFAULT_TIME_ZONE,
        workingHours: {
          mon: { enabled: true, start: '09:00', end: '17:00' },
          tue: { enabled: true, start: '09:00', end: '17:00' },
          wed: { enabled: true, start: '09:00', end: '17:00' },
          thu: { enabled: true, start: '09:00', end: '17:00' },
          fri: { enabled: true, start: '09:00', end: '17:00' },
          sat: { enabled: true, start: '09:00', end: '15:00' },
          sun: { enabled: false, start: '09:00', end: '17:00' },
        },
        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 3650,
      },
      select: { id: true },
    })
  }

  const category = await prisma.serviceCategory.upsert({
    where: { slug: CATEGORY_SLUG },
    update: {},
    create: { slug: CATEGORY_SLUG, name: 'Retention Perf', isActive: true },
    select: { id: true },
  })
  const service = await prisma.service.upsert({
    where: { name: SERVICE_NAME },
    update: {},
    create: {
      name: SERVICE_NAME,
      categoryId: category.id,
      defaultDurationMinutes: SERVICE_DURATION_MINUTES,
      minPrice: new Prisma.Decimal('65.00'),
      allowMobile: false,
    },
    select: { id: true },
  })

  // Required for checkProReadiness (app/pro/layout.tsx's onboarding gate) to let
  // this pro past /pro/services and actually reach /pro/dashboard.
  const existingOffering = await prisma.professionalServiceOffering.findFirst({
    where: { professionalId: pro.id, serviceId: service.id },
    select: { id: true },
  })
  if (!existingOffering) {
    await prisma.professionalServiceOffering.create({
      data: {
        professionalId: pro.id,
        serviceId: service.id,
        salonPriceStartingAt: new Prisma.Decimal('65.00'),
        salonDurationMinutes: SERVICE_DURATION_MINUTES,
        offersInSalon: true,
        offersMobile: false,
        isActive: true,
      },
    })
  }

  // ── wipe this script's own prior run (idempotent rerun) ──────────────────
  console.log('[seedRetentionRosterPerf] wiping this pro\'s prior seeded data…')
  await prisma.booking.deleteMany({ where: { professionalId: pro.id } })
  await prisma.professionalMonthlyAnalytics.deleteMany({ where: { professionalId: pro.id } })
  await prisma.clientProfile.deleteMany({
    where: { email: { startsWith: CLIENT_EMAIL_PREFIX } },
  })

  // ── clients ────────────────────────────────────────────────────────────
  console.log(`[seedRetentionRosterPerf] creating ${count} client profiles…`)
  const plans: ClientPlan[] = []
  for (let i = 0; i < count; i += 1) plans.push(buildClientPlan(i, now))

  const CHUNK = 25
  const clientIds: string[] = []
  for (let i = 0; i < plans.length; i += CHUNK) {
    const chunk = plans.slice(i, i + CHUNK)
    const created = await Promise.all(
      chunk.map((plan) =>
        prisma.clientProfile.create({
          data: {
            userId: null,
            homeTenantId: tenant.id,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            firstName: plan.firstName,
            lastName: plan.lastName,
            email: `${CLIENT_EMAIL_PREFIX}${plan.index}@seed.tovis.internal`,
          },
          select: { id: true },
        }),
      ),
    )
    created.forEach((c, j) => {
      clientIds.push(c.id)
      plans[i + j]!.visits.forEach((v) => {
        v.clientId = c.id
      })
    })
  }

  // ── schedule all bookings globally (past + future, every client) ─────────
  const allVisits = plans.flatMap((p) => p.visits)
  console.log(`[seedRetentionRosterPerf] scheduling ${allVisits.length} bookings…`)
  const slotByVisit = assignSlots(allVisits)

  const kindCounts: Record<ClientKind, number> = {
    single: 0, lapsing: 0, due_now: 0, on_books: 0, not_due: 0, deep_history: 0,
  }
  for (const plan of plans) kindCounts[plan.kind] += 1

  const bookingRows: Prisma.BookingCreateManyInput[] = allVisits.map((visit) => {
    const scheduledFor = slotByVisit.get(visit)!
    const clientId = visit.clientId
    const isCompleted = visit.status === 'COMPLETED'
    const isCancelled = visit.status === 'CANCELLED'
    const bookingStatus: BookingStatus = isCompleted
      ? BookingStatus.COMPLETED
      : isCancelled
        ? BookingStatus.CANCELLED
        : visit.status === 'ACCEPTED'
          ? BookingStatus.ACCEPTED
          : BookingStatus.PENDING

    return {
      clientId,
      professionalId: pro.id,
      serviceId: service.id,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
      scheduledFor,
      status: bookingStatus,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: location!.id,
      locationTimeZone: DEFAULT_TIME_ZONE,
      locationAddressSnapshot: { formattedAddress: '500 Perf Test Ave, Los Angeles, CA 90001' },
      locationLatSnapshot: 34.052235,
      locationLngSnapshot: -118.243683,
      clientAddressSnapshot: Prisma.JsonNull,
      subtotalSnapshot: new Prisma.Decimal('65.00'),
      totalDurationMinutes: SERVICE_DURATION_MINUTES,
      bufferMinutes: SERVICE_BUFFER_MINUTES,
      finishedAt: isCompleted
        ? new Date(scheduledFor.getTime() + SERVICE_DURATION_MINUTES * 60 * 1000)
        : null,
      cancelledAt: isCancelled ? scheduledFor : null,
      createdAt: new Date(scheduledFor.getTime() - randInt(1, 21) * DAY_MS),
    }
  })

  console.log(`[seedRetentionRosterPerf] inserting ${bookingRows.length} bookings…`)
  const BOOKING_CHUNK = 500
  for (let i = 0; i < bookingRows.length; i += BOOKING_CHUNK) {
    await prisma.booking.createMany({ data: bookingRows.slice(i, i + BOOKING_CHUNK) })
  }

  // ── backfill 6 months of REAL analytics snapshots from the booking data we
  // just wrote — never fabricate these separately from the roster (they'd drift). ──
  const monthKeys = recentMonthKeys(now, DEFAULT_TIME_ZONE, 6)
  console.log(`[seedRetentionRosterPerf] recomputing monthly analytics for ${monthKeys.join(', ')}…`)
  for (const monthKey of monthKeys) {
    await recomputeProfessionalMonthlyAnalytics({
      professionalId: pro.id,
      monthKey,
      timeZone: DEFAULT_TIME_ZONE,
    })
  }

  console.log('\n[seedRetentionRosterPerf] done.')
  console.log(`  professionalId: ${pro.id}`)
  console.log(`  proUserId:      ${proUser.id}`)
  console.log(`  proEmail:       ${PRO_EMAIL}`)
  console.log(`  clients:        ${clientIds.length}`)
  console.log(`  bookings:       ${bookingRows.length}`)
  console.log(`  kind mix:       ${JSON.stringify(kindCounts)}`)
  console.log(`  trend months:   ${monthKeys.join(', ')}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
