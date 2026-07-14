// lib/booking/writeBoundary.media.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  BookingStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  Role,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-25T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),
  txMediaAssetCreate: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

import { uploadProBookingMedia } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  mediaAsset: {
    create: mocks.txMediaAssetCreate,
  },
  professionalProfile: {
    findUnique: mocks.txProfessionalProfileFindUnique,
  },
}

function makeBooking(
  overrides?: Partial<{
    professionalId: string
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep | null
  }>,
) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    serviceId: 'service_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    startedAt: overrides?.startedAt ?? TEST_NOW,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.BEFORE_PHOTOS,
  }
}

function makeCreatedMedia(
  overrides?: Partial<{
    id: string
    mediaType: MediaType
    visibility: MediaVisibility
    phase: MediaPhase
    caption: string | null
    createdAt: Date
    storagePath: string
  }>,
) {
  return {
    id: overrides?.id ?? 'media_1',
    mediaType: overrides?.mediaType ?? MediaType.IMAGE,
    visibility: overrides?.visibility ?? MediaVisibility.PRO_CLIENT,
    phase: overrides?.phase ?? MediaPhase.BEFORE,
    caption: overrides?.caption ?? 'Before photo',
    createdAt: overrides?.createdAt ?? TEST_NOW,
    reviewId: null,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: false,
    storageBucket: 'media-private',
    storagePath: overrides?.storagePath ?? 'bookings/booking_1/before.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
  }
}

function makeUploadArgs(
  overrides?: Partial<Parameters<typeof uploadProBookingMedia>[0]>,
) {
  return {
    bookingId: 'booking_1',
    professionalId: 'pro_1',
    uploadedByUserId: 'user_1',
    storageBucket: 'media-private',
    storagePath: 'bookings/booking_1/before.jpg',
    thumbBucket: null,
    thumbPath: null,
    caption: 'Before photo',
    phase: MediaPhase.BEFORE,
    mediaType: MediaType.IMAGE,
    requestId: 'request_1',
    idempotencyKey: 'idem_1',
    ...(overrides ?? {}),
  }
}

function expectMediaCreateCalledWith(args: {
  storagePath: string
  caption: string | null
  phase: MediaPhase
  mediaType?: MediaType
}) {
  expect(mocks.txMediaAssetCreate).toHaveBeenCalledWith({
    data: {
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      proTenantId: 'tenant_root',
      primaryServiceId: 'service_1',
      uploadedByUserId: 'user_1',
      uploadedByRole: Role.PRO,
      storageBucket: 'media-private',
      storagePath: args.storagePath,
      thumbBucket: null,
      thumbPath: null,
      url: null,
      thumbUrl: null,
      focalX: null,
      focalY: null,
      caption: args.caption,
      phase: args.phase,
      mediaType: args.mediaType ?? MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      reviewId: null,
      reviewLocked: false,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
    },
    select: expect.objectContaining({
      id: true,
      mediaType: true,
      visibility: true,
      phase: true,
      caption: true,
      createdAt: true,
      reviewId: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    }),
  })
}

function expectMediaUploadAuditCalledWith(args: {
  action: BookingCloseoutAuditAction
  mediaId: string
  phase: MediaPhase
  caption: string | null
  storagePath: string
  previousSessionStep: SessionStep
}) {
  expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledTimes(1)
  expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
    tx,
    bookingId: 'booking_1',
    professionalId: 'pro_1',
    action: args.action,
    route: 'lib/booking/writeBoundary.ts:uploadProBookingMedia',
    requestId: 'request_1',
    idempotencyKey: 'idem_1',
    oldValue: {
      mediaAssetId: null,
    },
    newValue: {
      mediaAssetId: args.mediaId,
      phase: args.phase,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      caption: args.caption,
      storageBucket: 'media-private',
      storagePath: args.storagePath,
      thumbBucket: null,
      thumbPath: null,
      uploadedByUserId: 'user_1',
      uploadedByRole: Role.PRO,
    },
    metadata: {
      trigger: 'pro_booking_media_upload',
      previousSessionStep: args.previousSessionStep,
    },
  })
}

