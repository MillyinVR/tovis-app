// app/api/pro/notifications/summary/route.ts
import { jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { getProNotificationSummary } from '@/lib/notifications/proNotificationQueries'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const summary = await getProNotificationSummary({
    professionalId: auth.professionalId,
  })

  return jsonOk(summary, 200)
}