// app/api/v1/pro/readiness/route.ts

import { jsonOk, requirePro } from '@/app/api/_utils'
import { checkProReadiness } from '@/lib/pro/readiness/proReadiness'

export async function GET() {
  const auth = await requirePro()

  if (!auth.ok) {
    return auth.res
  }

  const readiness = await checkProReadiness(auth.professionalId)

  return jsonOk(
    {
      readiness,
    },
    200,
  )
}