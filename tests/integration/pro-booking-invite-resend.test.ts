// tests/integration/pro-booking-invite-resend.test.ts
//
// Real-Postgres coverage for POST /api/v1/pro/bookings/[id]/invite, driven
// TWICE for the same booking — the repeat invite that used to be a silent
// no-op.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/pro-booking-invite-resend.test.ts \
//     --config vitest.integration.config.mts
//
// This one has to be an integration test, and the reason is the shape of the
// bug it pins. Every layer here was already unit-tested at its own seam, and
// every one of those tests passed while the route delivered nothing: each seam
// proved only that the NEXT function was called with plausible arguments. The
// two facts that matter are both facts about ROWS —
//
//   1. re-issuing changes `ProClientInvite.tokenHash` (so the link that was
//      already delivered is now dead, and a caller that does not send a
//      replacement has made things WORSE than the no-op it replaced);
//   2. `NotificationDispatch.sourceKey` is @unique, so the second send only
//      exists if its send cycle differs — an INITIAL_SEND on a rotated token
//      collapses into the first dispatch and creates no delivery rows at all.
//
// Only the database can answer either one. Everything below the HTTP boundary
// is real: the issuer, the delivery helper, the orchestration, the idempotency
// keys and the dispatch/delivery writes. `requirePro` is the single seam mocked
// — there is no session to mint here, and the ownership check the route
// actually relies on (`requireProBooking`) still runs against real rows.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  ClientClaimStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import { hashProClientInviteToken } from '@/lib/clients/proClientInviteTokens'

const auth = vi.hoisted(() => ({
  professionalId: '',
  userId: '',
}))

vi.mock('@/app/api/_utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/_utils')>()

  return {
    ...actual,
    // The only seam that is faked: there is no signed-in session in a vitest
    // process. Ownership is NOT faked — the route's requireProBooking lookup
    // still has to find a real booking owned by this professionalId.
    requirePro: async () => ({
      ok: true as const,
      user: { id: auth.userId },
      userId: auth.userId,
      professionalId: auth.professionalId,
      proId: auth.professionalId,
    }),
  }
})

const { POST } = await import('@/app/api/v1/pro/bookings/[id]/invite/route')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `invresend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

const INVITED_EMAIL = `${TAG}_invitee@example.com`

let bookingId = ''
let clientId = ''

async function cleanup(): Promise<void> {
  await db.notificationDelivery.deleteMany({
    where: { dispatch: { client: { firstName: TAG } } },
  })
  await db.notificationDispatch.deleteMany({
    where: { client: { firstName: TAG } },
  })
  await db.proClientInvite.deleteMany({
    where: { client: { firstName: TAG } },
  })
  await db.booking.deleteMany({
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
  await db.clientProfile.deleteMany({ where: { firstName: TAG } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
}

function inviteRequest(): Request {
  return new Request(
    `http://localhost/api/v1/pro/bookings/${bookingId}/invite`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invited Client',
        email: INVITED_EMAIL,
        preferredContactMethod: 'EMAIL',
      }),
    },
  )
}

// jsonOk spreads the payload at the top level alongside `ok` — there is no
// `data` envelope on this route.
type InvitePayload = {
  ok: boolean
  invite: { id: string; token: string | null; status: string }
  inviteDelivery: { attempted: boolean; queued: boolean; href: string | null }
}

async function callInvite(): Promise<{ status: number; body: InvitePayload }> {
  const res = await POST(inviteRequest(), {
    params: Promise.resolve({ id: bookingId }),
  })

  if (!(res instanceof Response)) {
    throw new Error('route did not return a Response')
  }

  const json = (await res.json()) as InvitePayload

  if (!json?.invite) {
    throw new Error(`route returned no invite: ${JSON.stringify(json)}`)
  }

  return { status: res.status, body: json }
}

