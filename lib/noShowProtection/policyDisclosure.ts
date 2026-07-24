// lib/noShowProtection/policyDisclosure.ts
//
// Client-facing disclosure of a pro's no-show / late-cancel fee policy (Phase 2
// revenue protection). Two jobs:
//   1. Build the immutable POLICY SNAPSHOT recorded on a booking at finalize —
//      the exact terms the client agreed to. The no-show fee is later charged
//      FROM this snapshot (lib/noShowProtection/charge.ts), so a pro editing
//      their live policy afterward can never charge a client more than they saw.
//   2. Format the snapshot (or a live settings DTO) into one honest, client-safe
//      sentence rendered at the booking-confirm step and on the booking detail.
//
// Pure — no DB, no Stripe. Flag-agnostic: callers gate exposure behind
// noShowProtectionEnabled(). NOTHING here charges a card.

import { NoShowFeeType } from '@prisma/client'

import type { ProNoShowSettingsDTO } from '@/lib/dto/noShowSettings'
import { isRecord } from '@/lib/guards'

/**
 * The exact fee terms a client agreed to, snapshotted onto the booking at
 * finalize and stored as JSON. Mirrors the chargeable subset of
 * ProNoShowSettings; `feeFlatAmount` is a 2dp string (JSON-safe) parsed back to a
 * Decimal when charging. A snapshot only exists when a chargeable policy applied
 * at booking time, so its presence alone means "the client agreed to a fee".
 */
export type CancellationPolicySnapshot = {
  feeType: NoShowFeeType
  feeFlatAmount: string | null
  feePercent: number | null
  cancelWindowHours: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
}

/**
 * True when the pro's policy would actually charge a client something — enabled,
 * a usable fee amount for its type, and at least one triggering event. Only then
 * is a disclosure shown and agreement required at booking.
 */
export function cancellationPolicyApplies(dto: ProNoShowSettingsDTO): boolean {
  if (!dto.enabled) return false
  if (!dto.chargeNoShow && !dto.chargeLateCancel) return false
  if (dto.feeType === NoShowFeeType.FLAT) {
    return dto.feeFlatAmount != null && Number(dto.feeFlatAmount) > 0
  }
  return dto.feePercent != null && dto.feePercent > 0
}

/**
 * Build the snapshot to persist, or null when no chargeable policy applies (so
 * no snapshot is stored and no agreement is required).
 */
export function buildCancellationPolicySnapshot(
  dto: ProNoShowSettingsDTO,
): CancellationPolicySnapshot | null {
  if (!cancellationPolicyApplies(dto)) return null
  return {
    feeType: dto.feeType,
    feeFlatAmount: dto.feeType === NoShowFeeType.FLAT ? dto.feeFlatAmount : null,
    feePercent: dto.feeType === NoShowFeeType.PERCENT ? dto.feePercent : null,
    cancelWindowHours: dto.cancelWindowHours,
    chargeNoShow: dto.chargeNoShow,
    chargeLateCancel: dto.chargeLateCancel,
  }
}

function formatHours(hours: number): string {
  const h = Math.max(1, Math.round(hours))
  return `${h} hour${h === 1 ? '' : 's'}`
}

/**
 * One honest, client-facing sentence describing the fee policy, or null when no
 * chargeable policy applies. Uniform across web + iOS (the server formats it
 * once). Examples:
 *   "A cancellation fee ($25.00) applies if you cancel within 24 hours of your
 *    appointment or don't show up."
 *   "A cancellation fee (50% of the service price) applies if you don't show up."
 */
export function formatCancellationPolicy(
  policy: CancellationPolicySnapshot,
): string {
  const feeDesc =
    policy.feeType === NoShowFeeType.FLAT
      ? `$${policy.feeFlatAmount ?? '0.00'}`
      : `${policy.feePercent ?? 0}% of the service price`

  const lateClause = `cancel within ${formatHours(
    policy.cancelWindowHours,
  )} of your appointment`
  const noShowClause = `don’t show up`

  let when: string
  if (policy.chargeLateCancel && policy.chargeNoShow) {
    when = `${lateClause} or ${noShowClause}`
  } else if (policy.chargeLateCancel) {
    when = lateClause
  } else {
    when = noShowClause
  }

  return `A cancellation fee (${feeDesc}) applies if you ${when}.`
}

/**
 * Convenience: from a live settings DTO to the client disclosure string, or null.
 */
export function cancellationPolicyDisclosure(
  dto: ProNoShowSettingsDTO,
): string | null {
  const snapshot = buildCancellationPolicySnapshot(dto)
  return snapshot ? formatCancellationPolicy(snapshot) : null
}

/**
 * Safely parse a persisted `Booking.cancellationPolicySnapshot` JSON value back
 * into a typed snapshot, or null if it's absent/malformed. Used when charging the
 * no-show fee so the amount comes from what the client agreed to. Validates every
 * field rather than trusting the stored JSON's shape.
 */
export function parseCancellationPolicySnapshot(
  value: unknown,
): CancellationPolicySnapshot | null {
  if (!isRecord(value)) return null

  const feeType = value.feeType
  if (feeType !== NoShowFeeType.FLAT && feeType !== NoShowFeeType.PERCENT) {
    return null
  }

  const feeFlatAmount =
    typeof value.feeFlatAmount === 'string' ? value.feeFlatAmount : null
  const feePercent =
    typeof value.feePercent === 'number' ? value.feePercent : null
  const cancelWindowHours =
    typeof value.cancelWindowHours === 'number' ? value.cancelWindowHours : null
  if (cancelWindowHours === null) return null

  return {
    feeType,
    feeFlatAmount,
    feePercent,
    cancelWindowHours,
    chargeNoShow: value.chargeNoShow === true,
    chargeLateCancel: value.chargeLateCancel === true,
  }
}
