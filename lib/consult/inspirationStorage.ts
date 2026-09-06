import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  CONSULT_CAPTURE_BUCKET,
  CONSULT_CAPTURE_MAX_BYTES,
  ConsultCaptureStorageError,
  consultCaptureStorage,
  type ConsultCaptureStorage,
} from './captureStorage'
import type { ConsultCaptureMediaType } from './captureVision'

// External inspiration uses the canonical private-image provider boundary from
// C3. A distinct path prefix and Prisma model retain its separate lifecycle.
export const CONSULT_INSPIRATION_BUCKET = CONSULT_CAPTURE_BUCKET
export const CONSULT_INSPIRATION_MAX_BYTES = CONSULT_CAPTURE_MAX_BYTES

/**
 * P2e — how many bytes the server is willing to DOWNLOAD for a reference
 * before normalizing it, as distinct from how many it will accept on an
 * upload.
 *
 * The two are different questions and conflating them is what broke Tori's
 * 2026-09-06 run. `CONSULT_INSPIRATION_MAX_BYTES` bounds an UPLOAD: the client
 * declares a size, the server holds it to that, and both clients downscale
 * first, so 5 MB is generous. A Look source uploads nothing — its bytes are a
 * professional's already-published portfolio original, commonly a 4-5 MB phone
 * photo and occasionally more — and applying the upload cap to it refused a
 * perfectly readable reference for being 32,646 bytes over.
 *
 * So the fetch gets its own, larger ceiling. It still exists: an unbounded
 * read of an attacker-influenceable URL is the hole the origin pin next door
 * is guarding, and this is its size half. Everything that passes is then
 * brought inside the vision envelope by `normalizeImageForVision`, so a large
 * download never becomes a large provider request.
 */
export const CONSULT_INSPIRATION_FETCH_MAX_BYTES = 25_000_000
export const CONSULT_INSPIRATION_UPLOAD_TTL_MS = 60 * 60 * 1000
export const CONSULT_INSPIRATION_READ_TTL_SECONDS = 10 * 60

export { ConsultCaptureStorageError as ConsultInspirationStorageError }
export type ConsultInspirationStorage = ConsultCaptureStorage
export const consultInspirationStorage: ConsultInspirationStorage =
  consultCaptureStorage

export function consultInspirationObjectPath(
  contentType: ConsultCaptureMediaType,
): string {
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : 'jpg'
  return `consult-inspiration/v1/${randomUUID()}.${extension}`
}
