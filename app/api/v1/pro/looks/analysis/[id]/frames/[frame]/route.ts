import { lookAnalysisFrame } from '@/app/api/_utils/lookAnalysis'
import type { RouteContext } from '@/app/api/_utils/routeContext'
export const dynamic = 'force-dynamic'
export function GET(_request: Request, context: RouteContext<{ id: string; frame: string }>) { return lookAnalysisFrame(context, false) }
