// lib/media/uploadSession.ts
//
// Lifecycle SSoT for UploadSession (finish-plan T2.1 / Phase 4).
//
// A signing route mints a signed-upload URL AND a PENDING UploadSession that
// records the authoritative storage pointer + who/what the upload is for. The
// media-attach route then:
//   1. validateUploadSession() — loads the session by id and checks surface,
//      status, expiry, and owner/booking/phase against the authenticated caller.
//      The storage pointer the route writes comes from the SESSION, never the
//      client request body — so a client can't attach someone else's object or
//      forge a path.
//   2. creates the MediaAsset from session.storageBucket/storagePath.
//   3. consumeUploadSession() — flips PENDING -> CONSUMED (guarded, so a second
//      attach of the same session loses the race) and links the MediaAsset.
//
// Abandoned sessions (signed, maybe uploaded, never attached) stay PENDING past
// expiresAt and are reaped by expireStaleUploadSessions() in the cleanup job.

import {
  MediaPhase,
  Prisma,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

/** Signed-upload URLs are short-lived; a session is only attachable this long. */
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour

export type UploadSessionErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'SURFACE_MISMATCH'
  | 'CONTEXT_MISMATCH'
  | 'CONSUME_CONFLICT'

const HTTP_STATUS_BY_CODE: Record<UploadSessionErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  EXPIRED: 410,
  ALREADY_CONSUMED: 409,
  SURFACE_MISMATCH: 400,
  CONTEXT_MISMATCH: 400,
  CONSUME_CONFLICT: 409,
}

export class UploadSessionError extends Error {
  readonly code: UploadSessionErrorCode
  readonly httpStatus: number

  constructor(code: UploadSessionErrorCode, message: string) {
    super(message)
    this.name = 'UploadSessionError'
    this.code = code
    this.httpStatus = HTTP_STATUS_BY_CODE[code]
  }
}

// A Prisma client or transaction client — both expose the uploadSession delegate.
type UploadSessionDb = Prisma.TransactionClient

type UploadSessionRow = {
  id: string
  surface: UploadSurface
  status: UploadSessionStatus
  tenantId: string | null
  professionalId: string | null
  clientId: string | null
  bookingId: string | null
  phase: MediaPhase | null
  storageBucket: string
  storagePath: string
  contentType: string
  maxBytes: number
  checksumSha256: string | null
  expiresAt: Date
  consumedAt: Date | null
  mediaAssetId: string | null
}

export type CreateUploadSessionInput = {
  surface: UploadSurface
  storageBucket: string
  storagePath: string
  contentType: string
  maxBytes: number
  now: Date
  tenantId?: string | null
  professionalId?: string | null
  clientId?: string | null
  bookingId?: string | null
  phase?: MediaPhase | null
  checksumSha256?: string | null
}

/**
 * Creates a PENDING session for a freshly-minted signed-upload URL. Returns the
 * id the client echoes back on attach, plus the expiry.
 */
export async function createUploadSession(
  db: UploadSessionDb,
  input: CreateUploadSessionInput,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + UPLOAD_SESSION_TTL_MS)

  const created = await db.uploadSession.create({
    data: {
      surface: input.surface,
      status: UploadSessionStatus.PENDING,
      tenantId: input.tenantId ?? null,
      professionalId: input.professionalId ?? null,
      clientId: input.clientId ?? null,
      bookingId: input.bookingId ?? null,
      phase: input.phase ?? null,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      contentType: input.contentType,
      maxBytes: input.maxBytes,
      checksumSha256: input.checksumSha256 ?? null,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  })

  return created
}

export type ValidateUploadSessionInput = {
  uploadSessionId: string
  // A single surface, or a set of acceptable surfaces (e.g. PRO_LOOKS /
  // PRO_PORTFOLIO, which the client flips between at attach time).
  surface: UploadSurface | UploadSurface[]
  now: Date
  // Expected ownership/context — each, when provided, must match the session.
  professionalId?: string | null
  clientId?: string | null
  bookingId?: string | null
  phase?: MediaPhase | null
}

/**
 * Loads a session and asserts it is attachable by this caller. Throws
 * {@link UploadSessionError} on any mismatch. Returns the row so the caller can
 * read the authoritative storage pointer.
 */
