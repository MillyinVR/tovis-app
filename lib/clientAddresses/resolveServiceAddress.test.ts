import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  googleGeocodeAddress: vi.fn(),
}))

vi.mock('@/app/api/_utils/google', () => ({
  googleGeocodeAddress: mocks.googleGeocodeAddress,
}))

import {
  resolveServiceAddressValues,
  SERVICE_ADDRESS_UNRESOLVED_ERROR,
} from './resolveServiceAddress'

function manualValues() {
  return {
    label: 'Home',
    formattedAddress: null,
    addressLine1: '1571 avenida de las lilas',
    addressLine2: null,
    city: 'encinitas',
    state: 'ca',
    postalCode: '92024',
    countryCode: 'US',
    placeId: null,
    lat: null,
    lng: null,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveServiceAddressValues', () => {
  it('returns autocomplete picks unchanged without calling Google', async () => {
    const picked = {
      ...manualValues(),
      formattedAddress: '1571 Avenida De Las Lilas, Encinitas, CA 92024, USA',
      placeId: 'ChIJW3r_ae4L3IAR_Iua_Wy6SuA',
      lat: 33.0411574,
      lng: -117.2540393,
    }

    const result = await resolveServiceAddressValues(picked)

    expect(result).toEqual({ ok: true, values: picked })
    expect(mocks.googleGeocodeAddress).not.toHaveBeenCalled()
  })

  it('geocodes a hand-typed address and fills formattedAddress + coordinates', async () => {
    mocks.googleGeocodeAddress.mockResolvedValue({
      placeId: 'ChIJW3r_ae4L3IAR_Iua_Wy6SuA',
      formattedAddress: '1571 Avenida De Las Lilas, Encinitas, CA 92024, USA',
      lat: 33.0411574,
      lng: -117.2540393,
      city: 'Encinitas',
      state: 'CA',
      postalCode: '92024',
      countryCode: 'US',
    })

    const result = await resolveServiceAddressValues(manualValues())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.formattedAddress).toBe(
      '1571 Avenida De Las Lilas, Encinitas, CA 92024, USA',
    )
    expect(result.values.lat).toBe(33.0411574)
    expect(result.values.lng).toBe(-117.2540393)
    expect(result.values.placeId).toBe('ChIJW3r_ae4L3IAR_Iua_Wy6SuA')
    // Original manual fields are preserved when present.
    expect(result.values.addressLine1).toBe('1571 avenida de las lilas')
    expect(mocks.googleGeocodeAddress).toHaveBeenCalledWith(
      '1571 avenida de las lilas, encinitas, ca, 92024',
      'US',
    )
  })

  it('errors when Google cannot resolve the address', async () => {
    mocks.googleGeocodeAddress.mockRejectedValue(new Error('No results found.'))

    const result = await resolveServiceAddressValues(manualValues())

    expect(result).toEqual({ ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR })
  })

  it('errors when geocode returns no coordinates', async () => {
    mocks.googleGeocodeAddress.mockResolvedValue({
      placeId: null,
      formattedAddress: 'Somewhere, CA',
      lat: null,
      lng: null,
      city: null,
      state: 'CA',
      postalCode: null,
      countryCode: 'US',
    })

    const result = await resolveServiceAddressValues(manualValues())

    expect(result).toEqual({ ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR })
  })

  it('errors without calling Google when there is nothing to geocode', async () => {
    const empty = {
      ...manualValues(),
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    }

    const result = await resolveServiceAddressValues(empty)

    expect(result).toEqual({ ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR })
    expect(mocks.googleGeocodeAddress).not.toHaveBeenCalled()
  })
})
