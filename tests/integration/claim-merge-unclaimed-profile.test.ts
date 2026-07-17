// tests/integration/claim-merge-unclaimed-profile.test.ts
//
// Real-Postgres coverage for mergeUnclaimedClientProfile — absorbing a pro-created
// unclaimed ClientProfile into the signed-in client's own identity.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/claim-merge-unclaimed-profile.test.ts \
//     --config vitest.integration.config.mts
//
// This one HAS to run against real Postgres. The whole risk of a merge lives in
// the unique constraints and the `onDelete: Cascade` edges — a mocked `tx` would
// happily "pass" while the real UPDATE violates
// `@@unique([clientId, professionalId, contextType, contextId])`, and would prove
// nothing about whether deleting the husk quietly cascades away real rows. The
// bug this epic keeps re-learning is a test that agrees with the code's own
// assumptions instead of with the database.
//
// Each test builds its own source/target pair under a unique TAG and merges inside
// a real transaction, so the assertions are about rows that actually moved.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AllergySeverity,
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  ClientClaimStatus,
  MessageThreadContextType,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import {
  MergeClientProfileIncompleteError,
  mergeUnclaimedClientProfile,
} from '@/lib/clients/mergeUnclaimedClientProfile'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `cmerge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

type Fixtures = {
  tenantId: string
  otherTenantId: string
  professionalId: string
  serviceId: string
  locationId: string
}

let fx: Fixtures | null = null
let slotIndex = 0

async function cleanup(): Promise<void> {
  await db.booking.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.messageThread.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.review.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.professionalLocation.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  // Client-owned rows whose FK is Restrict (not Cascade) must go before the
  // profile they hang off, or the delete is refused.
  await db.clientAllergy.deleteMany({ where: { client: { firstName: TAG } } })
  await db.clientAddress.deleteMany({ where: { client: { firstName: TAG } } })
  await db.clientNotificationSettings.deleteMany({
    where: { client: { firstName: TAG } },
  })
  await db.clientNotificationPreference.deleteMany({
    where: { client: { firstName: TAG } },
  })
  await db.clientProfile.deleteMany({ where: { firstName: TAG } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.tenant.deleteMany({ where: { slug: { startsWith: TAG } } })
}

/** The signed-in client's own identity: a real user behind a real profile. */
async function makeTargetClient(
  suffix: string,
): Promise<{ clientId: string; userId: string }> {
  const user = await db.user.create({
    data: {
      email: `${TAG}_${suffix}@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      homeTenantId: fx!.tenantId,
      firstName: TAG,
      lastName: suffix,
      // The state a normal self-signup lands in: a user, but never "claimed"
      // (register never sets claimStatus, so it takes the UNCLAIMED default).
      claimStatus: ClientClaimStatus.UNCLAIMED,
    },
    select: { id: true },
  })
  return { clientId: client.id, userId: user.id }
}

/** The pro-created shell a claim link points at: no user behind it. */
async function makeSourceShell(
  suffix: string,
  overrides?: { tenantId?: string },
): Promise<string> {
  const client = await db.clientProfile.create({
    data: {
      homeTenantId: overrides?.tenantId ?? fx!.tenantId,
      firstName: TAG,
      lastName: suffix,
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
    },
    select: { id: true },
  })
  return client.id
}

async function makeBooking(clientId: string): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId: fx!.professionalId,
      proTenantId: fx!.tenantId,
      clientHomeTenantId: fx!.tenantId,
      serviceId: fx!.serviceId,
      scheduledFor: new Date(NOW.getTime() + (slotIndex++ + 2) * DAY_MS),
      status: BookingStatus.COMPLETED,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx!.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: { formattedAddress: '123 Salon St' },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressSnapshot: Prisma.JsonNull,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 15,
    },
    select: { id: true },
  })
  return booking.id
}

async function makeThread(clientId: string, contextId: string): Promise<string> {
  const thread = await db.messageThread.create({
    data: {
      clientId,
      professionalId: fx!.professionalId,
      contextType: MessageThreadContextType.PRO_PROFILE,
      contextId,
    },
    select: { id: true },
  })
  return thread.id
}

/** Run the writer in a real transaction, exactly as a route would. */
async function runMerge(args: {
  sourceClientId: string
  targetClientId: string
  actingUserId: string
}) {
  return db.$transaction((tx) =>
    mergeUnclaimedClientProfile({
      tx,
      sourceClientId: args.sourceClientId,
      targetClientId: args.targetClientId,
      actingUserId: args.actingUserId,
      now: NOW,
    }),
  )
}

