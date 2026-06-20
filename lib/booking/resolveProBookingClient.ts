// lib/booking/resolveProBookingClient.ts

import {
  ClientAddressKind,
  ClientClaimStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

import {
  clientAddressNumberToDecimalOrNull,
  coerceClientAddressLatLng,
  getInvalidClientAddressField,
  hasFullClientServiceAddress,
  normalizeClientAddressBoolean,
  normalizeClientAddressLatLng,
  normalizeClientAddressOptionalString,
} from '@/lib/clientAddresses/addressInput'
import { resolveServiceAddressValues } from '@/lib/clientAddresses/resolveServiceAddress'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { prisma } from '@/lib/prisma'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { asTrimmedString } from '@/lib/guards'

type DbClient = Prisma.TransactionClient | typeof prisma

const RESOLVED_CLIENT_SELECT = {
  id: true,
  userId: true,
  claimStatus: true,
  email: true,
  user: {
    select: {
      email: true,
    },
  },
} satisfies Prisma.ClientProfileSelect

type ResolvedClientRecord = Prisma.ClientProfileGetPayload<{
  select: typeof RESOLVED_CLIENT_SELECT
}>

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return value != null
}

// Address-field normalization, completeness, and invalid-field detection are
// owned by lib/clientAddresses/addressInput (the single source of truth shared
// with the client-facing address routes). This module reuses them rather than
// re-implementing, so the pro and client paths stay in lockstep.

type NewClientInput = {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  phone?: unknown
}

export type ProBookingServiceAddressInput = {
  label?: unknown
  formattedAddress?: unknown
  addressLine1?: unknown
  addressLine2?: unknown
  city?: unknown
  state?: unknown
  postalCode?: unknown
  countryCode?: unknown
  placeId?: unknown
  lat?: unknown
  lng?: unknown
  isDefault?: unknown
}

type NormalizedServiceAddressInput = {
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
  isDefault: boolean | undefined
}

export type ResolveProBookingClientArgs = {
  professionalId: string
  locationType: ServiceLocationType
  clientId?: string | null
  client?: NewClientInput | null
  clientAddressId?: string | null
  serviceAddress?: ProBookingServiceAddressInput | null
  tx?: Prisma.TransactionClient
}

export type ResolveProBookingClientResult =
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
      clientClaimStatus: ClientClaimStatus
      clientAddressId: string | null
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }

function normalizeNewClientInput(value: NewClientInput | null | undefined) {
  return {
    firstName: value?.firstName,
    lastName: value?.lastName,
    email: value?.email,
    phone: value?.phone,
  }
}

function hasNewClientPayload(input: NewClientInput): boolean {
  return (
    hasMeaningfulValue(input.firstName) ||
    hasMeaningfulValue(input.lastName) ||
    hasMeaningfulValue(input.email) ||
    hasMeaningfulValue(input.phone)
  )
}

function hasAddressPayload(
  value: ProBookingServiceAddressInput | null | undefined,
): boolean {
  if (!value) return false

  return (
    hasMeaningfulValue(value.label) ||
    hasMeaningfulValue(value.formattedAddress) ||
    hasMeaningfulValue(value.addressLine1) ||
    hasMeaningfulValue(value.addressLine2) ||
    hasMeaningfulValue(value.city) ||
    hasMeaningfulValue(value.state) ||
    hasMeaningfulValue(value.postalCode) ||
    hasMeaningfulValue(value.countryCode) ||
    hasMeaningfulValue(value.placeId) ||
    value.lat !== undefined ||
    value.lng !== undefined ||
    value.isDefault !== undefined
  )
}

