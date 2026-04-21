// lib/adminModeration/service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminPermissionRole,
  LookPostStatus,
  ModerationStatus,
  Role,
  ViralServiceRequestStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status

      return Response.json(
        { ok: true, ...(data ?? {}) },
        { status: status ?? 200 },
      )
    },
  )

  const jsonFail = vi.fn(
    (
      status: number,
      error: string,
      extra?: Record<string, unknown>,
    ) => {
      return Response.json(
        { ok: false, error, ...(extra ?? {}) },
        { status },
      )
    },
  )

  const lookPostFindUnique = vi.fn()
  const lookPostUpdate = vi.fn()
  const lookCommentFindUnique = vi.fn()
  const lookCommentUpdate = vi.fn()
  const viralServiceRequestFindUnique = vi.fn()
  const adminActionLogCreate = vi.fn()

  const tx = {
    lookPost: {
      findUnique: lookPostFindUnique,
      update: lookPostUpdate,
    },
    lookComment: {
      findUnique: lookCommentFindUnique,
      update: lookCommentUpdate,
    },
    viralServiceRequest: {
      findUnique: viralServiceRequestFindUnique,
    },
    adminActionLog: {
      create: adminActionLogCreate,
    },
  }

  const prisma = {
    lookPost: {
      findUnique: lookPostFindUnique,
      update: lookPostUpdate,
    },
    lookComment: {
      findUnique: lookCommentFindUnique,
      update: lookCommentUpdate,
    },
    viralServiceRequest: {
      findUnique: viralServiceRequestFindUnique,
    },
    adminActionLog: {
      create: adminActionLogCreate,
    },
    $transaction: vi.fn(async (callback: (db: typeof tx) => Promise<unknown>) => {
      return await callback(tx)
    }),
  }

  const requireUser = vi.fn()
  const requireAdminPermission = vi.fn()

  const recomputeLookPostCommentCount = vi.fn()
  const recomputeLookPostScores = vi.fn()
  const enqueueRecomputeLookCounts = vi.fn()
  const enqueueFanOutViralRequestApprovalNotifications = vi.fn()

  const updateViralRequestStatus = vi.fn()
  const enqueueViralRequestApprovalNotifications = vi.fn()

  const toViralRequestDto = vi.fn()
  const toViralRequestApprovalNotificationsDto = vi.fn()
  const toQueuedViralRequestApprovalNotificationsDto = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    tx,
    requireUser,
    requireAdminPermission,
    recomputeLookPostCommentCount,
    recomputeLookPostScores,
    enqueueRecomputeLookCounts,
    enqueueFanOutViralRequestApprovalNotifications,
    updateViralRequestStatus,
    enqueueViralRequestApprovalNotifications,
    toViralRequestDto,
    toViralRequestApprovalNotificationsDto,
    toQueuedViralRequestApprovalNotificationsDto,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostCommentCount: mocks.recomputeLookPostCommentCount,
  recomputeLookPostScores: mocks.recomputeLookPostScores,
}))

vi.mock('@/lib/jobs/looksSocial/enqueue', () => ({
  enqueueRecomputeLookCounts: mocks.enqueueRecomputeLookCounts,
  enqueueFanOutViralRequestApprovalNotifications:
    mocks.enqueueFanOutViralRequestApprovalNotifications,
}))

vi.mock('@/lib/viralRequests', () => ({
  updateViralRequestStatus: mocks.updateViralRequestStatus,
  enqueueViralRequestApprovalNotifications:
    mocks.enqueueViralRequestApprovalNotifications,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
  toViralRequestApprovalNotificationsDto:
    mocks.toViralRequestApprovalNotificationsDto,
  toQueuedViralRequestApprovalNotificationsDto:
    mocks.toQueuedViralRequestApprovalNotificationsDto,
}))

import {
  handleAdminModerationRoute,
  handleLegacyViralModerationRoute,
} from './service'

