// lib/security/addressEncryption.ts

import { Prisma } from '@prisma/client'

import {
  decryptAead,
  encryptAead,
  isAeadEnvelopeV1,
  type AeadEnvelopeV1,
} from '@/lib/security/crypto/aead'

export const ADDRESS_KEY_VERSION = 'address-aead-v1' as const
export const ADDRESS_AEAD_ASSOCIATED_DATA = 'tovis:address-privacy:v1' as const

const LEGACY_ADDRESS_KEY_VERSION = 'address-json-v1' as const
const LEGACY_ADDRESS_ALGORITHM = 'plaintext-json-expand-phase' as const
const ADDRESS_AEAD_ALGORITHM = 'aes-256-gcm-v1' as const

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

export type NormalizedAddressPrivacyPayload = {
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

export type LegacyAddressPrivacyEnvelopeV1 = {
  v: 1
  algorithm: typeof LEGACY_ADDRESS_ALGORITHM
  keyVersion: typeof LEGACY_ADDRESS_KEY_VERSION
  address: NormalizedAddressPrivacyPayload
}

export type EncryptedAddressPrivacyEnvelopeV1 = {
  v: 1
  algorithm: typeof ADDRESS_AEAD_ALGORITHM
  keyVersion: typeof ADDRESS_KEY_VERSION
  ciphertext: AeadEnvelopeV1
}

export type AddressPrivacyEnvelopeV1 =
  | LegacyAddressPrivacyEnvelopeV1
  | EncryptedAddressPrivacyEnvelopeV1

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

  const raw = value.toString().trim()
  if (!raw) return null

  const numberValue = Number(raw)
  return Number.isFinite(numberValue) ? numberValue : null
}

function roundCoordinate(value: NullableNumberLike): Prisma.Decimal | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue == null) return null

  const rounded = numberValue.toFixed(APPROX_COORDINATE_DECIMAL_PLACES)
  return new Prisma.Decimal(rounded)
}

/**
 * Use this only for Booking / BookingHold snapshot approximation columns that
 * are Float in Prisma. ClientAddress / ProfessionalLocation approximation
 * columns should keep the Prisma.Decimal values from buildAddressPrivacyWriteData.
 */
export function approximateCoordinateDecimalToFloat(
  value: Prisma.Decimal | null,
): number | null {
  if (value === null) return null

  const numberValue = value.toNumber()
  return Number.isFinite(numberValue) ? numberValue : null
}

function coordinateString(value: NullableNumberLike): string | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue == null) return null

  return String(numberValue)
}

function buildNormalizedAddressPayload(
  input: AddressPrivacyInput,
): NormalizedAddressPrivacyPayload {
  return {
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
  }
}

function buildLegacyAddressEnvelope(
  input: AddressPrivacyInput,
): LegacyAddressPrivacyEnvelopeV1 {
  return {
    v: 1,
    algorithm: LEGACY_ADDRESS_ALGORITHM,
    keyVersion: LEGACY_ADDRESS_KEY_VERSION,
    address: buildNormalizedAddressPayload(input),
  }
}

function buildEncryptedAddressEnvelope(
  input: AddressPrivacyInput,
): EncryptedAddressPrivacyEnvelopeV1 {
  const address = buildNormalizedAddressPayload(input)

  const ciphertext = encryptAead({
    plaintext: JSON.stringify(address),
    keyVersion: ADDRESS_KEY_VERSION,
    associatedData: ADDRESS_AEAD_ASSOCIATED_DATA,
  })

  return {
    v: 1,
    algorithm: ADDRESS_AEAD_ALGORITHM,
    keyVersion: ADDRESS_KEY_VERSION,
    ciphertext,
  }
}

/**
 * Canonical address envelope builder for all new writes.
 *
 * New writes must be AEAD-only. Legacy plaintext envelopes are supported only
 * for read/backfill burn-in through buildLegacyAddressPrivacyEnvelopeForBackfill
 * and readAddressPrivacyEnvelope.
 */
export function buildAddressEnvelope(
  input: AddressPrivacyInput,
): EncryptedAddressPrivacyEnvelopeV1 {
  return buildEncryptedAddressEnvelope(input)
}

/**
 * Legacy helper for backfill/test fixtures only.
 *
 * Do not use this for new application writes.
 */
export function buildLegacyAddressPrivacyEnvelopeForBackfill(
  input: AddressPrivacyInput,
): LegacyAddressPrivacyEnvelopeV1 {
  return buildLegacyAddressEnvelope(input)
}

/**
 * Canonical address privacy write boundary.
 *
 * Use this for ClientAddress / ProfessionalLocation writes and for backfills.
 * It writes the AEAD envelope plus the non-sensitive search/version metadata
 * needed during the expand phase.
 */
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

export function isAddressPrivacyEnvelopeV1(
  value: unknown,
): value is AddressPrivacyEnvelopeV1 {
  if (!isRecord(value)) return false

  if (value.v !== 1) return false
  if (typeof value.algorithm !== 'string') return false
  if (typeof value.keyVersion !== 'string') return false

  if (
    value.algorithm === LEGACY_ADDRESS_ALGORITHM &&
    value.keyVersion === LEGACY_ADDRESS_KEY_VERSION
  ) {
    return isNormalizedAddressPrivacyPayload(value.address)
  }

  if (
    value.algorithm === ADDRESS_AEAD_ALGORITHM &&
    value.keyVersion === ADDRESS_KEY_VERSION
  ) {
    return isAeadEnvelopeV1(value.ciphertext)
  }

  return false
}

/**
 * Dual-read boundary for the AEAD burn-in period.
 *
 * This intentionally supports legacy plaintext envelopes so old rows can be
 * read while the backfill/contract migration completes. New writes must still
 * use buildAddressPrivacyWriteData/buildAddressEnvelope.
 */
export function readAddressPrivacyEnvelope(
  envelope: AddressPrivacyEnvelopeV1,
): NormalizedAddressPrivacyPayload {
  if (envelope.algorithm === LEGACY_ADDRESS_ALGORITHM) {
    return envelope.address
  }

  const plaintext = decryptAead({
    envelope: envelope.ciphertext,
    associatedData: ADDRESS_AEAD_ASSOCIATED_DATA,
  })

  let parsed: unknown

  try {
    parsed = JSON.parse(plaintext)
  } catch {
    throw new Error('Invalid decrypted address privacy payload JSON')
  }

  if (!isNormalizedAddressPrivacyPayload(parsed)) {
    throw new Error('Invalid decrypted address privacy payload')
  }

  return parsed
}

function isNormalizedAddressPrivacyPayload(
  value: unknown,
): value is NormalizedAddressPrivacyPayload {
  if (!isRecord(value)) return false

  return (
    isNullableStringValue(value.formattedAddress) &&
    isNullableStringValue(value.addressLine1) &&
    isNullableStringValue(value.addressLine2) &&
    isNullableStringValue(value.city) &&
    isNullableStringValue(value.state) &&
    isNullableStringValue(value.postalCode) &&
    isNullableStringValue(value.countryCode) &&
    isNullableStringValue(value.placeId) &&
    isNullableStringValue(value.lat) &&
    isNullableStringValue(value.lng)
  )
}

function isNullableStringValue(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}