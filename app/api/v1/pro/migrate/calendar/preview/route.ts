// app/api/v1/pro/migrate/calendar/preview/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { parseCalendarFeed } from '@/lib/migration/calendarImport'
import {
  parseCalendarImportRequest,
  previewCalendarImport,
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
    const preview = await previewCalendarImport({
      professionalId: auth.professionalId,
      events,
      now: new Date(),
    })

    return jsonOk(preview, 200)
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/calendar/preview error', error)
    return jsonFail(500, 'Internal server error')
  }
}
