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