function makeAdminAuth(overrides?: Partial<{ id: string }>) {
  return {
    ok: true as const,
    user: {
      id: overrides?.id ?? 'admin_1',
      role: Role.ADMIN,
    },
  }
}

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeTextRequest(body = 'x'): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
    },
    body,
  })
}

async function readJson(res: Response): Promise<unknown> {
  return await res.json()
}

function makeLookPostRow(
  overrides?: Partial<{
    id: string
    status: LookPostStatus
    moderationStatus: ModerationStatus
    archivedAt: Date | null
    removedAt: Date | null
    reviewedAt: Date | null
    reviewedByUserId: string | null
    adminNotes: string | null
    reportCount: number
    professionalId: string
    serviceId: string | null
    service: { categoryId: string | null } | null
  }>,
) {
  return {
    id: 'look_1',
    status: LookPostStatus.PUBLISHED,
    moderationStatus: ModerationStatus.PENDING_REVIEW,
    archivedAt: null,
    removedAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    adminNotes: null,
    reportCount: 0,
    professionalId: 'pro_1',
    serviceId: 'service_1',
    service: { categoryId: 'cat_1' },
    ...overrides,
  }
}

function makeLookCommentRow(
  overrides?: Partial<{
    id: string
    lookPostId: string
    moderationStatus: ModerationStatus
    removedAt: Date | null
    reviewedAt: Date | null
    reviewedByUserId: string | null
    adminNotes: string | null
    reportCount: number
    lookPost: {
      id: string
      professionalId: string
      serviceId: string | null
      service: { categoryId: string | null } | null
    }
  }>,
) {
  return {
    id: 'comment_1',
    lookPostId: 'look_9',
    moderationStatus: ModerationStatus.APPROVED,
    removedAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    adminNotes: null,
    reportCount: 0,
    lookPost: {
      id: 'look_9',
      professionalId: 'pro_9',
      serviceId: 'service_9',
      service: { categoryId: 'cat_9' },
    },
    ...overrides,
  }
}

function makeViralPermissionRow(
  overrides?: Partial<{
    id: string
    status: ViralServiceRequestStatus
    requestedCategoryId: string | null
  }>,
) {
  return {
    id: 'request_1',
    status: ViralServiceRequestStatus.REQUESTED,
    requestedCategoryId: 'cat_1',
    ...overrides,
  }
}

