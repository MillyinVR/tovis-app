// tests/integration/social-signup-completion.test.ts
//
// Real-Postgres coverage for POST /api/v1/auth/social/complete — the second
// half of a two-phase social signup, driven end-to-end against real rows.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/social-signup-completion.test.ts \
//     --config vitest.integration.config.mts
//
// ── Why this has to be an integration test ─────────────────────────────────
//
// The bug it closes was invisible to every seam test that could have caught
// it. `findOrCreate{Google,Apple}User` did the right-looking thing at its own
// boundary — look up a User by email hash, miss, create one — and the failure
// only existed in the DATABASE: `ClientProfile.emailHashV2` is @unique, a pro
// who has already booked someone owns an UNCLAIMED profile holding that hash,
// and the nested create therefore raised P2002 and returned a bare 500. A
// mocked Prisma agrees with the code's assumptions; only Postgres knows about
// the constraint. Both route suites mocked the helper wholesale, so nothing
// executed the collision at all.
//
// So the assertions here are about ROWS: which ClientProfile the account ends
// up owning, how many exist for that email hash, whether the password column is
// null, whether consent was recorded. And the headline case is proved to fail
// two ways — see its comment.
//
// ── What is faked, and what is deliberately not ────────────────────────────
//
// Faked: outbound delivery (`sendRegistrationVerifications`, and the claim
// link's send) — there is no Twilio or Postmark here, and neither is the
// subject. Rate limits, because they are not what is under test and a
// redis-less limiter fails open anyway, which would prove nothing either way.
// The tenant request context, so the ticket's tenant can be told apart from the
// request's.
//
// NOT faked: the ticket (real rows, real single-use consumption), the whole
// creation transaction, claim adoption, the self-serve claim DETECTION, the
// contact hashing and encryption, and the unique constraints that are the
// entire point.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ClientClaimStatus,
  ContactMethod,
  PrismaClient,
  ProClientInviteStatus,
  Role,
  VerificationStatus,
  type SocialAuthProvider,
} from '@prisma/client'

vi.hoisted(() => {
  // lib/auth reads JWT_SECRET at module load and ESM imports hoist above plain
  // statements, so this cannot be at file scope.
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
  process.env.TOVIS_TOS_VERSION ||= '2026-04'
})

const tenantMock = vi.hoisted(() => ({ tenantId: '' }))
const sends = vi.hoisted(() => ({
  registrationVerifications: [] as unknown[],
  claimLinks: [] as unknown[],
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  rateLimitIdentity: vi.fn(async () => ({ kind: 'ip', id: '203.0.113.1' })),
  enforceRateLimit: vi.fn(async () => null),
  phoneRateLimitIdentity: vi.fn(() => ({ kind: 'phone', id: 'p' })),
}))

vi.mock('@vercel/functions', () => ({
  // The route hands the tail to waitUntil and returns; outside a Vercel runtime
  // there is nothing to register it with, so run it and swallow — the tail is
  // best-effort by contract.
  waitUntil: (p: Promise<unknown>) => {
    void Promise.resolve(p).catch(() => null)
  },
}))

vi.mock('@/lib/auth/registration/sendRegistrationVerifications', () => ({
  sendRegistrationVerifications: vi.fn(async (args: unknown) => {
    sends.registrationVerifications.push(args)
  }),
}))

vi.mock('@/lib/clients/selfServeClaim', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/clients/selfServeClaim')>()
  return {
    ...actual,
    // Detection stays REAL — it is what decides whether a colliding account
    // would have been created. Only the outbound message is faked.
    sendSelfServeClaimLink: vi.fn(async (args: unknown) => {
      sends.claimLinks.push(args)
      return { sent: true }
    }),
  }
})

vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    tenantId: tenantMock.tenantId,
  })),
}))

