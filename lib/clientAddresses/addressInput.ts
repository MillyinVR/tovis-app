// lib/clientAddresses/addressInput.ts

import { ClientAddressKind, Prisma } from '@prisma/client'
import type { ClientAddressDTO } from '@/lib/dto/clientAddress'

import { decimalToNullableNumber } from '@/lib/booking/snapshots'
import { pickNumber, pickString } from '@/lib/pick'

export const CLIENT_ADDRESS_SELECT = {
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientAddressSelect

export type ClientAddressRow = Prisma.ClientAddressGetPayload<{
  select: typeof CLIENT_ADDRESS_SELECT
}>

export type NormalizedClientAddressInput = {
  label: string | null
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

export type NormalizedClientAddressValues = {
  label: string | null
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
}

export type NormalizedOptionalString =
  | string
  | null
  | undefined
  | 'invalid'

export type NormalizedLatLng = number | null | undefined | 'invalid'
export type NormalizedBoolean = boolean | undefined | 'invalid'

export type ClientAddressInvalidFieldInput = {
  label: NormalizedOptionalString
  formattedAddress: NormalizedOptionalString
  addressLine1: NormalizedOptionalString
  addressLine2: NormalizedOptionalString
  city: NormalizedOptionalString
  state: NormalizedOptionalString
  postalCode: NormalizedOptionalString
  countryCode: NormalizedOptionalString
  placeId: NormalizedOptionalString
  lat: NormalizedLatLng
  lng: NormalizedLatLng
  isDefault: NormalizedBoolean
}

export type ClientAddressCompletenessInput = {
  formattedAddress?: string | null
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  lat?: number | null
  lng?: number | null
}

export type ClientAddressZipLikeInput = {
  formattedAddress?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  lat?: number | null
  lng?: number | null
}

export function normalizeClientAddressKind(
  value: unknown,
): ClientAddressKind | null {
  const text = pickString(value)?.toUpperCase() ?? ''

  if (text === ClientAddressKind.SEARCH_AREA) {
    return ClientAddressKind.SEARCH_AREA
  }

  if (text === ClientAddressKind.SERVICE_ADDRESS) {
    return ClientAddressKind.SERVICE_ADDRESS
  }

  return null
}

export function normalizeClientAddressOptionalString(
  value: unknown,
  max = 255,
): NormalizedOptionalString {
  if (value === undefined) return undefined
  if (value === null) return null

  const text = pickString(value)
  if (!text) return null
  if (text.length > max) return 'invalid'

  return text
}

export function normalizeClientAddressBoolean(
  value: unknown,
): NormalizedBoolean {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value

  return 'invalid'
}

export function normalizeClientAddressLatLng(
  value: unknown,
): NormalizedLatLng {
  if (value === undefined) return undefined
  if (value === null || value === '') return null

  const numberValue = pickNumber(value)
  if (numberValue == null || !Number.isFinite(numberValue)) return 'invalid'

  return numberValue
}

export function coerceClientAddressLatLng(
  value: NormalizedLatLng,
): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null) return null

  return undefined
}

export function clientAddressNumberToDecimalOrNull(
  value: number | null | undefined,
): Prisma.Decimal | null {
  if (value == null) return null

  return new Prisma.Decimal(String(value))
}

export function hasClientAddressZipLikeData(
  args: ClientAddressZipLikeInput,
): boolean {
  return Boolean(
    args.formattedAddress ||
      args.city ||
      args.state ||
      args.postalCode ||
      args.placeId ||
      (args.lat != null && args.lng != null),
  )
}

export function hasFullClientServiceAddress(
  args: ClientAddressCompletenessInput,
): boolean {
  const hasAddressLine = Boolean(args.formattedAddress || args.addressLine1)

  const hasLocationAnchor = Boolean(
    args.placeId ||
      (args.lat != null && args.lng != null) ||
      args.postalCode ||
      (args.city && args.state),
  )

  return hasAddressLine && hasLocationAnchor
}

