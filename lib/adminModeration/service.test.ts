// lib/adminModeration/service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminPermissionRole,
  LookPostStatus,
  ModerationStatus,
  Role,
  ViralServiceRequestStatus,
} from '@prisma/client'

const FIXED_DATE_ISO = '2026-04-20T00:00:00.000Z'
const FIXED_DATE = new Date(FIXED_DATE_ISO)

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
    $transaction: vi.fn(
      async (callback: (db: typeof tx) => Promise<unknown>) => {
        return await callback(tx)
      },
    ),
  }

  const requireUser = vi.fn()
  const requireAdminPermission = vi.fn()

  const recomputeLookPostCommentCount = vi.fn()
  const recomputeLookPostScores = vi.fn()

  const enqueueRecomputeLookCounts = vi.fn()
  const enqueueFanOutViralRequestApprovalNotifications = vi.fn()
  const enqueueLookPostMutationPolicy = vi.fn()

  const updateViralRequestStatus = vi.fn()

  const toViralRequestDto = vi.fn()
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
    enqueueLookPostMutationPolicy,
    updateViralRequestStatus,
    toViralRequestDto,
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

vi.mock('@/lib/jobs/looksSocial/mutationEnqueuePolicy', () => ({
  enqueueLookPostMutationPolicy: mocks.enqueueLookPostMutationPolicy,
}))

vi.mock('@/lib/viralRequests', () => ({
  updateViralRequestStatus: mocks.updateViralRequestStatus,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
  toQueuedViralRequestApprovalNotificationsDto:
    mocks.toQueuedViralRequestApprovalNotificationsDto,
}))

import { handleAdminModerationRoute } from './service'

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