const { POST } = await import('@/app/api/v1/auth/social/complete/route')
const { createSocialSignupTicket } = await import(
  '@/lib/auth/socialSignupTicket'
)
const { upsertProClient } = await import('@/lib/clients/upsertProClient')
const { createProClientInviteToken, hashProClientInviteToken } = await import(
  '@/lib/clients/proClientInviteTokens'
)
const { emailLookupHashV2 } = await import('@/lib/security/crypto/hashLookup')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `socomp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let emailCounter = 0
const nextEmail = (label: string) =>
  `${TAG}_${label}_${(emailCounter += 1)}@example.com`

let subjectCounter = 0
const nextSubject = (label: string) =>
  `${TAG}-${label}-${(subjectCounter += 1)}`

// Distinct US numbers per test; the SMS country policy is real and rejects
// anything it does not recognise as a US destination.
// Handles are 3–24 chars of [a-z0-9-], globally unique, and must start and end
// alphanumeric. Unique per CALL: two tests deriving one handle from TAG collide
// on whichever runs second, which shows up as a pass in isolation and a failure
// in the file — the worst way to find out.
let handleCounter = 0
const nextHandle = () =>
  // Counter FIRST. Appending it and then slicing to 24 truncates the counter
  // itself off — the TAG alone is already 25 chars — so every call returned the
  // same handle and the second pro signup hit HANDLE_IN_USE.
  `h${(handleCounter += 1)}${TAG.replace(/[^a-z0-9]/g, '')}`.slice(0, 24)

let phoneCounter = 0
const nextPhone = () =>
  `+1415555${String(1000 + (phoneCounter += 1)).slice(0, 4)}`

let tenantId = ''
let otherTenantId = ''
let professionalId = ''

const CLIENT_ZIP = {
  kind: 'CLIENT_ZIP' as const,
  postalCode: '94110',
  city: 'San Francisco',
  state: 'CA',
  countryCode: 'US',
  lat: 37.7484,
  lng: -122.4156,
  timeZoneId: 'America/Los_Angeles',
}

const PRO_MOBILE = {
  kind: 'PRO_MOBILE' as const,
  postalCode: '94110',
  lat: 37.7484,
  lng: -122.4156,
  timeZoneId: 'America/Los_Angeles',
}

function req(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/auth/social/complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'app.tovis.app',
      'x-forwarded-for': '203.0.113.7',
      'user-agent': 'integration-suite/1.0',
    },
    body: JSON.stringify(body),
  })
}

async function issueTicket(args: {
  email: string
  provider?: SocialAuthProvider
  subject?: string
  tenantId?: string
  firstName?: string | null
  lastName?: string | null
  now?: Date
}) {
  return createSocialSignupTicket({
    provider: args.provider ?? 'GOOGLE',
    subject: args.subject ?? nextSubject('sub'),
    email: args.email,
    firstName: args.firstName ?? 'Ada',
    lastName: args.lastName ?? 'Lovelace',
    tenantId: args.tenantId ?? tenantId,
    now: args.now,
  })
}

/** A valid CLIENT completion body; individual tests override what they probe. */
function clientBody(signupTicket: string, overrides: Record<string, unknown> = {}) {
  return {
    signupTicket,
    role: 'CLIENT',
    phone: nextPhone(),
    tosAccepted: true,
    transactionalSmsConsent: true,
    signupLocation: CLIENT_ZIP,
    ...overrides,
  }
}

async function cleanup() {
  const ourUsers = await db.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  })

  await db.proClientInvite.deleteMany({
    where: { professionalId: professionalId || undefined },
  })

  // ClientProfile.user is onDelete: SetNull, NOT Cascade — deleting the user
  // first ORPHANS the profile (userId -> null) rather than removing it, and a
  // socially-created profile carries no plaintext email to find it by again.
  // Profiles go first, always.
  await db.clientProfile.deleteMany({
    where: {
      OR: [
        { userId: { in: ourUsers.map((u) => u.id) } },
        ...(professionalId
          ? [{ createdByProfessionalId: professionalId }]
          : []),
        ...(otherTenantId ? [{ homeTenantId: otherTenantId }] : []),
      ],
    },
  })

  await db.socialSignupTicket.deleteMany({ where: { email: { contains: TAG } } })

  await db.professionalProfile.deleteMany({
    where: { businessName: { contains: TAG } },
  })
  await db.user.deleteMany({ where: { email: { contains: TAG } } })
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id
  tenantMock.tenantId = tenantId

  const otherTenant = await db.tenant.upsert({
    where: { slug: `${TAG}-other` },
    update: {},
    create: { slug: `${TAG}-other`, name: `${TAG} Other`, isActive: true },
    select: { id: true },
  })
  otherTenantId = otherTenant.id

  const proUser = await db.user.create({
    data: {
      email: `${TAG}_owner@example.com`,
      password: 'x',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Social',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = professional.id
})

beforeEach(() => {
  sends.registrationVerifications.length = 0
  sends.claimLinks.length = 0
  tenantMock.tenantId = tenantId
})

afterAll(async () => {
  await cleanup()
  await db.tenant.deleteMany({ where: { slug: `${TAG}-other` } })
  await db.$disconnect()
})

describe('POST /api/v1/auth/social/complete (integration)', () => {
  it('creates the account a provider identity alone could not: role, phone, consent, and NO password', async () => {
    const email = nextEmail('fresh')
    const subject = nextSubject('fresh')
    const phone = nextPhone()
    const ticket = await issueTicket({ email, subject })

    const res = await POST(
      req(clientBody(ticket.token, { phone, firstName: 'Grace', lastName: 'Hopper' })),
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.user.role).toBe('CLIENT')
    // The provider vouched for the email, so it is verified on arrival and no
    // verification mail is sent — but the PHONE still has to be proved.
    expect(json.isEmailVerified).toBe(true)
    expect(json.requiresEmailVerification).toBe(false)
    expect(json.emailVerificationSent).toBe('skipped')
    expect(json.isPhoneVerified).toBe(false)
    expect(json.requiresPhoneVerification).toBe(true)
    expect(json.isFullyVerified).toBe(false)

    const row = await db.user.findUnique({
      where: { id: json.user.id },
      select: {
        email: true,
        role: true,
        password: true,
        googleUserId: true,
        appleUserId: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        phone: true,
        tosVersion: true,
        transactionalSmsConsentAt: true,
        transactionalSmsConsentVersion: true,
        transactionalSmsConsentSource: true,
        transactionalSmsConsentIp: true,
        transactionalSmsConsentUserAgent: true,
        clientProfile: {
          select: { homeTenantId: true, firstName: true, lastName: true },
        },
      },
    })

    expect(row).not.toBeNull()
    if (!row) return

    // 🔴 The account has NO password. It used to carry a bcrypt hash of a
    // random UUID, invented purely to satisfy a NOT NULL column, which made a
    // provider-only account indistinguishable from a password one.
    expect(row.password).toBeNull()
    expect(row.googleUserId).toBe(subject)
    expect(row.appleUserId).toBeNull()

    expect(row.emailVerifiedAt).toBeInstanceOf(Date)
    expect(row.phoneVerifiedAt).toBeNull()

    // 🔴 None of the next four existed on the old inline-creation path: it made
    // a CLIENT with no phone and no consent, so the person's first booking had
    // nowhere to send anything and no record said they had agreed to be texted.
    expect(row.phone).toBe(phone)
    expect(row.transactionalSmsConsentAt).toBeInstanceOf(Date)
    expect(row.transactionalSmsConsentVersion).not.toBeNull()
    expect(row.transactionalSmsConsentSource).toBe('SOCIAL_SIGNUP_GOOGLE_CLIENT')
    expect(row.transactionalSmsConsentIp).toBe('203.0.113.7')
    expect(row.transactionalSmsConsentUserAgent).toBe('integration-suite/1.0')

    expect(row.tosVersion).toBe('2026-04')

    // The form's name wins over the provider's.
    expect(row.clientProfile?.firstName).toBe('Grace')
    expect(row.clientProfile?.lastName).toBe('Hopper')

    // 🔴 The profile's contact shape, which #990 flagged as an open question:
    // the old social path wrote NO plaintext email or phone on the
    // ClientProfile (hash + AEAD envelope only) while a password signup wrote
    // what it writes, so anything finding a client by profile plaintext missed
    // every social signup. That asymmetry is gone — not by choosing a side, but
    // because both paths are now literally the same createRegisteredAccount
    // call. Asserted rather than argued: plaintext phone IS written, plaintext
    // email is NOT (envelope only), for social exactly as for password.
    const profile = await db.clientProfile.findUnique({
      where: { userId: json.user.id },
      select: {
        phone: true,
        email: true,
        emailEncrypted: true,
        phoneEncrypted: true,
        emailHashV2: true,
      },
    })
    expect(profile?.phone).toBe(phone)
    expect(profile?.email).toBeNull()
    expect(profile?.emailEncrypted).not.toBeNull()
    expect(profile?.phoneEncrypted).not.toBeNull()
    expect(profile?.emailHashV2).toBe(emailLookupHashV2(email)?.hash)

    // The tail is asked to skip the email send, not merely to not send one.
    expect(sends.registrationVerifications).toHaveLength(1)
    expect(sends.registrationVerifications[0]).toMatchObject({
      skipEmailVerification: true,
      skipPhoneVerification: false,
    })
  })

  it('records the APPLE provider id and consent source for an Apple ticket', async () => {
    const email = nextEmail('apple')
    const subject = nextSubject('apple')
    const ticket = await issueTicket({ email, subject, provider: 'APPLE' })

    const res = await POST(req(clientBody(ticket.token)))
    expect(res.status).toBe(201)
    const json = await res.json()

    const row = await db.user.findUnique({
      where: { id: json.user.id },
      select: {
        googleUserId: true,
        appleUserId: true,
        transactionalSmsConsentSource: true,
      },
    })
    // The provider-parameterized column mapping, proved on a real row: the
    // other provider's column must stay null, not be written with something.
    expect(row?.appleUserId).toBe(subject)
    expect(row?.googleUserId).toBeNull()
    expect(row?.transactionalSmsConsentSource).toBe('SOCIAL_SIGNUP_APPLE_CLIENT')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 🔴 THE HEADLINE. This exact setup returned an unhandled P2002 — a bare 500
  // — for the most ordinary new client there is: one whose pro had already
  // booked them.
  //
  // It is proved to fail two ways — both run, not assumed:
  //   1. Old behaviour (no adoption, no collision detection): the request 500s.
  //      Measured — "expected 500 to be 201".
  //   2. The plausible HALF-fix: detect the collision and answer politely with
  //      a claim link and a 409 instead of crashing. The crash is gone and the
  //      client still cannot sign up. Measured — "expected 409 to be 201".
  //
  // Note what is NOT a possible half-fix, because it explains why the
  // duplicate-count assertion below is cheap rather than redundant: "catch the
  // P2002 and create a fresh profile" cannot silently succeed here — the fresh
  // profile carries the same unique emailHashV2 and collides in its turn. Two
  // profiles for one email is not a state this database can reach.
  // ────────────────────────────────────────────────────────────────────────
  it('ADOPTS the pro’s unclaimed profile instead of colliding with it', async () => {
    const email = nextEmail('adopt')
    const phone = nextPhone()

    // Exactly how a client first appears: the pro adds them, which writes a
    // ClientProfile with NO user and the unique emailHashV2 for this address.
    const upserted = await upsertProClient({
      professionalId,
      firstName: 'Unclaimed',
      lastName: 'Client',
      email,
      phone: null,
    })
    expect(upserted.ok).toBe(true)
    if (!upserted.ok) return
    expect(upserted.claimStatus).toBe(ClientClaimStatus.UNCLAIMED)
    expect(upserted.userId).toBeNull()

    const inviteToken = createProClientInviteToken()
    await db.proClientInvite.create({
      data: {
        professionalId,
        clientId: upserted.clientId,
        invitedName: 'Unclaimed Client',
        invitedEmail: email,
        preferredContactMethod: ContactMethod.EMAIL,
        status: ProClientInviteStatus.PENDING,
        token: null,
        tokenHash: hashProClientInviteToken(inviteToken),
      },
      select: { id: true },
    })

    const ticket = await issueTicket({ email })

    const res = await POST(
      req(
        clientBody(ticket.token, {
          phone,
          intent: 'CLAIM_INVITE',
          inviteToken,
        }),
      ),
    )

    expect(res.status).toBe(201)
    const json = await res.json()

    // The account owns the PRO'S profile — the same row, with its history.
    const profile = await db.clientProfile.findUnique({
      where: { id: upserted.clientId },
      select: {
        userId: true,
        claimStatus: true,
        createdByProfessionalId: true,
      },
    })
    expect(profile?.userId).toBe(json.user.id)
    expect(profile?.claimStatus).toBe(ClientClaimStatus.CLAIMED)
    expect(profile?.createdByProfessionalId).toBe(professionalId)

    // ...and no duplicate was minted alongside it. This is the assertion that
    // separates the fix from a P2002-swallowing half-fix.
    const hash = emailLookupHashV2(email)
    expect(hash).not.toBeNull()
    const profiles = await db.clientProfile.count({
      where: { emailHashV2: hash?.hash },
    })
    expect(profiles).toBe(1)

    const users = await db.user.count({ where: { email } })
    expect(users).toBe(1)
  })

  it('refuses with a claim link — creating NOTHING — when the contact has history but no invite in hand', async () => {
    const email = nextEmail('cold')

    const upserted = await upsertProClient({
      professionalId,
      firstName: 'Cold',
      lastName: 'Client',
      email,
      phone: null,
    })
    expect(upserted.ok).toBe(true)
    if (!upserted.ok) return

    const ticket = await issueTicket({ email })

    const res = await POST(req(clientBody(ticket.token)))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('CLAIMABLE_HISTORY')
    expect(json.claimLinkSent).toBe(true)
    expect(sends.claimLinks).toHaveLength(1)

    // The old path would have tried to create here and thrown P2002. Nothing
    // exists, and the pro's profile is untouched.
    const users = await db.user.count({ where: { email } })
    expect(users).toBe(0)

    const profile = await db.clientProfile.findUnique({
      where: { id: upserted.clientId },
      select: { userId: true, claimStatus: true },
    })
    expect(profile?.userId).toBeNull()
    expect(profile?.claimStatus).toBe(ClientClaimStatus.UNCLAIMED)
  })

  it('creates a PRO workspace when the completion step says PRO', async () => {
    const email = nextEmail('pro')
    const ticket = await issueTicket({ email })
    const handle = nextHandle()

    const res = await POST(
      req({
        signupTicket: ticket.token,
        role: 'PRO',
        phone: nextPhone(),
        tosAccepted: true,
        transactionalSmsConsent: true,
        signupLocation: PRO_MOBILE,
        businessName: `${TAG} Social Studio`,
        // MAKEUP_ARTIST is EXEMPT from licensure in every state we model, so
        // this exercises the pro path without a licence lookup.
        professionType: 'MAKEUP_ARTIST',
        // The operating state is required for every pro, licensed or not.
        licenseState: 'CA',
        handle,
        mobileRadiusMiles: 10,
      }),
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.user.role).toBe('PRO')

    // 🔴 The old path hardcoded `role: 'CLIENT'`; a pro could not sign up
    // socially at all.
    const row = await db.user.findUnique({
      where: { id: json.user.id },
      select: {
        role: true,
        password: true,
        googleUserId: true,
        clientProfile: { select: { id: true } },
        professionalProfile: {
          select: { businessName: true, homeTenantId: true, handle: true },
        },
      },
    })
    expect(row?.role).toBe(Role.PRO)
    expect(row?.password).toBeNull()
    expect(row?.googleUserId).not.toBeNull()
    expect(row?.clientProfile).toBeNull()
    expect(row?.professionalProfile?.businessName).toBe(`${TAG} Social Studio`)
    expect(row?.professionalProfile?.handle).toBe(handle)
  })

  it('takes the home tenant from the TICKET, not from the request that completes it', async () => {
    const email = nextEmail('tenant')
    const ticket = await issueTicket({ email, tenantId: otherTenantId })

    // The completing request resolves to a DIFFERENT tenant. The profile must
    // still land where the person actually started, and the tenant must not be
    // swappable between the two steps.
    tenantMock.tenantId = tenantId

    const res = await POST(req(clientBody(ticket.token)))
    expect(res.status).toBe(201)
    const json = await res.json()

    const profile = await db.clientProfile.findUnique({
      where: { userId: json.user.id },
      select: { homeTenantId: true },
    })
    expect(profile?.homeTenantId).toBe(otherTenantId)
    expect(profile?.homeTenantId).not.toBe(tenantId)
  })

  it('spends a ticket exactly once', async () => {
    const email = nextEmail('once')
    const ticket = await issueTicket({ email })

    const first = await POST(req(clientBody(ticket.token)))
    expect(first.status).toBe(201)

    const second = await POST(req(clientBody(ticket.token)))
    expect(second.status).toBe(400)
    expect((await second.json()).code).toBe('INVALID_TICKET')

    // Exactly one account, not two.
    const users = await db.user.count({ where: { email } })
    expect(users).toBe(1)

    const row = await db.socialSignupTicket.findUnique({
      where: { id: ticket.id },
      select: { usedAt: true },
    })
    expect(row?.usedAt).toBeInstanceOf(Date)
  })

  it('refuses an expired ticket', async () => {
    const email = nextEmail('expired')
    // Issued far enough in the past that its TTL has already elapsed.
    const ticket = await issueTicket({
      email,
      now: new Date(Date.now() - 60 * 60 * 1000),
    })

    const res = await POST(req(clientBody(ticket.token)))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_TICKET')

    const users = await db.user.count({ where: { email } })
    expect(users).toBe(0)
  })

  it('refuses a forged secret without burning the real ticket', async () => {
    const email = nextEmail('forged')
    const ticket = await issueTicket({ email })

    const forged = `${ticket.id}.${'0'.repeat(64)}`
    const res = await POST(req(clientBody(forged)))
    expect(res.status).toBe(400)

    // 🔴 A wrong guess must not spend somebody's live ticket — that would be a
    // trivial denial of service on a signup in progress. The secret is compared
    // BEFORE consumption for exactly this reason.
    const row = await db.socialSignupTicket.findUnique({
      where: { id: ticket.id },
      select: { usedAt: true },
    })
    expect(row?.usedAt).toBeNull()

    // And the real ticket still works afterwards.
    const ok = await POST(req(clientBody(ticket.token)))
    expect(ok.status).toBe(201)
  })

  it('does NOT burn the ticket when the body is rejected', async () => {
    const email = nextEmail('badbody')
    const ticket = await issueTicket({ email })

    // No phone: a form mistake, not a reason to make someone sign in again.
    const res = await POST(
      req({
        signupTicket: ticket.token,
        role: 'CLIENT',
        tosAccepted: true,
        transactionalSmsConsent: true,
        signupLocation: CLIENT_ZIP,
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PHONE_REQUIRED')

    const row = await db.socialSignupTicket.findUnique({
      where: { id: ticket.id },
      select: { usedAt: true },
    })
    expect(row?.usedAt).toBeNull()

    // Correcting the form works on the same ticket.
    const ok = await POST(req(clientBody(ticket.token)))
    expect(ok.status).toBe(201)
  })

  it('does NOT burn the ticket when a PRO mistypes a field', async () => {
    const email = nextEmail('protypo')
    const ticket = await issueTicket({ email })
    const handle = nextHandle()

    const proBody = (overrides: Record<string, unknown> = {}) => ({
      signupTicket: ticket.token,
      role: 'PRO',
      phone: nextPhone(),
      tosAccepted: true,
      transactionalSmsConsent: true,
      signupLocation: PRO_MOBILE,
      businessName: `${TAG} Typo Studio`,
      professionType: 'MAKEUP_ARTIST',
      licenseState: 'CA',
      handle,
      mobileRadiusMiles: 10,
      ...overrides,
    })

    // A handle over the 24-char limit — the single most likely thing for a pro
    // to get wrong, and a refusal they can fix by editing one field.
    const res = await POST(req(proBody({ handle: `${handle}-far-too-long-to-be-valid` })))
    expect(res.status).toBe(400)

    // 🔴 The pro resolution runs BEFORE the consume for exactly this reason. If
    // it moved back below it, a typo would cost the person their single-use
    // ticket and make them tap the provider again.
    const row = await db.socialSignupTicket.findUnique({
      where: { id: ticket.id },
      select: { usedAt: true },
    })
    expect(row?.usedAt).toBeNull()

    // Correcting the field works on the same ticket.
    const ok = await POST(req(proBody()))
    expect(ok.status).toBe(201)
  })

  it('refuses without SMS consent, and creates nothing', async () => {
    const email = nextEmail('noconsent')
    const ticket = await issueTicket({ email })

    const res = await POST(
      req(clientBody(ticket.token, { transactionalSmsConsent: false })),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('SMS_CONSENT_REQUIRED')

    const users = await db.user.count({ where: { email } })
    expect(users).toBe(0)
  })
})
