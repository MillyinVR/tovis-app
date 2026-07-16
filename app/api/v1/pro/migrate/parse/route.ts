// app/api/v1/pro/migrate/parse/route.ts
//
// Parse an uploaded spreadsheet (xlsx / legacy xls / CSV) into headers + string
// rows for the migration wizard. Web and iOS both send binary exports here
// (base64) instead of parsing Excel client-side — see lib/migration/tableParse.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import { parseSpreadsheet, parseTableParseRequest } from '@/lib/migration/tableParse'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const parsed = parseTableParseRequest(body)
    if ('error' in parsed) {
      return parsed.error === 'TOO_LARGE'
        ? jsonFail(413, 'That file is too large to import.')
        : jsonFail(400, 'Invalid file payload')
    }

    const result = parseSpreadsheet(parsed.content)
    if (!result.ok) {
      return jsonFail(result.code === 'TOO_LARGE' ? 413 : 422, result.error)
    }

    return jsonOk(
      {
        headers: result.table.headers,
        rows: result.table.rows,
        truncated: result.table.truncated,
      },
      200,
    )
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/parse error', error)
    return jsonFail(500, 'Internal server error')
  }
}
