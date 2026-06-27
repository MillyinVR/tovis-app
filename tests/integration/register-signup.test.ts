// tests/integration/register-signup.test.ts
//
// Integration coverage for POST /api/v1/auth/register against the docker test
// database:
//   pnpm test:integration
//
// Unlike the route unit tests, Prisma is real here: we assert the user +
// profile + location transaction actually commits, unique constraints map to
// friendly errors, and contact lookup hashes / address privacy columns are
// written. Only true network boundaries are mocked (Turnstile + DCA fetch,
// Twilio Verify, Postmark email send, Vercel waitUntil).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // lib/auth reads JWT_SECRET at module load, so it must exist before the
  // route module graph is imported.
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
  process.env.TOVIS_TOS_VERSION ||= '2026-04'
  process.env.TURNSTILE_SECRET_KEY = 'integration-test-turnstile-secret'

  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON = JSON.stringify({ 'address-aead-v1': key32 })
})

const mockWaitUntil = vi.hoisted(() => vi.fn())
const mockStartTwilioVerifyPhoneVerification = vi.hoisted(() => vi.fn())
const mockIssueAndSendEmailVerification = vi.hoisted(() => vi.fn())

let currentClientIp = '198.51.100.10'

vi.mock('@vercel/functions', () => ({
  waitUntil: mockWaitUntil,
}))

vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: mockStartTwilioVerifyPhoneVerification,
}))

vi.mock('@/lib/auth/emailVerification', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/emailVerification')
  >('@/lib/auth/emailVerification')

  return {
    ...actual,
    issueAndSendEmailVerification: mockIssueAndSendEmailVerification,
  }
})

// lib/trustedClientIp reads next/headers, which only works inside a real Next
// request scope.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': currentClientIp }),
}))

import { PrismaClient } from '@prisma/client'

