// app/api/pros/nearby/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const loadNearbyPros = vi.fn()

  return {
    jsonOk,
    jsonFail,
    loadNearbyPros,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  },
}))

vi.mock('@/lib/discovery/nearbyPros', () => ({
  loadNearbyPros: mocks.loadNearbyPros,
}))

import { GET } from './route'

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

describe('app/api/pros/nearby/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadNearbyPros.mockResolvedValue([])
  })

  it('returns 400 when lat is missing', async () => {
    const res = await GET(makeRequest('/api/pros/nearby?lng=-117.1611'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Valid lat is required.',
    })

    expect(mocks.loadNearbyPros).not.toHaveBeenCalled()
  })

  it('rejects unsupported offering aliases', async () => {
    const res = await GET(
      makeRequest('/api/pros/nearby?lat=32.7157&lng=-117.1611&offering=balayage'),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Use serviceId for exact offering matching on this route.',
    })

    expect(mocks.loadNearbyPros).not.toHaveBeenCalled()
  })

  it('passes normalized params to the shared nearby-pros loader', async () => {
    mocks.loadNearbyPros.mockResolvedValue([
      {
        id: 'pro_2',
        businessName: 'Hair One',
        handle: 'hairone',
        professionType: 'BARBER',
        avatarUrl: null,
        locationLabel: 'San Diego, CA',
        distanceMiles: 0.8,
        ratingAvg: 4.7,
        ratingCount: 9,
        minPrice: 85,
        supportsMobile: false,
        closestLocation: {
          id: 'loc_2',
          formattedAddress: '123 Main St',
          city: 'San Diego',
          state: 'CA',
          timeZone: 'America/Los_Angeles',
          placeId: 'place_2',
          lat: 32.72,
          lng: -117.16,
          isPrimary: true,
          workingHours: {},
        },
        primaryLocation: {
          id: 'loc_2',
          formattedAddress: '123 Main St',
          city: 'San Diego',
          state: 'CA',
          timeZone: 'America/Los_Angeles',
          placeId: 'place_2',
          lat: 32.72,
          lng: -117.16,
          isPrimary: true,
          workingHours: {},
        },
      },
    ])

    const res = await GET(
      makeRequest(
        '/api/pros/nearby?lat=32.7157&lng=-117.1611&radiusMiles=25&categoryId=cat_hair&serviceId=svc_1&excludeProfessionalId=pro_1&limit=12',
      ),
    )
    const body = await res.json()

    expect(res.status).toBe(200)

    expect(mocks.loadNearbyPros).toHaveBeenCalledWith({
      lat: 32.7157,
      lng: -117.1611,
      radiusMiles: 25,
      categoryId: 'cat_hair',
      serviceId: 'svc_1',
      excludeProfessionalId: 'pro_1',
      limit: 12,
    })

    expect(body).toEqual({
      ok: true,
      pros: [
        {
          id: 'pro_2',
          businessName: 'Hair One',
          handle: 'hairone',
          professionType: 'BARBER',
          avatarUrl: null,
          locationLabel: 'San Diego, CA',
          distanceMiles: 0.8,
          ratingAvg: 4.7,
          ratingCount: 9,
          minPrice: 85,
          supportsMobile: false,
          closestLocation: {
            id: 'loc_2',
            formattedAddress: '123 Main St',
            city: 'San Diego',
            state: 'CA',
            timeZone: 'America/Los_Angeles',
            placeId: 'place_2',
            lat: 32.72,
            lng: -117.16,
            isPrimary: true,
            workingHours: {},
          },
          primaryLocation: {
            id: 'loc_2',
            formattedAddress: '123 Main St',
            city: 'San Diego',
            state: 'CA',
            timeZone: 'America/Los_Angeles',
            placeId: 'place_2',
            lat: 32.72,
            lng: -117.16,
            isPrimary: true,
            workingHours: {},
          },
        },
      ],
    })
  })

  it('returns 500 when the shared loader throws', async () => {
    mocks.loadNearbyPros.mockRejectedValue(new Error('db blew up'))

    const res = await GET(
      makeRequest('/api/pros/nearby?lat=32.7157&lng=-117.1611'),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to load nearby pros.',
    })
  })
})