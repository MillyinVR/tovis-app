// app/api/v1/client/settings/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientAddressKind, Prisma } from '@prisma/client'

const CLIENT_ID = 'client_1'
const USER_EMAIL = 'client@example.com'
const TEST_NOW = new Date('2026-04-16T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),

  clientProfileFindUnique: vi.fn(),
  clientProfileUpdate: vi.fn(),

  buildClientProfileContactLookupData: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
  ) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: {
      findUnique: mocks.clientProfileFindUnique,
      update: mocks.clientProfileUpdate,
    },
  },
}))

vi.mock('@/lib/security/contactLookup', () => ({
  buildClientProfileContactLookupData:
    mocks.buildClientProfileContactLookupData,
}))

// Deterministic stand-in for the AEAD dual-write so the assertion does not
// depend on a keyring being present in the test env (CI has none).
vi.mock('@/lib/security/phonePrivacy', () => ({
  buildPhoneEncryptionWriteData: (input: { phone?: unknown }) =>
    input.phone === undefined
      ? {}
      : { phoneEncrypted: { encrypted: input.phone } },
}))

import { GET, PATCH } from './route'

function makeAuthOk() {
  return {
    ok: true,
    clientId: CLIENT_ID,
    user: {
      id: 'user_1',
      email: USER_EMAIL,
    },
  }
}

function makeAuthFail() {
  return {
    ok: false,
    res: new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  }
}

function makePatchRequest(body: unknown) {
  return new Request('http://localhost/api/v1/client/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeInvalidJsonPatchRequest() {
  return new Request('http://localhost/api/v1/client/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{',
  })
}

function makeClientProfile() {
  return {
    id: CLIENT_ID,
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '555-111-2222',
    avatarUrl: 'https://example.com/avatar.png',
    dateOfBirth: new Date('1992-08-10T12:00:00.000Z'),
    addresses: [
      {
        id: 'service_old',
        kind: ClientAddressKind.SERVICE_ADDRESS,
        label: 'Old service address',
        isDefault: false,
        formattedAddress: '222 Service St, Los Angeles, CA 90002',
        addressLine1: '222 Service St',
        addressLine2: null,
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90002',
        countryCode: 'US',
        placeId: 'place_service_old',
        lat: new Prisma.Decimal('34.0522'),
        lng: new Prisma.Decimal('-118.2437'),
        radiusMiles: null,
        createdAt: new Date('2026-01-03T12:00:00.000Z'),
        updatedAt: new Date('2026-01-04T12:00:00.000Z'),
      },
      {
        id: 'search_area',
        kind: ClientAddressKind.SEARCH_AREA,
        label: 'Search area',
        isDefault: false,
        formattedAddress: 'Los Angeles, CA',
        addressLine1: null,
        addressLine2: null,
        city: 'Los Angeles',
        state: 'CA',
        postalCode: null,
        countryCode: 'US',
        placeId: 'place_search_area',
        lat: null,
        lng: null,
        radiusMiles: 25,
        createdAt: new Date('2026-01-02T12:00:00.000Z'),
        updatedAt: new Date('2026-01-02T13:00:00.000Z'),
      },
      {
        id: 'service_default',
        kind: ClientAddressKind.SERVICE_ADDRESS,
        label: 'Default service address',
        isDefault: true,
        formattedAddress: '111 Service St, Los Angeles, CA 90001',
        addressLine1: '111 Service St',
        addressLine2: 'Apt 1',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_service_default',
        lat: new Prisma.Decimal('34.0501'),
        lng: new Prisma.Decimal('-118.2401'),
        radiusMiles: null,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        updatedAt: new Date('2026-01-01T13:00:00.000Z'),
      },
    ],
  }
}

