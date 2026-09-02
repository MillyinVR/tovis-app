// lib/media/cdnCache.ts
//
// Purging a withdrawn object from the CDN edge.
//
// 🔴 Why this is not optional. Deleting an object at the origin does NOT stop the
// public URL from resolving. Supabase serves `media-public` through Cloudflare,
// and the edge keeps serving its cached copy until the asset's metadata change
// has propagated. That was measured against production 2026-09-02, twice, with a
// still-live control object in the same request loop so a 400 could never be
// blamed on the request shape:
//
//     delete only            200 HIT at t+50s, gone by t+60s   (both runs)
//     delete + purge         gone at t+3s                       (both runs)
//
// So the automatic invalidation does work — the hole is not permanent — but it
// leaves a full-resolution photograph a pro has just withdrawn readable by anyone
// with the URL for the better part of a minute. The purge closes it to seconds.
//
// A cache-buster query string does NOT get you a fresh answer here: the Smart CDN
// shields the origin from requests that differ only by query string, so
// `?cb=<random>` was served `cf-cache-status: HIT` from the same cached copy.
// Any check of whether bytes are really gone must therefore compare against a
// control object, never read one status code on one URL.

import { safeError } from '@/lib/security/logging'

export type CdnPurgeResult =
  | { ok: true }
  | { ok: false; reason: string }

function serviceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}

function storageOrigin(): string | null {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    null
  )
}

/**
 * Invalidates one object's cached copies across the CDN edge.
 *
 * Maps to `DELETE /storage/v1/cdn/{bucket}/{path}`, which is a Pro-plan-and-above
 * feature. It is NOT exposed by the pinned `@supabase/supabase-js` (2.98.0 has no
 * `purgeCache`), so the endpoint is called directly rather than waiting for an
 * SDK bump — the alternative is leaving the window open.
 *
 * 🔴 The endpoint requires an `Authorization: Bearer <service role>` header.
 * Sending only `apikey` returns `400 InvalidRequest — headers must have required
 * property 'authorization'`, which is easy to mistake for "this project cannot
 * purge". Verified against production: `apikey` alone → 400, bearer → 200.
 *
 * Never throws. A purge failure means the bytes are already gone at origin but
 * the edge copy may linger for up to a minute — worth reporting, never worth
 * failing a retraction that has otherwise succeeded.
 */
export async function purgeCdnObject(
  bucket: string,
  path: string,
): Promise<CdnPurgeResult> {
  const origin = storageOrigin()
  const key = serviceRoleKey()

  if (!origin || !key) {
    return { ok: false, reason: 'Storage credentials are not configured.' }
  }

  const url = `${origin}/storage/v1/cdn/${bucket}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: `CDN purge failed (${res.status}): ${body.slice(0, 200)}` }
    }

    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, reason: String(safeError(e)) }
  }
}
