// app/api/client/addresses/route.ts

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import {
  CLIENT_ADDRESS_SELECT,
  clientAddressNumberToDecimalOrNull,
  getInvalidClientAddressField,
  hasClientAddressZipLikeData,
  hasFullClientServiceAddress,
  mapClientAddress,
  normalizeClientAddressBoolean,
  normalizeClientAddressInput,
  normalizeClientAddressKind,
  normalizeClientAddressLatLng,
  normalizeClientAddressOptionalString,
  sortClientAddresses,
} from '@/lib/clientAddresses/addressInput'

export const dynamic = 'force-dynamic'

async function loadAddresses(clientId: string) {
  const rows = await prisma.clientAddress.findMany({
    where: { clientId },
    select: CLIENT_ADDRESS_SELECT,
  })

  return sortClientAddresses(rows).map(mapClientAddress)
}

function normalizeCreateClientAddressBody(body: Record<string, unknown>):
  | {
      ok: true
      kind: NonNullable<ReturnType<typeof normalizeClientAddressKind>>
      isDefault: boolean | undefined
      values: ReturnType<typeof normalizeClientAddressInput>
    }
  | {
      ok: false
      error: string
    } {
  const kind = normalizeClientAddressKind(body.kind)

  if (!kind) {
    return {
      ok: false,
      error: 'Invalid kind. Use SEARCH_AREA or SERVICE_ADDRESS.',
    }
  }

  const label = normalizeClientAddressOptionalString(body.label, 80)
  const formattedAddress = normalizeClientAddressOptionalString(
    body.formattedAddress,
    500,
  )
  const addressLine1 = normalizeClientAddressOptionalString(
    body.addressLine1, // pii-plaintext-read-ok: client address create accepts plaintext request address before centralized normalization/encryption
    200,
  )
  const addressLine2 = normalizeClientAddressOptionalString(
    body.addressLine2, // pii-plaintext-read-ok: client address create accepts plaintext request address before centralized normalization/encryption
    200,
  )
  const city = normalizeClientAddressOptionalString(body.city, 120)
  const state = normalizeClientAddressOptionalString(body.state, 120)
  // pii-plaintext-read-ok: client address create accepts plaintext request postal code before centralized normalization/encryption
  const postalCode = normalizeClientAddressOptionalString(
  body.postalCode, // pii-plaintext-read-ok: client address create accepts plaintext request postal code before centralized normalization/encryption
  40,
)
  const countryCode = normalizeClientAddressOptionalString(body.countryCode, 8)
  const placeId = normalizeClientAddressOptionalString(body.placeId, 255)
  const lat = normalizeClientAddressLatLng(body.lat)
  const lng = normalizeClientAddressLatLng(body.lng)
  const isDefault = normalizeClientAddressBoolean(body.isDefault)

  const invalidField = getInvalidClientAddressField({
    label,
    formattedAddress,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
    placeId,
    lat,
    lng,
    isDefault,
  })

  if (invalidField) {
    return {
      ok: false,
      error: `Invalid ${invalidField}.`,
    }
  }

  const values = normalizeClientAddressInput({
    label,
    formattedAddress,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
    placeId,
    lat,
    lng,
  })

  if (kind === 'SEARCH_AREA') {
    if (!hasClientAddressZipLikeData(values)) {
      return {
        ok: false,
        error:
          'Search area needs at least a ZIP/postal code, city/state, place, or map location.',
      }
    }
  }

  if (kind === 'SERVICE_ADDRESS') {
    if (!hasFullClientServiceAddress(values)) {
      return {
        ok: false,
        error:
          'Service address needs a real address or formatted address before mobile booking.',
      }
    }
  }

  return {
    ok: true,
    kind,
    isDefault: typeof isDefault === 'boolean' ? isDefault : undefined,
    values,
  }
}

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const addresses = await loadAddresses(auth.clientId)

    return jsonOk({ addresses }, 200)
  } catch (error) {
    console.error('GET /api/client/addresses error', error)
    return jsonFail(500, 'Failed to load client addresses.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const parsed = normalizeCreateClientAddressBody(body)

    if (!parsed.ok) {
      return jsonFail(400, parsed.error)
    }

    const { kind, isDefault, values } = parsed

    const existingCountForKind = await prisma.clientAddress.count({
      where: {
        clientId: auth.clientId,
        kind,
      },
    })

    const shouldBeDefault = isDefault === true || existingCountForKind === 0

    const addressPrivacyData = buildAddressPrivacyWriteData({
      formattedAddress: values.formattedAddress,
      addressLine1: values.addressLine1,
      addressLine2: values.addressLine2,
      city: values.city,
      state: values.state,
      postalCode: values.postalCode,
      countryCode: values.countryCode,
      placeId: values.placeId,
      lat: values.lat,
      lng: values.lng,
    })

    const created = await prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.clientAddress.updateMany({
          where: {
            clientId: auth.clientId,
            kind,
            isDefault: true,
          },
          data: { isDefault: false },
        })
      }

      return tx.clientAddress.create({
        data: {
          clientId: auth.clientId,
          kind,
          isDefault: shouldBeDefault,
          label: values.label,
          formattedAddress: values.formattedAddress,
          addressLine1: values.addressLine1,
          addressLine2: values.addressLine2,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
          countryCode: values.countryCode,
          placeId: values.placeId,
          lat: clientAddressNumberToDecimalOrNull(values.lat),
          lng: clientAddressNumberToDecimalOrNull(values.lng),
          ...addressPrivacyData,
        },
        select: CLIENT_ADDRESS_SELECT,
      })
    })

    return jsonOk(
      {
        address: mapClientAddress(created),
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/client/addresses error', error)
    return jsonFail(500, 'Failed to create client address.')
  }
}