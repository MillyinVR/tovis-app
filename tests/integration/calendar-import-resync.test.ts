// tests/integration/calendar-import-resync.test.ts
//
// B9 — the calendar import driven for real: a Google-shaped .ics feed through
// `runCalendarResync` against real Postgres, twice, then with an event removed.
// Only the network edge is stubbed (`fetchCalendarFeed`) and the Redis bump
// (`.env.test.local` shares prod Upstash — never assert on it, spy on it).
//
// What only a real database can show, and why each case is here:
//
//   - the block windows are the pro's LOCAL day. The whole B9 timezone fix is
//     invisible to a mocked write: the assertion has to be a row.
//   - UID idempotency ACROSS resyncs, including after the pro RENAMES a block.
//     The old scheme matched a `[import:uid]` tag inside the note, so a rename
//     orphaned the block; now it is a column with a unique index, and the index
//     itself is only real here.
//   - the schedule lock. A mocked transaction proves the call shape; a real one
//     proves the advisory lock is taken and released, twelve times in a row,
//     without deadlocking against itself ([[prove-the-lock-from-outside-the-app]]).
//   - the deletion reconcile, which needs `lastSyncedUids` written by an earlier
//     real run.
//   - a feed event landing on a NATIVE booking: the block is still written
//     (Tori's call) and the note says so.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real Postgres means the PII columns are really encrypted, and the import
// resolves a feed attendee into a client through the blind-index lookup — so
// both keyrings must be present or every failure masquerades as a regression.
//
// ⚠️ The HMAC keyring's versions are positive INTEGERS
// (`parseContactLookupHmacKeyring`, hashLookup.ts:137), and the AEAD keyring
// wants NAMED keys. A label like `'lookup-hmac-v1'` throws "invalid key
// version" — which is what the first draft of this suite did, and it surfaced
// as an opaque `[redacted-notes]` error inside the importer's own catch.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 7).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({
    'address-aead-v1': key32,
    'email-aead-v1': key32,
    'phone-aead-v1': key32,
    'notes-aead-v1': key32,
  })
})

const feed = vi.hoisted(() => ({
  fetchCalendarFeed: vi.fn(),
}))

// The ONLY stub on the import path: the network. Everything from
// `parseCalendarFeed` inwards is the shipped code.
vi.mock('@/lib/migration/calendarFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/migration/calendarFeed')>()),
  fetchCalendarFeed: feed.fetchCalendarFeed,
}))

const cacheVersion = vi.hoisted(() => ({
  bumpScheduleVersion: vi.fn(async () => 1),
}))

vi.mock('@/lib/booking/cacheVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/cacheVersion')>()),
  bumpScheduleVersion: cacheVersion.bumpScheduleVersion,
}))

import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  CalendarFeedStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { runCalendarResync } from '@/lib/migration/calendarResync'
import {
  addDaysToYMD,
  getZonedParts,
  startOfLocalDayUtc,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/time'
import { commitCalendarImport } from '@/lib/migration/calendarImportServer'
import { upsertProClient } from '@/lib/clients/upsertProClient'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `calimport_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const TZ = 'America/Los_Angeles'
const FEED_URL = 'https://calendar.example.com/private/basic.ics'
const SERVICE_NAME = `Balayage ${tag}`

let tenantId = ''
let clientId = ''
let professionalId = ''
let proUserId = ''
// Pro 2 exists ONLY for the cross-pro idempotency regression at the bottom of
// this file — same client, shared event UID, and the booking keys must not
// collide. Everything about it mirrors pro 1's fixture.
let pro2Id = ''
let pro2UserId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let offeringId = ''
let subscriptionId = ''
let nativeBookingId = ''

const seededUserEmails: string[] = []

const OPEN_ALL_WEEK = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: true, start: '09:00', end: '17:00' },
  sun: { enabled: true, start: '09:00', end: '17:00' },
}

// ── the fixture feed ──────────────────────────────────────────────────────────
// A calendar date `daysOut` local days from today, so every run is in the future
// regardless of when it runs — and stepped on the CALENDAR, not by +24h.
function localDate(daysOut: number): { year: number; month: number; day: number } {
  const today = getZonedParts(new Date(), TZ)
  return addDaysToYMD(today.year, today.month, today.day, daysOut)
}

function ymdStamp(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, '0')}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}`
}

