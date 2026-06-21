// lib/looks/publication/clientLookService.ts
//
// Publishes a CLIENT-authored look from a completed visit (Share-your-look
// capture). This is the client-side mirror of createOrUpdateProLookFromMediaAsset
// in ./service.ts, but the author is the client, not the pro.
//
// A client look is a LookPost with:
//   - clientAuthorId  = the publishing client (engagement-loop authorship)
//   - professionalId  = the visit's pro (origin / tagged pro — UNCHANGED indexes)
//   - serviceId       = the booking's service (so the look is "born bookable")
//   - primaryMediaAsset = the AFTER photo (PUBLIC, in media-public)
//   - an optional BEFORE photo attached as a LookPostAsset
//
// Each photo is either freshly uploaded by the client (a CLIENT_LOOK upload
// session → media-public) or reused from the visit's existing pro-shot session
// photos (media-private → copied into media-public so the public look asset does
// not violate the MediaAsset bucket invariant, and the original is left intact).
//
// Visibility: "Public on your profile" → PUBLIC; "Save to my profile only" →
// UNLISTED. Both PUBLISHED. NOTE: client looks stay off the public feed until the
// author opts into a public profile (gate in lib/looks/feed.ts) — so v1 does not
// enqueue moderation/social jobs here; that wiring lands with the public-profile
// PR when client looks actually become discoverable.

import {
  LookPostStatus,
  LookPostVisibility,
  MediaPhase,
  MediaType,
  MediaVisibility,
  Prisma,
  PrismaClient,
  Role,
  UploadSurface,
} from '@prisma/client'

import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'
import { recomputeLookPostScores } from '@/lib/looks/counters'
import { mediaTypeFromContentType } from '@/lib/media/contentType'
import { copyToPublicBucket } from '@/lib/media/copyToPublicBucket'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import {
  consumeUploadSession,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import { safeUrl } from '@/lib/media'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const MAX_NAME_LENGTH = 80
const MAX_CAPTION_LENGTH = 300

/**
 * A client look's caption stores the look NAME on the first line, then the
 * optional free-text caption body. This is the single reader of that encoding —
 * use it wherever a client look's display name is derived from its caption.
 */
export function lookNameFromCaption(
  caption: string | null,
  fallback = 'Look',
): string {
  return (caption ?? '').split('\n')[0]?.trim() || fallback
}

export type ClientLookErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_COMPLETED'
  | 'NO_SERVICE'
  | 'INVALID_INPUT'
  | 'PHOTO_NOT_FOUND'
  | 'UPLOAD_INVALID'
  | 'LOOK_NOT_FOUND'

const HTTP_STATUS_BY_CODE: Record<ClientLookErrorCode, number> = {
  BOOKING_NOT_FOUND: 404,
  FORBIDDEN: 403,
  BOOKING_NOT_COMPLETED: 409,
  NO_SERVICE: 409,
  INVALID_INPUT: 400,
  PHOTO_NOT_FOUND: 400,
  UPLOAD_INVALID: 400,
  LOOK_NOT_FOUND: 404,
}

export class ClientLookError extends Error {
  readonly code: ClientLookErrorCode
  readonly httpStatus: number

  constructor(code: ClientLookErrorCode, message: string) {
    super(message)
    this.name = 'ClientLookError'
    this.code = code
    this.httpStatus = HTTP_STATUS_BY_CODE[code]
  }
}

/** One photo for the look — either a fresh client upload or a reused visit photo. */
export type ClientLookPhotoSource =
  | { uploadSessionId: string }
  | { reuseMediaAssetId: string }

export type CreateClientLookFromVisitArgs = {
  clientId: string
  bookingId: string
  uploadedByUserId: string
  name: string
  caption?: string | null
  isPublic: boolean
  after: ClientLookPhotoSource
  before?: ClientLookPhotoSource | null
  now?: Date
}

export type CreateClientLookResult = {
  lookPostId: string
  visibility: LookPostVisibility
  primaryMediaAssetId: string
  serviceId: string
}

type BookingRow = {
  id: string
  clientId: string
  professionalId: string
  serviceId: string
  proTenantId: string
  status: string
}

// A resolved photo, ready to be written as a MediaAsset inside the transaction.
type PreparedPhoto = {
  storageBucket: string
  storagePath: string
  mediaType: MediaType
  phase: MediaPhase
  // Set when the photo came from a fresh upload session that must be consumed
  // (CONSUMED) in the same transaction that creates the MediaAsset.
  consumeUploadSessionId: string | null
}

function isUploadSource(
  source: ClientLookPhotoSource,
): source is { uploadSessionId: string } {
  return 'uploadSessionId' in source && typeof source.uploadSessionId === 'string'
}

function normalizeName(value: string): string {
  const trimmed = asTrimmedString(value)
  if (!trimmed) {
    throw new ClientLookError('INVALID_INPUT', 'A look name is required.')
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ClientLookError(
      'INVALID_INPUT',
      `Look name must be ${MAX_NAME_LENGTH} characters or fewer.`,
    )
  }
  return trimmed
}

function normalizeCaption(value: string | null | undefined): string | null {
  const trimmed = asTrimmedString(value ?? '')
  if (!trimmed) return null
  if (trimmed.length > MAX_CAPTION_LENGTH) {
    throw new ClientLookError(
      'INVALID_INPUT',
      `Caption must be ${MAX_CAPTION_LENGTH} characters or fewer.`,
    )
  }
  return trimmed
}

/**
 * Confirms a public-bucket object actually has bytes before we record a row for
 * it (parity with the client review-media route). Returns false on 403/404.
 */
async function publicObjectExists(path: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { data } = admin.storage.from(BUCKETS.mediaPublic).getPublicUrl(path)
  const url = safeUrl(data?.publicUrl)
  if (!url) return false

  const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
  if (head?.ok) return true
  if (head && (head.status === 403 || head.status === 404)) return false

  const get = await fetch(url, { method: 'GET' }).catch(() => null)
  return Boolean(get?.ok)
}

async function loadBookingOrThrow(
  db: PrismaClient,
  args: { clientId: string; bookingId: string },
): Promise<BookingRow> {
  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      proTenantId: true,
      status: true,
    },
  })

  if (!booking) {
    throw new ClientLookError('BOOKING_NOT_FOUND', 'Visit not found.')
  }
  if (booking.clientId !== args.clientId) {
    // A foreign visit is indistinguishable from a missing one (uniform 404) so
    // the API never reveals that another client's visit exists.
    throw new ClientLookError('BOOKING_NOT_FOUND', 'Visit not found.')
  }
  if (booking.status !== 'COMPLETED') {
    throw new ClientLookError(
      'BOOKING_NOT_COMPLETED',
      'You can only share a look once the visit is complete.',
    )
  }
  if (!asTrimmedString(booking.serviceId)) {
    throw new ClientLookError(
      'NO_SERVICE',
      'This visit has no service, so it cannot become a bookable look.',
    )
  }

  return booking
}