export async function validateUploadSession(
  db: UploadSessionDb,
  input: ValidateUploadSessionInput,
): Promise<UploadSessionRow> {
  const session = (await db.uploadSession.findUnique({
    where: { id: input.uploadSessionId },
  })) as UploadSessionRow | null

  if (!session) {
    throw new UploadSessionError('NOT_FOUND', 'Upload session not found.')
  }

  const allowedSurfaces = Array.isArray(input.surface)
    ? input.surface
    : [input.surface]

  if (!allowedSurfaces.includes(session.surface)) {
    throw new UploadSessionError(
      'SURFACE_MISMATCH',
      'Upload session is for a different upload surface.',
    )
  }

  if (session.status === UploadSessionStatus.CONSUMED) {
    throw new UploadSessionError(
      'ALREADY_CONSUMED',
      'This upload was already attached.',
    )
  }

  if (
    session.status === UploadSessionStatus.EXPIRED ||
    session.expiresAt.getTime() <= input.now.getTime()
  ) {
    throw new UploadSessionError(
      'EXPIRED',
      'This upload session has expired. Please re-upload.',
    )
  }

  if (
    input.professionalId != null &&
    session.professionalId !== input.professionalId
  ) {
    throw new UploadSessionError('FORBIDDEN', 'Upload session belongs to another professional.')
  }

  if (input.clientId != null && session.clientId !== input.clientId) {
    throw new UploadSessionError('FORBIDDEN', 'Upload session belongs to another client.')
  }

  if (input.bookingId != null && session.bookingId !== input.bookingId) {
    throw new UploadSessionError(
      'CONTEXT_MISMATCH',
      'Upload session is for a different booking.',
    )
  }

  if (input.phase != null && session.phase !== input.phase) {
    throw new UploadSessionError(
      'CONTEXT_MISMATCH',
      'Upload session is for a different photo phase.',
    )
  }

  return session
}

/**
 * Atomically flips PENDING -> CONSUMED and links the created MediaAsset. The
 * `status: PENDING` guard means a concurrent second attach updates 0 rows and
 * gets a CONSUME_CONFLICT — together with the MediaAsset (bucket,path) unique
 * index, double-attach is impossible. Call inside the same transaction that
 * creates the MediaAsset.
 */
export async function consumeUploadSession(
  db: UploadSessionDb,
  input: { uploadSessionId: string; mediaAssetId?: string | null; now: Date },
): Promise<void> {
  const result = await db.uploadSession.updateMany({
    where: { id: input.uploadSessionId, status: UploadSessionStatus.PENDING },
    data: {
      status: UploadSessionStatus.CONSUMED,
      consumedAt: input.now,
      mediaAssetId: input.mediaAssetId ?? null,
    },
  })

  if (result.count !== 1) {
    throw new UploadSessionError(
      'CONSUME_CONFLICT',
      'This upload was already attached.',
    )
  }
}

/**
 * Marks PENDING sessions past their expiry as EXPIRED. Returns the count
 * reaped. Used by the stale-session cleanup job; the matching storage objects
 * (if any bytes were uploaded) are orphans that a storage sweep can delete.
 */
export async function expireStaleUploadSessions(
  db: UploadSessionDb,
  now: Date,
): Promise<number> {
  const result = await db.uploadSession.updateMany({
    where: { status: UploadSessionStatus.PENDING, expiresAt: { lte: now } },
    data: { status: UploadSessionStatus.EXPIRED },
  })

  return result.count
}

/** Maps a signing-route "kind" to its surface, or null for kinds that do not
 *  produce a MediaAsset (avatar, service image, verification doc, DM, etc.). */
export function uploadSurfaceForKind(kind: string): UploadSurface | null {
  switch (kind) {
    case 'CONSULT_PRIVATE':
      return UploadSurface.PRO_BOOKING_MEDIA
    case 'LOOKS_PUBLIC':
      return UploadSurface.PRO_LOOKS
    case 'PORTFOLIO_PUBLIC':
      return UploadSurface.PRO_PORTFOLIO
    case 'REVIEW_PUBLIC':
      return UploadSurface.CLIENT_REVIEW
    default:
      return null
  }
}