function expectClientProfileFindUniqueCalled() {
  expect(mocks.clientProfileFindUnique).toHaveBeenCalledWith({
    where: { id: CLIENT_ID },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      dateOfBirth: true,
      addresses: {
        select: {
          id: true,
          clientId: true,
          kind: true,
          label: true,
          isDefault: true,
          formattedAddress: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          countryCode: true,
          placeId: true,
          lat: true,
          lng: true,
          radiusMiles: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })
}

describe('app/api/v1/client/settings/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.requireClient.mockResolvedValue(makeAuthOk())
    mocks.clientProfileFindUnique.mockResolvedValue(makeClientProfile())
    mocks.clientProfileUpdate.mockResolvedValue({ id: CLIENT_ID })
    mocks.buildClientProfileContactLookupData.mockReturnValue({
      phoneLookupHash: 'phone_lookup_hash_1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns auth response when GET is unauthorized', async () => {
    mocks.requireClient.mockResolvedValueOnce(makeAuthFail())

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.clientProfileFindUnique).not.toHaveBeenCalled()
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('loads client settings for the authenticated client and sorts addresses for settings', async () => {
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expectClientProfileFindUniqueCalled()

    expect(json).toEqual({
      ok: true,
      profile: {
        id: CLIENT_ID,
        email: USER_EMAIL,
        firstName: 'Tori',
        lastName: 'Morales',
        phone: '555-111-2222',
        avatarUrl: 'https://example.com/avatar.png',
        dateOfBirth: '1992-08-10',
      },
      addresses: [
        {
          id: 'search_area',
          kind: ClientAddressKind.SEARCH_AREA,
          label: 'Search area',
          isDefault: false,
          formattedAddress: 'Los Angeles, CA',
          addressLine1: null,
          addressLine2: null,
          city: 'Los Angeles',
          state: 'CA',
          postalCode: null,
          countryCode: 'US',
          placeId: 'place_search_area',
          lat: null,
          lng: null,
          radiusMiles: 25,
          createdAt: '2026-01-02T12:00:00.000Z',
          updatedAt: '2026-01-02T13:00:00.000Z',
        },
        {
          id: 'service_default',
          kind: ClientAddressKind.SERVICE_ADDRESS,
          label: 'Default service address',
          isDefault: true,
          formattedAddress: '111 Service St, Los Angeles, CA 90001',
          addressLine1: '111 Service St',
          addressLine2: 'Apt 1',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          countryCode: 'US',
          placeId: 'place_service_default',
          lat: 34.0501,
          lng: -118.2401,
          radiusMiles: null,
          createdAt: '2026-01-01T12:00:00.000Z',
          updatedAt: '2026-01-01T13:00:00.000Z',
        },
        {
          id: 'service_old',
          kind: ClientAddressKind.SERVICE_ADDRESS,
          label: 'Old service address',
          isDefault: false,
          formattedAddress: '222 Service St, Los Angeles, CA 90002',
          addressLine1: '222 Service St',
          addressLine2: null,
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90002',
          countryCode: 'US',
          placeId: 'place_service_old',
          lat: 34.0522,
          lng: -118.2437,
          radiusMiles: null,
          createdAt: '2026-01-03T12:00:00.000Z',
          updatedAt: '2026-01-04T12:00:00.000Z',
        },
      ],
    })
  })

  it('returns 404 when GET cannot find the client profile', async () => {
    mocks.clientProfileFindUnique.mockResolvedValueOnce(null)

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json).toEqual({
      ok: false,
      error: 'Client profile not found.',
    })
  })

  it('returns sanitized 500 when GET throws unexpectedly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.clientProfileFindUnique.mockRejectedValueOnce(new Error('db exploded'))

    try {
      const response = await GET()
      const json = await response.json()

      expect(response.status).toBe(500)
      expect(json).toEqual({
        ok: false,
        error: 'Failed to load client settings.',
      })

      expect(consoleError).toHaveBeenCalledWith(
        'GET /api/v1/client/settings error',
        expect.any(Error),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('returns auth response when PATCH is unauthorized', async () => {
    mocks.requireClient.mockResolvedValueOnce(makeAuthFail())

    const response = await PATCH(
      makePatchRequest({
        firstName: 'New',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.clientProfileFindUnique).not.toHaveBeenCalled()
    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('returns current settings when PATCH has no supported changes', async () => {
    const response = await PATCH(
      makePatchRequest({
        unsupported: 'ignored',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
    expect(mocks.clientProfileFindUnique).toHaveBeenCalledTimes(1)
  })

  it('treats invalid JSON PATCH body as no changes and returns current settings', async () => {
    const response = await PATCH(makeInvalidJsonPatchRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
    expect(mocks.clientProfileFindUnique).toHaveBeenCalledTimes(1)
  })

  it('updates editable profile fields and reloads settings', async () => {
    const response = await PATCH(
      makePatchRequest({
        firstName: '  Victoria  ',
        lastName: '  Morales  ',
        phone: '  555-999-0000  ',
        avatarUrl: '  https://example.com/new-avatar.png  ',
        dateOfBirth: '1992-08-10',
      }),
    )
    const json = await response.json()

    expect(mocks.buildClientProfileContactLookupData).toHaveBeenCalledWith({
      phone: '+15559990000',
    })

    expect(mocks.clientProfileUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: {
        firstName: 'Victoria',
        lastName: 'Morales',
        phone: '+15559990000',
        phoneLookupHash: 'phone_lookup_hash_1',
        phoneEncrypted: { encrypted: '+15559990000' },
        avatarUrl: 'https://example.com/new-avatar.png',
        dateOfBirth: new Date('1992-08-10T12:00:00.000Z'),
      },
      select: { id: true },
    })

    expect(mocks.clientProfileFindUnique).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('normalizes blank optional PATCH fields to null', async () => {
    const response = await PATCH(
      makePatchRequest({
        phone: '   ',
        avatarUrl: '',
        dateOfBirth: null,
      }),
    )
    const json = await response.json()

    expect(mocks.buildClientProfileContactLookupData).toHaveBeenCalledWith({
      phone: null,
    })

    expect(mocks.clientProfileUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: {
        phone: null,
        phoneLookupHash: 'phone_lookup_hash_1',
        phoneEncrypted: { encrypted: null },
        avatarUrl: null,
        dateOfBirth: null,
      },
      select: { id: true },
    })

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('allows blank names because current route normalizes them to empty strings', async () => {
    const response = await PATCH(
      makePatchRequest({
        firstName: '   ',
        lastName: '',
      }),
    )
    const json = await response.json()

    expect(mocks.clientProfileUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: {
        firstName: '',
        lastName: '',
      },
      select: { id: true },
    })

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('rejects null firstName', async () => {
    const response = await PATCH(
      makePatchRequest({
        firstName: null,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid firstName.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects null lastName', async () => {
    const response = await PATCH(
      makePatchRequest({
        lastName: null,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid lastName.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects overlong firstName', async () => {
    const response = await PATCH(
      makePatchRequest({
        firstName: 'x'.repeat(81),
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid firstName.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects overlong lastName', async () => {
    const response = await PATCH(
      makePatchRequest({
        lastName: 'x'.repeat(81),
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid lastName.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects overlong phone', async () => {
    const response = await PATCH(
      makePatchRequest({
        phone: '1'.repeat(41),
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid phone.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects overlong avatarUrl', async () => {
    const response = await PATCH(
      makePatchRequest({
        avatarUrl: `https://example.com/${'x'.repeat(2000)}`,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid avatarUrl.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects invalid dateOfBirth format', async () => {
    const response = await PATCH(
      makePatchRequest({
        dateOfBirth: '08/10/1992',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid dateOfBirth. Use YYYY-MM-DD.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects impossible dateOfBirth calendar dates', async () => {
    const response = await PATCH(
      makePatchRequest({
        dateOfBirth: '2026-02-31',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid dateOfBirth. Use YYYY-MM-DD.',
    })

    expect(mocks.clientProfileUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when PATCH update succeeds but profile reload cannot find the client profile', async () => {
    mocks.clientProfileFindUnique.mockResolvedValueOnce(null)

    const response = await PATCH(
      makePatchRequest({
        firstName: 'Victoria',
      }),
    )
    const json = await response.json()

    expect(mocks.clientProfileUpdate).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(404)
    expect(json).toEqual({
      ok: false,
      error: 'Client profile not found.',
    })
  })

  it('returns sanitized 500 when PATCH throws unexpectedly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.clientProfileUpdate.mockRejectedValueOnce(new Error('db exploded'))

    try {
      const response = await PATCH(
        makePatchRequest({
          firstName: 'Victoria',
        }),
      )
      const json = await response.json()

      expect(response.status).toBe(500)
      expect(json).toEqual({
        ok: false,
        error: 'Failed to update client settings.',
      })

      expect(consoleError).toHaveBeenCalledWith(
        'PATCH /api/v1/client/settings error',
        expect.any(Error),
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})