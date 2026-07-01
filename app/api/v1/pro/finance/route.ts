// GET /api/v1/pro/finance — the pro Finance & Tax tab. A superset of
// /api/v1/pro/overview: it returns the full performance Overview view-model
// (revenue / stats / top services) PLUS the finance block (income breakdown,
// expenses, net profit, estimated tax, quarterly reminder, category guide).
// `?month=YYYY-MM` selects a month (defaults to the current month).
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadProFinancePage } from '@/lib/finance/proFinanceSummary'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const month = new URL(req.url).searchParams.get('month') ?? undefined

    const tenantContext = await resolveTenantContextForRequest(req)
    const brand = getBrandForTenantContext(tenantContext)

    const finance = await loadProFinancePage({
      professionalId: auth.professionalId,
      professionalTimeZone: auth.user.professionalProfile?.timeZone,
      searchParams: month ? { month } : undefined,
      now: new Date(),
      brandName: brand.displayName,
    })

    return jsonOk(finance)
  } catch (error) {
    console.error('GET /api/v1/pro/finance error', error)
    return jsonFail(500, 'Internal server error')
  }
}
