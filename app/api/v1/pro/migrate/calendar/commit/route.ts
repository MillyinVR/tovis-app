// app/api/v1/pro/migrate/calendar/commit/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { parseCalendarFeed } from '@/lib/migration/calendarImport'
import {
  commitCalendarImport,
  parseCalendarImportRequest,
} from '@/lib/migration/calendarImportServer'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const parsed = parseCalendarImportRequest(body)
    if (!parsed) return jsonFail(400, 'Invalid calendar payload')

    const events = parseCalendarFeed(parsed.icsText)
    const result = await commitCalendarImport({
      professionalId: auth.professionalId,
      actorUserId: auth.userId,
      events,
      excludeUids: parsed.excludeUids,
      now: new Date(),
    })

    return jsonOk(result, 200)
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/calendar/commit error', error)
    return jsonFail(500, 'Internal server error')
  }
}
