// tests/integration/consent-signing.test.ts
//
// K15 — the per-service consent requirement and the client's own signature,
// against real Postgres through the real mint + resolve + record path.
//
// The DoD this suite exists to prove:
//
//   🔴 a token signature lands a record pinned to the version the client
//      ACTUALLY SAW — and publishing a new version between the send and the
//      signature does NOT change which text the record attests to.
//
// RED-PROOF — each was RUN, not reasoned about:
//   * Resolve the version at SIGNING time (`max(version)` off the form — the
//     obvious cheaper design that needs no column) → tests 2 AND 3 fail. Test 2
//     on the record's pointer ("expected <v2 id> to be <v1 id>"), test 3 on the
//     text the page shows ("expected 2 to be 1"). 🔴 Test 1 stays GREEN, which
//     is exactly why the pin needs a test that publishes BETWEEN the send and
//     the signature — asserting the mint alone would have passed the bug.
//   * Drop the UNIQUE on ClientConsentRecord.signatureTokenId (DROP INDEX
//     against the test database) → test 5 fails; the raw second INSERT lands and
//     one link produces two signatures.
//
// K14-B's refusal is red-proved in its own suite, not here: this file asserts a
// database STATE, and a state check cannot fail when a ROUTE stops refusing.
// See app/api/v1/pro/clients/[id]/consent/route.test.ts — deleting the refusal
// turns two of its tests red ("expected 201 to be 400").
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingServiceItemType,
  BookingStatus,
  ClientActionTokenKind,
  ClientConsentKind,
  ConsentProofMethod,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  collectBookingConsentRequirements,
  deriveConsentRequirementBadge,
  loadConsentRequirementsByServiceId,
  loadSignedConsentFormIds,
} from '@/lib/consentForms/requirement'
import {
  createConsentFormWithFirstVersion,
  publishConsentFormVersion,
} from '@/lib/consentForms/publish'
import { createConsentSignatureRequest } from '@/lib/consentForms/signatureRequest'
import {
  recordConsentSignature,
  resolveConsentSignatureTokenForRead,
} from '@/lib/consentForms/signatureTokens'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `consent_sign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const V1_TITLE = 'Corrective colour waiver'
const V1_BODY = 'I understand corrective colour may take several sessions.'
const V2_TITLE = 'Corrective colour waiver (2026)'
const V2_BODY = 'I understand corrective colour may take up to five sessions.'

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  clientId: string
  clientUserId: string
  serviceId: string
  offeringId: string
  addOnServiceId: string
  addOnOfferingId: string
  locationId: string
}

let fx: Fixtures

// ─── Fixtures ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consent signing', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Consent',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: ZONE,
      workingHours: {
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '18:00' },
        sun: { enabled: true, start: '09:00', end: '18:00' },
      },
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Consent',
      lastName: 'Client',
      // A deliverable destination — the mint REFUSES without one.
      email: `${tag}_client@example.com`,
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} colour`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const addOnService = await db.service.create({
    data: {
      name: `${tag} gloss`,
      categoryId: category.id,
      defaultDurationMinutes: 30,
      minPrice: new Prisma.Decimal('20.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      salonDurationMinutes: 60,
      salonPriceStartingAt: new Prisma.Decimal('120.00'),
    },
    select: { id: true },
  })

  const addOnOffering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: addOnService.id,
      isActive: true,
      offersInSalon: true,
      salonDurationMinutes: 30,
      salonPriceStartingAt: new Prisma.Decimal('40.00'),
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: pro.id,
    proUserId: proUser.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    serviceId: service.id,
    offeringId: offering.id,
    addOnServiceId: addOnService.id,
    addOnOfferingId: addOnOffering.id,
    locationId: location.id,
  }
}, 120_000)

