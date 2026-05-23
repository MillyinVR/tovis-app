// lib/security/addressEncryption.ts

import { Prisma } from '@prisma/client'

export const ADDRESS_KEY_VERSION = 'address-json-v1' as const

const APPROX_COORDINATE_DECIMAL_PLACES = 4
const MAX_POSTAL_CODE_PREFIX_LENGTH = 12

type NullableString = string | null | undefined
type NullableNumberLike =
  | number
  | string
  | Prisma.Decimal
  | { toString(): string }
  | null
  | undefined

export type AddressPrivacyInput = {
  formattedAddress?: NullableString
  addressLine1?: NullableString
  addressLine2?: NullableString
  city?: NullableString
  state?: NullableString
  postalCode?: NullableString
  countryCode?: NullableString
  placeId?: NullableString
  lat?: NullableNumberLike
  lng?: NullableNumberLike
}

export type AddressPrivacyEnvelopeV1 = {
  v: 1
  algorithm: 'plaintext-json-expand-phase'
  keyVersion: typeof ADDRESS_KEY_VERSION
  address: {
    formattedAddress: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    countryCode: string | null
    placeId: string | null
    lat: string | null
    lng: string | null
  }
}

export type AddressPrivacyWriteData = {
  encryptedAddressJson: Prisma.InputJsonValue
  addressKeyVersion: typeof ADDRESS_KEY_VERSION
  postalCodePrefix: string | null
  latApprox: Prisma.Decimal | null
  lngApprox: Prisma.Decimal | null
}

function normalizeString(value: NullableString): string | null {
  if (value == null) return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeCountryCode(value: NullableString): string | null {
  const normalized = normalizeString(value)
  return normalized ? normalized.toUpperCase() : null
}

function normalizePostalCode(value: NullableString): string | null {
  const normalized = normalizeString(value)
  if (!normalized) return null

  return normalized.toUpperCase().replace(/\s+/g, ' ')
}

function buildPostalCodePrefix(value: NullableString): string | null {
  const normalized = normalizePostalCode(value)
  if (!normalized) return null

  const compact = normalized.replace(/[^A-Z0-9]/g, '')
  if (!compact) return null

  return compact.slice(0, MAX_POSTAL_CODE_PREFIX_LENGTH)
}

function toFiniteNumber(value: NullableNumberLike): number | null {
  if (value == null) return null

  if (value instanceof Prisma.Decimal) {
    const numberValue = value.toNumber()
    return Number.isFinite(numberValue) ? numberValue : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const numberValue = Number(value.toString())
  return Number.isFinite(numberValue) ? numberValue : null
}

function roundCoordinate(value: NullableNumberLike): Prisma.Decimal | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue == null) return null

  const rounded = numberValue.toFixed(APPROX_COORDINATE_DECIMAL_PLACES)
  return new Prisma.Decimal(rounded)
}

function coordinateString(value: NullableNumberLike): string | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue == null) return null

  return String(numberValue)
}

function buildAddressEnvelope(
  input: AddressPrivacyInput,
): AddressPrivacyEnvelopeV1 {
  return {
    v: 1,
    algorithm: 'plaintext-json-expand-phase',
    keyVersion: ADDRESS_KEY_VERSION,
    address: {
      formattedAddress: normalizeString(input.formattedAddress),
      addressLine1: normalizeString(input.addressLine1),
      addressLine2: normalizeString(input.addressLine2),
      city: normalizeString(input.city),
      state: normalizeString(input.state),
      postalCode: normalizePostalCode(input.postalCode),
      countryCode: normalizeCountryCode(input.countryCode),
      placeId: normalizeString(input.placeId),
      lat: coordinateString(input.lat),
      lng: coordinateString(input.lng),
    },
  }
}

export function buildAddressPrivacyWriteData(
  input: AddressPrivacyInput,
): AddressPrivacyWriteData {
  return {
    encryptedAddressJson: buildAddressEnvelope(input),
    addressKeyVersion: ADDRESS_KEY_VERSION,
    postalCodePrefix: buildPostalCodePrefix(input.postalCode),
    latApprox: roundCoordinate(input.lat),
    lngApprox: roundCoordinate(input.lng),
  }
}