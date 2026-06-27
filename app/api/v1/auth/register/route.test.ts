// app/api/v1/auth/register/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  emailLookupHashV2,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const mockHashPassword = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockConsumeTapIntent = vi.hoisted(() => vi.fn())

const mockGetAppUrlFromRequest = vi.hoisted(() => vi.fn())
const mockIssueAndSendEmailVerification = vi.hoisted(() => vi.fn())

const mockWaitUntil = vi.hoisted(() => vi.fn())

const mockIsValidIanaTimeZone = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockPhoneRateLimitIdentity = vi.hoisted(() => vi.fn())

const mockValidatePassword = vi.hoisted(() => vi.fn())
const mockGetCurrentTosVersion = vi.hoisted(() => vi.fn())
const mockVerifyTurnstileOrFailOpen = vi.hoisted(() => vi.fn())

const mockIsRuntimeFlagEnabled = vi.hoisted(() => vi.fn())
const mockValidateSmsDestinationCountry = vi.hoisted(() => vi.fn())

const mockStartTwilioVerifyPhoneVerification = vi.hoisted(() => vi.fn())

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockBuildAddressPrivacyWriteData = vi.hoisted(() => vi.fn())

const mockFetch = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
  },
  professionalProfile: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const ORIGINAL_ENV = { ...process.env }

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')


vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    isRoot: true,
    tenantId: 'tenant_root',
    slug: 'tovis-root',
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth', () => ({
  hashPassword: mockHashPassword,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mockConsumeTapIntent,
}))

vi.mock('@/lib/auth/emailVerification', () => ({
  getAppUrlFromRequest: mockGetAppUrlFromRequest,
  issueAndSendEmailVerification: mockIssueAndSendEmailVerification,
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: mockWaitUntil,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mockIsValidIanaTimeZone,
}))

vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )

  return {
    ...actual,
    enforceRateLimit: mockEnforceRateLimit,
    rateLimitIdentity: mockRateLimitIdentity,
    phoneRateLimitIdentity: mockPhoneRateLimitIdentity,
  }
})

vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: mockStartTwilioVerifyPhoneVerification,
}))

vi.mock('@/lib/passwordPolicy', () => ({
  validatePassword: mockValidatePassword,
}))

vi.mock('@/lib/legal', () => ({
  getCurrentTosVersion: mockGetCurrentTosVersion,
}))

vi.mock('@/lib/auth/turnstile', () => ({
  verifyTurnstileOrFailOpen: mockVerifyTurnstileOrFailOpen,
}))

vi.mock('@/lib/runtimeFlags', () => ({
  isRuntimeFlagEnabled: mockIsRuntimeFlagEnabled,
}))

vi.mock('@/lib/smsCountryPolicy', () => ({
  validateSmsDestinationCountry: mockValidateSmsDestinationCountry,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mockBuildAddressPrivacyWriteData,
}))

// Deterministic stand-in for the AEAD dual-write so the assertion does not
// depend on a keyring being present in the test env (CI has none).
vi.mock('@/lib/security/phonePrivacy', () => ({
  buildPhoneEncryptionWriteData: (input: { phone?: unknown }) =>
    input.phone === undefined
      ? {}
      : { phoneEncrypted: { encrypted: input.phone } },
}))

import { POST } from './route'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

let waitUntilTasks: Promise<unknown>[] = []

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushWaitUntilTasks() {
  await Promise.allSettled(waitUntilTasks)
  await Promise.resolve()
}

function makeClientSignupBody() {
  return {
    email: 'client@example.com',
    password: 'SuperSecret123!',
    role: 'CLIENT',
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '(555) 123-4567',
    tapIntentId: 'tap_1',
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_signup_ok',
    signupLocation: {
      kind: 'CLIENT_ZIP',
      postalCode: '92101',
      city: 'San Diego',
      state: 'CA',
      countryCode: 'US',
      lat: 32.7157,
      lng: -117.1611,
      timeZoneId: 'America/Los_Angeles',
    },
  }
}

