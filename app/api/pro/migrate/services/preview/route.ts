// app/api/pro/migrate/services/preview/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import {
  parseServiceMenuRows,
  previewServiceImport,
} from '@/lib/migration/serviceImportServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const rows = parseServiceMenuRows(body)
    if (!rows) return jsonFail(400, 'Invalid menu payload')

    const preview = await previewServiceImport({
      professionalId: auth.professionalId,
      rows,
    })

    return jsonOk({ catalog: preview.catalog, rows: preview.rows }, 200)
  } catch (error) {
    console.error('POST /api/pro/migrate/services/preview error', error)
    return jsonFail(500, 'Internal server error')
  }
}