function normalizeServiceAddressInput(
  value: ProBookingServiceAddressInput | null | undefined,
):
  | { ok: true; data: NormalizedServiceAddressInput }
  | { ok: false; error: string } {
  const label = normalizeClientAddressOptionalString(value?.label, 80)
  const formattedAddress = normalizeClientAddressOptionalString(
    value?.formattedAddress,
    500,
  )
  const addressLine1 = normalizeClientAddressOptionalString(
    value?.addressLine1, // pii-plaintext-read-ok: normalizes pro-supplied client service address before centralized normalization/encryption
    200,
  )
  const addressLine2 = normalizeClientAddressOptionalString(
    value?.addressLine2, // pii-plaintext-read-ok: normalizes pro-supplied client service address before centralized normalization/encryption
    200,
  )
  const city = normalizeClientAddressOptionalString(value?.city, 120)
  const state = normalizeClientAddressOptionalString(value?.state, 120)
  const postalCode = normalizeClientAddressOptionalString(value?.postalCode, 40) // pii-plaintext-read-ok: normalizes pro-supplied client postal code before centralized normalization/encryption
  const countryCode = normalizeClientAddressOptionalString(value?.countryCode, 8)
  const placeId = normalizeClientAddressOptionalString(value?.placeId, 255)
  const lat = normalizeClientAddressLatLng(value?.lat)
  const lng = normalizeClientAddressLatLng(value?.lng)
  const isDefault = normalizeClientAddressBoolean(value?.isDefault)

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

  const normalized: NormalizedServiceAddressInput = {
    label: label ?? null,
    formattedAddress: formattedAddress ?? null,
    addressLine1: addressLine1 ?? null,
    addressLine2: addressLine2 ?? null,
    city: city ?? null,
    state: state ?? null,
    postalCode: postalCode ?? null,
    countryCode: countryCode ?? null,
    placeId: placeId ?? null,
    lat: coerceClientAddressLatLng(lat),
    lng: coerceClientAddressLatLng(lng),
    isDefault: typeof isDefault === 'boolean' ? isDefault : undefined,
  }

  if (
    !hasFullClientServiceAddress({
      formattedAddress: normalized.formattedAddress,
      addressLine1: normalized.addressLine1,
      city: normalized.city,
      state: normalized.state,
      postalCode: normalized.postalCode,
      placeId: normalized.placeId,
      lat: normalized.lat ?? null,
      lng: normalized.lng ?? null,
    })
  ) {
    return {
      ok: false,
      error:
        'Service address needs a real address or formatted address before mobile booking.',
    }
  }

  return {
    ok: true,
    data: normalized,
  }
}

