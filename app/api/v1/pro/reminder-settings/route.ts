// app/api/v1/pro/reminder-settings/route.ts
//
// GET  — read the pro's appointment-reminder cadence + the supported menu.
// PUT  — create/update it.
// Not flag-gated: appointment reminders already ship; this just lets a pro
// choose which of them fire.
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getProReminderSettings,
  updateProReminderSettings,
  ProReminderSettingsValidationError,
  REMINDER_OFFSET_OPTIONS,
} from '@/lib/reminderSettings/settings'
import type {
  ProReminderSettingsResponseDTO,
  ProReminderSettingsUpdateRequestDTO,
} from '@/lib/dto/reminderSettings'

export const dynamic = 'force-dynamic'

function normalizeOffsetDays(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const raw of v) {
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number.parseInt(raw.trim(), 10)
          : NaN
    if (Number.isInteger(n)) out.push(n)
  }
  return out
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const settings = await getProReminderSettings(auth.professionalId)
    const response: ProReminderSettingsResponseDTO = {
      settings,
      options: [...REMINDER_OFFSET_OPTIONS],
    }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/reminder-settings error', error)
    return jsonFail(500, 'Failed to load reminder settings.')
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const update: ProReminderSettingsUpdateRequestDTO = {
      enabled: body.enabled === true,
      offsetDays: normalizeOffsetDays(body.offsetDays),
    }

    const settings = await updateProReminderSettings({
      professionalId: auth.professionalId,
      update,
    })

    const response: ProReminderSettingsResponseDTO = {
      settings,
      options: [...REMINDER_OFFSET_OPTIONS],
    }
    return jsonOk(response)
  } catch (error: unknown) {
    if (error instanceof ProReminderSettingsValidationError) {
      return jsonFail(400, error.message)
    }
    console.error('PUT /api/v1/pro/reminder-settings error', error)
    return jsonFail(500, 'Failed to save reminder settings.')
  }
}
