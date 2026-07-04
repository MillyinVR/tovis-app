// app/api/v1/pro/no-show-settings/route.ts
//
// GET  — read the pro's no-show / late-cancel fee policy.
// PUT  — create/update it.
// Dark unless ENABLE_NO_SHOW_PROTECTION is on (Phase 2 revenue protection).
import { NoShowFeeType } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import {
  getProNoShowSettings,
  updateProNoShowSettings,
  ProNoShowSettingsValidationError,
} from '@/lib/noShowProtection/settings'
import type {
  ProNoShowSettingsResponseDTO,
  ProNoShowSettingsUpdateRequestDTO,
} from '@/lib/dto/noShowSettings'

export const dynamic = 'force-dynamic'

function normalizeFeeType(v: unknown): NoShowFeeType {
  return typeof v === 'string' && v.trim().toUpperCase() === 'PERCENT'
    ? NoShowFeeType.PERCENT
    : NoShowFeeType.FLAT
}

function nullableTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function nullableInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseInt(v.trim(), 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function GET() {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const settings = await getProNoShowSettings(auth.professionalId)
    const response: ProNoShowSettingsResponseDTO = { settings }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/no-show-settings error', error)
    return jsonFail(500, 'Failed to load no-show settings.')
  }
}

export async function PUT(req: Request) {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const update: ProNoShowSettingsUpdateRequestDTO = {
      enabled: body.enabled === true,
      feeType: normalizeFeeType(body.feeType),
      feeFlatAmount: nullableTrimmedString(body.feeFlatAmount),
      feePercent: nullableInt(body.feePercent),
      cancelWindowHours: nullableInt(body.cancelWindowHours) ?? undefined,
      chargeNoShow: body.chargeNoShow !== false,
      chargeLateCancel: body.chargeLateCancel !== false,
    }

    const settings = await updateProNoShowSettings({
      professionalId: auth.professionalId,
      update,
    })

    const response: ProNoShowSettingsResponseDTO = { settings }
    return jsonOk(response)
  } catch (error: unknown) {
    if (error instanceof ProNoShowSettingsValidationError) {
      return jsonFail(400, error.message)
    }
    console.error('PUT /api/v1/pro/no-show-settings error', error)
    return jsonFail(500, 'Failed to save no-show settings.')
  }
}
