// app/api/v1/client/notification-preferences/route.ts

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { parsePreferenceUpdate } from '@/lib/notifications/preferenceRequest'
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/lib/notifications/preferenceService'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const data = await loadNotificationPreferences({
      audience: 'client',
      ownerId: auth.clientId,
    })

    return jsonOk(data, 200)
  } catch (error) {
    console.error('GET /api/v1/client/notification-preferences error', error)
    return jsonFail(500, 'Failed to load notification preferences.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)
    const parsed = parsePreferenceUpdate({ audience: 'client', body })
    if (!parsed.ok) return jsonFail(400, parsed.error)

    await saveNotificationPreferences({
      audience: 'client',
      ownerId: auth.clientId,
      events: parsed.value.events,
      quietHours: parsed.value.quietHours,
    })

    const data = await loadNotificationPreferences({
      audience: 'client',
      ownerId: auth.clientId,
    })

    return jsonOk(data, 200)
  } catch (error) {
    console.error('PATCH /api/v1/client/notification-preferences error', error)
    return jsonFail(500, 'Failed to update notification preferences.')
  }
}