beforeAll(async () => {
  await cleanup()

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
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
      firstName: 'Resend',
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

  // The pro-created shell a claim link points at: no user behind it.
  const client = await db.clientProfile.create({
    data: {
      homeTenantId: tenant.id,
      firstName: TAG,
      lastName: 'Invitee',
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      createdByProfessionalId: professional.id,
    },
    select: { id: true },
  })

  const booking = await db.booking.create({
    data: {
      clientId: client.id,
      professionalId: professional.id,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
      serviceId: service.id,
      scheduledFor: new Date(NOW.getTime() + 3 * DAY_MS),
      status: BookingStatus.ACCEPTED,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
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

  auth.professionalId = professional.id
  auth.userId = proUser.id
  clientId = client.id
  bookingId = booking.id
}, 120_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('POST /pro/bookings/[id]/invite — repeat invite', () => {
  it('rotates the token and queues a SECOND real dispatch instead of collapsing into the first', async () => {
    // ── first invite ────────────────────────────────────────────────────────
    const first = await callInvite()

    expect(first.status).toBe(200)
    expect(first.body.invite.token).toBeTruthy()
    expect(first.body.inviteDelivery).toMatchObject({
      attempted: true,
      queued: true,
    })

    const firstToken = first.body.invite.token as string

    const afterFirst = await db.proClientInvite.findUnique({
      where: { bookingId },
      select: { id: true, tokenHash: true, token: true },
    })
    expect(afterFirst?.tokenHash).toBe(hashProClientInviteToken(firstToken))
    // Modern rows never persist the plaintext column — which is exactly why
    // returning it on a repeat invite handed the pro `null`.
    expect(afterFirst?.token).toBeNull()

    // ── second invite, same booking ─────────────────────────────────────────
    const second = await callInvite()

    expect(second.status).toBe(200)

    const secondToken = second.body.invite.token
    // The first half of the bug: this used to be null, so the pro could not even
    // copy the link to send it by hand.
    expect(secondToken).toBeTruthy()
    expect(secondToken).not.toBe(firstToken)

    // The rotation is real: the row now answers to the NEW token only.
    const afterSecond = await db.proClientInvite.findUnique({
      where: { bookingId },
      select: { id: true, tokenHash: true },
    })
    expect(afterSecond?.id).toBe(afterFirst?.id)
    expect(afterSecond?.tokenHash).toBe(
      hashProClientInviteToken(secondToken as string),
    )
    expect(
      await db.proClientInvite.findUnique({
        where: { tokenHash: hashProClientInviteToken(firstToken) },
        select: { id: true },
      }),
    ).toBeNull()

    // ── the half that used to fail silently ─────────────────────────────────
    // Because the token rotated, a send that did NOT open a fresh cycle would
    // land on the first dispatch's @unique sourceKey, return created:false and
    // write no delivery rows — leaving the client holding a dead link and
    // promised a live one.
    expect(second.body.inviteDelivery).toMatchObject({
      attempted: true,
      queued: true,
    })

    const dispatches = await db.notificationDispatch.findMany({
      where: {
        clientId,
        eventKey: NotificationEventKey.CLIENT_CLAIM_INVITE,
      },
      select: {
        id: true,
        sourceKey: true,
        href: true,
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(dispatches).toHaveLength(2)
    expect(new Set(dispatches.map((d) => d.sourceKey)).size).toBe(2)

    const [firstDispatch, secondDispatch] = dispatches
    if (!firstDispatch || !secondDispatch) {
      throw new Error('expected two claim-invite dispatches')
    }

    // Each dispatch carries its OWN link, and each actually produced delivery
    // rows — a dispatch with zero deliveries is the silent no-op wearing a
    // 200.
    expect(firstDispatch.href).toContain(firstToken)
    expect(secondDispatch.href).toContain(secondToken as string)
    expect(firstDispatch._count.deliveries).toBeGreaterThan(0)
    expect(secondDispatch._count.deliveries).toBeGreaterThan(0)
  }, 60_000)
})