describe('lib/adminModeration/service.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)

    mocks.requireUser.mockResolvedValue(makeAdminAuth())
    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.recomputeLookPostCommentCount.mockResolvedValue(4)
    mocks.recomputeLookPostScores.mockResolvedValue({
      spotlightScore: 10,
      rankScore: 20,
    })

    mocks.enqueueRecomputeLookCounts.mockResolvedValue({
      id: 'job_counts_1',
      type: 'RECOMPUTE_LOOK_COUNTS',
    })

    mocks.enqueueLookPostMutationPolicy.mockResolvedValue({
      lookPostId: 'look_1',
      mutation: 'MODERATION_APPROVE',
      plannedJobs: [],
      enqueuedJobs: [],
      gatedJobs: [],
    })

    mocks.enqueueFanOutViralRequestApprovalNotifications.mockResolvedValue({
      id: 'job_viral_1',
      type: 'FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS',
    })

    mocks.prisma.adminActionLog.create.mockResolvedValue({ id: 'log_1' })

    mocks.updateViralRequestStatus.mockResolvedValue({ id: 'request_1' })
    mocks.toViralRequestDto.mockReturnValue({ id: 'request_1' })
    mocks.toQueuedViralRequestApprovalNotificationsDto.mockReturnValue({
      enqueued: true,
      matchedProfessionalIds: [],
      notificationIds: [],
      jobId: 'job_viral_1',
      deliveryMode: 'JOB_QUEUED',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes through failed admin auth responses unchanged and does not touch moderation targets', async () => {
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('passes through admin permission failures unchanged and does not execute moderation writes or enqueue work', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeLookPostRow())

    const permRes = Response.json(
      { ok: false, error: 'Forbidden' },
      { status: 403 },
    )

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
    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid look comment moderation action and does not execute writes or enqueue work', async () => {
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
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()
  })

  it('approves a look post, recomputes scores, delegates feed/search async work to the look-post mutation policy, and logs the action', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeLookPostRow())

    mocks.prisma.lookPost.update.mockResolvedValue(
      makeLookPostRow({
        moderationStatus: ModerationStatus.APPROVED,
        reviewedAt: FIXED_DATE,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Approved by admin',
        reportCount: 0,
      }),
    )

    mocks.enqueueLookPostMutationPolicy.mockResolvedValue({
      lookPostId: 'look_1',
      mutation: 'MODERATION_APPROVE',
      plannedJobs: [
        { type: 'RECOMPUTE_LOOK_SPOTLIGHT_SCORE', processorSupport: 'SUPPORTED' },
        { type: 'RECOMPUTE_LOOK_RANK_SCORE', processorSupport: 'SUPPORTED' },
        { type: 'INDEX_LOOK_POST_DOCUMENT', processorSupport: 'SUPPORTED' },
      ],
      enqueuedJobs: [
        {
          type: 'RECOMPUTE_LOOK_SPOTLIGHT_SCORE',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_spotlight_1',
          dedupeKey: 'looks:spotlight:look_1',
        },
        {
          type: 'RECOMPUTE_LOOK_RANK_SCORE',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_rank_1',
          dedupeKey: 'looks:rank:look_1',
        },
        {
          type: 'INDEX_LOOK_POST_DOCUMENT',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'looks:index:look_1',
        },
      ],
      gatedJobs: [],
    })

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
        reviewedAt: FIXED_DATE,
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

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'MODERATION_APPROVE',
        feedEligibilityChanged: true,
        searchableDocumentChanged: true,
      },
    )

    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()

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
        reviewedAt: FIXED_DATE_ISO,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Approved by admin',
        reportCount: 0,
      },
    })
  })

  it('removes a look post, recomputes scores, delegates feed/search removal work to the look-post mutation policy, and logs the action', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeLookPostRow())

    mocks.prisma.lookPost.update.mockResolvedValue(
      makeLookPostRow({
        status: LookPostStatus.REMOVED,
        moderationStatus: ModerationStatus.REMOVED,
        removedAt: FIXED_DATE,
        reviewedAt: FIXED_DATE,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
      }),
    )

    mocks.enqueueLookPostMutationPolicy.mockResolvedValue({
      lookPostId: 'look_1',
      mutation: 'MODERATION_REMOVE',
      plannedJobs: [
        { type: 'RECOMPUTE_LOOK_SPOTLIGHT_SCORE', processorSupport: 'SUPPORTED' },
        { type: 'RECOMPUTE_LOOK_RANK_SCORE', processorSupport: 'SUPPORTED' },
        { type: 'INDEX_LOOK_POST_DOCUMENT', processorSupport: 'SUPPORTED' },
      ],
      enqueuedJobs: [
        {
          type: 'RECOMPUTE_LOOK_SPOTLIGHT_SCORE',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_spotlight_1',
          dedupeKey: 'looks:spotlight:look_1',
        },
        {
          type: 'RECOMPUTE_LOOK_RANK_SCORE',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_rank_1',
          dedupeKey: 'looks:rank:look_1',
        },
        {
          type: 'INDEX_LOOK_POST_DOCUMENT',
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'looks:index:look_1',
        },
      ],
      gatedJobs: [],
    })

    const res = await handleAdminModerationRoute(
      makeJsonRequest({
        action: 'remove',
        adminNotes: 'Removed by admin',
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
        status: LookPostStatus.REMOVED,
        moderationStatus: ModerationStatus.REMOVED,
        removedAt: FIXED_DATE,
        reviewedAt: FIXED_DATE,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
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

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'MODERATION_REMOVE',
        feedEligibilityChanged: true,
        searchableDocumentChanged: true,
      },
    )

    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      target: {
        kind: 'LOOK_POST',
        id: 'look_1',
      },
      action: 'remove',
      result: {
        id: 'look_1',
        status: LookPostStatus.REMOVED,
        moderationStatus: ModerationStatus.REMOVED,
        archivedAt: null,
        removedAt: FIXED_DATE_ISO,
        reviewedAt: FIXED_DATE_ISO,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
        reportCount: 0,
      },
    })
  })

  it('removes a look comment, recomputes approved comment count, enqueues count reconciliation, does not delegate to look-post mutation policy, and logs the action', async () => {
    mocks.prisma.lookComment.findUnique.mockResolvedValue(
      makeLookCommentRow(),
    )

    mocks.prisma.lookComment.update.mockResolvedValue({
      id: 'comment_1',
      lookPostId: 'look_9',
      moderationStatus: ModerationStatus.REMOVED,
      removedAt: FIXED_DATE,
      reviewedAt: FIXED_DATE,
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
        reviewedAt: FIXED_DATE,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
        removedAt: FIXED_DATE,
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

    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()
    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

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
        removedAt: FIXED_DATE_ISO,
        reviewedAt: FIXED_DATE_ISO,
        reviewedByUserId: 'admin_1',
        adminNotes: 'Removed by admin',
        reportCount: 0,
        commentsCount: 7,
      },
    })
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
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
    expect(mocks.prisma.adminActionLog.create).not.toHaveBeenCalled()
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

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('does not pull unrelated viral-request enqueue paths into the looks moderation audit surface', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeViralPermissionRow(),
    )

    const res = await handleAdminModerationRoute(
      makeJsonRequest({ action: 'approve' }),
      {
        kind: 'LOOK_POST',
        targetId: 'look_missing',
      },
    )

    expect(res.status).toBe(404)
    expect(
      mocks.enqueueFanOutViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()
  })
})