afterAll(async () => {
  // 🔴 Resolved by TAG, not from `fx`: a seed that throws half-way leaves rows
  // behind, and an `if (!fx) return` would skip the cleanup that the NEXT run
  // then trips over ([[failed-seed-leaves-orphans-confounds-next-run]]).
  const pros = await db.professionalProfile.findMany({
    where: { businessName: { startsWith: tag } },
    select: { id: true },
  })
  const proIds = pros.map((p) => p.id)
  const users = await db.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)
  const clients = await db.clientProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  })
  const clientIds = clients.map((c) => c.id)

  // Leaf-first: records RESTRICT the versions they point at.
  await db.clientConsentRecord.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.notificationDelivery.deleteMany({
    where: { dispatch: { professionalId: { in: proIds } } },
  })
  await db.notificationDispatch.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientActionToken.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId: { in: proIds } } },
  })
  await db.booking.deleteMany({ where: { professionalId: { in: proIds } } })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.consentFormVersion.deleteMany({
    where: { form: { professionalId: { in: proIds } } },
  })
  await db.consentForm.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalLocation.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await db.service.deleteMany({ where: { name: { startsWith: tag } } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 120_000)

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedForm(): Promise<{ formId: string; v1Id: string }> {
  const created = await createConsentFormWithFirstVersion(db, {
    professionalId: fx.professionalId,
    kind: ClientConsentKind.SERVICE_WAIVER,
    title: V1_TITLE,
    body: V1_BODY,
  })
  return { formId: created.formId, v1Id: created.version.id }
}

// Each booking gets its own hour: the pro-overlap exclusion constraint is real
// in this database, and two fixtures at the same instant collide before the
// test under examination ever runs.
let bookingSlot = 0

async function seedBooking(args?: {
  scheduledFor?: Date
  withAddOn?: boolean
}): Promise<string> {
  bookingSlot += 1
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      scheduledFor:
        args?.scheduledFor ??
        new Date(Date.now() + 3 * DAY_MS + bookingSlot * 2 * HOUR_MS),
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('120.00'),
      totalAmount: new Prisma.Decimal('120.00'),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
    },
    select: { id: true },
  })

  await db.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('120.00'),
      durationMinutesSnapshot: 60,
      sortOrder: 0,
    },
  })

  if (args?.withAddOn) {
    await db.bookingServiceItem.create({
      data: {
        bookingId: booking.id,
        serviceId: fx.addOnServiceId,
        offeringId: fx.addOnOfferingId,
        itemType: BookingServiceItemType.ADD_ON,
        priceSnapshot: new Prisma.Decimal('40.00'),
        durationMinutesSnapshot: 30,
        sortOrder: 1,
      },
    })
  }

  return booking.id
}

/** Mint a signature link the way the pro's route does. */
async function sendSignatureLink(args: {
  formId: string
  bookingId: string
  scheduledFor?: Date
}) {
  return db.$transaction(async (tx) =>
    createConsentSignatureRequest({
      tx,
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      bookingId: args.bookingId,
      formId: args.formId,
      scheduledFor: args.scheduledFor ?? new Date(Date.now() + 3 * DAY_MS),
      recipientEmail: `${tag}_client@example.com`,
      recipientPhone: null,
      professionalName: 'Consent Studio',
    }),
  )
}

/** Sign the way the public route does: resolve the token, then record. */
async function signWithToken(rawToken: string, name = 'Consent Client') {
  return db.$transaction(async (tx) => {
    const resolved = await resolveConsentSignatureTokenForRead({ rawToken, tx })
    return recordConsentSignature({ tx, resolved, signatureName: name })
  })
}

// ─── The pin ─────────────────────────────────────────────────────────────────

describe('the link pins the words it was sent with', () => {
  it('1. minting stores the form’s CURRENT version on the token', async () => {
    const { formId, v1Id } = await seedForm()
    const bookingId = await seedBooking()

    const sent = await sendSignatureLink({ formId, bookingId })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return

    const token = await db.clientActionToken.findUniqueOrThrow({
      where: { id: sent.token.id },
      select: { kind: true, consentFormVersionId: true, singleUse: true },
    })

    expect(token.kind).toBe(ClientActionTokenKind.CONSENT_SIGNATURE)
    expect(token.consentFormVersionId).toBe(v1Id)
    // Not single-use: the client may reopen the link to re-read what they
    // agreed to. One signature is guaranteed by the unique column, not by
    // burning the token.
    expect(token.singleUse).toBe(false)
  })

  it('2. 🔴 publishing v2 between the SEND and the SIGNATURE does not move the record', async () => {
    const { formId, v1Id } = await seedForm()
    const bookingId = await seedBooking()

    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')

    // The pro edits the waiver while the message sits unread.
    const v2 = await publishConsentFormVersion(db, {
      formId,
      title: V2_TITLE,
      body: V2_BODY,
      publishedByProfessionalId: fx.professionalId,
    })
    expect(v2.version).toBe(2)

    const signed = await signWithToken(sent.token.rawToken)
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    const record = await db.clientConsentRecord.findUniqueOrThrow({
      where: { id: signed.recordId },
      select: {
        formVersionId: true,
        formVersion: { select: { version: true, title: true, body: true } },
      },
    })

    expect(record.formVersionId).toBe(v1Id)
    expect(record.formVersion?.version).toBe(1)
    expect(record.formVersion?.title).toBe(V1_TITLE)
    expect(record.formVersion?.body).toBe(V1_BODY)
  })

  it('3. 🔴 the PAGE shows the pinned words too, not the form’s current text', async () => {
    const { formId } = await seedForm()
    const bookingId = await seedBooking()

    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')

    await publishConsentFormVersion(db, {
      formId,
      title: V2_TITLE,
      body: V2_BODY,
      publishedByProfessionalId: fx.professionalId,
    })

    const resolved = await resolveConsentSignatureTokenForRead({
      rawToken: sent.token.rawToken,
    })

    // Showing v2 and recording v1 would be worse than either alone.
    expect(resolved.version.version).toBe(1)
    expect(resolved.version.title).toBe(V1_TITLE)
    expect(resolved.version.body).toBe(V1_BODY)
  })
})