/** The UTC instant of `hourLocal:00` on a local date, via the shared helpers. */
function localHour(parts: { year: number; month: number; day: number }, hourLocal: number): Date {
  return utcFromDayAndMinutesInTimeZone(
    startOfLocalDayUtc({ ...parts, timeZone: TZ }),
    hourLocal * 60,
    TZ,
  )
}

function tzidStamp(parts: { year: number; month: number; day: number }, hourLocal: number, minute = 0): string {
  return `${ymdStamp(parts)}T${String(hourLocal).padStart(2, '0')}${String(minute).padStart(2, '0')}00`
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'X-LIC-LOCATION:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=1;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

const UID_ALLDAY = `${tag}-allday@google.com`
const UID_BOOKABLE = `${tag}-bookable@google.com`
const UID_UNMAPPED = `${tag}-unmapped@google.com`
const UID_ON_NATIVE = `${tag}-collides@google.com`

// Local dates the feed refers to. Spread across days so no two writes contend
// for `(professionalId, scheduledFor)`, which is UNIQUE.
const DAY_ALLDAY = localDate(21)
const DAY_ALLDAY_END = localDate(22)
const DAY_BOOKABLE = localDate(23)
const DAY_UNMAPPED = localDate(24)
const DAY_NATIVE = localDate(25)

function vevent(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
}

/** A Google-export-shaped .ics. `omit` drops UIDs, to drive the reconcile. */
function fixtureIcs(omit: string[] = []): string {
  const events: string[][] = []

  if (!omit.includes(UID_ALLDAY)) {
    events.push(
      vevent(
        `UID:${UID_ALLDAY}`,
        `DTSTART;VALUE=DATE:${ymdStamp(DAY_ALLDAY)}`,
        `DTEND;VALUE=DATE:${ymdStamp(DAY_ALLDAY_END)}`,
        'SUMMARY:Vacation - closed',
        'TRANSP:OPAQUE',
      ),
    )
  }

  if (!omit.includes(UID_BOOKABLE)) {
    events.push(
      vevent(
        `UID:${UID_BOOKABLE}`,
        `DTSTART;TZID=America/Los_Angeles:${tzidStamp(DAY_BOOKABLE, 11)}`,
        `DTEND;TZID=America/Los_Angeles:${tzidStamp(DAY_BOOKABLE, 12)}`,
        `SUMMARY:${SERVICE_NAME}`,
        'ATTENDEE;CN=Jordan Reyes:mailto:jordan.reyes@example.com',
      ),
    )
  }

  if (!omit.includes(UID_UNMAPPED)) {
    events.push(
      vevent(
        `UID:${UID_UNMAPPED}`,
        `DTSTART;TZID=America/Los_Angeles:${tzidStamp(DAY_UNMAPPED, 13)}`,
        `DTEND;TZID=America/Los_Angeles:${tzidStamp(DAY_UNMAPPED, 14)}`,
        'SUMMARY:Hot Stone Massage',
      ),
    )
  }

  if (!omit.includes(UID_ON_NATIVE)) {
    events.push(
      vevent(
        `UID:${UID_ON_NATIVE}`,
        `DTSTART;TZID=America/Los_Angeles:${tzidStamp(DAY_NATIVE, 10)}`,
        `DTEND;TZID=America/Los_Angeles:${tzidStamp(DAY_NATIVE, 11)}`,
        'SUMMARY:Reiki',
      ),
    )
  }

  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Studio',
    'X-WR-TIMEZONE:America/Los_Angeles',
    ...VTIMEZONE,
    ...events.flat(),
    'END:VCALENDAR',
  ].join('\r\n')
}

function serveFeed(ics: string): void {
  feed.fetchCalendarFeed.mockResolvedValue({ ok: true, ics })
}

async function resync(): Promise<{ scanned: number; synced: number; errored: number }> {
  const summary = await runCalendarResync({ now: new Date() })
  return { scanned: summary.scanned, synced: summary.synced, errored: summary.errored }
}

async function importedBlocks() {
  return db.calendarBlock.findMany({
    where: { professionalId },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      note: true,
      locationId: true,
      importedEventUid: true,
    },
  })
}