/**
 * Resolves a photo source into a storage pointer ready to be written. Performs
 * all storage I/O (session validation, existence check, private→public copy)
 * OUTSIDE the DB transaction; the returned descriptor is written (and any upload
 * session consumed) inside it.
 */
async function preparePhoto(
  db: PrismaClient,
  args: {
    source: ClientLookPhotoSource
    booking: BookingRow
    clientId: string
    phase: MediaPhase
    now: Date
  },
): Promise<PreparedPhoto> {
  if (isUploadSource(args.source)) {
    const session = await validateUploadSession(db, {
      uploadSessionId: args.source.uploadSessionId,
      surface: UploadSurface.CLIENT_LOOK,
      clientId: args.clientId,
      bookingId: args.booking.id,
      now: args.now,
    })

    if (session.storageBucket !== BUCKETS.mediaPublic) {
      throw new ClientLookError(
        'UPLOAD_INVALID',
        `Look photos must upload to ${BUCKETS.mediaPublic}.`,
      )
    }

    const exists = await publicObjectExists(session.storagePath)
    if (!exists) {
      throw new ClientLookError(
        'PHOTO_NOT_FOUND',
        'Uploaded photo not found in storage.',
      )
    }

    return {
      storageBucket: session.storageBucket,
      storagePath: session.storagePath,
      mediaType: mediaTypeFromContentType(session.contentType),
      phase: args.phase,
      consumeUploadSessionId: args.source.uploadSessionId,
    }
  }

  // Reuse path: a pro-shot session photo from THIS visit, copied into the public
  // bucket so it can back a PUBLIC look asset.
  const reuseId = normalizeRequiredId('reuseMediaAssetId', args.source.reuseMediaAssetId)
  const source = await db.mediaAsset.findUnique({
    where: { id: reuseId },
    select: {
      id: true,
      bookingId: true,
      professionalId: true,
      storageBucket: true,
      storagePath: true,
      mediaType: true,
    },
  })

  if (
    !source ||
    source.bookingId !== args.booking.id ||
    source.professionalId !== args.booking.professionalId
  ) {
    throw new ClientLookError(
      'PHOTO_NOT_FOUND',
      'That photo is not from this visit.',
    )
  }

  const copied = await copyToPublicBucket({
    sourceBucket: source.storageBucket,
    sourcePath: source.storagePath,
    clientId: args.clientId,
  })

  return {
    storageBucket: copied.storageBucket,
    storagePath: copied.storagePath,
    mediaType: source.mediaType,
    phase: args.phase,
    consumeUploadSessionId: null,
  }
}

