// app/api/v1/pro/migrate/services/commit/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import {
  commitServiceImport,
  parseServiceDecisions,
} from '@/lib/migration/serviceImportServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

    const body = await readJsonRecord(request)
    const decisions = parseServiceDecisions(body)
    if (!decisions) return jsonFail(400, 'Invalid decisions payload')

    const result = await commitServiceImport({
      professionalId: auth.professionalId,
      decisions,
    })

    return jsonOk({ rows: result.rows, summary: result.summary }, 200)
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/services/commit error', error)
    return jsonFail(500, 'Internal server error')
  }
}
