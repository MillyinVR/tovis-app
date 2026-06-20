// app/api/client/addresses/_resolveServiceAddress.ts
//
// Server-side resolver that canonicalizes a client SERVICE_ADDRESS on save.
//
// The address form lets a client either pick a Google autocomplete suggestion
// (which fills formattedAddress + placeId + lat/lng) OR type the street/city/
// state/zip by hand. A hand-typed address has no formattedAddress and no
// coordinates, which passes the save-time completeness check but is then
// rejected by mobile booking (lib/booking/writeBoundary requires a non-empty
// formattedAddress, and the pro needs lat/lng to travel).
//
// This forward-geocodes the typed address so every saved service address is
// bookable regardless of how it was entered. Autocomplete picks already carry
// formattedAddress + coordinates, so they short-circuit without a Google call.

import { googleGeocodeAddress } from '@/app/api/_utils/google'

export const SERVICE_ADDRESS_UNRESOLVED_ERROR =
  'We couldn’t verify that address. Use the “Search address” box and pick a suggestion so we can confirm the exact location for mobile service.'

type ServiceAddressInput = {
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null | undefined
  lng: number | null | undefined
}

function isAlreadyResolved(values: ServiceAddressInput): boolean {
  return Boolean(values.formattedAddress) && values.lat != null && values.lng != null
}

function buildGeocodeQuery(values: ServiceAddressInput): string {
  const formatted = values.formattedAddress?.trim()
  if (formatted) return formatted

  return [
    values.addressLine1, // pii-plaintext-read-ok: assembles a geocode query from already-normalized service-address fields before encryption
    values.addressLine2, // pii-plaintext-read-ok: assembles a geocode query from already-normalized service-address fields before encryption
    values.city,
    values.state,
    values.postalCode, // pii-plaintext-read-ok: assembles a geocode query from already-normalized service-address fields before encryption
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Returns the values unchanged when they already carry a formatted address and
 * coordinates (autocomplete pick). Otherwise forward-geocodes the typed address
 * and fills the missing formattedAddress / lat / lng / placeId. Returns an error
 * when the address can't be resolved to a confident point.
 */
export async function resolveServiceAddressValues<T extends ServiceAddressInput>(
  values: T,
): Promise<{ ok: true; values: T } | { ok: false; error: string }> {
  if (isAlreadyResolved(values)) {
    return { ok: true, values }
  }

  const query = buildGeocodeQuery(values)
  if (!query) {
    return { ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR }
  }

  let geocoded
  try {
    geocoded = await googleGeocodeAddress(query, values.countryCode)
  } catch {
    return { ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR }
  }

  const formattedAddress = values.formattedAddress ?? geocoded.formattedAddress
  const lat = values.lat ?? geocoded.lat
  const lng = values.lng ?? geocoded.lng

  if (!formattedAddress || lat == null || lng == null) {
    return { ok: false, error: SERVICE_ADDRESS_UNRESOLVED_ERROR }
  }

  return {
    ok: true,
    values: {
      ...values,
      formattedAddress,
      lat,
      lng,
      placeId: values.placeId ?? geocoded.placeId,
      city: values.city ?? geocoded.city,
      state: values.state ?? geocoded.state,
      postalCode: values.postalCode ?? geocoded.postalCode,
      countryCode: values.countryCode ?? geocoded.countryCode,
    },
  }
}
