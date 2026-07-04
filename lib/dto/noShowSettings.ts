// lib/dto/noShowSettings.ts
//
// Wire contract for the pro no-show / late-cancel fee settings endpoints
// (Phase 2 revenue protection): GET/PUT /api/v1/pro/no-show-settings. Dark unless
// ENABLE_NO_SHOW_PROTECTION is on.

import type { NoShowFeeType } from '@prisma/client'

/** A pro's account-level no-show / late-cancel fee policy. */
export type ProNoShowSettingsDTO = {
  /** Master opt-in. While false the pro never charges a fee. */
  enabled: boolean
  /** How the fee is computed: a flat dollar amount or a percent of the total. */
  feeType: NoShowFeeType
  /** Flat fee as a 2dp money string (e.g. "25.00"), or null when unset. */
  feeFlatAmount: string | null
  /** Percent of the booking total (1–100), or null when unset. */
  feePercent: number | null
  /** Hours before start inside which a client cancel is a billable late cancel. */
  cancelWindowHours: number
  /** Charge when the pro marks a booking as a no-show. */
  chargeNoShow: boolean
  /** Charge when a client cancels inside the window. */
  chargeLateCancel: boolean
}

/** Response for GET /api/v1/pro/no-show-settings. */
export type ProNoShowSettingsResponseDTO = {
  settings: ProNoShowSettingsDTO
}

/** Request body for PUT /api/v1/pro/no-show-settings. */
export type ProNoShowSettingsUpdateRequestDTO = {
  enabled: boolean
  feeType: NoShowFeeType
  feeFlatAmount: string | null
  feePercent: number | null
  cancelWindowHours?: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
}