// ─── The signature ───────────────────────────────────────────────────────────

describe('what the signature writes', () => {
  it('4. proofMethod is CLIENT_TOKEN, paired with the link that produced it', async () => {
    const { formId } = await seedForm()
    const bookingId = await seedBooking()
    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')

    const signed = await signWithToken(sent.token.rawToken, '  Amara   Morales ')
    if (!signed.ok) throw new Error('signature refused')

    const record = await db.clientConsentRecord.findUniqueOrThrow({
      where: { id: signed.recordId },
      select: {
        proofMethod: true,
        proofRef: true,
        signatureTokenId: true,
        signedAt: true,
        bookingId: true,
        kind: true,
        professionalId: true,
        clientId: true,
      },
    })

    expect(record.proofMethod).toBe(ConsentProofMethod.CLIENT_TOKEN)
    expect(record.signatureTokenId).toBe(sent.token.id)
    expect(record.signedAt).toBeInstanceOf(Date)
    expect(record.bookingId).toBe(bookingId)
    // The KIND comes from the pinned version's FORM, never from the caller: a
    // record labelled one thing pointing at another thing's words reads as
    // proof of something it isn't.
    expect(record.kind).toBe(ClientConsentKind.SERVICE_WAIVER)
    expect(record.professionalId).toBe(fx.professionalId)
    expect(record.clientId).toBe(fx.clientId)
    // The typed name is the signature — stored as given, whitespace collapsed
    // by the caller's parser (the page and the route share it).
    expect(record.proofRef).toBe('  Amara   Morales ')
  })

  it('5. 🔴 one signature per link, enforced by the DATABASE', async () => {
    const { formId } = await seedForm()
    const bookingId = await seedBooking()
    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')

    const first = await signWithToken(sent.token.rawToken)
    if (!first.ok) throw new Error('first signature refused')

    // The application's own pre-check.
    const second = await signWithToken(sent.token.rawToken)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('ALREADY_SIGNED')

    // And the promise underneath it: a raw INSERT that skips the pre-check
    // entirely — the shape a double-submit race takes — is still refused.
    const resolved = await resolveConsentSignatureTokenForRead({
      rawToken: sent.token.rawToken,
    })
    await expect(
      db.clientConsentRecord.create({
        data: {
          clientId: fx.clientId,
          professionalId: fx.professionalId,
          kind: ClientConsentKind.SERVICE_WAIVER,
          formVersionId: resolved.version.id,
          signedAt: new Date(),
          proofMethod: ConsentProofMethod.CLIENT_TOKEN,
          signatureTokenId: sent.token.id,
        },
      }),
    ).rejects.toThrow()

    const count = await db.clientConsentRecord.count({
      where: { signatureTokenId: sent.token.id },
    })
    expect(count).toBe(1)
  })

  it('6. a re-send revokes the older link for the SAME form, and only that one', async () => {
    const first = await seedForm()
    const second = await createConsentFormWithFirstVersion(db, {
      professionalId: fx.professionalId,
      kind: ClientConsentKind.GENERAL_CONSENT,
      title: `${tag} general consent`,
      body: 'General consent text.',
    })
    const bookingId = await seedBooking()

    const sentA1 = await sendSignatureLink({ formId: first.formId, bookingId })
    const sentB = await sendSignatureLink({ formId: second.formId, bookingId })
    if (!sentA1.ok || !sentB.ok) throw new Error('mint refused')

    const sentA2 = await sendSignatureLink({ formId: first.formId, bookingId })
    if (!sentA2.ok) throw new Error('re-mint refused')

    const [a1, a2, b] = await Promise.all([
      db.clientActionToken.findUniqueOrThrow({
        where: { id: sentA1.token.id },
        select: { revokedAt: true },
      }),
      db.clientActionToken.findUniqueOrThrow({
        where: { id: sentA2.token.id },
        select: { revokedAt: true },
      }),
      db.clientActionToken.findUniqueOrThrow({
        where: { id: sentB.token.id },
        select: { revokedAt: true },
      }),
    ])

    expect(a1.revokedAt).toBeInstanceOf(Date)
    expect(a2.revokedAt).toBeNull()
    // 🔴 A client with two different forms to sign has two live links; killing
    // one when the pro chases the other would strand it.
    expect(b.revokedAt).toBeNull()

    // A revoked link refuses rather than silently signing superseded text.
    await expect(
      resolveConsentSignatureTokenForRead({ rawToken: sentA1.token.rawToken }),
    ).rejects.toThrow()
  })
})

