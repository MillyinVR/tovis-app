// app/api/v1/pro/migrate/services/preview/route.ts
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

    // `locationCapability` / `defaultOfferingModes` are the SAME two fields
    // `GET /api/v1/pro/services/catalog` ships to the Add-service form. Both
    // import wizards seed their Salon/Mobile display from them instead of
    // hardcoding salon-on/mobile-off.
    return jsonOk(
      {
        catalog: preview.catalog,
        rows: preview.rows,
        locationCapability: preview.locationCapability,
        defaultOfferingModes: preview.defaultOfferingModes,
      },
      200,
    )
  } catch (error) {
    console.error('POST /api/v1/pro/migrate/services/preview error', error)
    return jsonFail(500, 'Internal server error')
  }
}
