// app/api/v1/pro/reminder-settings/route.ts
//
// GET  — read the pro's appointment-reminder cadence + suggested presets.
// PUT  — create/update it from a structured reminders: {value, unit}[] list.
// Not flag-gated: appointment reminders already ship; this just lets a pro
// choose which of them fire and at what lead times.
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getProReminderSettings,
  parseReminderLeadsToOffsetMinutes,
  updateProReminderSettings,
  ProReminderSettingsValidationError,
  REMINDER_PRESETS,
} from '@/lib/reminderSettings/settings'
import type { ProReminderSettingsResponseDTO } from '@/lib/dto/reminderSettings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const settings = await getProReminderSettings(auth.professionalId)
    const response: ProReminderSettingsResponseDTO = {
      settings,
      presets: [...REMINDER_PRESETS],
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

    const settings = await updateProReminderSettings({
      professionalId: auth.professionalId,
      update: {
        enabled: body.enabled === true,
        offsetMinutes: parseReminderLeadsToOffsetMinutes(body.reminders),
      },
    })

    const response: ProReminderSettingsResponseDTO = {
      settings,
      presets: [...REMINDER_PRESETS],
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