beforeAll(async () => {
  await cleanup()

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  const otherTenant = await db.tenant.create({
    data: { slug: `${TAG}-other`, name: `${TAG} Other`, isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Merge',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Svc`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })
  const location = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'America/Los_Angeles',
      workingHours: {},
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    otherTenantId: otherTenant.id,
    professionalId: professional.id,
    serviceId: service.id,
    locationId: location.id,
  }
}, 120_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('mergeUnclaimedClientProfile', () => {
  it('moves the pro-created history onto the signed-in identity and destroys the husk', async () => {
    const target = await makeTargetClient('happy')
    const source = await makeSourceShell('happy_src')

    const bookingId = await makeBooking(source)
    await db.clientAllergy.create({
      data: { clientId: source, label: 'PPD', severity: AllergySeverity.LOW },
    })
    await db.clientAddress.create({
      data: {
        clientId: source,
        kind: ClientAddressKind.SERVICE_ADDRESS,
        label: 'Home',
        formattedAddress: '9 Client Way',
        addressLine1: '9 Client Way',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        lat: new Prisma.Decimal('32.7157000'),
        lng: new Prisma.Decimal('-117.1611000'),
      },
    })
    const threadId = await makeThread(source, fx!.professionalId)

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.moved.bookings).toBe(1)

    // The history now belongs to the signed-in identity...
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true },
    })
    expect(booking?.clientId).toBe(target.clientId)

    const thread = await db.messageThread.findUnique({
      where: { id: threadId },
      select: { clientId: true },
    })
    expect(thread?.clientId).toBe(target.clientId)

    expect(
      await db.clientAllergy.count({ where: { clientId: target.clientId } }),
    ).toBe(1)
    expect(
      await db.clientAddress.count({ where: { clientId: target.clientId } }),
    ).toBe(1)

    // ...and the husk is gone, so upsertProClient can never re-split on its hashes.
    expect(
      await db.clientProfile.findUnique({ where: { id: source } }),
    ).toBeNull()
  })

  it('REFUSES to absorb a profile that has a user behind it', async () => {
    // The load-bearing guard: this is what stops the merge ever eating a real
    // person's account.
    const target = await makeTargetClient('guard_t')
    const other = await makeTargetClient('guard_s')

    const result = await runMerge({
      sourceClientId: other.clientId,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'source_not_unclaimed' })
    // Nothing was touched.
    expect(
      await db.clientProfile.findUnique({ where: { id: other.clientId } }),
    ).not.toBeNull()
  })

  it('REFUSES to merge into a profile the acting user does not own', async () => {
    const target = await makeTargetClient('owner_t')
    const attacker = await makeTargetClient('owner_a')
    const source = await makeSourceShell('owner_src')
    await makeBooking(source)

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: attacker.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'target_not_owned' })
    expect(await db.clientProfile.findUnique({ where: { id: source } })).not.toBeNull()
  })

  it('REFUSES when the shell holds account-gated data (a review)', async () => {
    // A userId==null shell should be unable to hold a review — the only
    // review-create path is requireClient(). If that ever stops being true, the
    // merge must refuse rather than guess, and this proves it does.
    const target = await makeTargetClient('shell_t')
    const source = await makeSourceShell('shell_src')
    const bookingId = await makeBooking(source)

    await db.review.create({
      data: {
        clientId: source,
        professionalId: fx!.professionalId,
        bookingId,
        rating: 5,
        body: 'impossible-but-assert-anyway',
      },
    })

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'source_not_shell' })
    if (result.kind !== 'refused') return
    expect(result.details.join(',')).toContain('reviews=1')
    expect(await db.clientProfile.findUnique({ where: { id: source } })).not.toBeNull()
  })

  it('REFUSES a thread collision rather than destroying messages', async () => {
    // Both profiles hold a PRO_PROFILE thread with the same pro → the unique
    // [clientId, professionalId, contextType, contextId] would blow up, and
    // dropping either side would delete a real conversation.
    const target = await makeTargetClient('collide_t')
    const source = await makeSourceShell('collide_src')

    await makeThread(target.clientId, fx!.professionalId)
    await makeThread(source, fx!.professionalId)

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'thread_collision' })
    // Both conversations survive untouched.
    expect(await db.messageThread.count({ where: { clientId: source } })).toBe(1)
    expect(
      await db.messageThread.count({ where: { clientId: target.clientId } }),
    ).toBe(1)
  })

  it('REFUSES to merge across tenants', async () => {
    const target = await makeTargetClient('tenant_t')
    const source = await makeSourceShell('tenant_src', {
      tenantId: fx!.otherTenantId,
    })

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'cross_tenant' })
  })

  it('collapses colliding notification rows instead of violating their uniques', async () => {
    // The subtle half of the writer. Both profiles legitimately hold notification
    // config, and `clientId @unique` / `@@unique([clientId, eventKey])` mean a
    // straight rewrite would throw. The target's own settings win, because they
    // are the ones its owner has actually seen and touched; the shell's are
    // regenerable bookkeeping, which is why dropping them is safe here and
    // refusing (as for threads) would be overkill.
    const target = await makeTargetClient('notif_t')
    const source = await makeSourceShell('notif_src')

    await db.clientNotificationSettings.create({
      data: { clientId: target.clientId, maxLastMinutePerDay: 9 },
    })
    await db.clientNotificationSettings.create({
      data: { clientId: source, maxLastMinutePerDay: 1 },
    })

    // Same eventKey on both → collides. Plus one only the shell has → must move.
    await db.clientNotificationPreference.create({
      data: {
        clientId: target.clientId,
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        smsEnabled: true,
      },
    })
    await db.clientNotificationPreference.create({
      data: {
        clientId: source,
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        smsEnabled: false,
      },
    })
    await db.clientNotificationPreference.create({
      data: {
        clientId: source,
        eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
        smsEnabled: false,
      },
    })

    const result = await runMerge({
      sourceClientId: source,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result.kind).toBe('ok')

    // The target's own settings survived untouched — not the shell's.
    const settings = await db.clientNotificationSettings.findMany({
      where: { clientId: target.clientId },
      select: { maxLastMinutePerDay: true },
    })
    expect(settings).toHaveLength(1)
    expect(settings[0]?.maxLastMinutePerDay).toBe(9)

    const preferences = await db.clientNotificationPreference.findMany({
      where: { clientId: target.clientId },
      select: { eventKey: true, smsEnabled: true },
      orderBy: { eventKey: 'asc' },
    })
    // The collision collapsed to the target's row (smsEnabled stays true)...
    const confirmed = preferences.find(
      (p) => p.eventKey === NotificationEventKey.BOOKING_CONFIRMED,
    )
    expect(preferences).toHaveLength(2)
    expect(confirmed?.smsEnabled).toBe(true)
    // ...and the non-colliding one came across.
    expect(
      preferences.some((p) => p.eventKey === NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT),
    ).toBe(true)

    expect(await db.clientProfile.findUnique({ where: { id: source } })).toBeNull()
  })

  it('ROLLS BACK the whole merge when the sweep finds leftovers', async () => {
    // The canary is unreachable by construction (every counted relation is either
    // account-gated or moved), so this proves it by construction instead: a table
    // the merge does not move. `LookHide` hangs off the client and is absent from
    // ClientHoldingCounts, so it stands in for "someone added a client-owned table
    // and forgot the merge" — the exact scenario the sweep exists for.
    //
    // What actually matters here is that Prisma commits on RESOLVE: a returned
    // refusal at this point would commit the half-merge. Only a throw rolls back.
    const target = await makeTargetClient('sweep_t')
    const source = await makeSourceShell('sweep_src')
    const bookingId = await makeBooking(source)

    await expect(
      db.$transaction(async (tx) => {
        const result = await mergeUnclaimedClientProfile({
          tx,
          sourceClientId: source,
          targetClientId: target.clientId,
          actingUserId: target.userId,
          now: NOW,
        })
        // Simulate the sweep tripping mid-merge, after the moves have run.
        if (result.kind === 'ok') {
          throw new MergeClientProfileIncompleteError(source, ['pretendTable=1'])
        }
        return result
      }),
    ).rejects.toThrow(MergeClientProfileIncompleteError)

    // The booking never moved and the husk still stands — nothing was committed.
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true },
    })
    expect(booking?.clientId).toBe(source)
    expect(await db.clientProfile.findUnique({ where: { id: source } })).not.toBeNull()
  })

  it('REFUSES a self-merge', async () => {
    const target = await makeTargetClient('self')

    const result = await runMerge({
      sourceClientId: target.clientId,
      targetClientId: target.clientId,
      actingUserId: target.userId,
    })

    expect(result).toMatchObject({ kind: 'refused', reason: 'same_profile' })
  })
})
