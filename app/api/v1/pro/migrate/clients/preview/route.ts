// app/api/v1/pro/migrate/clients/preview/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import {
  parseClientImportRequest,
  previewClientImport,
} from '@/lib/migration/clientImportServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const parsed = parseClientImportRequest(body)
    if (!parsed) return jsonFail(400, 'Invalid import payload')

    const preview = await previewClientImport({
      rows: parsed.rows,
      mapping: parsed.mapping,
    })

    return jsonOk({ rows: preview.rows, summary: preview.summary }, 200)
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/clients/preview error', error)
    return jsonFail(500, 'Internal server error')
  }
}
