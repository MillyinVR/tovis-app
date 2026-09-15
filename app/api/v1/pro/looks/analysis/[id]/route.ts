import { lookAnalysisMutation } from '@/app/api/_utils/lookAnalysis'
import type { RouteContext } from '@/app/api/_utils/routeContext'
export const dynamic = 'force-dynamic'
export function PATCH(request: Request, context: RouteContext) { return lookAnalysisMutation(request, context, false) }
