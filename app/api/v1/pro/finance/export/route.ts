// GET /api/v1/pro/finance/export?scope=month|ytd|year&month=YYYY-MM&format=csv|pdf
// Streams the pro's income + expenses for a CPA / Schedule C: `format=csv`
// (default) is line-item data; `format=pdf` is the one-page "Schedule C Ready"
// summary mapped to form lines. The pro's own data only (requirePro).
import { jsonFail } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import {
  buildFinanceCsv,
  isFinanceExportScope,
} from '@/lib/finance/proFinanceExport'
import { buildScheduleCPdf } from '@/lib/finance/proFinanceScheduleCPdf'
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
    const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv'

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

    if (format === 'pdf') {
      const pro = auth.user.professionalProfile
      const { filename, bytes } = await buildScheduleCPdf({
        professionalId: auth.professionalId,
        timeZone,
        scope: scopeParam,
        selectedMonthKey,
        brandName: brand.displayName,
        businessName: pro ? pickProfessionalPublicDisplayName(pro) : null,
      })

      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

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
