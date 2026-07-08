import 'server-only'

import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { extensionForContentType } from '@/lib/media/contentType'
import { safeUrl } from '@/lib/media'

// A message attachment is private to the two thread participants (NOT a
// published look), so its bytes live in the deny-by-default media-private
// bucket. The upload is authorized by an admin-signed PUT token; reads are
// admin-signed short-lived URLs. No RLS policy is ever added for this bucket —
// everything flows through the service role (see lib/media/renderUrls.ts).
export const MESSAGE_ATTACHMENT_BUCKET = BUCKETS.mediaPrivate

/** Max attachments a single message may carry. */
export const MAX_MESSAGE_ATTACHMENTS = 6

const SIGNED_TTL_SECONDS = 60 * 10

/** Only images are supported by the composer today. */
export function isSupportedAttachmentContentType(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith('image/')
}

/** `messages/<threadId>/…` — the namespace every attachment path must live under. */
export function messageAttachmentPrefix(threadId: string): string {
  return `messages/${threadId}/`
}

/**
 * Build a unique, thread-scoped, uploader-scoped storage path. Keyed under the
 * thread so a POST can cheaply prove an attachment belongs to this thread by a
 * prefix check, and under the uploader so paths never collide.
 */
export function buildMessageAttachmentPath(args: {
  threadId: string
  userId: string
  contentType: string
}): string {
  const ext = extensionForContentType(args.contentType)
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `${messageAttachmentPrefix(args.threadId)}${args.userId}/${ym}/${Date.now()}_${rand}.${ext}`
}

/**
 * A path is acceptable for this thread only if it sits under the thread's
 * namespace (`messages/<threadId>/…`) and carries no traversal. This bounds a
 * client-supplied path to media the two participants can already see — a
 * participant can never point a message at another thread's or an unrelated
 * private object.
 */
export function isMessageAttachmentPathForThread(
  path: unknown,
  threadId: string,
): path is string {
  if (typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed) return false
  if (trimmed.includes('..')) return false
  return trimmed.startsWith(messageAttachmentPrefix(threadId))
}

// Short-lived signed READ URLs churn a new token per call, which would make the
// client re-download the image on every 10s poll. Cache the signed URL per path
// and reuse it until it nears expiry, so a stable URL string lets the browser /
// AsyncImage cache the bytes. Per-instance (best-effort) — correctness never
// depends on it, it only trims re-fetches.
const signedUrlCache = new Map<string, { url: string; expiresAtMs: number }>()
const RESIGN_MARGIN_MS = 60 * 1000

/**
 * Sign the given media-private storage paths into short-lived render URLs,
 * returned as a path→url map. Unsignable paths are omitted. Batched via
 * createSignedUrls; served from a small per-instance TTL cache to avoid churn.
 */
export async function signMessageAttachmentUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const now = Date.now()

  const misses: string[] = []
  for (const path of paths) {
    const hit = signedUrlCache.get(path)
    if (hit && hit.expiresAtMs - RESIGN_MARGIN_MS > now) {
      out.set(path, hit.url)
    } else if (!misses.includes(path)) {
      misses.push(path)
    }
  }

  if (misses.length === 0) return out

  const admin = getSupabaseAdmin()
  const { data, error } = await admin.storage
    .from(MESSAGE_ATTACHMENT_BUCKET)
    .createSignedUrls(misses, SIGNED_TTL_SECONDS)

  if (error || !data) return out

  const expiresAtMs = now + SIGNED_TTL_SECONDS * 1000
  for (const row of data) {
    const url = safeUrl(row.signedUrl)
    if (row.path && url) {
      signedUrlCache.set(row.path, { url, expiresAtMs })
      out.set(row.path, url)
    }
  }

  return out
}
