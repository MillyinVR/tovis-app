// lib/search/pros.test.ts
//
// P2.4b — searchPros now reads from ProfessionalSearchIndex via raw SQL
// (prismaRead.$queryRaw). These tests mock $queryRaw to return synthetic
// rows representing what PostGIS would have produced and exercise the
// JS-side concerns: response shape, cursor slicing, open-now filter,
// rating-count widening.
//
// They do NOT assert SQL strings — that's covered by the integration
// suite under `tests/integration/` which runs the real query against
// the postgis test container.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionType } from '@prisma/client'

import { SearchRequestError, encodeIdCursor } from './contracts'

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn()

  const inferProfessionTypesFromQuery = vi.fn(
    (query: string): ProfessionType[] => {
      const q = query.trim().toLowerCase()
      const hits: ProfessionType[] = []

      if (q.includes('barber')) hits.push(ProfessionType.BARBER)
      if (
        q.includes('cosmo') ||
        q.includes('hair') ||
        q.includes('stylist')
      ) {
        hits.push(ProfessionType.COSMETOLOGIST)
      }
      if (
        q.includes('esthetic') ||
        q.includes('facial') ||
        q.includes('skin')
      ) {
        hits.push(ProfessionType.ESTHETICIAN)
      }
      if (
        q.includes('nail') ||
        q.includes('mani') ||
        q.includes('pedi')
      ) {
        hits.push(ProfessionType.MANICURIST)
      }
      if (q.includes('massage')) {
        hits.push(ProfessionType.MASSAGE_THERAPIST)
      }
      if (q.includes('makeup') || q.includes('mua')) {
        hits.push(ProfessionType.MAKEUP_ARTIST)
      }

      return Array.from(new Set(hits))
    },
  )

  const isOpenNowAtLocation = vi.fn(() => true)

  const buildDiscoveryLocationLabel = vi.fn(
    ({
      location,
    }: {
      location:
        | {
            formattedAddress: string | null
            city: string | null
            state: string | null
          }
        | null
    }) => {
      const city = location?.city?.trim() ?? ''
      const state = location?.state?.trim() ?? ''
      const formattedAddress = location?.formattedAddress?.trim() ?? ''

      if (city && state) return `${city}, ${state}`
      if (city) return city
      if (state) return state
      if (formattedAddress) return formattedAddress

      return null
    },
  )

  const PUBLICLY_APPROVED_PRO_STATUSES = ['APPROVED'] as const

  return {
    queryRaw,
    inferProfessionTypesFromQuery,
    isOpenNowAtLocation,
    buildDiscoveryLocationLabel,
    PUBLICLY_APPROVED_PRO_STATUSES,
  }
})

vi.mock('@/lib/prisma', () => ({
  prismaRead: {
    $queryRaw: mocks.queryRaw,
  },
}))

vi.mock('@/lib/proTrustState', () => ({
  PUBLICLY_APPROVED_PRO_STATUSES: mocks.PUBLICLY_APPROVED_PRO_STATUSES,
}))

vi.mock('@/lib/discovery/nearby', () => ({
  buildDiscoveryLocationLabel: mocks.buildDiscoveryLocationLabel,
  inferProfessionTypesFromQuery: mocks.inferProfessionTypesFromQuery,
  isOpenNowAtLocation: mocks.isOpenNowAtLocation,
}))

import { rootTenantContext } from '@/lib/tenant/context'

import { parseSearchProsParams, searchPros } from './pros'

const ROOT_CTX = rootTenantContext('tenant_root')

type SyntheticCandidate = {
  professionalId: string
  businessName: string | null
  displayName: string | null
  handle: string | null
  professionType: ProfessionType | null
  avatarUrl: string | null
  locationId: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
  ratingAvg: number | null
  ratingCount: number | bigint
  offersMobile: boolean
  minMobilePrice: number | null
  minAnyPrice: number | null
  distanceMiles: number | null
}

type SyntheticPrimary = {
  professionalId: string
  locationId: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
}

function makeCandidate(
  overrides: Partial<SyntheticCandidate> & { professionalId: string },
): SyntheticCandidate {
  return {
    businessName: 'TOVIS Studio',
    displayName: 'TOVIS Studio',
    handle: 'tovisstudio',
    professionType: ProfessionType.BARBER,
    avatarUrl: null,
    locationId: 'loc_primary',
    formattedAddress: '123 Main St',
    city: 'San Diego',
    state: 'CA',
    timeZone: 'America/Los_Angeles',
    placeId: 'place_1',
    lat: 32.7157,
    lng: -117.1611,
    isPrimary: true,
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '17:00' },
    },
    ratingAvg: 4.8,
    ratingCount: 12,
    offersMobile: false,
    minMobilePrice: null,
    minAnyPrice: 85,
    distanceMiles: null,
    ...overrides,
  }
}

