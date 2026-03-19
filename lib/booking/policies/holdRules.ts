import {
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { pickFormattedAddressFromSnapshot } from '@/lib/booking/snapshots'

export type HoldRuleFailureCode =
  | 'HOLD_NOT_FOUND'
  | 'HOLD_FORBIDDEN'
  | 'HOLD_EXPIRED'
  | 'HOLD_MISMATCH'
  | 'HOLD_MISSING_CLIENT_ADDRESS'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'

export type HoldRuleResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      code: HoldRuleFailureCode
      message?: string
      userMessage?: string
    }

export type HoldRuleRecord = {
  id: string
  clientId: string | null
  professionalId: string
  offeringId: string
  scheduledFor: Date
  expiresAt: Date
  locationType: ServiceLocationType
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot?: Prisma.JsonValue | null
  clientAddressId: string | null
  clientAddressSnapshot: Prisma.JsonValue | null
}

export type ValidatedHoldForClientMutation = {
  holdId: string
  locationId: string
  locationType: ServiceLocationType
  locationTimeZone: string | null
  holdClientAddressId: string | null
  holdClientServiceAddressText: string | null
  holdSalonAddressTextFromSnapshot: string | null
}

function holdRuleOk<T>(value: T): HoldRuleResult<T> {
  return { ok: true, value }
}

function holdRuleFail<T>(
  code: HoldRuleFailureCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
): HoldRuleResult<T> {
  return {
    ok: false,
    code,
    message: overrides?.message,
    userMessage: overrides?.userMessage,
  }
}

export function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function resolveHeldSalonAddressText(args: {
  holdLocationType: ServiceLocationType
  holdLocationAddressSnapshot: Prisma.JsonValue | null | undefined
  fallbackFormattedAddress: unknown
}): HoldRuleResult<string | null> {
  if (args.holdLocationType !== ServiceLocationType.SALON) {
    return holdRuleOk(null)
  }

  const salonAddressText =
    pickFormattedAddressFromSnapshot(args.holdLocationAddressSnapshot) ??
    normalizeAddress(args.fallbackFormattedAddress)

  if (!salonAddressText) {
    return holdRuleFail('SALON_LOCATION_ADDRESS_REQUIRED')
  }

  return holdRuleOk(salonAddressText)
}

export async function validateHoldForClientMutation(args: {
  tx: Prisma.TransactionClient
  hold: HoldRuleRecord | null
  clientId: string
  now: Date
  expectedProfessionalId: string
  expectedOfferingId: string
  expectedLocationType?: ServiceLocationType | null
}): Promise<HoldRuleResult<ValidatedHoldForClientMutation>> {
  const hold = args.hold

  if (!hold) {
    return holdRuleFail('HOLD_NOT_FOUND')
  }

  if (hold.clientId !== args.clientId) {
    return holdRuleFail('HOLD_FORBIDDEN')
  }

  if (hold.expiresAt.getTime() <= args.now.getTime()) {
    return holdRuleFail('HOLD_EXPIRED')
  }

  if (hold.professionalId !== args.expectedProfessionalId) {
    return holdRuleFail('HOLD_MISMATCH', {
      message: 'Hold is for a different professional.',
      userMessage:
        'That hold no longer matches this booking. Please pick a new slot.',
    })
  }

  if (hold.offeringId !== args.expectedOfferingId) {
    return holdRuleFail('HOLD_MISMATCH', {
      message: 'Hold is for a different service.',
      userMessage:
        'That hold no longer matches this booking. Please pick a new slot.',
    })
  }

  if (
    args.expectedLocationType &&
    hold.locationType !== args.expectedLocationType
  ) {
    return holdRuleFail('HOLD_MISMATCH', {
      message:
        'Hold location type does not match the requested location type.',
      userMessage:
        'That hold no longer matches this booking. Please pick a new slot.',
    })
  }

  if (!hold.locationId) {
    return holdRuleFail('HOLD_MISMATCH', {
      message: 'Hold is missing location info.',
      userMessage: 'That hold is missing location info. Please pick a new slot.',
    })
  }

  const holdSalonAddressTextFromSnapshot =
    hold.locationType === ServiceLocationType.SALON
      ? pickFormattedAddressFromSnapshot(hold.locationAddressSnapshot)
      : null

  let holdClientServiceAddressText: string | null = null

  if (hold.locationType === ServiceLocationType.MOBILE) {
    holdClientServiceAddressText = pickFormattedAddressFromSnapshot(
      hold.clientAddressSnapshot,
    )

    if (!hold.clientAddressId || !holdClientServiceAddressText) {
      return holdRuleFail('HOLD_MISSING_CLIENT_ADDRESS')
    }

    const ownedClientAddress = await args.tx.clientAddress.findFirst({
      where: {
        id: hold.clientAddressId,
        clientId: args.clientId,
        kind: ClientAddressKind.SERVICE_ADDRESS,
      },
      select: { id: true },
    })

    if (!ownedClientAddress) {
      return holdRuleFail('CLIENT_SERVICE_ADDRESS_REQUIRED')
    }
  }

  return holdRuleOk({
    holdId: hold.id,
    locationId: hold.locationId,
    locationType: hold.locationType,
    locationTimeZone: hold.locationTimeZone ?? null,
    holdClientAddressId: hold.clientAddressId,
    holdClientServiceAddressText,
    holdSalonAddressTextFromSnapshot,
  })
}