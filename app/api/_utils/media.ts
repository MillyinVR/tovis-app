// app/api/_utils/media.ts
import { pickString } from './pick'

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
 * Extract bucket/path from Supabase Storage URLs (public or signed).
 * Supports:
 *  - /storage/v1/object/public/<bucket>/<path>
 *  - /storage/v1/object/sign/<bucket>/<path>
 *  - /storage/v1/object/<bucket>/<path>   (some setups)
 */
export function parseSupabaseStoragePointer(urlStr: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(urlStr)
    const parts = u.pathname.split('/').filter(Boolean)

    const idx = parts.findIndex((p) => p === 'storage')
    if (idx === -1) return null

    const v1 = parts[idx + 1]
    const object = parts[idx + 2]
    if (v1 !== 'v1' || object !== 'object') return null

    const mode = parts[idx + 3] // public | sign | bucket (depending)
    const bucket = parts[idx + 4]
    const restStart = idx + 5

    // /storage/v1/object/public/<bucket>/<path> or sign
    if (mode && bucket && (mode === 'public' || mode === 'sign')) {
      const path = parts.slice(restStart).join('/')
      if (!path) return null
      return { bucket, path }
    }

    // /storage/v1/object/<bucket>/<path>
    const bucketAlt = parts[idx + 3]
    const pathAlt = parts.slice(idx + 4).join('/')
    if (!bucketAlt || !pathAlt) return null
    return { bucket: bucketAlt, path: pathAlt }
  } catch {
    return null
  }
}

export function resolveStoragePointers(args: {
  url: string
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
  // If explicit pointers are provided, trust them.
  if (args.storageBucket && args.storagePath) {
    return {
      storageBucket: args.storageBucket,
      storagePath: args.storagePath,
      thumbBucket: args.thumbBucket ?? null,
      thumbPath: args.thumbPath ?? null,
    }
  }

  // Otherwise parse from URL(s)
  const ptr = parseSupabaseStoragePointer(args.url)
  if (!ptr) return null

  const thumbPtr = args.thumbUrl ? parseSupabaseStoragePointer(args.thumbUrl) : null

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
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x, 10) : Number.NaN
  if (!Number.isFinite(n) || n < 1 || n > 5) return null
  return n
}
