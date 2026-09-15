import { lookAnalysisList } from '@/app/api/_utils/lookAnalysis'
export const dynamic = 'force-dynamic'
export function GET() { return lookAnalysisList(false) }
