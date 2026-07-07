// lib/looks/publication/clientLookService.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostVisibility,
  MediaPhase,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const bookingFindUnique = vi.fn()
  const mediaAssetFindUnique = vi.fn()
  const mediaAssetCreate = vi.fn()
  const lookPostCreate = vi.fn()
  const lookPostAssetCreate = vi.fn()
  const lookPostFindUnique = vi.fn()
  const lookPostUpdate = vi.fn()
  const lookTagUpsert = vi.fn()

  const tx = {
    mediaAsset: { create: mediaAssetCreate },
    lookPost: { create: lookPostCreate, update: lookPostUpdate },
    lookPostAsset: { create: lookPostAssetCreate },
    lookTag: { upsert: lookTagUpsert },
  }

  const prisma = {
    booking: { findUnique: bookingFindUnique },
    mediaAsset: { findUnique: mediaAssetFindUnique },
    lookPost: { findUnique: lookPostFindUnique },
    $transaction: vi.fn(async (cb: (db: typeof tx) => unknown) => cb(tx)),
  }

  return {
    bookingFindUnique,
    mediaAssetFindUnique,
    mediaAssetCreate,
    lookPostCreate,
    lookPostAssetCreate,
    lookPostFindUnique,
    lookPostUpdate,
    lookTagUpsert,
    prisma,
    validateUploadSession: vi.fn(),
    consumeUploadSession: vi.fn(),
    copyToPublicBucket: vi.fn(),
    recomputeLookPostScores: vi.fn(),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://cdn.test/x.jpg' } })),
  }
})

vi.mock('@/lib/media/uploadSession', () => ({
  validateUploadSession: mocks.validateUploadSession,
  consumeUploadSession: mocks.consumeUploadSession,
}))

vi.mock('@/lib/media/copyToPublicBucket', () => ({
  copyToPublicBucket: mocks.copyToPublicBucket,
  StorageCopyError: class extends Error {},
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostScores: mocks.recomputeLookPostScores,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ getPublicUrl: mocks.getPublicUrl }) },
  }),
}))

import {
  createClientLookFromVisit,
  updateClientLookVisibility,
  ClientLookError,
} from './clientLookService'

const CLIENT_ID = 'client_1'
const BOOKING_ID = 'booking_1'
const NOW = new Date('2026-06-19T12:00:00.000Z')

function completedBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    professionalId: 'pro_1',
    serviceId: 'svc_1',
    proTenantId: 'tenant_1',
    status: 'COMPLETED',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Object existence HEAD check → exists.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))

  mocks.bookingFindUnique.mockResolvedValue(completedBooking())
  mocks.mediaAssetCreate.mockImplementation(async () => ({ id: 'media_new' }))
  mocks.lookPostCreate.mockResolvedValue({ id: 'look_1' })
  mocks.lookPostAssetCreate.mockResolvedValue({ id: 'lpa_1' })
  mocks.lookTagUpsert.mockImplementation(async (args: { create: { slug: string } }) => ({
    id: `tag_${args.create.slug}`,
    bannedAt: null,
  }))
  mocks.validateUploadSession.mockResolvedValue({
    storageBucket: 'media-public',
    storagePath: 'client/client_1/look_public/2026-06/after.jpg',
    contentType: 'image/jpeg',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createClientLookFromVisit', () => {
  it('publishes a public client look from a fresh after-upload (born bookable)', async () => {
    const result = await createClientLookFromVisit(mocks.prisma as never, {
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      uploadedByUserId: 'user_1',
      name: 'Glazed donut blonde',
      caption: 'zero brass',
      isPublic: true,
      after: { uploadSessionId: 'sess_after' },
      now: NOW,
    })

    expect(result).toEqual({
      lookPostId: 'look_1',
      visibility: LookPostVisibility.PUBLIC,
      primaryMediaAssetId: 'media_new',
      serviceId: 'svc_1',
    })

    // After asset: PUBLIC, media-public, CLIENT, AFTER, born-bookable serviceId.
    const assetData = mocks.mediaAssetCreate.mock.calls[0]![0].data
    expect(assetData).toMatchObject({
      visibility: MediaVisibility.PUBLIC,
      storageBucket: 'media-public',
      uploadedByRole: Role.CLIENT,
      phase: MediaPhase.AFTER,
      primaryServiceId: 'svc_1',
      mediaType: MediaType.IMAGE,
      isEligibleForLooks: true,
    })

    // LookPost: client-authored, tagged pro, born-bookable service, PUBLISHED,
    // pre-moderated (PENDING_REVIEW) with the per-look feed opt-in (social C2).
    const lookData = mocks.lookPostCreate.mock.calls[0]![0].data
    expect(lookData).toMatchObject({
      clientAuthorId: CLIENT_ID,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      primaryMediaAssetId: 'media_new',
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.PENDING_REVIEW,
      publicToFeed: true,
      caption: 'Glazed donut blonde\nzero brass',
    })

    expect(mocks.consumeUploadSession).toHaveBeenCalledTimes(1)
    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      expect.anything(),
      'look_1',
    )
  })

  it('maps "save to profile only" to an UNLISTED look', async () => {
    const result = await createClientLookFromVisit(mocks.prisma as never, {
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      uploadedByUserId: 'user_1',
      name: 'My look',
      isPublic: false,
      after: { uploadSessionId: 'sess_after' },
      now: NOW,
    })

    expect(result.visibility).toBe(LookPostVisibility.UNLISTED)
    expect(mocks.lookPostCreate.mock.calls[0]![0].data.visibility).toBe(
      LookPostVisibility.UNLISTED,
    )
  })

  it('reuses a visit photo by copying it into the public bucket', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: 'media_visit',
      bookingId: BOOKING_ID,
      professionalId: 'pro_1',
      storageBucket: 'media-private',
      storagePath: 'bookings/booking_1/AFTER/x.jpg',
      mediaType: MediaType.IMAGE,
    })
    mocks.copyToPublicBucket.mockResolvedValue({
      storageBucket: 'media-public',
      storagePath: 'client/client_1/look_public/2026-06/copy.jpg',
      contentType: 'image/jpeg',
    })

    await createClientLookFromVisit(mocks.prisma as never, {
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      uploadedByUserId: 'user_1',
      name: 'Reused look',
      isPublic: true,
      after: { reuseMediaAssetId: 'media_visit' },
      now: NOW,
    })

    expect(mocks.copyToPublicBucket).toHaveBeenCalledWith({
      sourceBucket: 'media-private',
      sourcePath: 'bookings/booking_1/AFTER/x.jpg',
      clientId: CLIENT_ID,
    })
    // No upload session to consume on the reuse path.
    expect(mocks.consumeUploadSession).not.toHaveBeenCalled()
    const assetData = mocks.mediaAssetCreate.mock.calls[0]![0].data
    expect(assetData.storageBucket).toBe('media-public')
  })

  it('attaches an optional before photo as a LookPostAsset', async () => {
    mocks.validateUploadSession.mockResolvedValue({
      storageBucket: 'media-public',
      storagePath: 'client/client_1/look_public/2026-06/p.jpg',
      contentType: 'image/jpeg',
    })

    await createClientLookFromVisit(mocks.prisma as never, {
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      uploadedByUserId: 'user_1',
      name: 'With before',
      isPublic: true,
      after: { uploadSessionId: 'sess_after' },
      before: { uploadSessionId: 'sess_before' },
      now: NOW,
    })

    expect(mocks.mediaAssetCreate).toHaveBeenCalledTimes(2)
    expect(mocks.lookPostAssetCreate).toHaveBeenCalledTimes(1)
    expect(mocks.lookPostAssetCreate.mock.calls[0]![0].data).toMatchObject({
      lookPostId: 'look_1',
      mediaAssetId: 'media_new',
      sortOrder: 0,
    })
    // The before asset is recorded with BEFORE phase.
    const beforeCall = mocks.mediaAssetCreate.mock.calls.find(
      (c) => c[0].data.phase === MediaPhase.BEFORE,
    )
    expect(beforeCall).toBeTruthy()
  })

  it('rejects a visit that is not the caller’s as not-found (no existence leak)', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      completedBooking({ clientId: 'someone_else' }),
    )

    await expect(
      createClientLookFromVisit(mocks.prisma as never, {
        clientId: CLIENT_ID,
        bookingId: BOOKING_ID,
        uploadedByUserId: 'user_1',
        name: 'X',
        isPublic: true,
        after: { uploadSessionId: 'sess_after' },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })
  })

  it('rejects a visit that is not completed', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      completedBooking({ status: 'ACCEPTED' }),
    )

    await expect(
      createClientLookFromVisit(mocks.prisma as never, {
        clientId: CLIENT_ID,
        bookingId: BOOKING_ID,
        uploadedByUserId: 'user_1',
        name: 'X',
        isPublic: true,
        after: { uploadSessionId: 'sess_after' },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_COMPLETED' })
  })

  it('rejects reusing a photo from a different visit', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: 'media_other',
      bookingId: 'other_booking',
      professionalId: 'pro_1',
      storageBucket: 'media-private',
      storagePath: 'x',
      mediaType: MediaType.IMAGE,
    })

    await expect(
      createClientLookFromVisit(mocks.prisma as never, {
        clientId: CLIENT_ID,
        bookingId: BOOKING_ID,
        uploadedByUserId: 'user_1',
        name: 'X',
        isPublic: true,
        after: { reuseMediaAssetId: 'media_other' },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ClientLookError)
  })

  it('requires a look name', async () => {
    await expect(
      createClientLookFromVisit(mocks.prisma as never, {
        clientId: CLIENT_ID,
        bookingId: BOOKING_ID,
        uploadedByUserId: 'user_1',
        name: '   ',
        isPublic: true,
        after: { uploadSessionId: 'sess_after' },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('ingests #tags from the client caption (name + body)', async () => {
    await createClientLookFromVisit(mocks.prisma as never, {
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      uploadedByUserId: 'user_1',
      name: 'Glazed #Blonde',
      caption: 'zero brass #balayage',
      isPublic: true,
      after: { uploadSessionId: 'sess_after' },
      now: NOW,
    })

    const upsertedSlugs = mocks.lookTagUpsert.mock.calls.map(
      (c) => c[0].where.slug,
    )
    expect(upsertedSlugs).toEqual(['blonde', 'balayage'])
    // The look's tag set is replaced with the (non-banned) upserted tag ids.
    const tagUpdate = mocks.lookPostUpdate.mock.calls.find(
      (c) => c[0].data?.tags,
    )
    expect(tagUpdate?.[0].data.tags.set).toEqual([
      { id: 'tag_blonde' },
      { id: 'tag_balayage' },
    ])
  })
})

describe('updateClientLookVisibility', () => {
  it('flips a client-authored look to UNLISTED (save to profile only)', async () => {
    mocks.lookPostFindUnique.mockResolvedValue({
      id: 'look_1',
      clientAuthorId: CLIENT_ID,
      caption: 'My look',
    })

    const result = await updateClientLookVisibility(mocks.prisma as never, {
      clientId: CLIENT_ID,
      lookPostId: 'look_1',
      isPublic: false,
    })

    expect(result.visibility).toBe(LookPostVisibility.UNLISTED)
    expect(mocks.lookPostUpdate).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: { visibility: LookPostVisibility.UNLISTED, publicToFeed: false },
    })
  })

  it('re-syncs #tags from the existing caption on visibility change', async () => {
    mocks.lookPostFindUnique.mockResolvedValue({
      id: 'look_1',
      clientAuthorId: CLIENT_ID,
      caption: 'Fresh #balayage',
    })

    await updateClientLookVisibility(mocks.prisma as never, {
      clientId: CLIENT_ID,
      lookPostId: 'look_1',
      isPublic: true,
    })

    expect(mocks.lookTagUpsert.mock.calls.map((c) => c[0].where.slug)).toEqual([
      'balayage',
    ])
  })

  it('rejects editing a look the client does not own', async () => {
    mocks.lookPostFindUnique.mockResolvedValue({
      id: 'look_1',
      clientAuthorId: 'someone_else',
    })

    await expect(
      updateClientLookVisibility(mocks.prisma as never, {
        clientId: CLIENT_ID,
        lookPostId: 'look_1',
        isPublic: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.lookPostUpdate).not.toHaveBeenCalled()
  })

  it('rejects a missing look', async () => {
    mocks.lookPostFindUnique.mockResolvedValue(null)

    await expect(
      updateClientLookVisibility(mocks.prisma as never, {
        clientId: CLIENT_ID,
        lookPostId: 'nope',
        isPublic: true,
      }),
    ).rejects.toMatchObject({ code: 'LOOK_NOT_FOUND' })
  })
})
