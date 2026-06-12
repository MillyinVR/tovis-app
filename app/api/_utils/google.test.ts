// app/api/_utils/google.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  googleGeocodePostal,
  googlePlaceDetails,
  googleTimeZoneId,
} from './google'

const fetchMock = vi.fn()

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const ADDRESS_COMPONENTS = [
  {
    long_name: 'San Diego',
    short_name: 'San Diego',
    types: ['locality'],
  },
  {
    long_name: 'California',
    short_name: 'CA',
    types: ['administrative_area_level_1'],
  },
  {
    long_name: '92101',
    short_name: '92101',
    types: ['postal_code'],
  },
  {
    long_name: 'United States',
    short_name: 'US',
    types: ['country'],
  },
]

beforeEach(() => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'google_key')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const ADDRESS_COMPONENTS_V1 = [
  {
    longText: 'San Diego',
    shortText: 'San Diego',
    types: ['locality'],
  },
  {
    longText: 'California',
    shortText: 'CA',
    types: ['administrative_area_level_1'],
  },
  {
    longText: '92101',
    shortText: '92101',
    types: ['postal_code'],
  },
  {
    longText: 'United States',
    shortText: 'US',
    types: ['country'],
  },
]

describe('googlePlaceDetails', () => {
  it('parses Places API (New) details into a flat shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'place_123',
        displayName: { text: 'Vivid Salon', languageCode: 'en' },
        formattedAddress: '123 Main St, San Diego, CA 92101',
        location: { latitude: 32.715736, longitude: -117.161087 },
        addressComponents: ADDRESS_COMPONENTS_V1,
      }),
    )

    const place = await googlePlaceDetails('place_123', 'session_123')

    expect(place).toEqual({
      placeId: 'place_123',
      name: 'Vivid Salon',
      formattedAddress: '123 Main St, San Diego, CA 92101',
      lat: 32.715736,
      lng: -117.161087,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe('https://places.googleapis.com/v1/places/place_123')

    const headers = init.headers as Record<string, string>

    expect(headers['X-Goog-Api-Key']).toBe('google_key')
    expect(headers['X-Goog-FieldMask']).toContain('addressComponents')
    expect(headers['X-Goog-Session-Token']).toBe('session_123')
  })

  it('returns null coordinates when location is missing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'place_123',
        location: {},
      }),
    )

    const place = await googlePlaceDetails('place_123')

    expect(place.lat).toBeNull()
    expect(place.lng).toBeNull()
  })

  it('throws the Google error message on an error response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: 'Google said nope.',
          },
        },
        403,
      ),
    )

    await expect(googlePlaceDetails('place_123')).rejects.toThrow(
      'Google said nope.',
    )
  })

  it('accepts an already-prefixed places/ resource name', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'place_123',
        location: { latitude: 1, longitude: 2 },
      }),
    )

    await googlePlaceDetails('places/place_123')

    const [url] = fetchMock.mock.calls[0] as [string]

    expect(url).toBe('https://places.googleapis.com/v1/places/place_123')
  })
})

describe('googleGeocodePostal', () => {
  it('parses the first geocode result', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'OK',
        results: [
          {
            geometry: {
              location: { lat: 32.715736, lng: -117.161087 },
            },
            address_components: ADDRESS_COMPONENTS,
          },
        ],
      }),
    )

    const geo = await googleGeocodePostal('92101')

    expect(geo).toEqual({
      lat: 32.715736,
      lng: -117.161087,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
    })
  })

  it('throws when there are no results', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'OK', results: [] }))

    await expect(googleGeocodePostal('00000')).rejects.toThrow(
      'No results found.',
    )
  })

  it('throws the Google error message on non-OK status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'OVER_QUERY_LIMIT',
        error_message: 'Slow down.',
      }),
    )

    await expect(googleGeocodePostal('92101')).rejects.toThrow('Slow down.')
  })
})

describe('googleTimeZoneId', () => {
  it('returns the timeZoneId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'OK', timeZoneId: 'America/Los_Angeles' }),
    )

    await expect(googleTimeZoneId(32.7, -117.1)).resolves.toBe(
      'America/Los_Angeles',
    )
  })

  it('throws when no timeZoneId is returned', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'OK' }))

    await expect(googleTimeZoneId(32.7, -117.1)).rejects.toThrow(
      'No timeZoneId returned.',
    )
  })
})