// ─── Refusals — nothing half-sent ────────────────────────────────────────────

describe('the mint refuses rather than half-sending', () => {
  it('7. a retired form, a form with no text, and a client with no contact all refuse — with no token written', async () => {
    const bookingId = await seedBooking()

    const retired = await seedForm()
    await db.consentForm.update({
      where: { id: retired.formId },
      data: { isActive: false },
    })

    const emptyForm = await db.consentForm.create({
      data: {
        professionalId: fx.professionalId,
        kind: ClientConsentKind.SERVICE_WAIVER,
      },
      select: { id: true },
    })

    const usable = await seedForm()

    const before = await db.clientActionToken.count({
      where: {
        professionalId: fx.professionalId,
        kind: ClientActionTokenKind.CONSENT_SIGNATURE,
      },
    })

    const retiredResult = await sendSignatureLink({
      formId: retired.formId,
      bookingId,
    })
    expect(retiredResult.ok).toBe(false)
    if (!retiredResult.ok) expect(retiredResult.code).toBe('FORM_RETIRED')

    const emptyResult = await sendSignatureLink({
      formId: emptyForm.id,
      bookingId,
    })
    expect(emptyResult.ok).toBe(false)
    if (!emptyResult.ok) expect(emptyResult.code).toBe('FORM_HAS_NO_TEXT')

    const notFound = await sendSignatureLink({ formId: 'nope', bookingId })
    expect(notFound.ok).toBe(false)
    if (!notFound.ok) expect(notFound.code).toBe('FORM_NOT_FOUND')

    const noContact = await db.$transaction(async (tx) =>
      createConsentSignatureRequest({
        tx,
        professionalId: fx.professionalId,
        clientId: fx.clientId,
        bookingId,
        formId: usable.formId,
        scheduledFor: new Date(Date.now() + DAY_MS),
        recipientEmail: null,
        recipientPhone: null,
        professionalName: 'Consent Studio',
      }),
    )
    expect(noContact.ok).toBe(false)
    if (!noContact.ok) expect(noContact.code).toBe('NO_DELIVERABLE_CONTACT')

    const after = await db.clientActionToken.count({
      where: {
        professionalId: fx.professionalId,
        kind: ClientActionTokenKind.CONSENT_SIGNATURE,
      },
    })
    expect(after).toBe(before)
  })
})

// ─── K14-B: the proof method now means something ─────────────────────────────

describe('CLIENT_TOKEN is no longer a claim anyone can type', () => {
  it('8. every CLIENT_TOKEN record in the database carries a signature token', async () => {
    const { formId } = await seedForm()
    const bookingId = await seedBooking()
    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')
    await signWithToken(sent.token.rawToken)

    const claimed = await db.clientConsentRecord.count({
      where: {
        professionalId: fx.professionalId,
        proofMethod: ConsentProofMethod.CLIENT_TOKEN,
        signatureTokenId: null,
      },
    })

    // The pro's own route refuses proofMethod=CLIENT_TOKEN outright, so the
    // only producer left is the signing route — which always sets the pair.
    expect(claimed).toBe(0)

    const witnessed = await db.clientConsentRecord.count({
      where: {
        professionalId: fx.professionalId,
        proofMethod: ConsentProofMethod.CLIENT_TOKEN,
        signatureTokenId: { not: null },
      },
    })
    expect(witnessed).toBeGreaterThan(0)
  })
})

// ─── The requirement, end to end ─────────────────────────────────────────────

