// app/api/pro/migrate/calendar/fetch/route.ts
//
// Fetch a pro-supplied read-only calendar feed URL server-side (SSRF-guarded)
// and return the raw .ics text. The client then runs the same preview/commit
// flow it uses for an uploaded file, so the feed URL and file upload converge.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { fetchCalendarFeed } from '@/lib/migration/calendarFeed'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_URL: 400,
  BLOCKED: 400,
  TOO_LARGE: 413,
  UNREACHABLE: 502,
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const url = typeof body.url === 'string' ? body.url : ''
    if (!url.trim()) return jsonFail(400, 'Enter a calendar feed URL.')

    const result = await fetchCalendarFeed(url)
    if (!result.ok) {
      return jsonFail(STATUS_BY_CODE[result.code] ?? 400, result.error)
    }

    return jsonOk({ ics: result.ics }, 200)
  } catch (error) {
    console.error('POST /api/pro/migrate/calendar/fetch error', error)
    return jsonFail(500, 'Internal server error')
  }
}