async function loadOwnedServiceAddress(args: {
  db: DbClient
  clientId: string
  clientAddressId: string
}) {
  return args.db.clientAddress.findFirst({
    where: {
      id: args.clientAddressId,
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
    select: {
      id: true,
    },
  })
}

async function loadResolvedClientById(args: {
  db: DbClient
  clientId: string
}): Promise<ResolvedClientRecord | null> {
  return args.db.clientProfile.findUnique({
    where: {
      id: args.clientId,
    },
    select: RESOLVED_CLIENT_SELECT,
  })
}

async function createServiceAddressInDb(args: {
  db: DbClient
  clientId: string
  input: NormalizedServiceAddressInput
}) {
  const existingCountForKind = await args.db.clientAddress.count({
    where: {
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
  })

  const shouldBeDefault =
    args.input.isDefault === true || existingCountForKind === 0

  if (shouldBeDefault) {
    await args.db.clientAddress.updateMany({
      where: {
        clientId: args.clientId,
        kind: ClientAddressKind.SERVICE_ADDRESS,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    })
  }

  const addressPrivacyData = buildAddressPrivacyWriteData({
    formattedAddress: args.input.formattedAddress,
    addressLine1: args.input.addressLine1,
    addressLine2: args.input.addressLine2,
    city: args.input.city,
    state: args.input.state,
    postalCode: args.input.postalCode,
    countryCode: args.input.countryCode,
    placeId: args.input.placeId,
    lat: args.input.lat,
    lng: args.input.lng,
  })

  return args.db.clientAddress.create({
    data: {
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
      isDefault: shouldBeDefault,
      label: args.input.label,
      formattedAddress: args.input.formattedAddress,
      addressLine1: args.input.addressLine1,
      addressLine2: args.input.addressLine2,
      city: args.input.city,
      state: args.input.state,
      postalCode: args.input.postalCode,
      countryCode: args.input.countryCode,
      placeId: args.input.placeId,
      lat: clientAddressNumberToDecimalOrNull(args.input.lat),
      lng: clientAddressNumberToDecimalOrNull(args.input.lng),
      ...addressPrivacyData,
    },
    select: {
      id: true,
    },
  })
}

async function createServiceAddress(args: {
  clientId: string
  input: NormalizedServiceAddressInput
  tx?: Prisma.TransactionClient
}) {
  if (args.tx) {
    return createServiceAddressInDb({
      db: args.tx,
      clientId: args.clientId,
      input: args.input,
    })
  }

  return prisma.$transaction(async (tx) =>
    createServiceAddressInDb({
      db: tx,
      clientId: args.clientId,
      input: args.input,
    }),
  )
}

async function resolveClientIdentity(args: {
  professionalId: string
  clientId?: string | null
  client?: NewClientInput | null
  tx?: Prisma.TransactionClient
}): Promise<
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
      clientClaimStatus: ClientClaimStatus
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }
> {
  const existingClientId = asTrimmedString(args.clientId)

  if (existingClientId) {
    const db = getDb(args.tx)
    const existingClient = await loadResolvedClientById({
      db,
      clientId: existingClientId,
    })

    if (!existingClient) {
      return {
        ok: false,
        status: 404,
        error: 'Client not found.',
        code: 'CLIENT_NOT_FOUND',
      }
    }

    return {
      ok: true,
      clientId: existingClient.id,
      clientUserId: existingClient.userId,
      clientEmail: existingClient.email ?? existingClient.user?.email ?? null,
      clientClaimStatus: existingClient.claimStatus,
    }
  }

  const clientInput = normalizeNewClientInput(args.client)

  if (!hasNewClientPayload(clientInput)) {
    return {
      ok: false,
      status: 400,
      error: 'clientId or client details are required.',
      code: 'VALIDATION_ERROR',
    }
  }

  const upserted = await upsertProClient({
    professionalId: args.professionalId,
    firstName: clientInput.firstName,
    lastName: clientInput.lastName,
    email: clientInput.email,
    phone: clientInput.phone,
    tx: args.tx,
  })

  if (!upserted.ok) {
    return upserted
  }

  return {
    ok: true,
    clientId: upserted.clientId,
    clientUserId: upserted.userId,
    clientEmail: upserted.email,
    clientClaimStatus: upserted.claimStatus,
  }
}

export async function resolveProBookingClient(
  args: ResolveProBookingClientArgs,
): Promise<ResolveProBookingClientResult> {
  const db = getDb(args.tx)

  const resolvedClient = await resolveClientIdentity({
    professionalId: args.professionalId,
    clientId: args.clientId,
    client: args.client,
    tx: args.tx,
  })

  if (!resolvedClient.ok) {
    return resolvedClient
  }

  if (args.locationType !== ServiceLocationType.MOBILE) {
    return {
      ok: true,
      clientId: resolvedClient.clientId,
      clientUserId: resolvedClient.clientUserId,
      clientEmail: resolvedClient.clientEmail,
      clientAddressId: null,
      clientClaimStatus: resolvedClient.clientClaimStatus,
    }
  }

  const existingClientAddressId = asTrimmedString(args.clientAddressId)

  if (existingClientAddressId) {
    const ownedAddress = await loadOwnedServiceAddress({
      db,
      clientId: resolvedClient.clientId,
      clientAddressId: existingClientAddressId,
    })

    if (!ownedAddress) {
      return {
        ok: false,
        status: 400,
        error: 'Please choose a valid saved service address.',
        code: 'CLIENT_SERVICE_ADDRESS_INVALID',
      }
    }

    return {
      ok: true,
      clientId: resolvedClient.clientId,
      clientUserId: resolvedClient.clientUserId,
      clientEmail: resolvedClient.clientEmail,
      clientClaimStatus: resolvedClient.clientClaimStatus,
      clientAddressId: ownedAddress.id,
    }
  }

  if (!hasAddressPayload(args.serviceAddress)) {
    return {
      ok: false,
      status: 400,
      error: 'Mobile bookings require a saved client service address.',
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
    }
  }

  const normalizedAddress = normalizeServiceAddressInput(args.serviceAddress)

  if (!normalizedAddress.ok) {
    return {
      ok: false,
      status: 400,
      error: normalizedAddress.error,
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    }
  }

  // Canonicalize a hand-typed service address into a formatted address +
  // coordinates so mobile booking accepts it (autocomplete picks short-circuit).
  // Runs before createServiceAddress so the external geocode is not inside a tx.
  const resolvedAddress = await resolveServiceAddressValues(
    normalizedAddress.data,
  )

  if (!resolvedAddress.ok) {
    return {
      ok: false,
      status: 400,
      error: resolvedAddress.error,
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    }
  }

  const createdAddress = await createServiceAddress({
    clientId: resolvedClient.clientId,
    input: resolvedAddress.values,
    tx: args.tx,
  })

  return {
    ok: true,
    clientId: resolvedClient.clientId,
    clientUserId: resolvedClient.clientUserId,
    clientEmail: resolvedClient.clientEmail,
    clientClaimStatus: resolvedClient.clientClaimStatus,
    clientAddressId: createdAddress.id,
  }
}