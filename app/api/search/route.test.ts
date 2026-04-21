// app/api/search/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class SearchRequestError extends Error {
    readonly status: number

    constructor(status: number, message: string) {
      super(message)
      this.name = 'SearchRequestError'
      this.status = status
    }
  }

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

  const parseSearchProsParams = vi.fn()
  const searchPros = vi.fn()

  const parseSearchServicesParams = vi.fn()
  const searchServices = vi.fn()

  return {
    SearchRequestError,
    jsonOk,
    jsonFail,
    parseSearchProsParams,
    searchPros,
    parseSearchServicesParams,
    searchServices,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/search/contracts', () => ({
  SearchRequestError: mocks.SearchRequestError,
}))

vi.mock('@/lib/search/pros', () => ({
  parseSearchProsParams: mocks.parseSearchProsParams,
  searchPros: mocks.searchPros,
}))

vi.mock('@/lib/search/services', () => ({
  parseSearchServicesParams: mocks.parseSearchServicesParams,
  searchServices: mocks.searchServices,
}))

import { GET } from './route'

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

describe('app/api/search/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.parseSearchProsParams.mockReturnValue({
      q: null,
      lat: null,
      lng: null,
      categoryId: null,
      radiusMiles: 15,
      mobileOnly: false,
      openNowOnly: false,
      minRating: null,
      maxPrice: null,
      sort: 'DISTANCE',
      cursorId: null,
      limit: 50,
    })

    mocks.searchPros.mockResolvedValue({
      items: [],
      nextCursor: null,
    })

    mocks.parseSearchServicesParams.mockReturnValue({
      q: null,
      categoryId: null,
      cursorId: null,
      limit: 40,
    })

    mocks.searchServices.mockResolvedValue({
      items: [],
      nextCursor: null,
    })
  })

  it('delegates to pros search by default and preserves the mixed compatibility envelope', async () => {
    const parsedProsParams = {
      q: 'barber',
      lat: null,
      lng: null,
      categoryId: null,
      radiusMiles: 15,
      mobileOnly: false,
      openNowOnly: false,
      minRating: null,
      maxPrice: null,
      sort: 'DISTANCE',
      cursorId: null,
      limit: 50,
    }

    const prosResult = {
      items: [
        {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          professionType: 'BARBER',
          avatarUrl: null,
          locationLabel: 'San Diego, CA',
          distanceMiles: null,
          ratingAvg: 4.8,
          ratingCount: 12,
          minPrice: 85,
          supportsMobile: false,
          closestLocation: null,
          primaryLocation: null,
        },
      ],
      nextCursor: 'next_pros_cursor',
    }

    mocks.parseSearchProsParams.mockReturnValue(parsedProsParams)
    mocks.searchPros.mockResolvedValue(prosResult)

    const res = await GET(makeRequest('/api/search?q=barber'))
    const body = await res.json()

    expect(res.status).toBe(200)

    expect(mocks.parseSearchProsParams).toHaveBeenCalledTimes(1)
    expect(mocks.searchPros).toHaveBeenCalledWith(parsedProsParams)

    const passedSearchParams =
      mocks.parseSearchProsParams.mock.calls[0]?.[0] as URLSearchParams
    expect(passedSearchParams.get('q')).toBe('barber')
    expect(passedSearchParams.get('tab')).toBeNull()

    expect(mocks.parseSearchServicesParams).not.toHaveBeenCalled()
    expect(mocks.searchServices).not.toHaveBeenCalled()

    expect(body).toEqual({
      ok: true,
      pros: prosResult.items,
      services: [],
    })
  })

  it('delegates to services search for tab=SERVICES and preserves the mixed compatibility envelope', async () => {
    const parsedServicesParams = {
      q: 'silk',
      categoryId: 'cat_hair',
      cursorId: null,
      limit: 40,
    }

    const servicesResult = {
      items: [
        {
          id: 'svc_1',
          name: 'Silk Press',
          categoryId: 'cat_hair',
          categoryName: 'Hair',
          categorySlug: 'hair',
        },
      ],
      nextCursor: 'next_services_cursor',
    }

    mocks.parseSearchServicesParams.mockReturnValue(parsedServicesParams)
    mocks.searchServices.mockResolvedValue(servicesResult)

    const res = await GET(
      makeRequest('/api/search?tab=SERVICES&q=silk&categoryId=cat_hair'),
    )
    const body = await res.json()

    expect(res.status).toBe(200)

    expect(mocks.parseSearchServicesParams).toHaveBeenCalledTimes(1)
    expect(mocks.searchServices).toHaveBeenCalledWith(parsedServicesParams)

    const passedSearchParams =
      mocks.parseSearchServicesParams.mock.calls[0]?.[0] as URLSearchParams
    expect(passedSearchParams.get('tab')).toBe('SERVICES')
    expect(passedSearchParams.get('q')).toBe('silk')
    expect(passedSearchParams.get('categoryId')).toBe('cat_hair')

    expect(mocks.parseSearchProsParams).not.toHaveBeenCalled()
    expect(mocks.searchPros).not.toHaveBeenCalled()

    expect(body).toEqual({
      ok: true,
      pros: [],
      services: servicesResult.items,
    })
  })

  it('returns the shared SearchRequestError as a 400-style jsonFail response', async () => {
    mocks.parseSearchProsParams.mockImplementation(() => {
      throw new mocks.SearchRequestError(
        400,
        'Invalid pros search cursor.',
      )
    })

    const res = await GET(makeRequest('/api/search?cursor=bad_cursor'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid pros search cursor.',
    })

    expect(mocks.searchPros).not.toHaveBeenCalled()
    expect(mocks.parseSearchServicesParams).not.toHaveBeenCalled()
    expect(mocks.searchServices).not.toHaveBeenCalled()
  })

  it('returns 500 when a shared search module throws unexpectedly', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    mocks.parseSearchServicesParams.mockReturnValue({
      q: 'silk',
      categoryId: 'cat_hair',
      cursorId: null,
      limit: 40,
    })

    mocks.searchServices.mockRejectedValue(new Error('db blew up'))

    const res = await GET(
      makeRequest('/api/search?tab=SERVICES&q=silk&categoryId=cat_hair'),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to search.',
    })

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})