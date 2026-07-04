// lib/noShowProtection/settings.ts
//
// Single source of truth for a pro's account-level no-show / late-cancel fee
// policy (Phase 2 revenue protection). One ProNoShowSettings row per pro, created
// lazily. Owns reads, the upsert applied by the settings surface, and DTO
// mapping. Callers must gate exposure behind noShowProtectionEnabled(); this
// module is flag-agnostic so tests can exercise it directly. NOTHING here charges
// a card — that is lib/noShowProtection/charge.ts.

import { NoShowFeeType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { moneyToFixed2String, parseMoney } from '@/lib/money'
import type { ProNoShowSettingsDTO } from '@/lib/dto/noShowSettings'

type ProNoShowSettingsRow = {
  enabled: boolean
  feeType: NoShowFeeType
  feeFlatAmount: Prisma.Decimal | null
  feePercent: number | null
  cancelWindowHours: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
}

/** Defaults describing "fee protection off" — used when a pro has no row yet. */
const DEFAULTS: ProNoShowSettingsRow = {
  enabled: false,
  feeType: NoShowFeeType.FLAT,
  feeFlatAmount: null,
  feePercent: null,
  cancelWindowHours: 24,
  chargeNoShow: true,
  chargeLateCancel: true,
}

const SELECT = {
  enabled: true,
  feeType: true,
  feeFlatAmount: true,
  feePercent: true,
  cancelWindowHours: true,
  chargeNoShow: true,
  chargeLateCancel: true,
} satisfies Prisma.ProNoShowSettingsSelect

export function toProNoShowSettingsDTO(
  row: ProNoShowSettingsRow,
): ProNoShowSettingsDTO {
  return {
    enabled: row.enabled,
    feeType: row.feeType,
    feeFlatAmount: moneyToFixed2String(row.feeFlatAmount),
    feePercent: row.feePercent,
    cancelWindowHours: row.cancelWindowHours,
    chargeNoShow: row.chargeNoShow,
    chargeLateCancel: row.chargeLateCancel,
  }
}

/** Read a pro's fee policy, falling back to the "off" defaults when unset. */
export async function getProNoShowSettings(
  professionalId: string,
): Promise<ProNoShowSettingsDTO> {
  const row = await prisma.proNoShowSettings.findUnique({
    where: { professionalId },
    select: SELECT,
  })
  return toProNoShowSettingsDTO(row ?? DEFAULTS)
}

/** Validated patch the settings route applies. Amounts arrive as strings. */
export type ProNoShowSettingsUpdate = {
  enabled: boolean
  feeType: NoShowFeeType
  feeFlatAmount: string | null
  feePercent: number | null
  cancelWindowHours?: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
}

export class ProNoShowSettingsValidationError extends Error {}

function normalizeUpdate(update: ProNoShowSettingsUpdate): {
  enabled: boolean
  feeType: NoShowFeeType
  feeFlatAmount: Prisma.Decimal | null
  feePercent: number | null
  cancelWindowHours: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
} {
  const cancelWindowHours = update.cancelWindowHours ?? DEFAULTS.cancelWindowHours

  let feeFlatAmount: Prisma.Decimal | null = null
  let feePercent: number | null = null

  if (update.feeType === NoShowFeeType.FLAT) {
    if (update.feeFlatAmount != null && update.feeFlatAmount.trim() !== '') {
      let parsed: Prisma.Decimal
      try {
        parsed = parseMoney(update.feeFlatAmount)
      } catch {
        throw new ProNoShowSettingsValidationError(
          'Enter a valid fee amount.',
        )
      }
      if (parsed.lessThan(0)) {
        throw new ProNoShowSettingsValidationError(
          'Fee amount cannot be negative.',
        )
      }
      feeFlatAmount = parsed.toDecimalPlaces(2)
    }
  } else {
    if (update.feePercent != null) {
      if (
        !Number.isInteger(update.feePercent) ||
        update.feePercent < 1 ||
        update.feePercent > 100
      ) {
        throw new ProNoShowSettingsValidationError(
          'Fee percent must be a whole number between 1 and 100.',
        )
      }
      feePercent = update.feePercent
    }
  }

  // Turning protection on requires a usable fee amount for the chosen type.
  if (update.enabled) {
    if (update.feeType === NoShowFeeType.FLAT && !feeFlatAmount) {
      throw new ProNoShowSettingsValidationError(
        'Set a flat fee amount before turning on no-show protection.',
      )
    }
    if (update.feeType === NoShowFeeType.PERCENT && feePercent == null) {
      throw new ProNoShowSettingsValidationError(
        'Set a fee percent before turning on no-show protection.',
      )
    }
  }

  if (cancelWindowHours < 1 || cancelWindowHours > 168) {
    throw new ProNoShowSettingsValidationError(
      'Cancel window must be between 1 and 168 hours.',
    )
  }

  return {
    enabled: update.enabled,
    feeType: update.feeType,
    feeFlatAmount,
    feePercent,
    cancelWindowHours,
    chargeNoShow: update.chargeNoShow,
    chargeLateCancel: update.chargeLateCancel,
  }
}

/** Create-or-update a pro's fee policy and return the persisted DTO. */
export async function updateProNoShowSettings(args: {
  professionalId: string
  update: ProNoShowSettingsUpdate
}): Promise<ProNoShowSettingsDTO> {
  const data = normalizeUpdate(args.update)

  const row = await prisma.proNoShowSettings.upsert({
    where: { professionalId: args.professionalId },
    create: { professionalId: args.professionalId, ...data },
    update: data,
    select: SELECT,
  })

  return toProNoShowSettingsDTO(row)
}