export function getInvalidClientAddressField(
  args: ClientAddressInvalidFieldInput,
): string | null {
  if (args.label === 'invalid') return 'label'
  if (args.formattedAddress === 'invalid') return 'formattedAddress'
  if (args.addressLine1 === 'invalid') return 'addressLine1'
  if (args.addressLine2 === 'invalid') return 'addressLine2'
  if (args.city === 'invalid') return 'city'
  if (args.state === 'invalid') return 'state'
  if (args.postalCode === 'invalid') return 'postalCode'
  if (args.countryCode === 'invalid') return 'countryCode'
  if (args.placeId === 'invalid') return 'placeId'
  if (args.lat === 'invalid') return 'lat'
  if (args.lng === 'invalid') return 'lng'
  if (args.isDefault === 'invalid') return 'isDefault'

  return null
}

export function normalizeClientAddressInput(args: {
  label: NormalizedOptionalString
  formattedAddress: NormalizedOptionalString
  addressLine1: NormalizedOptionalString
  addressLine2: NormalizedOptionalString
  city: NormalizedOptionalString
  state: NormalizedOptionalString
  postalCode: NormalizedOptionalString
  countryCode: NormalizedOptionalString
  placeId: NormalizedOptionalString
  lat: NormalizedLatLng
  lng: NormalizedLatLng
}): NormalizedClientAddressInput {
  return {
    label: args.label ?? null,
    formattedAddress: args.formattedAddress ?? null,
    addressLine1: args.addressLine1 ?? null,
    addressLine2: args.addressLine2 ?? null,
    city: args.city ?? null,
    state: args.state ?? null,
    postalCode: args.postalCode ?? null,
    countryCode: args.countryCode ?? null,
    placeId: args.placeId ?? null,
    lat: coerceClientAddressLatLng(args.lat),
    lng: coerceClientAddressLatLng(args.lng),
  }
}

export function buildNextClientAddressValues(args: {
  existing: ClientAddressRow
  label: string | null | undefined
  formattedAddress: string | null | undefined
  addressLine1: string | null | undefined
  addressLine2: string | null | undefined
  city: string | null | undefined
  state: string | null | undefined
  postalCode: string | null | undefined
  countryCode: string | null | undefined
  placeId: string | null | undefined
  lat: NormalizedLatLng
  lng: NormalizedLatLng
}): NormalizedClientAddressValues {
  return {
    label: args.label !== undefined ? args.label : args.existing.label,
    formattedAddress:
      args.formattedAddress !== undefined
        ? args.formattedAddress
        : args.existing.formattedAddress,
    addressLine1:
      args.addressLine1 !== undefined
        ? args.addressLine1
        : args.existing.addressLine1,
    addressLine2:
      args.addressLine2 !== undefined
        ? args.addressLine2
        : args.existing.addressLine2,
    city: args.city !== undefined ? args.city : args.existing.city,
    state: args.state !== undefined ? args.state : args.existing.state,
    postalCode:
      args.postalCode !== undefined ? args.postalCode : args.existing.postalCode,
    countryCode:
      args.countryCode !== undefined
        ? args.countryCode
        : args.existing.countryCode,
    placeId: args.placeId !== undefined ? args.placeId : args.existing.placeId,
    lat:
      args.lat !== undefined
        ? (coerceClientAddressLatLng(args.lat) ?? null)
        : decimalToNullableNumber(args.existing.lat),
    lng:
      args.lng !== undefined
        ? (coerceClientAddressLatLng(args.lng) ?? null)
        : decimalToNullableNumber(args.existing.lng),
  }
}

export function mapClientAddress(row: ClientAddressRow): ClientAddressDTO {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label ?? null,
    isDefault: row.isDefault,
    formattedAddress: row.formattedAddress ?? null,
    addressLine1: row.addressLine1 ?? null,
    addressLine2: row.addressLine2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postalCode: row.postalCode ?? null,
    countryCode: row.countryCode ?? null,
    placeId: row.placeId ?? null,
    lat: decimalToNullableNumber(row.lat),
    lng: decimalToNullableNumber(row.lng),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function sortClientAddresses<
  T extends {
    kind: ClientAddressKind
    isDefault: boolean
    createdAt: Date
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === ClientAddressKind.SEARCH_AREA) return -1
      if (b.kind === ClientAddressKind.SEARCH_AREA) return 1
    }

    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1
    }

    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}