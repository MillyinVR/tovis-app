// lib/media.ts
import { pickString } from '@/lib/pick'

const URL_MAX = 2048

export function safeUrl(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > URL_MAX) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Supports:
 *  - https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path...>
 *  - https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path...>?token=...
 *  - https://<project>.supabase.co/storage/v1/object/<bucket>/<path...> (older patterns)
 *  - supabase://<bucket>/<path...>  <-- your legacy pseudo scheme
 */
export function parseSupabasePointer(raw: string): { bucket: string; path: string } | null {
  const s = raw.trim()
  if (!s) return null

  // ✅ Legacy pseudo scheme (THIS is what your browser error shows)
  if (s.startsWith('supabase://')) {
    // supabase://bucket/path/to/file.jpg
    const rest = s.slice('supabase://'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    const bucket = rest.slice(0, slash).trim()
    const path = rest.slice(slash + 1).trim()
    if (!bucket || !path) return null
    return { bucket, path }
  }

  // ✅ Real URLs
  try {
    const u = new URL(s)
    const parts = u.pathname.split('/').filter(Boolean)

    // find ".../storage/v1/object/..."
    const idx = parts.findIndex((p) => p === 'storage')
    if (idx === -1) return null

    const v1 = parts[idx + 1]
    const object = parts[idx + 2]
    if (v1 !== 'v1' || object !== 'object') return null

    // patterns:
    // /storage/v1/object/public/<bucket>/<path...>
    // /storage/v1/object/sign/<bucket>/<path...>
    // /storage/v1/object/<bucket>/<path...>
    const modeOrBucket = parts[idx + 3]
    const bucketMaybe = parts[idx + 4]

    if (modeOrBucket === 'public' || modeOrBucket === 'sign') {
      const bucket = bucketMaybe
      const path = parts.slice(idx + 5).join('/')
      if (!bucket || !path) return null
      return { bucket, path }
    }

    // fallback: modeOrBucket is actually bucket
    const bucket = modeOrBucket
    const path = parts.slice(idx + 4).join('/')
    if (!bucket || !path) return null
    return { bucket, path }
  } catch {
    return null
  }
}

export function resolveStoragePointers(args: {
  url?: string | null
  thumbUrl?: string | null
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
}):
  | {
      storageBucket: string
      storagePath: string
      thumbBucket: string | null
      thumbPath: string | null
    }
  | null {
  // ✅ Canonical already present
  if (args.storageBucket && args.storagePath) {
    return {
      storageBucket: args.storageBucket,
      storagePath: args.storagePath,
      thumbBucket: args.thumbBucket ?? null,
      thumbPath: args.thumbPath ?? null,
    }
  }

  const url = typeof args.url === 'string' ? args.url : ''
  const ptr = url ? parseSupabasePointer(url) : null
  if (!ptr) return null

  const thumbPtr =
    typeof args.thumbUrl === 'string' && args.thumbUrl.trim()
      ? parseSupabasePointer(args.thumbUrl)
      : null

  return {
    storageBucket: ptr.bucket,
    storagePath: ptr.path,
    thumbBucket: thumbPtr?.bucket ?? null,
    thumbPath: thumbPtr?.path ?? null,
  }
}
export function parseIdArray(x: unknown, max: number): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const v of x) {
    const s = pickString(v)
    if (!s) continue
    out.push(s)
    if (out.length >= max) break
  }
  return Array.from(new Set(out))
}

export function parseRating1to5(x: unknown): number | null {
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? Number.parseInt(x, 10)
        : Number.NaN

  if (!Number.isFinite(n) || n < 1 || n > 5) return null
  return n
}