// app/api/health/ready/route.ts

import { jsonOk } from '@/app/api/_utils'
import { runReadyChecks } from '@/lib/health/checks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const result = await runReadyChecks()

  return jsonOk(result.response, result.statusCode)
}