describe('the requirement warns until it is satisfied', () => {
  it('9. an unsigned requirement warns; the signature clears it', async () => {
    const { formId } = await seedForm()
    const bookingId = await seedBooking()

    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { consentFormId: formId },
    })

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        serviceId: true,
        scheduledFor: true,
        finishedAt: true,
        serviceItems: { select: { serviceId: true } },
      },
    })

    const byServiceId = await loadConsentRequirementsByServiceId({
      db,
      professionalId: fx.professionalId,
    })
    const required = collectBookingConsentRequirements(booking, byServiceId)
    expect(required.map((r) => r.formId)).toContain(formId)

    const now = new Date()
    const before = await loadSignedConsentFormIds({
      db,
      professionalId: fx.professionalId,
      clientIds: [fx.clientId],
      formIds: [formId],
      now,
    })
    expect(before.get(fx.clientId)?.has(formId) ?? false).toBe(false)

    const warned = deriveConsentRequirementBadge({
      unsigned: required,
      finishedAt: booking.finishedAt,
      scheduledFor: booking.scheduledFor,
      now,
    })
    expect(warned?.significant).toBe(true)
    expect(warned?.description).toBe(`${V1_TITLE} not signed`)

    // Now the client signs.
    const sent = await sendSignatureLink({ formId, bookingId })
    if (!sent.ok) throw new Error('mint refused')
    const signed = await signWithToken(sent.token.rawToken)
    expect(signed.ok).toBe(true)

    const after = await loadSignedConsentFormIds({
      db,
      professionalId: fx.professionalId,
      clientIds: [fx.clientId],
      formIds: [formId],
      now: new Date(),
    })
    expect(after.get(fx.clientId)?.has(formId)).toBe(true)

    const cleared = deriveConsentRequirementBadge({
      unsigned: required.filter(
        (r) => !(after.get(fx.clientId)?.has(r.formId) ?? false),
      ),
      finishedAt: booking.finishedAt,
      scheduledFor: booking.scheduledFor,
      now: new Date(),
    })
    expect(cleared).toBeNull()

    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { consentFormId: null },
    })
  })

  it('10. 🔴 an EXPIRED consent goes back to warning — that is what validUntil means', async () => {
    const { formId, v1Id } = await seedForm()

    const record = await db.clientConsentRecord.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        kind: ClientConsentKind.SERVICE_WAIVER,
        formVersionId: v1Id,
        signedAt: new Date(Date.now() - 400 * DAY_MS),
        proofMethod: ConsentProofMethod.IN_PERSON,
        validUntil: new Date(Date.now() - DAY_MS),
      },
      select: { id: true },
    })

    const signed = await loadSignedConsentFormIds({
      db,
      professionalId: fx.professionalId,
      clientIds: [fx.clientId],
      formIds: [formId],
      now: new Date(),
    })
    expect(signed.get(fx.clientId)?.has(formId) ?? false).toBe(false)

    // Still current → counts.
    await db.clientConsentRecord.update({
      where: { id: record.id },
      data: { validUntil: new Date(Date.now() + DAY_MS) },
    })
    const stillValid = await loadSignedConsentFormIds({
      db,
      professionalId: fx.professionalId,
      clientIds: [fx.clientId],
      formIds: [formId],
      now: new Date(),
    })
    expect(stillValid.get(fx.clientId)?.has(formId)).toBe(true)
  })

  it('11. 🔴 the requirement does NOT block: a booking for the service still writes', async () => {
    const { formId } = await seedForm()
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { consentFormId: formId },
    })

    // No signature exists for this form. If any constraint, trigger or default
    // had been added to enforce the requirement, this create would fail.
    const bookingId = await seedBooking({ withAddOn: true })
    const stored = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true },
    })
    expect(stored.status).toBe(BookingStatus.ACCEPTED)

    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { consentFormId: null },
    })
  })

  it('12. an ADD-ON’s own requirement is collected, not just the base service’s', async () => {
    const addOnForm = await createConsentFormWithFirstVersion(db, {
      professionalId: fx.professionalId,
      kind: ClientConsentKind.PATCH_TEST,
      title: `${tag} patch test`,
      body: 'Patch test consent.',
    })

    await db.professionalServiceOffering.update({
      where: { id: fx.addOnOfferingId },
      data: { consentFormId: addOnForm.formId },
    })

    const bookingId = await seedBooking({ withAddOn: true })
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        serviceId: true,
        serviceItems: { select: { serviceId: true } },
      },
    })

    const byServiceId = await loadConsentRequirementsByServiceId({
      db,
      professionalId: fx.professionalId,
    })
    const required = collectBookingConsentRequirements(booking, byServiceId)

    expect(required.map((r) => r.formId)).toContain(addOnForm.formId)

    await db.professionalServiceOffering.update({
      where: { id: fx.addOnOfferingId },
      data: { consentFormId: null },
    })
  })
})