function makeProSignupBody(overrides?: Record<string, unknown>) {
  return {
    email: 'pro@example.com',
    password: 'SuperSecret123!',
    role: 'PRO',
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '(555) 123-4567',
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_signup_ok',
    professionType: 'MAKEUP_ARTIST',
    licenseState: 'CA',
    handle: 'jane-smith',
    signupLocation: {
      kind: 'PRO_SALON',
      placeId: 'place_1',
      formattedAddress: '123 Main St, San Diego, CA 92101',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: 32.7157,
      lng: -117.1611,
      timeZoneId: 'America/Los_Angeles',
      name: 'TOVIS Studio',
    },
    ...(overrides ?? {}),
  }
}

function makeProSalonSignupBody() {
  return {
    email: 'pro-salon@example.com',
    password: 'SuperSecret123!',
    role: 'PRO',
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '(555) 123-4567',
    tapIntentId: 'tap_pro_salon',
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_signup_ok',
    businessName: 'TOVIS Studio',
    professionType: 'MAKEUP_ARTIST',
    licenseState: 'CA',
    signupLocation: {
      kind: 'PRO_SALON',
      placeId: 'place_123',
      formattedAddress: '123 Main St, San Diego, CA 92101',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: 32.7157,
      lng: -117.1611,
      timeZoneId: 'America/Los_Angeles',
      name: 'TOVIS Studio',
    },
  }
}

function makeProMobileSignupBody() {
  return {
    email: 'pro-mobile@example.com',
    password: 'SuperSecret123!',
    role: 'PRO',
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '(555) 123-4567',
    tapIntentId: 'tap_pro_mobile',
    tosAccepted: true,
    transactionalSmsConsent: true,
    turnstileToken: 'ts_signup_ok',
    businessName: 'TOVIS Mobile',
    professionType: 'MAKEUP_ARTIST',
    licenseState: 'CA',
    mobileRadiusMiles: 25,
    signupLocation: {
      kind: 'PRO_MOBILE',
      postalCode: '92101',
      city: 'San Diego',
      state: 'CA',
      countryCode: 'US',
      lat: 32.7157,
      lng: -117.1611,
      timeZoneId: 'America/Los_Angeles',
    },
  }
}

function makeSuccessfulRegisterTx(args: {
  userId: string
  email: string
  role: Role
}) {
  return {
    user: {
      create: vi.fn().mockResolvedValue({
        id: args.userId,
        email: args.email,
        role: args.role,
        phone: '+15551234567',
        authVersion: 1,
      }),
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
      'user-agent': 'vitest',
      'x-forwarded-for': '198.51.100.10',
    },
    body: JSON.stringify(body),
  })
}

function expectedEmailLookupData(email: string) {
  const emailHashV2 = emailLookupHashV2(email)

  expect(emailHashV2).not.toBeNull()

  return {
    emailHashV2: emailHashV2?.hash,
    emailHashKeyVersion: emailHashV2?.keyVersion,
  }
}

function expectedPhoneLookupData(phone: string) {
  const phoneHashV2 = phoneLookupHashV2(phone)

  expect(phoneHashV2).not.toBeNull()

  return {
    phoneHashV2: phoneHashV2?.hash,
    phoneHashKeyVersion: phoneHashV2?.keyVersion,
  }
}

function expectedPhoneEncryption(phone: string) {
  return { phoneEncrypted: { encrypted: phone } }
}

function makeCompleteDcaLicenseTypesResponse() {
  return makeJsonResponse({
    getAllLicenseTypes: [
      {
        licenseTypes: [
          {
            licenseLongName: 'COSMETOLOGIST',
            publicNameDesc: 'COSMETOLOGIST',
            clientCode: 'COSM',
          },
          {
            licenseLongName: 'BARBER',
            publicNameDesc: 'BARBER',
            clientCode: 'BARB',
          },
          {
            licenseLongName: 'ESTHETICIAN',
            publicNameDesc: 'ESTHETICIAN',
            clientCode: 'ESTH',
          },
          {
            licenseLongName: 'MANICURIST',
            publicNameDesc: 'MANICURIST',
            clientCode: 'MANI',
          },
          {
            licenseLongName: 'HAIRSTYLIST',
            publicNameDesc: 'HAIRSTYLIST',
            clientCode: 'HAIR',
          },
          {
            licenseLongName: 'ELECTROLOGIST',
            publicNameDesc: 'ELECTROLOGIST',
            clientCode: 'ELEC',
          },
        ],
      },
    ],
  })
}

function makeJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('app/api/v1/auth/register/route', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }

    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })

    clearContactLookupHmacKeyringCacheForTests()

    resetMockGroup(mockPrisma.user)
    resetMockGroup(mockPrisma.professionalProfile)
    mockPrisma.$transaction.mockReset()

    mockHashPassword.mockReset()
    mockCreateVerificationToken.mockReset()

    mockValidatePassword.mockReset()
    mockGetCurrentTosVersion.mockReset()
    mockVerifyTurnstileOrFailOpen.mockReset()

    mockConsumeTapIntent.mockReset()

    mockGetAppUrlFromRequest.mockReset()
    mockIssueAndSendEmailVerification.mockReset()

    waitUntilTasks = []
    mockWaitUntil.mockReset()
    mockWaitUntil.mockImplementation((task: Promise<unknown>) => {
      waitUntilTasks.push(Promise.resolve(task))
    })

    mockIsValidIanaTimeZone.mockReset()

    mockEnforceRateLimit.mockReset()
    mockRateLimitIdentity.mockReset()
    mockPhoneRateLimitIdentity.mockReset()

    mockIsRuntimeFlagEnabled.mockReset()
    mockValidateSmsDestinationCountry.mockReset()

    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()

    mockBuildAddressPrivacyWriteData.mockReset()
    mockBuildAddressPrivacyWriteData.mockReturnValue({
      addressPrivacyEnvelope: {
        v: 1,
        kid: 'test-address-key',
        alg: 'aes-256-gcm',
        iv: 'test-iv',
        tag: 'test-tag',
        ciphertext: 'test-ciphertext',
      },
      addressPrivacyKeyVersion: 1,
      addressPostalCodeHash: 'test-postal-code-hash',
      addressGeoHash: 'test-geo-hash',
    })

    mockStartTwilioVerifyPhoneVerification.mockReset()

    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)

    mockRateLimitIdentity.mockResolvedValue({
      kind: 'ip',
      id: '198.51.100.10',
    })

    mockPhoneRateLimitIdentity.mockReturnValue({
      kind: 'phone',
      id: '+15551234567',
    })

    mockEnforceRateLimit.mockResolvedValue(null)

    mockIsRuntimeFlagEnabled.mockImplementation(async () => false)

    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: true,
      phone: '+15551234567',
      countryCode: 'US',
    })

    mockValidatePassword.mockReturnValue(null)
    mockGetCurrentTosVersion.mockReturnValue('2026-04')

    mockVerifyTurnstileOrFailOpen.mockResolvedValue({
      ok: true,
      failOpen: false,
    })

    mockHashPassword.mockResolvedValue('hashed_password')
    mockCreateVerificationToken.mockReturnValue('verification_token')

    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')

    mockIssueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_1',
      expiresAt: new Date('2026-04-09T12:00:00.000Z'),
    })

    mockIsValidIanaTimeZone.mockReturnValue(true)

    mockConsumeTapIntent.mockResolvedValue({
      nextUrl: '/looks?from=tap',
    })

    mockPrisma.user.findFirst.mockResolvedValue(null)
    mockPrisma.professionalProfile.findFirst.mockResolvedValue(null)

    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: true,
      sid: 'VE123456789',
      status: 'pending',
    })

    process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid'
    process.env.TWILIO_AUTH_TOKEN = 'test_auth_token'
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test_verify_service'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearContactLookupHmacKeyringCacheForTests()
  })

  it('creates the initial PRO_SALON location as non-bookable', async () => {
    const tx = makeSuccessfulRegisterTx({
      userId: 'user_pro_salon',
      email: 'pro-salon@example.com',
      role: Role.PRO,
    })

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(makeRequest(makeProSalonSignupBody()))

    expect(result.status).toBe(201)

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'pro-salon@example.com',
          ...expectedEmailLookupData('pro-salon@example.com'),
          phone: '+15551234567',
          ...expectedPhoneLookupData('+15551234567'),
          ...expectedPhoneEncryption('+15551234567'),
          role: 'PRO',
          transactionalSmsConsentAt: expect.any(Date),
          transactionalSmsConsentVersion: '2026-04-17',
          transactionalSmsConsentSource: 'WEB_SIGNUP_PRO',
          transactionalSmsConsentIp: '198.51.100.10',
          transactionalSmsConsentUserAgent: 'vitest',
          professionalProfile: {
            create: expect.objectContaining({
              firstName: 'Tori',
              lastName: 'Morales',
              phone: '+15551234567',
              timeZone: 'America/Los_Angeles',
              businessName: 'TOVIS Studio',
              professionType: 'MAKEUP_ARTIST',
              verificationStatus: 'PENDING',
              licenseVerified: false,
              mobileBasePostalCode: null,
              mobileRadiusMiles: null,
              locations: {
                create: expect.objectContaining({
                  type: 'SALON',
                  name: 'TOVIS Studio',
                  isPrimary: true,
                  isBookable: false,
                  formattedAddress: '123 Main St, San Diego, CA 92101',
                  city: 'San Diego',
                  state: 'CA',
                  postalCode: '92101',
                  countryCode: 'US',
                  placeId: 'place_123',
                  lat: 32.7157,
                  lng: -117.1611,
                  timeZone: 'America/Los_Angeles',
                  workingHours: expect.any(Object),
                  addressPrivacyEnvelope: expect.any(Object),
                  addressPrivacyKeyVersion: expect.any(Number),
                  addressPostalCodeHash: expect.any(String),
                  addressGeoHash: expect.any(String),
                }),
              },
            }),
          },
        }),
      }),
    )

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_pro_salon',
      role: Role.PRO,
      authVersion: 1,
      deviceId: null,
    })
  })

  it('creates the initial PRO_MOBILE location as non-bookable', async () => {
    const tx = makeSuccessfulRegisterTx({
      userId: 'user_pro_mobile',
      email: 'pro-mobile@example.com',
      role: Role.PRO,
    })

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(makeRequest(makeProMobileSignupBody()))

    expect(result.status).toBe(201)

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'pro-mobile@example.com',
          ...expectedEmailLookupData('pro-mobile@example.com'),
          phone: '+15551234567',
          ...expectedPhoneLookupData('+15551234567'),
          ...expectedPhoneEncryption('+15551234567'),
          role: 'PRO',
          transactionalSmsConsentAt: expect.any(Date),
          transactionalSmsConsentVersion: '2026-04-17',
          transactionalSmsConsentSource: 'WEB_SIGNUP_PRO',
          transactionalSmsConsentIp: '198.51.100.10',
          transactionalSmsConsentUserAgent: 'vitest',
          professionalProfile: {
            create: expect.objectContaining({
              firstName: 'Tori',
              lastName: 'Morales',
              phone: '+15551234567',
              timeZone: 'America/Los_Angeles',
              businessName: 'TOVIS Mobile',
              professionType: 'MAKEUP_ARTIST',
              verificationStatus: 'PENDING',
              licenseVerified: false,
              mobileBasePostalCode: '92101',
              mobileRadiusMiles: 25,
              locations: {
                create: expect.objectContaining({
                  type: 'MOBILE_BASE',
                  name: 'Mobile base',
                  isPrimary: true,
                  isBookable: false,
                  city: 'San Diego',
                  state: 'CA',
                  postalCode: '92101',
                  countryCode: 'US',
                  lat: 32.7157,
                  lng: -117.1611,
                  timeZone: 'America/Los_Angeles',
                  workingHours: expect.any(Object),
                  addressPrivacyEnvelope: expect.any(Object),
                  addressPrivacyKeyVersion: expect.any(Number),
                  addressPostalCodeHash: expect.any(String),
                  addressGeoHash: expect.any(String),
                }),
              },
            }),
          },
        }),
      }),
    )

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_pro_mobile',
      role: Role.PRO,
      authVersion: 1,
      deviceId: null,
    })
  })

  it('writes v2 user and client contact lookup hashes during client signup', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_hash_1',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(makeRequest(makeClientSignupBody()))

    expect(result.status).toBe(201)

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'client@example.com',
          ...expectedEmailLookupData('client@example.com'),
          phone: '+15551234567',
          ...expectedPhoneLookupData('+15551234567'),
          ...expectedPhoneEncryption('+15551234567'),
          clientProfile: {
            create: {
              homeTenantId: 'tenant_root',
              firstName: 'Tori',
              lastName: 'Morales',
              phone: '+15551234567',
              ...expectedEmailLookupData('client@example.com'),
              ...expectedPhoneLookupData('+15551234567'),
              ...expectedPhoneEncryption('+15551234567'),
              phoneVerifiedAt: null,
            },
          },
        })
      }),
    )
  })

  it('passes through the verified-register rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValueOnce(rateLimitRes)

    const result = await POST(makeRequest(makeClientSignupBody()))

    expect(mockVerifyTurnstileOrFailOpen).toHaveBeenCalledWith({
      request: expect.any(Request),
      token: 'ts_signup_ok',
    })

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:register:verified',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })

    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('uses the base register bucket when Turnstile fails open', async () => {
    mockVerifyTurnstileOrFailOpen.mockResolvedValue({
      ok: true,
      failOpen: true,
      eventName: 'auth.turnstile.fail_open',
      reason: 'turnstile_network_or_timeout',
    })

    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_failopen',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(makeRequest(makeClientSignupBody()))
    expect(result.status).toBe(201)

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.register.captcha_fail_open',
      route: 'auth.register',
      email: 'client@example.com',
      phone: '+15551234567',
      meta: {
        captchaEvent: 'auth.turnstile.fail_open',
        reason: 'turnstile_network_or_timeout',
        role: 'CLIENT',
      },
    })
  })

  it('rejects phone values that canonical normalization refuses', async () => {
    const body = {
      ...makeClientSignupBody(),
      phone: '555-123-4567 ext 9',
    }

    const result = await POST(makeRequest(body))
    const data = await result.json()

    expect(result.status).toBe(400)
    expect(data).toEqual({
      ok: false,
      error: 'Enter a valid phone number.',
      code: 'INVALID_PHONE_FORMAT',
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 503 when signup is disabled', async () => {
    mockIsRuntimeFlagEnabled.mockImplementation(async (name: string) => {
      return name === 'signup_disabled'
    })

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'Signup is temporarily unavailable.',
      code: 'SIGNUP_DISABLED',
    })

    expect(mockVerifyTurnstileOrFailOpen).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 503 when SMS is disabled', async () => {
    mockIsRuntimeFlagEnabled.mockImplementation(async (name: string) => {
      return name === 'sms_disabled'
    })

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'SMS verification is temporarily unavailable.',
      code: 'SMS_DISABLED',
    })

    expect(mockVerifyTurnstileOrFailOpen).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
  it('returns 400 when transactional SMS consent is missing', async () => {
    const body = makeClientSignupBody()
    delete (body as { transactionalSmsConsent?: boolean }).transactionalSmsConsent

    const result = await POST(makeRequest(body))
    const data = await result.json()

    expect(result.status).toBe(400)
    expect(data).toEqual({
      ok: false,
      error:
        'You must agree to receive transactional SMS messages for account verification and appointment updates.',
      code: 'SMS_CONSENT_REQUIRED',
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the SMS destination country is unsupported', async () => {
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'SMS verification is not available for this country yet.',
      countryCode: 'GB',
    })

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'SMS verification is not available for this country yet.',
      code: 'SMS_COUNTRY_UNSUPPORTED',
      countryCode: 'GB',
    })

    expect(mockVerifyTurnstileOrFailOpen).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns the shared per-phone quota response unchanged when SMS quota blocks signup', async () => {
    const quotaRes = new Response(null, { status: 429 })

    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(quotaRes)

    const result = await POST(makeRequest(makeClientSignupBody()))

    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:register:verified',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(result).toBe(quotaRes)
    expect(result.status).toBe(429)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it.each(['admin', 'Admin', 'tovis'])(
    'returns 400 HANDLE_RESERVED for reserved pro handle %s',
    async (handle) => {
      const result = await POST(makeRequest(makeProSignupBody({ handle })))
      const body = await result.json()

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'That handle is reserved.',
        code: 'HANDLE_RESERVED',
      })

      expect(mockPrisma.professionalProfile.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    },
  )

    it('returns the shared daily per-phone quota response unchanged when SMS daily quota blocks signup', async () => {
    const quotaRes = new Response(null, { status: 429 })

    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(quotaRes)

    const result = await POST(makeRequest(makeClientSignupBody()))

    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:register:verified',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(3, {
      bucket: 'auth:sms-phone-day',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(result).toBe(quotaRes)
    expect(result.status).toBe(429)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockPrisma.professionalProfile.findFirst).not.toHaveBeenCalled()
  })
  
  it('allows a non-reserved pro handle when otherwise valid', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'pro_user_1',
          email: 'pro@example.com',
          role: Role.PRO,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(
      makeRequest(makeProSignupBody({ handle: 'jane-smith' })),
    )
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)

    expect(mockPrisma.professionalProfile.findFirst).toHaveBeenCalledWith({
      where: { handleNormalized: 'jane-smith' },
      select: { id: true },
    })

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'pro@example.com',
        ...expectedEmailLookupData('pro@example.com'),
        phone: '+15551234567',
        ...expectedPhoneLookupData('+15551234567'),
        ...expectedPhoneEncryption('+15551234567'),
        role: 'PRO',
        transactionalSmsConsentAt: expect.any(Date),
        transactionalSmsConsentVersion: '2026-04-17',
        transactionalSmsConsentSource: 'WEB_SIGNUP_PRO',
        transactionalSmsConsentIp: '198.51.100.10',
        transactionalSmsConsentUserAgent: 'vitest',
        professionalProfile: {
          create: expect.objectContaining({
            handle: 'jane-smith',
            handleNormalized: 'jane-smith',
            professionType: 'MAKEUP_ARTIST',
          }),
        },
      }),
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
        authVersion: true,
      },
    })
  })

  it('creates an unverified client account, returns pending verification send states immediately, and finishes the async tail in waitUntil', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const verifyDeferred = createDeferred<{
      ok: true
      sid: string
      status: string
    }>()

    mockStartTwilioVerifyPhoneVerification.mockReturnValueOnce(
      verifyDeferred.promise,
    )

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'client@example.com',
        role: Role.CLIENT,
      },
      token: 'verification_token',
      nextUrl: null,
      requiresPhoneVerification: true,
      phoneVerificationSent: 'pending',
      phoneVerificationErrorCode: null,
      requiresEmailVerification: true,
      isPhoneVerified: false,
      isEmailVerified: false,
      isFullyVerified: false,
      emailVerificationSent: 'pending',
      needsManualLicenseUpload: false,
      manualLicensePendingReview: false,
    })

    expect(mockValidatePassword).toHaveBeenCalledWith('SuperSecret123!')
    expect(mockGetCurrentTosVersion).toHaveBeenCalledTimes(1)

    expect(mockIsRuntimeFlagEnabled).toHaveBeenNthCalledWith(
      1,
      'signup_disabled',
    )
    expect(mockIsRuntimeFlagEnabled).toHaveBeenNthCalledWith(2, 'sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )

    expect(mockVerifyTurnstileOrFailOpen).toHaveBeenCalledWith({
      request: expect.any(Request),
      token: 'ts_signup_ok',
    })

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:register:verified',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(3, {
      bucket: 'auth:sms-phone-day',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(mockHashPassword).toHaveBeenCalledWith('SuperSecret123!')
    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
      deviceId: null,
    })

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'client@example.com',
        ...expectedEmailLookupData('client@example.com'),
        phone: '+15551234567',
        ...expectedPhoneLookupData('+15551234567'),
        ...expectedPhoneEncryption('+15551234567'),
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        password: 'hashed_password',
        role: 'CLIENT',
        tosAcceptedAt: expect.any(Date),
        tosVersion: '2026-04',
        transactionalSmsConsentAt: expect.any(Date),
        transactionalSmsConsentVersion: '2026-04-17',
        transactionalSmsConsentSource: 'WEB_SIGNUP_CLIENT',
        transactionalSmsConsentIp: '198.51.100.10',
        transactionalSmsConsentUserAgent: 'vitest',
        clientProfile: {
          create: {
            homeTenantId: 'tenant_root',
            firstName: 'Tori',
            lastName: 'Morales',
            phone: '+15551234567',
            ...expectedEmailLookupData('client@example.com'),
            ...expectedPhoneLookupData('+15551234567'),
            ...expectedPhoneEncryption('+15551234567'),
            phoneVerifiedAt: null,
          },
        },
      }),
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
        authVersion: true,
      },
    })

    expect(tx).not.toHaveProperty('phoneVerification')

    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
    expect(mockConsumeTapIntent).not.toHaveBeenCalled()

    verifyDeferred.resolve({
      ok: true,
      sid: 'VE123456789',
      status: 'pending',
    })

    await flushWaitUntilTasks()

    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        email: 'client@example.com',
        appUrl: 'http://localhost:3000',
        next: null,
        intent: null,
        inviteToken: null,
      }),
    )

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_1',
    })

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15551234567',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.phone.verify.start.success',
      route: 'auth.register',
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        sid: 'VE123456789',
        status: 'pending',
      },
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.send.success',
      route: 'auth.register',
      provider: 'postmark',
      userId: 'user_1',
      email: 'client@example.com',
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
    expect(setCookie).toContain('tovis_client_zip=92101')
  })

  it('still returns 201 immediately when email send fails in the background tail', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_2',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockIssueAndSendEmailVerification.mockRejectedValue(
      new Error('Postmark timeout'),
    )

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.requiresPhoneVerification).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
    expect(body.isFullyVerified).toBe(false)
    expect(body.phoneVerificationSent).toBe('pending')
    expect(body.phoneVerificationErrorCode).toBe(null)
    expect(body.emailVerificationSent).toBe('pending')

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_2',
      role: Role.CLIENT,
      authVersion: 1,
      deviceId: null,
    })

    await flushWaitUntilTasks()

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.email.send.failed',
      route: 'auth.register',
      provider: 'postmark',
      userId: 'user_2',
      email: 'client@example.com',
      error: expect.any(Error),
    })

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_2',
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
  })

  it('still returns 201 immediately when Twilio Verify start fails in the background tail', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_3',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockStartTwilioVerifyPhoneVerification.mockResolvedValueOnce({
      ok: false,
      code: 'TWILIO_VERIFY_SEND_FAILED',
      message: 'Twilio Verify failed.',
    })

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.requiresPhoneVerification).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
    expect(body.isFullyVerified).toBe(false)
    expect(body.phoneVerificationSent).toBe('pending')
    expect(body.phoneVerificationErrorCode).toBe(null)
    expect(body.emailVerificationSent).toBe('pending')

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_3',
      role: Role.CLIENT,
      authVersion: 1,
      deviceId: null,
    })

    await flushWaitUntilTasks()

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.verify.start.failed',
      route: 'auth.register',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_SEND_FAILED',
      userId: 'user_3',
      phone: '+15551234567',
      meta: {
        message: 'Twilio Verify failed.',
      },
    })

    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_3',
        email: 'client@example.com',
        appUrl: 'http://localhost:3000',
      }),
    )

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_3',
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
  })

  it('still returns 201 immediately when twilio env is missing in the background tail', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_4',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockStartTwilioVerifyPhoneVerification.mockResolvedValueOnce({
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message:
        'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
    })
    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.phoneVerificationSent).toBe('pending')
    expect(body.phoneVerificationErrorCode).toBe(null)
    expect(body.emailVerificationSent).toBe('pending')

    await flushWaitUntilTasks()

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'auth.phone.verify.start.failed',
      route: 'auth.register',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      userId: 'user_4',
      phone: '+15551234567',
      meta: {
        message:
          'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
      },
    })

    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_4',
        email: 'client@example.com',
        appUrl: 'http://localhost:3000',
      }),
    )

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_4',
    })
  })

  it('degrades DCA timeout to PENDING for CA-license signup and still creates the PRO account', async () => {
    process.env.DCA_SEARCH_APP_ID = 'dca_app_id'
    process.env.DCA_SEARCH_APP_KEY = 'dca_app_key'

    const tx = makeSuccessfulRegisterTx({
      userId: 'user_dca_timeout',
      email: 'pro@example.com',
      role: Role.PRO,
    })

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      if (url.includes('getAllLicenseTypes')) {
        return makeCompleteDcaLicenseTypesResponse()
      }

      if (url.includes('getLicenseNumberSearch')) {
        const err = new Error('Aborted')
        Object.defineProperty(err, 'name', {
          value: 'AbortError',
          configurable: true,
        })
        throw err
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const result = await POST(
      makeRequest(
        makeProSignupBody({
          professionType: 'ESTHETICIAN',
          licenseState: 'CA',
          licenseNumber: 'Z123456',
        }),
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.requiresPhoneVerification).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
    expect(body.phoneVerificationSent).toBe('pending')
    expect(body.emailVerificationSent).toBe('pending')

    const createCall = tx.user.create.mock.calls[0]?.[0]
    expect(createCall).toBeTruthy()

    expect(createCall?.select).toEqual({
      id: true,
      email: true,
      role: true,
      phone: true,
      authVersion: true,
    })

    expect(createCall?.data).toEqual(
      expect.objectContaining({
        email: 'pro@example.com',
        ...expectedEmailLookupData('pro@example.com'),
        phone: '+15551234567',
        ...expectedPhoneLookupData('+15551234567'),
        ...expectedPhoneEncryption('+15551234567'),
        role: 'PRO',
        transactionalSmsConsentAt: expect.any(Date),
        transactionalSmsConsentVersion: '2026-04-17',
        transactionalSmsConsentSource: 'WEB_SIGNUP_PRO',
        transactionalSmsConsentIp: '198.51.100.10',
        transactionalSmsConsentUserAgent: 'vitest',
        professionalProfile: {
          create: expect.objectContaining({
            professionType: 'ESTHETICIAN',
            licenseState: 'CA',
            licenseNumber: 'Z123456',
            verificationStatus: 'PENDING',
            licenseVerified: false,
            licenseRawJson: {
              note: 'DCA timeout at signup',
              error: 'AbortError',
            },
          }),
        },
      }),
    )

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.dca.timeout',
      route: 'auth.register',
      userId: 'user_dca_timeout',
    })

    await flushWaitUntilTasks()
  })

  it('still blocks signup when the CA license is found but not CURRENT', async () => {
    process.env.DCA_SEARCH_APP_ID = 'dca_app_id'
    process.env.DCA_SEARCH_APP_KEY = 'dca_app_key'

    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      if (url.includes('getAllLicenseTypes')) {
        return makeCompleteDcaLicenseTypesResponse()
      }

      if (url.includes('getLicenseNumberSearch')) {
        const licenseDetail = {
          licNumber: 'Z123456',
          primaryStatusCode: 'EXPIRED',
          expDate: '2025-01-01',
        }

        return makeJsonResponse({
          licenseDetails: [
            {
              licNumber: 'Z123456',
              primaryStatusCode: 'EXPIRED',
              expDate: '2025-01-01',
              getLicenseDetails: [licenseDetail],
              getFullLicenseDetail: [
                {
                  getLicenseDetails: [licenseDetail],
                },
              ],
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const result = await POST(
      makeRequest(
        makeProSignupBody({
          professionType: 'ESTHETICIAN',
          licenseState: 'CA',
          licenseNumber: 'Z123456',
        }),
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toMatchObject({
      ok: false,
      error: 'License could not be verified as CURRENT.',
      code: 'LICENSE_NOT_VERIFIED',
      statusCode: 'EXPIRED',
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockWaitUntil).not.toHaveBeenCalled()
  })

  it('returns 500 when the app URL cannot be resolved', async () => {
    mockGetAppUrlFromRequest.mockReturnValue(null)

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'App URL is not configured.',
      code: 'APP_URL_MISSING',
    })

    expect(mockVerifyTurnstileOrFailOpen).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
  })
})