async function importedBookings() {
  return db.booking.findMany({
    where: { professionalId, source: BookingSource.IMPORTED },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      creationIdempotencyKey: true,
    },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Calendar import', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await db.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  seededUserEmails.push(clientEmail)

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Native',
      lastName: 'Client',
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  clientId = client.id

  const proEmail = `${tag}_pro@example.com`
  const proUser = await db.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(proEmail)
  proUserId = proUser.id

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Migrating',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      timeZone: TZ,
    },
    select: { id: true },
  })
  professionalId = pro.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      formattedAddress: '9 Import Way, Los Angeles, CA 90001',
      addressLine1: '9 Import Way',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      lat: new Prisma.Decimal('34.0522000'),
      lng: new Prisma.Decimal('-118.2437000'),
      timeZone: TZ,
      workingHours: OPEN_ALL_WEEK,
      bufferMinutes: 0,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })
  locationId = location.id

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })
  categoryId = category.id

  const service = await db.service.create({
    data: {
      // `Service.name` is globally UNIQUE, so it carries the run tag; the feed's
      // SUMMARY below matches the same string so the matcher still resolves it.
      name: SERVICE_NAME,
      categoryId,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('80.00'),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 60,
      salonPriceStartingAt: new Prisma.Decimal('80.00'),
      isActive: true,
    },
    select: { id: true },
  })
  offeringId = offering.id

  // A NATIVE booking the feed will land on: 10:00–11:00 local on DAY_NATIVE.
  const native = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      scheduledFor: localHour(DAY_NATIVE, 10),
      status: BookingStatus.ACCEPTED,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: new Date(),
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: TZ,
      subtotalSnapshot: new Prisma.Decimal('80.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
    },
    select: { id: true },
  })
  nativeBookingId = native.id

  await db.bookingServiceItem.create({
    data: {
      bookingId: native.id,
      serviceId,
      offeringId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('80.00'),
      durationMinutesSnapshot: 60,
      sortOrder: 0,
    },
  })

  const subscription = await db.calendarFeedSubscription.create({
    data: { professionalId, feedUrl: FEED_URL, status: CalendarFeedStatus.ACTIVE },
    select: { id: true },
  })
  subscriptionId = subscription.id

  // ── pro 2 (cross-pro idempotency regression only) ──────────────────────────
  const pro2Email = `${tag}_pro2@example.com`
  const pro2User = await db.user.create({
    data: { email: pro2Email, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(pro2Email)
  pro2UserId = pro2User.id

  const pro2 = await db.professionalProfile.create({
    data: {
      userId: pro2User.id,
      homeTenantId: tenantId,
      firstName: 'Second',
      lastName: 'Pro',
      businessName: `${tag} second studio`,
      timeZone: TZ,
    },
    select: { id: true },
  })
  pro2Id = pro2.id

  // A bookable salon so pro 2's import can materialize a BOOKING. Deliberately
  // a different location from pro 1's — nothing about this fixture should
  // collide with pro 1's except the thing under test.
  await db.professionalLocation.create({
    data: {
      professionalId: pro2Id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} second salon`,
      isPrimary: true,
      isBookable: true,
      formattedAddress: '12 Second Pro Rd, Los Angeles, CA 90002',
      addressLine1: '12 Second Pro Rd',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90002',
      countryCode: 'US',
      lat: new Prisma.Decimal('34.0523000'),
      lng: new Prisma.Decimal('-118.2438000'),
      timeZone: TZ,
      workingHours: OPEN_ALL_WEEK,
      bufferMinutes: 0,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })
}, 180_000)

afterAll(async () => {
  await db.calendarFeedSubscription.deleteMany({ where: { professionalId } })
  await db.calendarBlock.deleteMany({ where: { professionalId } })
  await db.scheduledClientNotification.deleteMany({
    where: { booking: { professionalId } },
  })
  await db.reminder.deleteMany({ where: { booking: { professionalId } } })
  await db.notification.deleteMany({ where: { booking: { professionalId } } })
  await db.bookingOverrideAuditLog.deleteMany({ where: { professionalId } })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId } },
  })
  await db.booking.deleteMany({ where: { professionalId } })
  // Pro 2's cross-pro regression rows.
  await db.bookingServiceItem.deleteMany({ where: { booking: { professionalId: pro2Id } } })
  await db.booking.deleteMany({ where: { professionalId: pro2Id } })
  const pro2ImportedClients = await db.clientProfile.findMany({
    where: { createdByProfessionalId: pro2Id },
    select: { id: true, userId: true },
  })
  await db.clientProfile.deleteMany({
    where: { id: { in: pro2ImportedClients.map((c) => c.id) } },
  })
  await db.user.deleteMany({
    where: { id: { in: pro2ImportedClients.map((c) => c.userId).filter((id): id is string => Boolean(id)) } },
  })
  await db.professionalLocation.deleteMany({ where: { professionalId: pro2Id } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId: pro2Id } })
  await db.professionalProfile.deleteMany({ where: { id: pro2Id } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })
  await db.professionalLocation.deleteMany({ where: { professionalId } })
  await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  // Clients the IMPORT created from feed attendees (upsertProClient stamps
  // `createdByProfessionalId`), plus any user rows it minted for them.
  const importedClients = await db.clientProfile.findMany({
    where: { createdByProfessionalId: professionalId },
    select: { id: true, userId: true },
  })
  await db.clientProfile.deleteMany({
    where: { id: { in: [clientId, ...importedClients.map((c) => c.id)] } },
  })
  const importedUserIds = importedClients
    .map((c) => c.userId)
    .filter((id): id is string => Boolean(id))
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.user.deleteMany({ where: { id: { in: [proUserId, ...importedUserIds] } } })
  await db.service.deleteMany({ where: { categoryId } })
  await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  await db.$disconnect()
}, 180_000)

beforeEach(() => {
  feed.fetchCalendarFeed.mockReset()
  cacheVersion.bumpScheduleVersion.mockClear()
})

// The cases in this block run in ORDER and share state ON PURPOSE: they model one
// feed's life across successive hourly resyncs, and the reconcile can only be
// exercised by a run that follows a run (it diffs against the `lastSyncedUids`
// the previous one stored). Splitting them into independent fixtures would test
// the same write four times and the reconcile not at all.
describe('B9 — a real .ics feed through the resync, against real Postgres', () => {
  it('materializes the feed: local-day block, real booking, honest notes', async () => {
    serveFeed(fixtureIcs())

    const summary = await resync()
    expect(summary).toEqual({ scanned: 1, synced: 1, errored: 0 })

    const blocks = await importedBlocks()
    expect(blocks).toHaveLength(3)

    const byUid = new Map(blocks.map((b) => [b.importedEventUid, b]))

    // The all-day event is the pro's WHOLE LOCAL DAY. Read as the server's
    // midnight (UTC on Vercel) this ran 17:00 the previous day → 17:00, leaving
    // the last seven hours of the pro's day off bookable.
    const allDay = byUid.get(UID_ALLDAY)
    expect(allDay?.startsAt).toEqual(startOfLocalDayUtc({ ...DAY_ALLDAY, timeZone: TZ }))
    expect(allDay?.endsAt).toEqual(startOfLocalDayUtc({ ...DAY_ALLDAY_END, timeZone: TZ }))
    // Global: the pro cannot be in two places, so it applies at every location.
    expect(allDay?.locationId).toBeNull()
    // User-facing copy — this string is the block's title on the pro calendar.
    expect(allDay?.note).toContain('Vacation - closed')
    expect(allDay?.note).not.toContain('import:')

    // The TZID event became a real IMPORTED booking at the pinned instant.
    const bookings = await importedBookings()
    expect(bookings).toHaveLength(1)
    expect(bookings[0]?.status).toBe(BookingStatus.ACCEPTED)
    expect(bookings[0]?.scheduledFor).toEqual(localHour(DAY_BOOKABLE, 11))
    // The key is scoped per pro (`import:<professionalId>:<uid>`): two pros can
    // share a UID and a client without one's bookmark swallowing the other's.
    expect(bookings[0]?.creationIdempotencyKey).toBe(
      `import:${professionalId}:${UID_BOOKABLE}`,
    )

    // The event that lands on the pro's NATIVE booking is still held — Tori's
    // call, and what overlapPolicy.ts already promises ("held as blocked time
    // for you to review") — and the note says why.
    const collides = byUid.get(UID_ON_NATIVE)
    expect(collides?.startsAt).toEqual(localHour(DAY_NATIVE, 10))
    expect(collides?.note).toContain('Overlaps an existing appointment.')

    // The unmapped event holds its own time with no overlap to report.
    expect(byUid.get(UID_UNMAPPED)?.note).not.toContain('Overlaps')

    // Blocks are written here, not in the write boundary, so the run bumps once.
    expect(cacheVersion.bumpScheduleVersion).toHaveBeenCalledWith(professionalId)

    const subscription = await db.calendarFeedSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { status: true, lastSyncError: true, lastSyncedUids: true },
    })
    expect(subscription.status).toBe(CalendarFeedStatus.ACTIVE)
    expect(subscription.lastSyncError).toBeNull()
    expect(subscription.lastSyncedUids).toEqual(
      expect.arrayContaining([UID_ALLDAY, UID_BOOKABLE, UID_UNMAPPED, UID_ON_NATIVE]),
    )
  }, 120_000)

  it('is idempotent on a second resync of the same feed', async () => {
    serveFeed(fixtureIcs())

    const before = await importedBlocks()
    const summary = await resync()

    expect(summary).toEqual({ scanned: 1, synced: 1, errored: 0 })
    const after = await importedBlocks()
    expect(after.map((b) => b.id).sort()).toEqual(before.map((b) => b.id).sort())
    expect(await importedBookings()).toHaveLength(1)

    // A run that wrote nothing must not evict the pro's warm availability cache
    // — pros resync on a timer ([[cache-is-a-third-query]]).
    expect(cacheVersion.bumpScheduleVersion).not.toHaveBeenCalled()
  }, 120_000)

  it('the migration review page counts these blocks (post-#779 notes carry no tag)', async () => {
    // Read-only against the state the two runs above left. The review summary
    // used to count blocks by `note: { contains: 'import:' }` — case 1 pins
    // that the importer no longer writes that tag, so the old query answered 0
    // for everything on this feed while the blocks sat right there on the
    // calendar.
    const { loadMigrationReviewSummary } = await import('@/lib/migration/migrationReview')
    const summary = await loadMigrationReviewSummary(professionalId)

    expect(summary.importedBlocks).toBe(3)
    expect(summary.importedBookings).toBe(1)
  }, 120_000)

  it('still dedupes after the pro RENAMES the imported block', async () => {
    // The old scheme kept the UID in the note and matched it with `contains`, so
    // this rename orphaned the block: the next resync made a second copy and the
    // deletion reconcile could never find either.
    const [block] = await db.calendarBlock.findMany({
      where: { professionalId, importedEventUid: UID_UNMAPPED },
      select: { id: true },
    })
    expect(block).toBeDefined()
    await db.calendarBlock.update({
      where: { id: block!.id },
      data: { note: 'Massage with Rae — my own note' },
    })

    serveFeed(fixtureIcs())
    await resync()

    const rows = await db.calendarBlock.findMany({
      where: { professionalId, importedEventUid: UID_UNMAPPED },
      select: { id: true, note: true },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.note).toBe('Massage with Rae — my own note')
  }, 120_000)

  it('refuses a duplicate at the database, not just in application code', async () => {
    // The unique index is the backstop for two runs of the same feed racing —
    // an interactive commit while the cron walks it. Only real Postgres can
    // prove the constraint exists.
    await expect(
      db.calendarBlock.create({
        data: {
          professionalId,
          startsAt: localHour(DAY_UNMAPPED, 13),
          endsAt: localHour(DAY_UNMAPPED, 14),
          note: 'a second copy',
          importedEventUid: UID_UNMAPPED,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  }, 120_000)

  it('leaves hand-created blocks unconstrained (NULLs are distinct)', async () => {
    const first = await db.calendarBlock.create({
      data: {
        professionalId,
        startsAt: localHour(localDate(40), 9),
        endsAt: localHour(localDate(40), 10),
        note: 'lunch',
        locationId,
      },
      select: { id: true },
    })
    const second = await db.calendarBlock.create({
      data: {
        professionalId,
        startsAt: localHour(localDate(41), 9),
        endsAt: localHour(localDate(41), 10),
        note: 'dentist',
        locationId,
      },
      select: { id: true },
    })

    expect(first.id).not.toBe(second.id)
    await db.calendarBlock.deleteMany({ where: { id: { in: [first.id, second.id] } } })
  }, 120_000)

  it('reconciles a deletion: removes the block and cancels the pristine booking', async () => {
    serveFeed(fixtureIcs([UID_ALLDAY, UID_BOOKABLE]))

    await resync()

    const remaining = await importedBlocks()
    expect(remaining.map((b) => b.importedEventUid).sort()).toEqual(
      [UID_ON_NATIVE, UID_UNMAPPED].sort(),
    )

    const bookings = await importedBookings()
    expect(bookings).toHaveLength(1)
    expect(bookings[0]?.status).toBe(BookingStatus.CANCELLED)

    // Freed time has to become bookable again.
    expect(cacheVersion.bumpScheduleVersion).toHaveBeenCalledWith(professionalId)
  }, 120_000)

  it('does not resurrect a cancelled imported booking when the event returns', async () => {
    serveFeed(fixtureIcs([UID_ALLDAY]))

    await resync()

    const bookings = await importedBookings()
    expect(bookings).toHaveLength(1)
    // The idempotency key survives the cancel, so the replay finds it and writes
    // nothing — a resync must not undo the reconcile it just performed.
    expect(bookings[0]?.status).toBe(BookingStatus.CANCELLED)
  }, 120_000)

  it('records a fetch failure on the subscription and touches no calendar rows', async () => {
    feed.fetchCalendarFeed.mockResolvedValue({
      ok: false,
      code: 'BLOCKED',
      error: 'That calendar URL is not allowed.',
    })

    const before = await importedBlocks()
    const summary = await resync()

    expect(summary).toEqual({ scanned: 1, synced: 0, errored: 1 })
    expect(await importedBlocks()).toEqual(before)

    const subscription = await db.calendarFeedSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { status: true, lastSyncError: true },
    })
    expect(subscription.status).toBe(CalendarFeedStatus.ERROR)
    expect(subscription.lastSyncError).toContain('BLOCKED')
  }, 120_000)

  it('retries an errored subscription on the next run', async () => {
    serveFeed(fixtureIcs())

    const summary = await resync()

    expect(summary).toEqual({ scanned: 1, synced: 1, errored: 0 })
    const subscription = await db.calendarFeedSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { status: true, lastSyncError: true },
    })
    expect(subscription.status).toBe(CalendarFeedStatus.ACTIVE)
    expect(subscription.lastSyncError).toBeNull()
  }, 120_000)

  it('never disturbs the pro’s native booking', async () => {
    const native = await db.booking.findUniqueOrThrow({
      where: { id: nativeBookingId },
      select: { status: true, scheduledFor: true, source: true },
    })

    expect(native.status).toBe(BookingStatus.ACCEPTED)
    expect(native.scheduledFor).toEqual(localHour(DAY_NATIVE, 10))
    expect(native.source).not.toBe(BookingSource.IMPORTED)
  }, 120_000)
})

// ── the cross-pro idempotency regression ─────────────────────────────────────
//
// OPEN-WORK item 1 (drive run 2): `importKey` used to be `import:<uid>` with no
// professional in it. Client identity matching is GLOBAL by design (one client
// account across all pros), so two pros whose feeds share an event UID AND a
// client — routine when both exports came from the same source app — collapsed
// onto one (clientId, key) replay pair: pro B's import hydrated pro A's booking,
// got mutated:false, and reported the event skipped. Silent data loss reported
// as success.
//
// This drives commitCalendarImport DIRECTLY (no feed subscription), so it shares
// nothing with the resync describe above except the tenant and teardown. The
// shared client is created through upsertProClient itself — the same global
// match path production runs — so the test fails for the RIGHT reason if the
// scoping ever regresses.

describe('cross-pro import: same UID + same client ⇒ each pro gets its own booking', () => {
  const SHARED_UID = `${tag}-shared@google.com`
  // A distinct future day so neither pro's write contends on any unique index
  // the other pro's fixture touches — the ONLY thing under test is the key.
  const DAY_SHARED = localDate(60)

  let sharedClientId = ''

  beforeAll(async () => {
    // The client exists ONCE app-wide; both pros resolve to this same profile
    // through the blind-index email match inside upsertProClient.
    const upserted = await upsertProClient({
      professionalId,
      firstName: 'Shared',
      lastName: 'Client',
      email: `${tag}_shared@example.com`,
    })
    if (!upserted.ok) throw new Error(`fixture: upsertProClient failed`)
    sharedClientId = upserted.clientId

    await db.professionalServiceOffering.create({
      data: {
        professionalId: pro2Id,
        serviceId,
        offersInSalon: true,
        salonDurationMinutes: 60,
        salonPriceStartingAt: new Prisma.Decimal('80.00'),
        isActive: true,
      },
      select: { id: true },
    })
  }, 60_000)

  it('imports the identical event for both pros as two separate bookings', async () => {
    const sharedEvent = [
      {
        uid: SHARED_UID,
        time: {
          anchor: 'INSTANT' as const,
          startUtc: localHour(DAY_SHARED, 11),
          endUtc: localHour(DAY_SHARED, 12),
        },
        summary: SERVICE_NAME,
        attendeeName: 'Shared Client',
        attendeeEmail: `${tag}_shared@example.com`,
        isRecurring: false,
      },
    ]

    const pro1Result = await commitCalendarImport({
      professionalId,
      actorUserId: proUserId,
      events: sharedEvent,
      now: new Date(),
    })
    const pro2Result = await commitCalendarImport({
      professionalId: pro2Id,
      actorUserId: pro2UserId,
      events: sharedEvent,
      now: new Date(),
    })

    expect(pro1Result.created.bookings).toBe(1)
    // THE assertion. Before the fix this was 0 with skipped:1 — pro 2 replayed
    // pro 1's booking off the unscoped key and counted it a skip.
    expect(pro2Result.created.bookings).toBe(1)

    // Scoped to THIS event's keys — both pros also carry other IMPORTED
    // bookings from the resync fixtures above.
    const keys = (
      await db.booking.findMany({
        where: {
          professionalId: { in: [professionalId, pro2Id] },
          source: BookingSource.IMPORTED,
          creationIdempotencyKey: { contains: SHARED_UID },
        },
        select: { professionalId: true, creationIdempotencyKey: true },
      })
    ).map((b) => ({ pro: b.professionalId, key: b.creationIdempotencyKey }))

    expect(keys).toHaveLength(2)
    expect(keys).toContainEqual({
      pro: professionalId,
      key: `import:${professionalId}:${SHARED_UID}`,
    })
    expect(keys).toContainEqual({
      pro: pro2Id,
      key: `import:${pro2Id}:${SHARED_UID}`,
    })

    // And the global-client rule held: ONE client account, TWO bookings.
    const bookingsForClient = await db.booking.count({
      where: {
        clientId: sharedClientId,
        source: BookingSource.IMPORTED,
        status: BookingStatus.ACCEPTED,
      },
    })
    expect(bookingsForClient).toBe(2)
  }, 120_000)

  it('is still idempotent per pro when the same feed replays', async () => {
    const sharedEvent = [
      {
        uid: SHARED_UID,
        time: {
          anchor: 'INSTANT' as const,
          startUtc: localHour(DAY_SHARED, 11),
          endUtc: localHour(DAY_SHARED, 12),
        },
        summary: SERVICE_NAME,
        attendeeName: 'Shared Client',
        attendeeEmail: `${tag}_shared@example.com`,
        isRecurring: false,
      },
    ]
    for (const pro of [professionalId, pro2Id]) {
      const result = await commitCalendarImport({
        professionalId: pro,
        actorUserId: pro === professionalId ? proUserId : pro2UserId,
        events: sharedEvent,
        now: new Date(),
      })
      expect(result.created.bookings).toBe(0)
    }
    expect(
      await db.booking.count({
        where: {
          clientId: sharedClientId,
          source: BookingSource.IMPORTED,
        },
      }),
    ).toBe(2)
  }, 120_000)
})