function makeApprovedViralRequestDto(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: 'request_1',
    status: ViralServiceRequestStatus.APPROVED,
    moderationStatus: ModerationStatus.APPROVED,
    reportCount: 0,
    removedAt: null,
    reviewedAt: '2026-04-20T00:00:00.000Z',
    reviewedByUserId: 'admin_1',
    approvedAt: '2026-04-20T00:00:00.000Z',
    rejectedAt: null,
    adminNotes: null,
    name: 'Chrome aura nails',
    description: null,
    sourceUrl: null,
    links: [],
    mediaUrls: [],
    requestedCategoryId: 'cat_1',
    requestedCategory: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

function makeInReviewViralRequestDto(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: 'request_1',
    status: ViralServiceRequestStatus.IN_REVIEW,
    moderationStatus: ModerationStatus.PENDING_REVIEW,
    reportCount: 0,
    removedAt: null,
    reviewedAt: '2026-04-20T00:00:00.000Z',
    reviewedByUserId: 'admin_1',
    approvedAt: null,
    rejectedAt: null,
    adminNotes: 'Needs another pass',
    name: 'Chrome aura nails',
    description: null,
    sourceUrl: null,
    links: [],
    mediaUrls: [],
    requestedCategoryId: 'cat_1',
    requestedCategory: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

function makeRejectedViralRequestDto(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: 'request_1',
    status: ViralServiceRequestStatus.REJECTED,
    moderationStatus: ModerationStatus.REJECTED,
    reportCount: 0,
    removedAt: null,
    reviewedAt: '2026-04-20T00:00:00.000Z',
    reviewedByUserId: 'admin_1',
    approvedAt: null,
    rejectedAt: '2026-04-20T00:00:00.000Z',
    adminNotes: 'No fit',
    name: 'Chrome aura nails',
    description: null,
    sourceUrl: null,
    links: [],
    mediaUrls: [],
    requestedCategoryId: 'cat_1',
    requestedCategory: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

function makeQueuedApprovalNotificationsDto(
  overrides?: Partial<{
    enqueued: true
    matchedProfessionalIds: string[]
    notificationIds: string[]
    jobId: string
    deliveryMode: 'JOB_QUEUED'
  }>,
) {
  return {
    enqueued: true as const,
    matchedProfessionalIds: [],
    notificationIds: [],
    jobId: 'job_viral_1',
    deliveryMode: 'JOB_QUEUED' as const,
    ...overrides,
  }
}

describe('lib/adminModeration/service.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue(makeAdminAuth())
    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.recomputeLookPostCommentCount.mockResolvedValue(4)
    mocks.recomputeLookPostScores.mockResolvedValue({
      spotlightScore: 10,
      rankScore: 20,
    })

    mocks.enqueueRecomputeLookCounts.mockResolvedValue({
      id: 'job_1',
      type: 'RECOMPUTE_LOOK_COUNTS',
    })

    mocks.enqueueFanOutViralRequestApprovalNotifications.mockResolvedValue({
      id: 'job_viral_1',
      type: 'FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS',
    })

    mocks.prisma.adminActionLog.create.mockResolvedValue({ id: 'log_1' })

    mocks.toViralRequestDto.mockReturnValue(makeApprovedViralRequestDto())

    mocks.toQueuedViralRequestApprovalNotificationsDto.mockReturnValue(
      makeQueuedApprovalNotificationsDto(),
    )
  })

  it('passes through failed admin auth responses unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )

    mocks.requireUser.mockResolvedValue({
      ok: false as const,
      res: authRes,
    })

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'approve' }),
      {
        kind: 'LOOK_POST',
        targetId: 'look_1',
      },
    )

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
    expect(res).toBe(authRes)
    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
  })

  it('passes through admin permission failures unchanged', async () => {
    const permRes = Response.json(
      { ok: false, error: 'Forbidden' },
      { status: 403 },
    )

    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeLookPostRow())

    mocks.requireAdminPermission.mockResolvedValue({
      ok: false as const,
      res: permRes,
    })

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'approve' }),
      {
        kind: 'LOOK_POST',
        targetId: 'look_1',
      },
    )

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: {
        professionalId: 'pro_1',
        serviceId: 'service_1',
        categoryId: 'cat_1',
      },
    })
    expect(res).toBe(permRes)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 415 when content type is not application/json', async () => {
    const res = await handleAdminModerationRoute(makeTextRequest(), {
      kind: 'LOOK_POST',
      targetId: 'look_1',
    })
    const body = await readJson(res)

    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
  })

  it('approves a look post, recomputes scores, and logs the action', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeLookPostRow())

    mocks.prisma.lookPost.update.mockResolvedValue(
      makeLookPostRow({
        moderationStatus: ModerationStatus.APPROVED,
        reviewedAt: new Date('2026-04-20T00:00:00.000Z'),
        reviewedByUserId: 'admin_1',
        adminNotes: 'Approved by admin',
        reportCount: 0,
      }),
    )

    const res = await handleAdminModerationRoute(
      makeJsonRequest({
        action: 'approve',
        adminNotes: 'Approved by admin',
      }),
      {
        kind: 'LOOK_POST',
        targetId: 'look_1',
      },
    )
    const body = await readJson(res)

    expect(mocks.prisma.lookPost.update).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: {
        moderationStatus: ModerationStatus.APPROVED,
        reviewedAt: expect.any(Date),
        reviewedByUserId: 'admin_1',
        adminNotes: 'Approved by admin',
      },
      select: expect.objectContaining({
        id: true,
        status: true,
        moderationStatus: true,
        reviewedAt: true,
        reviewedByUserId: true,
        adminNotes: true,
        reportCount: true,
      }),
    })

    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        action: 'LOOK_POST_APPROVED',
        note: 'lookPostId=look_1 note=Approved by admin',
        professionalId: 'pro_1',
        serviceId: 'service_1',
        categoryId: 'cat_1',
      },
    })

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      target: {
        kind: 'LOOK_POST',
        id: 'look_1',
      },
      action: 'approve',
      result: {
        id: 'look_1',
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        archivedAt: null,
        removedAt: null,
        reviewedAt: '2026-04-20T00:00:00.000Z',
        reviewedByUserId: 'admin_1',
        adminNotes: 'Approved by admin',
        reportCount: 0,
      },
    })
  })

  it('removes a look comment, recomputes approved comment count, enqueues reconciliation, and logs the action', async () => {
    mocks.prisma.lookComment.findUnique.mockResolvedValue(
      makeLookCommentRow(),
    )

    mocks.prisma.lookComment.update.mockResolvedValue({
      id: 'comment_1',
      lookPostId: 'look_9',
      moderationStatus: ModerationStatus.REMOVED,
      removedAt: new Date('2026-04-20T00:00:00.000Z'),
      reviewedAt: new Date('2026-04-20T00:00:00.000Z'),
      reviewedByUserId: 'admin_1',
      adminNotes: 'Removed by admin',
      reportCount: 0,
    })

    mocks.recomputeLookPostCommentCount.mockResolvedValue(7)

    const res = await handleAdminModerationRoute(
      makeJsonRequest({
        action: 'remove',
        adminNotes: 'Removed by admin',
      }),
      {
        kind: 'LOOK_COMMENT',
        targetId: 'comment_1',
      },
    )
    const body = await readJson(res)

    expect(mocks.prisma.lookComment.update).toHaveBeenCalledWith({
      where: { id: 'comment_1' },
      data: {
        moderationStatus: ModerationStatus.REMOVED,
        reviewedAt: expect.any(Date),
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
        removedAt: expect.any(Date),
      },
      select: {
        id: true,
        lookPostId: true,
        moderationStatus: true,
        removedAt: true,
        reviewedAt: true,
        reviewedByUserId: true,
        adminNotes: true,
        reportCount: true,
      },
    })

    expect(mocks.recomputeLookPostCommentCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_9',
    )

    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_9',
      },
    )

    expect(mocks.prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        action: 'LOOK_COMMENT_REMOVED',
        note:
          'lookCommentId=comment_1 lookPostId=look_9 note=Removed by admin',
        professionalId: 'pro_9',
        serviceId: 'service_9',
        categoryId: 'cat_9',
      },
    })

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      target: {
        kind: 'LOOK_COMMENT',
        id: 'comment_1',
        lookPostId: 'look_9',
      },
      action: 'remove',
      result: {
        id: 'comment_1',
        lookPostId: 'look_9',
        moderationStatus: ModerationStatus.REMOVED,
        removedAt: '2026-04-20T00:00:00.000Z',
        reviewedAt: '2026-04-20T00:00:00.000Z',
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
        reportCount: 0,
        commentsCount: 7,
      },
    })
  })

  it('returns 400 for an invalid look comment moderation action', async () => {
    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'mark_in_review' }),
      {
        kind: 'LOOK_COMMENT',
        targetId: 'comment_1',
      },
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid look comment moderation action.',
    })

    expect(mocks.prisma.lookComment.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 when a look comment is already removed and remove is requested again', async () => {
    mocks.prisma.lookComment.findUnique.mockResolvedValue(
      makeLookCommentRow({
        moderationStatus: ModerationStatus.REMOVED,
      }),
    )

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'remove' }),
      {
        kind: 'LOOK_COMMENT',
        targetId: 'comment_1',
      },
    )
    const body = await readJson(res)

    expect(res.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error:
        'Invalid look comment moderation transition: moderationStatus=REMOVED action=remove.',
    })

    expect(mocks.prisma.lookComment.update).not.toHaveBeenCalled()
    expect(mocks.prisma.adminActionLog.create).not.toHaveBeenCalled()
  })

  it('returns 409 when approve is requested for an already removed look comment', async () => {
    mocks.prisma.lookComment.findUnique.mockResolvedValue(
      makeLookCommentRow({
        moderationStatus: ModerationStatus.REMOVED,
      }),
    )

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'approve' }),
      {
        kind: 'LOOK_COMMENT',
        targetId: 'comment_1',
      },
    )
    const body = await readJson(res)

    expect(res.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error:
        'Invalid look comment moderation transition: moderationStatus=REMOVED action=approve.',
    })

    expect(mocks.prisma.lookComment.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the moderation target does not exist', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValue(null)

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'approve' }),
      {
        kind: 'LOOK_POST',
        targetId: 'look_missing',
      },
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Look post not found.',
    })
  })

  it('marks a viral request in review and records the reviewer + note', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeViralPermissionRow({
        status: ViralServiceRequestStatus.REQUESTED,
      }),
    )

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
    })

    mocks.toViralRequestDto.mockReturnValue(
      makeInReviewViralRequestDto({
        adminNotes: 'Needs another pass',
      }),
    )

    const res = await handleAdminModerationRoute(
      makeJsonRequest({
        action: 'mark_in_review',
        adminNotes: 'Needs another pass',
      }),
      {
        kind: 'VIRAL_SERVICE_REQUEST',
        targetId: 'request_1',
      },
    )
    const body = await readJson(res)

    expect(mocks.updateViralRequestStatus).toHaveBeenCalledWith(
      mocks.tx,
      {
        requestId: 'request_1',
        nextStatus: ViralServiceRequestStatus.IN_REVIEW,
        reviewerUserId: 'admin_1',
        adminNotes: 'Needs another pass',
        moderationStatus: ModerationStatus.PENDING_REVIEW,
      },
    )

    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      target: {
        kind: 'VIRAL_SERVICE_REQUEST',
        id: 'request_1',
      },
      action: 'mark_in_review',
      result: {
        request: {
          id: 'request_1',
          status: ViralServiceRequestStatus.IN_REVIEW,
          moderationStatus: ModerationStatus.PENDING_REVIEW,
          reportCount: 0,
          removedAt: null,
          reviewedAt: '2026-04-20T00:00:00.000Z',
          reviewedByUserId: 'admin_1',
          approvedAt: null,
          rejectedAt: null,
          adminNotes: 'Needs another pass',
          name: 'Chrome aura nails',
          description: null,
          sourceUrl: null,
          links: [],
          mediaUrls: [],
          requestedCategoryId: 'cat_1',
          requestedCategory: null,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      },
    })
  })

  it('approves a viral request, enqueues a durable fan-out job, and returns the queued notifications contract', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeViralPermissionRow(),
    )

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
    })

    mocks.toViralRequestDto.mockReturnValue(makeApprovedViralRequestDto())

    const res = await handleAdminModerationRoute(
      makeJsonRequest({
        action: 'approve',
        adminNotes: 'Looks good',
      }),
      {
        kind: 'VIRAL_SERVICE_REQUEST',
        targetId: 'request_1',
      },
    )
    const body = await readJson(res)

    expect(mocks.updateViralRequestStatus).toHaveBeenCalledWith(
      mocks.tx,
      {
        requestId: 'request_1',
        nextStatus: ViralServiceRequestStatus.APPROVED,
        reviewerUserId: 'admin_1',
        adminNotes: 'Looks good',
        moderationStatus: ModerationStatus.APPROVED,
      },
    )

    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).toHaveBeenCalledWith(mocks.tx, {
      requestId: 'request_1',
    })

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(mocks.prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        action: 'VIRAL_REQUEST_APPROVED',
        note: 'requestId=request_1 note=Looks good',
        categoryId: 'cat_1',
      },
    })

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      target: {
        kind: 'VIRAL_SERVICE_REQUEST',
        id: 'request_1',
      },
      action: 'approve',
      result: {
        request: {
          id: 'request_1',
          status: ViralServiceRequestStatus.APPROVED,
          moderationStatus: ModerationStatus.APPROVED,
          reportCount: 0,
          removedAt: null,
          reviewedAt: '2026-04-20T00:00:00.000Z',
          reviewedByUserId: 'admin_1',
          approvedAt: '2026-04-20T00:00:00.000Z',
          rejectedAt: null,
          adminNotes: null,
          name: 'Chrome aura nails',
          description: null,
          sourceUrl: null,
          links: [],
          mediaUrls: [],
          requestedCategoryId: 'cat_1',
          requestedCategory: null,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
        notifications: {
          enqueued: true,
          matchedProfessionalIds: [],
          notificationIds: [],
          jobId: 'job_viral_1',
          deliveryMode: 'JOB_QUEUED',
        },
      },
    })
  })

  it('keeps the legacy approve route response shape for viral requests while using queued orchestration', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeViralPermissionRow(),
    )

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
    })

    mocks.toViralRequestDto.mockReturnValue(makeApprovedViralRequestDto())

    const res = await handleLegacyViralModerationRoute(
      makeJsonRequest({
        adminNotes: 'Approved for match fan-out',
      }),
      {
        targetId: 'request_1',
        forcedAction: 'approve',
      },
    )
    const body = await readJson(res)

    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).toHaveBeenCalledWith(mocks.tx, {
      requestId: 'request_1',
    })

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      request: {
        id: 'request_1',
        status: ViralServiceRequestStatus.APPROVED,
        moderationStatus: ModerationStatus.APPROVED,
        reportCount: 0,
        removedAt: null,
        reviewedAt: '2026-04-20T00:00:00.000Z',
        reviewedByUserId: 'admin_1',
        approvedAt: '2026-04-20T00:00:00.000Z',
        rejectedAt: null,
        adminNotes: null,
        name: 'Chrome aura nails',
        description: null,
        sourceUrl: null,
        links: [],
        mediaUrls: [],
        requestedCategoryId: 'cat_1',
        requestedCategory: null,
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      },
      notifications: {
        enqueued: true,
        matchedProfessionalIds: [],
        notificationIds: [],
        jobId: 'job_viral_1',
        deliveryMode: 'JOB_QUEUED',
      },
    })
  })

  it('keeps the legacy reject route response shape for viral requests', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeViralPermissionRow(),
    )

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
    })

    mocks.toViralRequestDto.mockReturnValue(
      makeRejectedViralRequestDto({
        adminNotes: 'No fit',
      }),
    )

    const res = await handleLegacyViralModerationRoute(
      makeJsonRequest({
        adminNotes: 'No fit',
      }),
      {
        targetId: 'request_1',
        forcedAction: 'reject',
      },
    )
    const body = await readJson(res)

    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      request: {
        id: 'request_1',
        status: ViralServiceRequestStatus.REJECTED,
        moderationStatus: ModerationStatus.REJECTED,
        reportCount: 0,
        removedAt: null,
        reviewedAt: '2026-04-20T00:00:00.000Z',
        reviewedByUserId: 'admin_1',
        approvedAt: null,
        rejectedAt: '2026-04-20T00:00:00.000Z',
        adminNotes: 'No fit',
        name: 'Chrome aura nails',
        description: null,
        sourceUrl: null,
        links: [],
        mediaUrls: [],
        requestedCategoryId: 'cat_1',
        requestedCategory: null,
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      },
    })
  })
})