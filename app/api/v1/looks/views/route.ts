// app/api/v1/looks/views/route.ts
//
// Batched, sampled view ingestion (social-first plan B2). The client collects
// feed impressions (the active-slide signal) + detail-page opens, dedupes them
// per session, and flushes the id list here. Guest-allowed: impressions are the
// denominator for save-/follow-rate and count for signed-out viewers too.
//
// This never touches LookPost synchronously — it enqueues an APPLY_LOOK_VIEWS
// LooksSocialJob that increments viewCount for the published, approved looks in
// the batch (the job is the visibility gate, so no per-look access check here).
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { enqueueApplyLookViews } from '@/lib/jobs/looksSocial/enqueue'
import { MAX_APPLY_LOOK_VIEWS_BATCH } from '@/lib/jobs/looksSocial/applyLookViews'
import { isRecord } from '@/lib/guards'

export const dynamic = 'force-dynamic'

function readLookPostIds(body: unknown): string[] {
  if (!isRecord(body)) return []
  const raw = body.lookPostIds
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    seen.add(trimmed)
    if (seen.size >= MAX_APPLY_LOOK_VIEWS_BATCH) break
  }

  return Array.from(seen)
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => null)
    const lookPostIds = readLookPostIds(body)

    // Nothing to record — accept quietly so the client never treats an empty
    // flush as an error.
    if (lookPostIds.length === 0) {
      return jsonOk({ accepted: 0 }, 202)
    }

    await enqueueApplyLookViews(prisma, { lookPostIds })

    return jsonOk({ accepted: lookPostIds.length }, 202)
  } catch (e) {
    console.error('POST /api/v1/looks/views error', e)
    return jsonFail(500, 'Couldn’t record views. Try again.', {
      code: 'INTERNAL',
    })
  }
}