function makePrimaryRow(
  overrides: Partial<SyntheticPrimary> & { professionalId: string },
): SyntheticPrimary {
  return {
    locationId: 'loc_primary',
    formattedAddress: '123 Main St',
    city: 'San Diego',
    state: 'CA',
    timeZone: 'America/Los_Angeles',
    placeId: 'place_1',
    lat: 32.7157,
    lng: -117.1611,
    isPrimary: true,
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '17:00' },
    },
    ...overrides,
  }
}

// Helper: prime $queryRaw to return `candidates` then `primaries` then
// keep returning [] for any further calls (defensive).
function mockSearchRows(
  candidates: SyntheticCandidate[],
  primaries: SyntheticPrimary[],
): void {
  mocks.queryRaw
    .mockResolvedValueOnce(candidates)
    .mockResolvedValueOnce(primaries)
    .mockResolvedValue([])
}

const DEFAULT_PARAMS: Parameters<typeof searchPros>[0] = {
  q: null,
  lat: null,
  lng: null,
  categoryId: null,
  serviceId: null,
  excludeProfessionalId: null,
  radiusMiles: 15,
  mobileOnly: false,
  openNowOnly: false,
  minRating: null,
  maxPrice: null,
  sort: 'DISTANCE',
  cursorId: null,
  limit: 50,
}

