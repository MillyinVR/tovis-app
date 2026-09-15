import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { processNextLookAnalysis } from '@/lib/looks/analysis/process'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function POST(request: Request) {
  if (!getInternalJobSecret()) return jsonFail(503, 'Job unavailable')
  if (!isAuthorizedJobRequest(request)) return jsonFail(401, 'Unauthorized')
  return jsonOk(await processNextLookAnalysis())
}
export const GET = POST
