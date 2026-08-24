// app/api/v1/pro/upgrade/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, VerificationStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveProProfileSetup: vi.fn(),
  buildProfessionalProfileCreateData: vi.fn(),
  claimHandle: vi.fn(),
  createActiveToken: vi.fn(),
  captureAuthException: vi.fn(),
  tx: {
    professionalProfile: { create: vi.fn() },
    user: { update: vi.fn() },
  },
  prisma: { $transaction: vi.fn() },
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))
vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  tokenRateLimitIdentity: (id: string) => ({ kind: 'token', id }),
}))
vi.mock('@/lib/pro/proProfileSetup', () => ({
  resolveProProfileSetup: mocks.resolveProProfileSetup,
  buildProfessionalProfileCreateData: mocks.buildProfessionalProfileCreateData,
  claimHandle: mocks.claimHandle,
  parseProNumber: (v: unknown) =>
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : null,
}))
vi.mock('@/lib/auth', () => ({ createActiveToken: mocks.createActiveToken }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    tenantId: 'tenant_root',
    slug: 'tovis-root',
    isRoot: true,
  })),
}))
vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: mocks.captureAuthException,
}))

import { POST } from './route'

const SALON_LOCATION = {
  kind: 'PRO_SALON',
  placeId: 'place_1',
  formattedAddress: '1 Main St, San Diego, CA',
  city: 'San Diego',
  state: 'CA',
  postalCode: '92101',
  countryCode: 'US',
  lat: 32.7,
  lng: -117.1,
  timeZoneId: 'America/Los_Angeles',
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/upgrade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.tovis.app' },
    body: JSON.stringify(body),
  })
}

function makeBody(overrides?: Record<string, unknown>) {
  return {
    professionType: 'COSMETOLOGIST',
    licenseState: 'CA',
    licenseNumber: 'KK123456',
    handle: 'tori',
    businessName: 'Glow Studio',
    signupLocation: SALON_LOCATION,
    ...overrides,
  }
}

function makeClientUser(overrides?: Record<string, unknown>) {
  return {
    id: 'user_1',
    role: Role.CLIENT,
    authVersion: 3,
    deviceId: null,
    phone: '+16195551234',
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    professionalProfile: null,
    clientProfile: { id: 'client_1', firstName: 'Tori', lastName: 'Morales' },
    ...overrides,
  }
}

const RESOLVED = {
  profession: 'COSMETOLOGIST',
  businessName: 'Glow Studio',
  handleToStore: 'tori',
  normalizedHandle: 'tori',
  mobileRadiusMiles: null,
  verificationStatus: VerificationStatus.APPROVED,
  licenseVerified: true,
  licenseStateToStore: 'CA',
  licenseNumberToStore: 'KK123456',
  licenseExpiryToStore: null,
  licenseVerifiedAtToStore: new Date('2026-08-23T00:00:00.000Z'),
  licenseVerifiedSourceToStore: 'CA_DCA_BREEZE',
  licenseStatusCodeToStore: '20',
  licenseRawJsonToStore: undefined,
  manualLicenseDocUrl: null,
  needsManualLicenseUpload: false,
  manualLicensePendingReview: false,
  dcaTimedOutAtSignup: false,
}