describe('lib/search/pros.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryRaw.mockResolvedValue([])
  })

  describe('parseSearchProsParams', () => {
    it('parses defaults for the stable pros contract', () => {
      const params = parseSearchProsParams(new URLSearchParams('q=barber'))

      expect(params).toEqual({
        q: 'barber',
        lat: null,
        lng: null,
        categoryId: null,
        serviceId: null,
        excludeProfessionalId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })
    })

    it('decodes a valid cursor and clamps limit/radius', () => {
      const cursor = encodeIdCursor('pro_2')

      const params = parseSearchProsParams(
        new URLSearchParams(
          `cursor=${encodeURIComponent(cursor)}&limit=999&radiusMiles=200&mobile=true&openNow=yes&sort=name&lat=32.7&lng=-117.1`,
        ),
      )

      expect(params).toEqual({
        q: null,
        lat: 32.7,
        lng: -117.1,
        categoryId: null,
        serviceId: null,
        excludeProfessionalId: null,
        radiusMiles: 100,
        mobileOnly: true,
        openNowOnly: true,
        minRating: null,
        maxPrice: null,
        sort: 'NAME',
        cursorId: 'pro_2',
        limit: 50,
      })
    })

    it('throws a 400 SearchRequestError for an invalid cursor', () => {
      expect(() =>
        parseSearchProsParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        ),
      ).toThrowError(SearchRequestError)

      try {
        parseSearchProsParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        )
        throw new Error('expected parseSearchProsParams to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(SearchRequestError)
        expect((error as SearchRequestError).status).toBe(400)
        expect((error as SearchRequestError).message).toBe(
          'Invalid pros search cursor.',
        )
      }
    })
  })

  describe('searchPros', () => {
    it('returns the stable DTO shape and strips workingHours from location previews', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            professionType: ProfessionType.MAKEUP_ARTIST,
            ratingAvg: 4.8,
            ratingCount: 12,
            minAnyPrice: 85,
          }),
        ],
        [makePrimaryRow({ professionalId: 'pro_1' })],
      )

      const result = await searchPros(DEFAULT_PARAMS, ROOT_CTX)

      expect(result).toEqual({
        items: [
          {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            displayName: 'TOVIS Studio',
            handle: 'tovisstudio',
            professionType: ProfessionType.MAKEUP_ARTIST,
            avatarUrl: null,
            locationLabel: 'San Diego, CA',
            distanceMiles: null,
            ratingAvg: 4.8,
            ratingCount: 12,
            minPrice: 85,
            supportsMobile: false,
            closestLocation: {
              id: 'loc_primary',
              formattedAddress: '123 Main St',
              city: 'San Diego',
              state: 'CA',
              timeZone: 'America/Los_Angeles',
              placeId: 'place_1',
              lat: 32.7157,
              lng: -117.1611,
              isPrimary: true,
            },
            primaryLocation: {
              id: 'loc_primary',
              formattedAddress: '123 Main St',
              city: 'San Diego',
              state: 'CA',
              timeZone: 'America/Los_Angeles',
              placeId: 'place_1',
              lat: 32.7157,
              lng: -117.1611,
              isPrimary: true,
            },
          },
        ],
        nextCursor: null,
      })

      expect(result.items[0]?.closestLocation).not.toHaveProperty('workingHours')
      expect(result.items[0]?.primaryLocation).not.toHaveProperty('workingHours')
    })

    it('runs only the candidates query when no pros match (skips primary lookup)', async () => {
      mocks.queryRaw.mockResolvedValueOnce([])

      const result = await searchPros(DEFAULT_PARAMS, ROOT_CTX)

      expect(result).toEqual({ items: [], nextCursor: null })
      expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    })

    it('uses mobile-specific minPrice when mobileOnly is requested', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_1',
            offersMobile: true,
            minMobilePrice: 110,
            minAnyPrice: 85,
          }),
        ],
        [makePrimaryRow({ professionalId: 'pro_1' })],
      )

      const result = await searchPros({
        ...DEFAULT_PARAMS,
        lat: 32.7,
        lng: -117.1,
        mobileOnly: true,
      }, ROOT_CTX)

      expect(result.items[0]?.minPrice).toBe(110)
      expect(result.items[0]?.supportsMobile).toBe(true)
    })

    it('attaches the primary location even when the candidate row reports the closest', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_1',
            locationId: 'loc_closest',
            isPrimary: false,
            distanceMiles: 1.4,
            city: 'La Jolla',
          }),
        ],
        [
          makePrimaryRow({
            professionalId: 'pro_1',
            locationId: 'loc_primary',
            isPrimary: true,
            city: 'San Diego',
          }),
        ],
      )

      const result = await searchPros({
        ...DEFAULT_PARAMS,
        lat: 32.7,
        lng: -117.1,
      }, ROOT_CTX)

      expect(result.items[0]?.closestLocation?.id).toBe('loc_closest')
      expect(result.items[0]?.primaryLocation?.id).toBe('loc_primary')
      expect(result.items[0]?.distanceMiles).toBeCloseTo(1.4)
    })

    it('falls back to the closest location when no primary row is returned', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_solo',
            locationId: 'loc_only',
            isPrimary: false,
          }),
        ],
        [],
      )

      const result = await searchPros(DEFAULT_PARAMS, ROOT_CTX)

      expect(result.items[0]?.primaryLocation?.id).toBe('loc_only')
    })

    it('coerces a bigint ratingCount to a finite number', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_1',
            ratingAvg: 4.5,
            ratingCount: BigInt(42),
          }),
        ],
        [makePrimaryRow({ professionalId: 'pro_1' })],
      )

      const result = await searchPros(DEFAULT_PARAMS, ROOT_CTX)

      expect(result.items[0]?.ratingCount).toBe(42)
    })

    it('supports cursor pagination over the materialized candidate list', async () => {
      const candidates = [
        makeCandidate({
          professionalId: 'pro_1',
          businessName: 'Alpha Studio',
        }),
        makeCandidate({
          professionalId: 'pro_2',
          businessName: 'Bravo Studio',
        }),
        makeCandidate({
          professionalId: 'pro_3',
          businessName: 'Charlie Studio',
        }),
      ]
      const primaries = candidates.map((row) =>
        makePrimaryRow({ professionalId: row.professionalId }),
      )

      mockSearchRows(candidates, primaries)

      const page1 = await searchPros({
        ...DEFAULT_PARAMS,
        sort: 'NAME',
        limit: 1,
      }, ROOT_CTX)

      expect(page1.items.map((item) => item.id)).toEqual(['pro_1'])
      expect(page1.nextCursor).toBe(encodeIdCursor('pro_1'))

      mockSearchRows(candidates, primaries)

      const page2 = await searchPros({
        ...DEFAULT_PARAMS,
        sort: 'NAME',
        cursorId: 'pro_1',
        limit: 1,
      }, ROOT_CTX)

      expect(page2.items.map((item) => item.id)).toEqual(['pro_2'])
      expect(page2.nextCursor).toBe(encodeIdCursor('pro_2'))
    })

    it('drops candidates whose closest location is not open now when openNowOnly is set', async () => {
      mockSearchRows(
        [
          makeCandidate({
            professionalId: 'pro_open',
            businessName: 'Open Pro',
          }),
          makeCandidate({
            professionalId: 'pro_closed',
            businessName: 'Closed Pro',
          }),
        ],
        [
          makePrimaryRow({ professionalId: 'pro_open' }),
          makePrimaryRow({ professionalId: 'pro_closed' }),
        ],
      )

      mocks.isOpenNowAtLocation
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)

      const result = await searchPros({
        ...DEFAULT_PARAMS,
        openNowOnly: true,
      }, ROOT_CTX)

      expect(mocks.isOpenNowAtLocation).toHaveBeenCalledTimes(2)
      expect(result.items.map((item) => item.id)).toEqual(['pro_open'])
    })
  })
})
