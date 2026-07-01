// GET /api/v1/pro/finance/export?scope=month|ytd|year&month=YYYY-MM
// Streams a CSV of income + expenses formatted for a CPA / Schedule C. The pro's
// own data only (requirePro). PDF / Schedule-C-formatted export is a later phase.
import { jsonFail } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import {
  buildFinanceCsv,
  isFinanceExportScope,
} from '@/lib/finance/proFinanceExport'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
} from '@/lib/time'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function currentMonthKey(timeZone: string): string {
  const parts = getZonedParts(new Date(), timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const url = new URL(req.url)
    const scopeParam = url.searchParams.get('scope') ?? 'month'
    if (!isFinanceExportScope(scopeParam)) {
      return jsonFail(400, 'Invalid export scope.')
    }

    const timeZone = sanitizeTimeZone(
      auth.user.professionalProfile?.timeZone,
      DEFAULT_TIME_ZONE,
    )

    const monthParam = url.searchParams.get('month')
    const selectedMonthKey =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : currentMonthKey(timeZone)

    const tenantContext = await resolveTenantContextForRequest(req)
    const brand = getBrandForTenantContext(tenantContext)

    const { filename, csv } = await buildFinanceCsv({
      professionalId: auth.professionalId,
      timeZone,
      scope: scopeParam,
      selectedMonthKey,
      brandName: brand.displayName,
    })

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('GET /api/v1/pro/finance/export error', error)
    return jsonFail(500, 'Internal server error')
  }
}
