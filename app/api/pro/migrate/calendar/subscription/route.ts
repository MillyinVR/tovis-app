// app/api/pro/migrate/calendar/subscription/route.ts
//
// Manage the pro's calendar feed subscription: GET current, POST to connect (or
// update) a feed URL for auto-resync, DELETE to disconnect.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  disconnectCalendarFeedSubscription,
  getCalendarFeedSubscription,
  saveCalendarFeedSubscription,
} from '@/lib/migration/calendarFeedSubscription'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

  const subscription = await getCalendarFeedSubscription(auth.professionalId)
  return jsonOk({ subscription }, 200)
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const feedUrl = typeof body.url === 'string' ? body.url : ''
    if (!feedUrl.trim()) return jsonFail(400, 'Enter a calendar feed URL.')

    const result = await saveCalendarFeedSubscription({
      professionalId: auth.professionalId,
      feedUrl,
    })
    if (!result.ok) return jsonFail(400, result.error)

    return jsonOk({ subscription: result.subscription }, 200)
  } catch (error) {
    console.error('POST /api/pro/migrate/calendar/subscription error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    await disconnectCalendarFeedSubscription(auth.professionalId)
    return jsonOk({ ok: true }, 200)
  } catch (error) {
    console.error('DELETE /api/pro/migrate/calendar/subscription error', error)
    return jsonFail(500, 'Internal server error')
  }
}
