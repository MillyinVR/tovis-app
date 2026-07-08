// app/api/v1/looks/views/route.ts
//
// Batched, sampled view ingestion (social-first plan B2). The client collects
// feed impressions (the active-slide signal) + detail-page opens, tags each
// with where it was surfaced, dedupes them per session, and flushes the batch
// here. Guest-allowed: impressions are the denominator for save-/follow-rate
// and count for signed-out viewers too.
//
// This never touches LookPost synchronously — it enqueues an APPLY_LOOK_VIEWS
// LooksSocialJob that increments viewCount for the published, approved looks in
// the batch and records the §5.6 per-source, per-day windowed aggregate (the
// job is the visibility gate, so no per-look access check here).
//
// Two body shapes are accepted: the source-tagged `impressions: [{ lookPostId,
// source }]` (current web) and the legacy `lookPostIds: [...]` (iOS + pre-§5.6
// web), which the job reads as FEED-sourced.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { enqueueApplyLookViews } from '@/lib/jobs/looksSocial/enqueue'
import {
  buildApplyLookViewsUpdate,
  coerceLookImpressionSource,
} from '@/lib/jobs/looksSocial/applyLookViews'
import type { LookViewImpression } from '@/lib/jobs/looksSocial/contracts'
import { isRecord } from '@/lib/guards'

export const dynamic = 'force-dynamic'

function readViewBatch(body: unknown): {
  impressions: LookViewImpression[]
  lookPostIds: string[]
} {
  if (!isRecord(body)) return { impressions: [], lookPostIds: [] }

  const impressions: LookViewImpression[] = []
  if (Array.isArray(body.impressions)) {
    for (const entry of body.impressions) {
      if (!isRecord(entry)) continue
      const { lookPostId } = entry
      if (typeof lookPostId !== 'string') continue
      impressions.push({
        lookPostId,
        source: coerceLookImpressionSource(entry.source),
      })
    }
  }

  const lookPostIds = Array.isArray(body.lookPostIds)
    ? body.lookPostIds.filter(
        (value): value is string => typeof value === 'string',
      )
    : []

  return { impressions, lookPostIds }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => null)
    // Normalize here so the accepted count reflects the deduped/capped batch the
    // job will actually apply.
    const { impressions, lookPostIds } = buildApplyLookViewsUpdate(
      readViewBatch(body),
    )

    // Nothing to record — accept quietly so the client never treats an empty
    // flush as an error.
    if (lookPostIds.length === 0) {
      return jsonOk({ accepted: 0 }, 202)
    }

    await enqueueApplyLookViews(prisma, { impressions })

    return jsonOk({ accepted: lookPostIds.length }, 202)
  } catch (e) {
    console.error('POST /api/v1/looks/views error', e)
    return jsonFail(500, 'Couldn’t record views. Try again.', {
      code: 'INTERNAL',
    })
  }
}
