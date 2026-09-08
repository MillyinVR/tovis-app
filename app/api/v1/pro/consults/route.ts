import { requirePro, jsonOk } from '@/app/api/_utils'
import { loadProLookReviewQueue } from '@/lib/consult/lookReviewQueue'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  return jsonOk(await loadProLookReviewQueue(auth.professionalId, new URL(request.url).searchParams.get('cursor') ?? undefined))
}
