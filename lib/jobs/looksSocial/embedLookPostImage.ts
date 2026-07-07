// lib/jobs/looksSocial/embedLookPostImage.ts
//
// EMBED_LOOK_POST_IMAGE processor (personalization spec §6.0): embed the
// look's primary image so the visual-taste layer has a vector for it. Enqueued
// by the look mutation policy at publish (and re-planned on ranking-relevant
// edits — the up-to-date check below makes that a cheap no-op unless the
// primary image or provider model actually changed).
//
// Skip semantics matter: an unconfigured provider (no VOYAGE_API_KEY) is a
// quiet SKIP, not a failure — otherwise every publish would burn the job's
// retry budget in environments without the key. The backfill script
// (scripts/backfill-look-embeddings.ts) re-covers anything skipped once the
// key exists. Provider/storage errors DO throw, so the queue's retry/backoff
// applies to transient failures.

import { LookPostStatus, MediaType, ModerationStatus } from '@prisma/client'

import {
  embedLookImage,
  pickLookEmbeddingImageContentType,
  readLookEmbeddingConfig,
} from '@/lib/personalization/lookEmbedding'
import {
  upsertLookPostEmbedding,
  type EmbeddingSqlDb,
} from '@/lib/personalization/lookEmbeddingStore'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export type EmbedLookPostImageLookRow = {
  id: string
  status: LookPostStatus
  moderationStatus: ModerationStatus
  primaryMediaAsset: {
    id: string
    mediaType: MediaType
    storageBucket: string
    storagePath: string
  }
  embedding: { mediaAssetId: string; model: string } | null
}

/**
 * The capabilities this processor needs, expressed structurally so both
 * PrismaClient and Prisma.TransactionClient satisfy it — and so tests can pass
 * a plain mock without type escapes (lib/looks/categoryRankStats.ts pattern).
 */
export type EmbedLookPostImageDb = EmbeddingSqlDb & {
  lookPost: {
    findUnique(args: {
      where: { id: string }
      select: {
        id: true
        status: true
        moderationStatus: true
        primaryMediaAsset: {
          select: {
            id: true
            mediaType: true
            storageBucket: true
            storagePath: true
          }
        }
        embedding: { select: { mediaAssetId: true; model: true } }
      }
    }): PromiseLike<EmbedLookPostImageLookRow | null>
  }
}

export type EmbedLookPostImageStatus =
  | 'EMBEDDED'
  | 'WOULD_EMBED'
  | 'SKIPPED_UNCONFIGURED'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_NOT_ELIGIBLE'
  | 'SKIPPED_UNSUPPORTED_MEDIA'
  | 'SKIPPED_UP_TO_DATE'

export type EmbedLookPostImageResult = {
  lookPostId: string
  status: EmbedLookPostImageStatus
}

export async function processEmbedLookPostImage(
  db: EmbedLookPostImageDb,
  args: {
    lookPostId: string
    now?: Date
    /** Report WOULD_EMBED instead of calling the provider (backfill --dry-run). */
    dryRun?: boolean
  },
): Promise<EmbedLookPostImageResult> {
  const { lookPostId } = args

  const config = readLookEmbeddingConfig()
  if (!config) {
    return { lookPostId, status: 'SKIPPED_UNCONFIGURED' }
  }

  const look = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: {
      id: true,
      status: true,
      moderationStatus: true,
      primaryMediaAsset: {
        select: {
          id: true,
          mediaType: true,
          storageBucket: true,
          storagePath: true,
        },
      },
      embedding: {
        select: { mediaAssetId: true, model: true },
      },
    },
  })

  if (!look) {
    return { lookPostId, status: 'SKIPPED_NOT_FOUND' }
  }

  // Same eligibility bar as the ranking sweep: only published, approved looks
  // participate in discovery, so only they need vectors. A look that publishes
  // later re-plans this job through the mutation policy.
  if (
    look.status !== LookPostStatus.PUBLISHED ||
    look.moderationStatus !== ModerationStatus.APPROVED
  ) {
    return { lookPostId, status: 'SKIPPED_NOT_ELIGIBLE' }
  }

  const asset = look.primaryMediaAsset
  if (asset.mediaType !== MediaType.IMAGE) {
    return { lookPostId, status: 'SKIPPED_UNSUPPORTED_MEDIA' }
  }

  if (
    look.embedding &&
    look.embedding.mediaAssetId === asset.id &&
    look.embedding.model === config.model
  ) {
    return { lookPostId, status: 'SKIPPED_UP_TO_DATE' }
  }

  if (args.dryRun === true) {
    return { lookPostId, status: 'WOULD_EMBED' }
  }

  const admin = getSupabaseAdmin()
  const { data: blob, error: downloadError } = await admin.storage
    .from(asset.storageBucket)
    .download(asset.storagePath)

  if (downloadError || !blob) {
    throw new Error(
      `Failed to read look image for embedding: ${downloadError?.message ?? 'not found'}`,
    )
  }

  const contentType = pickLookEmbeddingImageContentType(blob.type)
  if (!contentType) {
    // Unknown bytes never become supported by retrying — a durable skip.
    return { lookPostId, status: 'SKIPPED_UNSUPPORTED_MEDIA' }
  }

  const embedding = await embedLookImage({
    config,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType,
  })

  await upsertLookPostEmbedding(db, {
    lookPostId,
    mediaAssetId: asset.id,
    model: config.model,
    embedding,
    now: args.now ?? new Date(),
  })

  return { lookPostId, status: 'EMBEDDED' }
}
