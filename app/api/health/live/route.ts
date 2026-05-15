// app/api/health/live/route.ts

import { jsonOk } from '@/app/api/_utils'
import { runLiveChecks } from '@/lib/health/checks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const result = await runLiveChecks()

  return jsonOk(result.response, result.statusCode)
}