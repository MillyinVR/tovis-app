// app/api/admin/viral-service-requests/[id]/approve/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminPermissionRole,
  ModerationStatus,
  Role,
  ViralServiceRequestStatus,
} from '@prisma/client'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status
      return Response.json(
        { ok: true, ...(data ?? {}) },
        { status: status ?? 200 },
      )
    },
  ),
  jsonFail: vi.fn(
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
  ),
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  prisma: {
    viralServiceRequest: {
      findUnique: vi.fn(),
    },
    adminActionLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  updateViralRequestStatus: vi.fn(),
  enqueueViralRequestApprovalNotifications: vi.fn(),
  toViralRequestDto: vi.fn(),
  toViralRequestApprovalNotificationsDto: vi.fn(),
}))

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

vi.mock('@/lib/viralRequests', () => ({
  updateViralRequestStatus: mocks.updateViralRequestStatus,
  enqueueViralRequestApprovalNotifications:
    mocks.enqueueViralRequestApprovalNotifications,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
  toViralRequestApprovalNotificationsDto:
    mocks.toViralRequestApprovalNotificationsDto,
}))

import { POST } from './route'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function makeJsonRequest(body: unknown): NextRequest {
  return asNextRequest(
    new Request('http://localhost/api/admin/viral-service-requests/request_1/approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

function makeTextRequest(body = 'x'): NextRequest {
  return asNextRequest(
    new Request('http://localhost/api/admin/viral-service-requests/request_1/approve', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
      },
      body,
    }),
  )
}

function makeCtx(id: string) {
  return {
    params: { id },
  }
}

function makeAdminUser(overrides?: Partial<{ id: string }>) {
  return {
    id: overrides?.id ?? 'admin_1',
    role: Role.ADMIN,
  }
}

describe('app/api/admin/viral-service-requests/[id]/approve/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through failed auth responses unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )

    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: authRes,
    })

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
    expect(res).toBe(authRes)
    expect(mocks.prisma.viralServiceRequest.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the request id is missing', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    const res = await POST(makeJsonRequest({}), makeCtx('   '))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing viral request id.',
    })
  })

  it('returns 404 when the viral request does not exist', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(null)

    const res = await POST(makeJsonRequest({}), makeCtx('request_missing'))
    const body = await res.json()

    expect(mocks.prisma.viralServiceRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'request_missing' },
      select: {
        id: true,
        requestedCategoryId: true,
      },
    })

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Viral request not found.',
    })
  })

  it('passes through admin permission failures unchanged', async () => {
    const permRes = Response.json(
      { ok: false, error: 'Forbidden' },
      { status: 403 },
    )

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({
      ok: false,
      res: permRes,
    })

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: { categoryId: 'cat_1' },
    })

    expect(res).toBe(permRes)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 415 for non-json content type', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    const res = await POST(makeTextRequest(), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('approves the request, enqueues notifications, logs the action, and returns mapped dto output', async () => {
    const tx = { __tx: true }
    const requestRow = {
      id: 'request_1',
      status: ViralServiceRequestStatus.APPROVED,
    }
    const notificationsRow = {
      enqueued: true,
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      dispatchSourceKeys: ['k1', 'k2'],
    }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.updateViralRequestStatus.mockResolvedValue(requestRow)
    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue(
      notificationsRow,
    )

    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      return await callback(tx)
    })

    mocks.prisma.adminActionLog.create.mockResolvedValue({ id: 'log_1' })

    mocks.toViralRequestDto.mockReturnValue({
      id: 'request_1',
      status: 'APPROVED',
    })

    mocks.toViralRequestApprovalNotificationsDto.mockReturnValue({
      enqueued: true,
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      dispatchSourceKeys: ['k1', 'k2'],
    })

    const res = await POST(
      makeJsonRequest({ adminNotes: ' Looks viable. ' }),
      makeCtx('request_1'),
    )
    const body = await res.json()

    expect(mocks.updateViralRequestStatus).toHaveBeenCalledWith(tx, {
      requestId: 'request_1',
      nextStatus: ViralServiceRequestStatus.APPROVED,
      reviewerUserId: 'admin_1',
      adminNotes: 'Looks viable.',
      moderationStatus: ModerationStatus.APPROVED,
    })

    expect(mocks.enqueueViralRequestApprovalNotifications).toHaveBeenCalledWith(
      tx,
      {
        requestId: 'request_1',
      },
    )

    expect(mocks.prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        categoryId: 'cat_1',
        action: 'VIRAL_REQUEST_APPROVED',
        note: 'requestId=request_1 note=Looks viable.',
      },
    })

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      request: {
        id: 'request_1',
        status: 'APPROVED',
      },
      notifications: {
        enqueued: true,
        matchedProfessionalIds: ['pro_1', 'pro_2'],
        dispatchSourceKeys: ['k1', 'k2'],
      },
    })
  })

  it('logs without category scope when requestedCategoryId is null', async () => {
    const tx = { __tx: true }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: null,
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
      status: ViralServiceRequestStatus.APPROVED,
    })

    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue({
      enqueued: true,
      matchedProfessionalIds: [],
      dispatchSourceKeys: [],
    })

    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      return await callback(tx)
    })

    mocks.prisma.adminActionLog.create.mockResolvedValue({ id: 'log_1' })

    mocks.toViralRequestDto.mockReturnValue({
      id: 'request_1',
      status: 'APPROVED',
    })

    mocks.toViralRequestApprovalNotificationsDto.mockReturnValue({
      enqueued: true,
      matchedProfessionalIds: [],
      dispatchSourceKeys: [],
    })

    await POST(makeJsonRequest({}), makeCtx('request_1'))

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: undefined,
    })

    expect(mocks.prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        categoryId: undefined,
        action: 'VIRAL_REQUEST_APPROVED',
        note: 'requestId=request_1',
      },
    })
  })

  it('swallows admin action log write failures', async () => {
    const tx = { __tx: true }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.updateViralRequestStatus.mockResolvedValue({
      id: 'request_1',
      status: ViralServiceRequestStatus.APPROVED,
    })

    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue({
      enqueued: true,
      matchedProfessionalIds: [],
      dispatchSourceKeys: [],
    })

    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      return await callback(tx)
    })

    mocks.prisma.adminActionLog.create.mockRejectedValue(new Error('log fail'))

    mocks.toViralRequestDto.mockReturnValue({
      id: 'request_1',
      status: 'APPROVED',
    })

    mocks.toViralRequestApprovalNotificationsDto.mockReturnValue({
      enqueued: true,
      matchedProfessionalIds: [],
      dispatchSourceKeys: [],
    })

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('returns 404 when the status helper throws viral request not found', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.prisma.$transaction.mockRejectedValue(
      new Error('Viral request not found.'),
    )

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Viral request not found.',
    })
  })

  it('returns 409 for invalid status transitions', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.prisma.$transaction.mockRejectedValue(
      new Error(
        'Invalid viral request status transition: APPROVED -> APPROVED.',
      ),
    )

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid viral request status transition: APPROVED -> APPROVED.',
    })
  })

  it('returns 400 for adminNotes validation errors', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.prisma.$transaction.mockRejectedValue(
      new Error('Text must be 2000 characters or fewer.'),
    )

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Text must be 2000 characters or fewer.',
    })
  })

  it('returns 500 for unexpected errors', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeAdminUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })

    mocks.requireAdminPermission.mockResolvedValue({ ok: true })

    mocks.prisma.$transaction.mockRejectedValue(new Error('boom'))

    const res = await POST(makeJsonRequest({}), makeCtx('request_1'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'boom',
    })
  })
})