describe('lib/booking/writeBoundary media lifecycle invariants', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      homeTenantId: 'tenant_root',
    })

    mocks.areAuditValuesEqual.mockImplementation(
      (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
    )

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx }) => Promise<unknown>,
      ) => run({ tx }),
    )

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
  })

  it('uploads BEFORE media during BEFORE_PHOTOS without advancing the session step', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        sessionStep: SessionStep.BEFORE_PHOTOS,
      }),
    )

    const created = makeCreatedMedia({
      phase: MediaPhase.BEFORE,
      caption: 'Before photo',
      storagePath: 'bookings/booking_1/before.jpg',
    })

    mocks.txMediaAssetCreate.mockResolvedValueOnce(created)

    const result = await uploadProBookingMedia(makeUploadArgs())

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_1',
      expect.any(Function),
    )

    expectMediaCreateCalledWith({
      storagePath: 'bookings/booking_1/before.jpg',
      caption: 'Before photo',
      phase: MediaPhase.BEFORE,
    })

    expectMediaUploadAuditCalledWith({
      action: BookingCloseoutAuditAction.BEFORE_PHOTO_UPLOADED,
      mediaId: created.id,
      phase: MediaPhase.BEFORE,
      caption: 'Before photo',
      storagePath: 'bookings/booking_1/before.jpg',
      previousSessionStep: SessionStep.BEFORE_PHOTOS,
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()

    expect(result).toEqual({
      created,
      advancedTo: null,
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('uploads BEFORE media during CONSULTATION_PENDING_CLIENT without advancing the session step', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      }),
    )

    const created = makeCreatedMedia({
      phase: MediaPhase.BEFORE,
      caption: 'Before photo',
      storagePath: 'bookings/booking_1/before.jpg',
    })

    mocks.txMediaAssetCreate.mockResolvedValueOnce(created)

    const result = await uploadProBookingMedia(
      makeUploadArgs({
        phase: MediaPhase.BEFORE,
      }),
    )

    expectMediaCreateCalledWith({
      storagePath: 'bookings/booking_1/before.jpg',
      caption: 'Before photo',
      phase: MediaPhase.BEFORE,
    })

    expectMediaUploadAuditCalledWith({
      action: BookingCloseoutAuditAction.BEFORE_PHOTO_UPLOADED,
      mediaId: created.id,
      phase: MediaPhase.BEFORE,
      caption: 'Before photo',
      storagePath: 'bookings/booking_1/before.jpg',
      previousSessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()

    expect(result).toEqual({
      created,
      advancedTo: null,
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('rejects BEFORE media before the session has reached consultation', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        sessionStep: SessionStep.NONE,
      }),
    )

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.BEFORE,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STEP_MISMATCH',
    })

    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })

  it('uploads AFTER media during AFTER_PHOTOS without advancing the session step', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
      }),
    )

    const created = makeCreatedMedia({
      id: 'media_after_1',
      phase: MediaPhase.AFTER,
      caption: 'After photo',
      storagePath: 'bookings/booking_1/after.jpg',
    })

    mocks.txMediaAssetCreate.mockResolvedValueOnce(created)

    const result = await uploadProBookingMedia(
      makeUploadArgs({
        storagePath: 'bookings/booking_1/after.jpg',
        caption: 'After photo',
        phase: MediaPhase.AFTER,
      }),
    )

    expectMediaCreateCalledWith({
      storagePath: 'bookings/booking_1/after.jpg',
      caption: 'After photo',
      phase: MediaPhase.AFTER,
    })

    expectMediaUploadAuditCalledWith({
      action: BookingCloseoutAuditAction.AFTER_PHOTO_UPLOADED,
      mediaId: created.id,
      phase: MediaPhase.AFTER,
      caption: 'After photo',
      storagePath: 'bookings/booking_1/after.jpg',
      previousSessionStep: SessionStep.AFTER_PHOTOS,
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()

    expect(result).toEqual({
      created,
      advancedTo: null,
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('rejects AFTER media outside AFTER_PHOTOS', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        sessionStep: SessionStep.FINISH_REVIEW,
      }),
    )

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.AFTER,
          caption: 'After photo',
          storagePath: 'bookings/booking_1/after.jpg',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STEP_MISMATCH',
    })

    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })

  it('rejects AFTER media during AFTER_PHOTOS when the booking session has not started', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      ...makeBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
      }),
      startedAt: null,
    })

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.AFTER,
          caption: 'After photo',
          storagePath: 'bookings/booking_1/after.jpg',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STEP_MISMATCH',
    })

    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })

  it('rejects media uploads for completed bookings', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: TEST_NOW,
      }),
    )

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.AFTER,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'BOOKING_CANNOT_EDIT_COMPLETED',
    })

    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })
})