describe('POST /api/v1/pro/upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue({ ok: true, user: makeClientUser() })
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.resolveProProfileSetup.mockResolvedValue({ ok: true, value: RESOLVED })
    mocks.buildProfessionalProfileCreateData.mockReturnValue({ firstName: 'Tori' })
    mocks.createActiveToken.mockReturnValue('active_token')
    mocks.tx.professionalProfile.create.mockResolvedValue({ id: 'pro_1' })
    mocks.tx.user.update.mockResolvedValue({})
    mocks.prisma.$transaction.mockImplementation(
      async (run: (tx: typeof mocks.tx) => Promise<unknown>) => run(mocks.tx),
    )
  })

  it('passes an auth refusal straight through', async () => {
    const res = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValueOnce({ ok: false, res })

    const result = await POST(makeRequest(makeBody()))

    expect(result).toBe(res)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('requires a CLIENT-role session', async () => {
    await POST(makeRequest(makeBody()))
    expect(mocks.requireUser).toHaveBeenCalledWith({ roles: [Role.CLIENT] })
  })

  it('rate limits per user before doing any work', async () => {
    const limitRes = new Response(null, { status: 429 })
    mocks.enforceRateLimit.mockResolvedValueOnce(limitRes)

    const result = await POST(makeRequest(makeBody()))

    expect(result).toBe(limitRes)
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:upgrade',
      identity: { kind: 'token', id: 'user_1' },
    })
    // The expensive licence lookup must not run for a limited caller.
    expect(mocks.resolveProProfileSetup).not.toHaveBeenCalled()
  })

  it('refuses an account that already has a professional profile', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: makeClientUser({ professionalProfile: { id: 'pro_existing' } }),
    })

    const result = await POST(makeRequest(makeBody()))
    const body = await result.json()

    expect(result.status).toBe(409)
    expect(body.code).toBe('ALREADY_PRO')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses a client ZIP — that is not a place of business', async () => {
    const result = await POST(
      makeRequest(
        makeBody({
          signupLocation: {
            kind: 'CLIENT_ZIP',
            postalCode: '92101',
            lat: 32.7,
            lng: -117.1,
            timeZoneId: 'America/Los_Angeles',
          },
        }),
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('LOCATION_INVALID')
    expect(mocks.resolveProProfileSetup).not.toHaveBeenCalled()
  })

  it('translates a shared-resolver refusal back into jsonFail, extras included', async () => {
    mocks.resolveProProfileSetup.mockResolvedValueOnce({
      ok: false,
      failure: {
        status: 400,
        message: 'License could not be verified as CURRENT.',
        code: 'LICENSE_NOT_VERIFIED',
        extra: { statusCode: '40' },
      },
    })

    const result = await POST(makeRequest(makeBody()))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('LICENSE_NOT_VERIFIED')
    expect(body.statusCode).toBe('40')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates the profile, claims the handle, flips the home role and re-mints the session', async () => {
    const result = await POST(makeRequest(makeBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.professionalId).toBe('pro_1')
    expect(body.token).toBe('active_token')
    expect(body.nextUrl).toBe('/pro/calendar')

    // The profile is attached to the EXISTING user via a relation connect.
    const createArg = mocks.tx.professionalProfile.create.mock.calls[0]?.[0]
    expect(createArg.data.user).toEqual({ connect: { id: 'user_1' } })

    // The client's own identity carries over, verified phone included.
    expect(mocks.buildProfessionalProfileCreateData).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          firstName: 'Tori',
          lastName: 'Morales',
          phone: '+16195551234',
        },
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      }),
    )

    expect(mocks.claimHandle).toHaveBeenCalledWith(mocks.tx, 'tori', {
      kind: 'PRO',
      professionalId: 'pro_1',
    })

    // See the DECISION note in the route: the home role has to flip or a
    // PENDING pro could never reach the Pro studio.
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { role: Role.PRO },
    })

    expect(mocks.createActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 3,
      deviceId: null,
    })
    expect(result.headers.get('set-cookie')).toContain('tovis_token=active_token')
  })

  it('skips the handle claim when no handle was chosen', async () => {
    mocks.resolveProProfileSetup.mockResolvedValueOnce({
      ok: true,
      value: { ...RESOLVED, handleToStore: null, normalizedHandle: null },
    })

    const result = await POST(makeRequest(makeBody({ handle: null })))

    expect(result.status).toBe(201)
    expect(mocks.claimHandle).not.toHaveBeenCalled()
    // The profile is still created — a handle is optional.
    expect(mocks.tx.professionalProfile.create).toHaveBeenCalledTimes(1)
  })

  it('surfaces the pending-review flags so the caller can say what is left', async () => {
    mocks.resolveProProfileSetup.mockResolvedValueOnce({
      ok: true,
      value: {
        ...RESOLVED,
        verificationStatus: VerificationStatus.PENDING,
        licenseVerified: false,
        needsManualLicenseUpload: true,
      },
    })

    const result = await POST(makeRequest(makeBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.verificationStatus).toBe(VerificationStatus.PENDING)
    expect(body.licenseVerified).toBe(false)
    expect(body.needsManualLicenseUpload).toBe(true)
  })

  it('returns 500 and captures, without leaking the error, when the transaction throws', async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error('handle race'))

    const result = await POST(makeRequest(makeBody()))
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body.code).toBe('INTERNAL')
    expect(mocks.captureAuthException).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pro.upgrade.failed', userId: 'user_1' }),
    )
  })
})
