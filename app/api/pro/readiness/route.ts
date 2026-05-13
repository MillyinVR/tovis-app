// app/api/pro/readiness/route.ts

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { loadProReadiness } from '@/lib/pro-readiness'

export async function GET() {
  const auth = await requirePro()

  if (!auth.ok) {
    return auth.res
  }

  const readiness = await loadProReadiness(auth.professionalId)

  if (!readiness) {
    return jsonFail(404, 'Professional profile was not found.')
  }

  return jsonOk(
    {
      readiness,
    },
    200,
  )
}