async function createLookMediaAsset(
  tx: Prisma.TransactionClient,
  args: {
    photo: PreparedPhoto
    booking: BookingRow
    uploadedByUserId: string
    isEligibleForLooks: boolean
    now: Date
  },
): Promise<string> {
  const row = await tx.mediaAsset.create({
    data: buildMediaAssetCreateData({
      professionalId: args.booking.professionalId,
      proTenantId: args.booking.proTenantId,
      primaryServiceId: args.booking.serviceId,
      bookingId: args.booking.id,
      storageBucket: args.photo.storageBucket,
      storagePath: args.photo.storagePath,
      mediaType: args.photo.mediaType,
      visibility: MediaVisibility.PUBLIC,
      uploadedByUserId: args.uploadedByUserId,
      uploadedByRole: Role.CLIENT,
      phase: args.photo.phase,
      isEligibleForLooks: args.isEligibleForLooks,
    }),
    select: { id: true },
  })

  if (args.photo.consumeUploadSessionId) {
    await consumeUploadSession(tx, {
      uploadSessionId: args.photo.consumeUploadSessionId,
      mediaAssetId: row.id,
      now: args.now,
    })
  }

  return row.id
}

/**
 * Publishes a client-authored look from a completed visit. Storage prep runs
 * first (outside the transaction); the DB writes (media assets, look post,
 * before-asset link, session consumption) run in a single transaction.
 */
export async function createClientLookFromVisit(
  db: PrismaClient,
  args: CreateClientLookFromVisitArgs,
): Promise<CreateClientLookResult> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const bookingId = normalizeRequiredId('bookingId', args.bookingId)
  const uploadedByUserId = normalizeRequiredId('uploadedByUserId', args.uploadedByUserId)
  const name = normalizeName(args.name)
  const caption = normalizeCaption(args.caption)
  const now = args.now ?? new Date()

  const booking = await loadBookingOrThrow(db, { clientId, bookingId })

  const afterPhoto = await preparePhoto(db, {
    source: args.after,
    booking,
    clientId,
    phase: MediaPhase.AFTER,
    now,
  })

  const beforePhoto = args.before
    ? await preparePhoto(db, {
        source: args.before,
        booking,
        clientId,
        phase: MediaPhase.BEFORE,
        now,
      })
    : null

  const visibility = args.isPublic
    ? LookPostVisibility.PUBLIC
    : LookPostVisibility.UNLISTED

  // Caption stores the look name first, then the optional free-text caption.
  const lookCaption = caption ? `${name}\n${caption}` : name

  const result = await db.$transaction(async (tx) => {
    const afterAssetId = await createLookMediaAsset(tx, {
      photo: afterPhoto,
      booking,
      uploadedByUserId,
      isEligibleForLooks: true,
      now,
    })

    const lookPost = await tx.lookPost.create({
      data: {
        professionalId: booking.professionalId,
        clientAuthorId: clientId,
        primaryMediaAssetId: afterAssetId,
        serviceId: booking.serviceId,
        caption: lookCaption,
        status: LookPostStatus.PUBLISHED,
        visibility,
        publishedAt: now,
      },
      select: { id: true },
    })

    if (beforePhoto) {
      const beforeAssetId = await createLookMediaAsset(tx, {
        photo: beforePhoto,
        booking,
        uploadedByUserId,
        isEligibleForLooks: false,
        now,
      })

      await tx.lookPostAsset.create({
        data: {
          lookPostId: lookPost.id,
          mediaAssetId: beforeAssetId,
          sortOrder: 0,
        },
      })
    }

    await recomputeLookPostScores(tx, lookPost.id)

    return {
      lookPostId: lookPost.id,
      visibility,
      primaryMediaAssetId: afterAssetId,
      serviceId: booking.serviceId,
    }
  })

  return result
}

/**
 * Flips a client-authored look between PUBLIC (on the profile + discoverable once
 * the author is public) and UNLISTED (saved to profile, not surfaced). The client
 * mirror of updateProLookPublication — authorizes by clientAuthorId, not pro.
 * Only these two states are exposed to clients in v1.
 */
export async function updateClientLookVisibility(
  db: PrismaClient,
  args: {
    clientId: string
    lookPostId: string
    isPublic: boolean
  },
): Promise<{ lookPostId: string; visibility: LookPostVisibility }> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  const existing = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: { id: true, clientAuthorId: true },
  })

  if (!existing) {
    throw new ClientLookError('LOOK_NOT_FOUND', 'Look not found.')
  }
  if (existing.clientAuthorId !== clientId) {
    throw new ClientLookError('FORBIDDEN', 'This look is not yours to edit.')
  }

  const visibility = args.isPublic
    ? LookPostVisibility.PUBLIC
    : LookPostVisibility.UNLISTED

  await db.$transaction(async (tx) => {
    await tx.lookPost.update({
      where: { id: lookPostId },
      data: { visibility },
    })
    await recomputeLookPostScores(tx, lookPostId)
  })

  return { lookPostId, visibility }
}
