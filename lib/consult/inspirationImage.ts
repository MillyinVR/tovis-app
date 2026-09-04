import 'server-only'

import { readOptionalEnv } from '@/lib/env'

import type { ConsultCaptureImage } from './captureStorage'
import { CONSULT_CAPTURE_MEDIA_TYPES, type ConsultCaptureMediaType } from './captureVision'
import { ConsultWriteError } from './errors'
import { CONSULT_INSPIRATION_MAX_BYTES } from './inspirationStorage'

/**
 * The bytes behind an inspiration reference, fetched through the SAME URL the
 * client's viewer gets (`loadClientInspirationSignedRead` → the P1 read path).
 *
 * Why a fetch and not a storage read: the two inspiration sources live in
 * different buckets. An EXTERNAL_UPLOAD is a private object in the consult
 * bucket; a Look's primary media may be in either the private or the PUBLIC
 * media bucket, and `consultCaptureStorage` is hard-bound to the private one.
 * Resolving both through the one read path that already exists — rather than
 * teaching the storage client a second bucket — is the same "one route, one
 * shape, both sources" rule that fixed B4 (#1072), and it means the analysis
 * sees exactly what the client saw, re-checked for visibility at read time.
 *
 * 🔴 The URL must be treated as untrusted even though we minted it.
 * `renderMediaUrls` can fall back to a MediaAsset's stored `url` column, and
 * `safeUrl` accepts any http(s) host — so an attacker-controlled row could aim
 * a server-side fetch anywhere. `assertStorageOrigin` pins it to the
 * configured Supabase storage origin before anything is requested.
 */
const FETCH_TIMEOUT_MS = 20_000

function configuredStorageOrigin(): string | null {
  const raw =
    readOptionalEnv('NEXT_PUBLIC_SUPABASE_URL') ?? readOptionalEnv('SUPABASE_URL')
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function assertStorageOrigin(url: string): URL {
  const origin = configuredStorageOrigin()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ConsultWriteError('INSPIRATION_OBJECT_INVALID', 'Invalid inspiration URL.')
  }
  // Fail closed: with no configured storage origin there is nothing to compare
  // against, and "fetch it anyway" is exactly the hole this function exists to
  // close.
  if (!origin || parsed.origin !== origin) {
    throw new ConsultWriteError(
      'INSPIRATION_OBJECT_INVALID',
      'The inspiration reference is not served from this project’s storage.',
    )
  }
  return parsed
}

function mediaType(value: string | null): ConsultCaptureMediaType {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? ''
  const found = CONSULT_CAPTURE_MEDIA_TYPES.find((candidate) => candidate === normalized)
  if (!found) {
    throw new ConsultWriteError(
      'INSPIRATION_OBJECT_INVALID',
      'Unsupported inspiration content type.',
    )
  }
  return found
}

/**
 * Read the inspiration image as base64. Every failure is an explicit typed
 * refusal — there is no "return null and carry on", because carrying on is the
 * silent fallback Part 0 rule 4 forbids.
 */
export async function fetchConsultInspirationImage(
  url: string,
): Promise<ConsultCaptureImage> {
  const target = assertStorageOrigin(url)
  let response: Response
  try {
    response = await fetch(target, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new ConsultWriteError(
      'INSPIRATION_STORAGE_UNAVAILABLE',
      'The inspiration reference could not be read.',
    )
  }
  if (!response.ok) {
    throw new ConsultWriteError(
      'INSPIRATION_OBJECT_INVALID',
      'The inspiration reference is missing.',
    )
  }
  const contentType = mediaType(response.headers.get('content-type'))
  // Check the advertised length first so an oversized object is refused before
  // it is buffered, then check the real length — a missing or lying header must
  // not become an unbounded read.
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > CONSULT_INSPIRATION_MAX_BYTES) {
    throw new ConsultWriteError(
      'INSPIRATION_OBJECT_INVALID',
      'The inspiration reference is too large.',
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 1 || bytes.byteLength > CONSULT_INSPIRATION_MAX_BYTES) {
    throw new ConsultWriteError(
      'INSPIRATION_OBJECT_INVALID',
      'The inspiration reference is empty or too large.',
    )
  }
  return { base64: Buffer.from(bytes).toString('base64'), mediaType: contentType }
}