import { POST } from '@/app/api/v1/auth/register/route'
import { verifyToken } from '@/lib/auth'
import { clearInMemoryRateLimitCountersForTests } from '@/lib/rateLimit/enforce'
import { emailLookupHashV2, phoneLookupHashV2 } from '@/lib/security/crypto/hashLookup'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `reg_int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let emailCounter = 0
let phoneCounter = 0
let waitUntilTasks: Promise<unknown>[] = []

function nextEmail(label: string): string {
  emailCounter += 1
  return `${tag}_${label}_${emailCounter}@example.com`
}

function nextPhone(): string {
  phoneCounter += 1
  return `+1619${String(5550000 + phoneCounter).padStart(7, '0')}`
}

async function flushWaitUntilTasks() {
  await Promise.allSettled(waitUntilTasks)
  await Promise.resolve()
}

function makeJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FetchHandler = (url: string) => Response | Promise<Response> | null

let dcaFetchHandler: FetchHandler = () => null

function installFetchRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      if (url.includes('challenges.cloudflare.com/turnstile')) {
        return makeJsonResponse({ success: true })
      }

      const dcaResponse = await dcaFetchHandler(url)
      if (dcaResponse) return dcaResponse

      throw new Error(`Unexpected fetch in integration test: ${url}`)
    }),
  )
}

function makeDcaHandler(licenseSearch: () => Response): FetchHandler {
  return (url) => {
    if (url.includes('getAllLicenseTypes')) {
      return makeJsonResponse({
        getAllLicenseTypes: [
          {
            licenseTypes: [
              { licenseLongName: 'COSMETOLOGIST', publicNameDesc: 'COSMETOLOGIST', clientCode: 'COSM' },
              { licenseLongName: 'BARBER', publicNameDesc: 'BARBER', clientCode: 'BARB' },
              { licenseLongName: 'ESTHETICIAN', publicNameDesc: 'ESTHETICIAN', clientCode: 'ESTH' },
              { licenseLongName: 'MANICURIST', publicNameDesc: 'MANICURIST', clientCode: 'MANI' },
              { licenseLongName: 'HAIRSTYLIST', publicNameDesc: 'HAIRSTYLIST', clientCode: 'HAIR' },
              { licenseLongName: 'ELECTROLOGIST', publicNameDesc: 'ELECTROLOGIST', clientCode: 'ELEC' },
            ],
          },
        ],
      })
    }

    if (url.includes('getLicenseNumberSearch')) {
      return licenseSearch()
    }

    return null
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
      'user-agent': 'vitest-integration',
      'x-forwarded-for': currentClientIp,
    },
    body: JSON.stringify(body),
  })
}

function clientZipLocation() {
  return {
    kind: 'CLIENT_ZIP',
    postalCode: '92101',
    city: 'San Diego',
    state: 'CA',
    countryCode: 'US',
    lat: 32.7157,
    lng: -117.1611,
    timeZoneId: 'America/Los_Angeles',
  }
}

function proSalonLocation() {
  return {
    kind: 'PRO_SALON',
    placeId: `place_${tag}`,
    formattedAddress: '123 Main St, San Diego, CA 92101',
    city: 'San Diego',
    state: 'CA',
    postalCode: '92101',
    countryCode: 'US',
    lat: 32.7157,
    lng: -117.1611,
    timeZoneId: 'America/Los_Angeles',
    name: 'TOVIS Studio',
  }
}

function proMobileLocation() {
  return {
    kind: 'PRO_MOBILE',
    postalCode: '92101',
    city: 'San Diego',
    state: 'CA',
    countryCode: 'US',
    lat: 32.7157,
    lng: -117.1611,
    timeZoneId: 'America/Los_Angeles',
  }
}

function makeClientBody(overrides?: Record<string, unknown>) {
  return {
    email: nextEmail('client'),
    password: 'SuperSecret123!',
    role: 'CLIENT',
    firstName: 'Integration',
    lastName: 'Client',
    phone: nextPhone(),
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_integration_ok',
    signupLocation: clientZipLocation(),
    ...(overrides ?? {}),
  }
}

function makeProBody(overrides?: Record<string, unknown>) {
  return {
    email: nextEmail('pro'),
    password: 'SuperSecret123!',
    role: 'PRO',
    firstName: 'Integration',
    lastName: 'Pro',
    phone: nextPhone(),
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_integration_ok',
    professionType: 'MAKEUP_ARTIST',
    businessName: 'TOVIS Integration Studio',
    signupLocation: proSalonLocation(),
    ...(overrides ?? {}),
  }
}

function readSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

async function cleanupSeededRows() {
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)

  const pros = await db.professionalProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  })
  const proIds = pros.map((p) => p.id)

  await db.professionalLocation.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
}

describe('POST /api/v1/auth/register (integration)', () => {
  beforeAll(async () => {
    // Background email tail resolves tenant context by host; make sure the
    // root tenant row exists like production data does.
    await db.tenant.upsert({
      where: { slug: 'tovis-root' },
      update: {},
      create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    })
  })

  beforeEach(() => {
    clearInMemoryRateLimitCountersForTests()
    installFetchRouter()
    dcaFetchHandler = () => null
    currentClientIp = '198.51.100.10'

    waitUntilTasks = []
    mockWaitUntil.mockReset()
    mockWaitUntil.mockImplementation((task: Promise<unknown>) => {
      waitUntilTasks.push(Promise.resolve(task))
    })

    mockStartTwilioVerifyPhoneVerification.mockReset()
    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: true,
      sid: 'VE_integration',
      status: 'pending',
    })

    mockIssueAndSendEmailVerification.mockReset()
    mockIssueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_integration',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
  })

  afterAll(async () => {
    await cleanupSeededRows()
    await db.$disconnect()
    vi.unstubAllGlobals()
  })

  it('creates a client account with profile, lookup hashes, and cookies', async () => {
    const body = makeClientBody()

    const res = await POST(makeRequest(body))
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data).toMatchObject({
      ok: true,
      user: { email: body.email, role: 'CLIENT' },
      requiresPhoneVerification: true,
      requiresEmailVerification: true,
      phoneVerificationSent: 'pending',
      emailVerificationSent: 'pending',
      isFullyVerified: false,
    })

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: { clientProfile: true },
    })

    expect(user).toBeTruthy()
    expect(user?.role).toBe('CLIENT')
    expect(user?.phone).toBe(body.phone)
    expect(user?.phoneVerifiedAt).toBeNull()
    expect(user?.emailVerifiedAt).toBeNull()
    expect(user?.tosVersion).toBe(process.env.TOVIS_TOS_VERSION)
    expect(user?.tosAcceptedAt).toBeInstanceOf(Date)
    expect(user?.transactionalSmsConsentSource).toBe('WEB_SIGNUP_CLIENT')
    expect(user?.transactionalSmsConsentIp).toBe('198.51.100.10')
    expect(user?.transactionalSmsConsentUserAgent).toBe('vitest-integration')
    expect(user?.password).not.toBe(body.password)

    expect(user?.emailHashV2).toBe(emailLookupHashV2(body.email)?.hash)
    expect(user?.phoneHashV2).toBe(phoneLookupHashV2(body.phone)?.hash)

    const rootTenant = await db.tenant.findUnique({
      where: { slug: 'tovis-root' },
      select: { id: true },
    })

    expect(user?.clientProfile).toMatchObject({
      firstName: 'Integration',
      lastName: 'Client',
      phone: body.phone,
      phoneVerifiedAt: null,
      homeTenantId: rootTenant?.id,
    })

    const cookies = readSetCookies(res).join('; ')
    expect(cookies).toContain('tovis_token=')
    expect(cookies).toContain('tovis_client_zip=92101')

    const tokenMatch = /tovis_token=([^;]+)/.exec(cookies)
    const payload = verifyToken(tokenMatch?.[1] ?? '')
    expect(payload).toMatchObject({ userId: user?.id, role: 'CLIENT' })

    await flushWaitUntilTasks()
    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: body.phone,
    })
    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user?.id, email: body.email }),
    )
  })

  it('creates a salon pro with a non-bookable primary location and address privacy columns', async () => {
    const body = makeProBody({ handle: `studio-${tag.slice(-6)}` })

    const res = await POST(makeRequest(body))
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.ok).toBe(true)
    expect(data.needsManualLicenseUpload).toBe(false)

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: {
        professionalProfile: { include: { locations: true } },
      },
    })

    const profile = user?.professionalProfile
    expect(profile).toMatchObject({
      firstName: 'Integration',
      lastName: 'Pro',
      professionType: 'MAKEUP_ARTIST',
      businessName: 'TOVIS Integration Studio',
      handleNormalized: `studio-${tag.slice(-6)}`.toLowerCase(),
      timeZone: 'America/Los_Angeles',
      verificationStatus: 'PENDING',
      licenseVerified: false,
      mobileBasePostalCode: null,
      mobileRadiusMiles: null,
    })

    expect(profile?.locations).toHaveLength(1)
    const location = profile?.locations[0]
    expect(location).toMatchObject({
      type: 'SALON',
      name: 'TOVIS Studio',
      isPrimary: true,
      isBookable: false,
      formattedAddress: '123 Main St, San Diego, CA 92101',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      timeZone: 'America/Los_Angeles',
    })
    expect(location?.encryptedAddressJson).toBeTruthy()
    expect(location?.postalCodePrefix).toBe('92101')
    expect(location?.latApprox).not.toBeNull()
    expect(location?.lngApprox).not.toBeNull()

    const cookies = readSetCookies(res).join('; ')
    expect(cookies).toContain('tovis_token=')
    expect(cookies).not.toContain('tovis_client_zip=')
  })

  it('creates a mobile pro with base postal code and rounded radius', async () => {
    const body = makeProBody({
      professionType: 'MASSAGE_THERAPIST',
      signupLocation: proMobileLocation(),
      mobileRadiusMiles: 25,
    })

    const res = await POST(makeRequest(body))
    expect(res.status).toBe(201)

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: {
        professionalProfile: { include: { locations: true } },
      },
    })

    expect(user?.professionalProfile).toMatchObject({
      professionType: 'MASSAGE_THERAPIST',
      mobileBasePostalCode: '92101',
      mobileRadiusMiles: 25,
    })
    expect(user?.professionalProfile?.locations[0]).toMatchObject({
      type: 'MOBILE_BASE',
      name: 'Mobile base',
      isPrimary: true,
      isBookable: false,
      postalCode: '92101',
    })
  })

  it('approves a licensed pro when the CA DCA reports the license as CURRENT', async () => {
    process.env.DCA_SEARCH_APP_ID = 'dca_app_id'
    process.env.DCA_SEARCH_APP_KEY = 'dca_app_key'

    const licenseDetail = {
      licNumber: 'Z123456',
      primaryStatusCode: 'CURRENT',
      expDate: '2027-01-01',
    }

    dcaFetchHandler = makeDcaHandler(() =>
      makeJsonResponse({
        licenseDetails: [
          {
            getFullLicenseDetail: [{ getLicenseDetails: [licenseDetail] }],
          },
        ],
      }),
    )

    const body = makeProBody({
      professionType: 'ESTHETICIAN',
      licenseState: 'CA',
      licenseNumber: 'z 123456',
    })

    const res = await POST(makeRequest(body))
    expect(res.status).toBe(201)

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: { professionalProfile: true },
    })

    expect(user?.professionalProfile).toMatchObject({
      professionType: 'ESTHETICIAN',
      licenseState: 'CA',
      licenseNumber: 'Z123456',
      licenseVerified: true,
      verificationStatus: 'APPROVED',
      licenseVerifiedSource: 'CA_DCA_BREEZE',
      licenseStatusCode: 'CURRENT',
    })
    expect(user?.professionalProfile?.licenseExpiry).toBeInstanceOf(Date)
    expect(user?.professionalProfile?.licenseVerifiedAt).toBeInstanceOf(Date)
  })

  it('maps a duplicate email to ACCOUNT_EXISTS without leaking constraint details', async () => {
    const first = makeClientBody()
    expect((await POST(makeRequest(first))).status).toBe(201)

    const res = await POST(
      makeRequest(makeClientBody({ email: first.email })),
    )
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toEqual({
      ok: false,
      error: 'An account already exists with those details.',
      code: 'ACCOUNT_EXISTS',
    })
  })

  it('maps a duplicate phone to ACCOUNT_EXISTS', async () => {
    const first = makeClientBody()
    expect((await POST(makeRequest(first))).status).toBe(201)

    const res = await POST(
      makeRequest(makeClientBody({ phone: first.phone })),
    )
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toEqual({
      ok: false,
      error: 'An account already exists with those details.',
      code: 'ACCOUNT_EXISTS',
    })
  })

  it('rejects a pro handle that another pro already owns', async () => {
    const handle = `dup_${tag.slice(-8)}`

    const first = makeProBody({ handle })
    expect((await POST(makeRequest(first))).status).toBe(201)

    const res = await POST(makeRequest(makeProBody({ handle })))
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toEqual({
      ok: false,
      error: 'That handle is already taken.',
      code: 'HANDLE_IN_USE',
    })
  })

  it('rejects passwords below the policy minimum before touching the database', async () => {
    const body = makeClientBody({ password: 'short1!' })

    const res = await POST(makeRequest(body))
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('WEAK_PASSWORD')

    const user = await db.user.findUnique({ where: { email: body.email } })
    expect(user).toBeNull()
  })

  it('enforces the per-phone SMS rate limit across repeated signups', async () => {
    const phone = nextPhone()

    // auth:sms-phone-hour allows 5 per hour per phone; each attempt below
    // fails on the duplicate-phone constraint but still consumes quota.
    const first = makeClientBody({ phone })
    expect((await POST(makeRequest(first))).status).toBe(201)

    let lastStatus = 0
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(makeRequest(makeClientBody({ phone })))
      lastStatus = res.status
    }

    expect(lastStatus).toBe(429)
  })
})
