// app/api/internal/privacy/delete/[userId]/route.test.ts

import { AdminPermissionRole, Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  deleteUserData: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  prisma: {},
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))

vi.mock('@/lib/privacy/deleteUserData', () => ({
  deleteUserData: mocks.deleteUserData,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { POST } from './route'

function makeRequest(body?: unknown, headers?: HeadersInit): NextRequest {
  return new NextRequest(
    'http://localhost/api/internal/privacy/delete/user_1',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )
}

function makeContext(userId = 'user_1') {
  return {
    params: Promise.resolve({
      userId,
    }),
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json()
}

function makeDeleteResult(mode: 'DRY_RUN' | 'ANONYMIZE') {
  return {
    executedAt: '2026-05-27T12:00:00.000Z',
    mode,
    subject: {
      userId: 'user_1',
      clientProfileId: 'client_1',
      professionalProfileId: 'pro_1',
    },
    requestedByUserId: 'admin_1',
    reason: 'User requested deletion.',
    actions: [
      {
        model: 'User',
        action: mode === 'DRY_RUN' ? 'WOULD_ANONYMIZE' : 'ANONYMIZED',
        count: 1,
      },
    ],
    limitations: [],
  }
}

describe('POST /api/internal/privacy/delete/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'admin_1',
        role: Role.ADMIN,
      },
    })

    mocks.requireAdminPermission.mockResolvedValue({
      ok: true,
      role: AdminPermissionRole.SUPER_ADMIN,
    })

    mocks.deleteUserData.mockResolvedValue(makeDeleteResult('DRY_RUN'))

    mocks.writeAdminAuditLog.mockResolvedValue({
      id: 'audit_1',
    })
  })

  it('requires a target user id before auth', async () => {
    const response = await POST(
      makeRequest({
        reason: 'User requested deletion.',
      }),
      makeContext('   '),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await readJson(response)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_USER_ID',
        message: 'A target user id is required.',
      },
    })

    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('requires a reason before auth', async () => {
    const response = await POST(
      makeRequest({
        dryRun: true,
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await readJson(response)).toEqual({
      ok: false,
      error: {
        code: 'MISSING_REASON',
        message: 'A reason is required for privacy delete/anonymize requests.',
      },
    })

    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('requires confirmUserId for live anonymize requests before auth', async () => {
    const response = await POST(
      makeRequest({
        dryRun: false,
        reason: 'User requested deletion.',
        confirmUserId: 'wrong_user',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(400)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: {
        code: 'CONFIRM_USER_ID_REQUIRED',
        message:
          'confirmUserId must match the target user id for a live delete/anonymize request.',
      },
    })

    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('requires an admin user', async () => {
    const authResponse = Response.json(
      {
        ok: false,
        error: 'Unauthorized',
      },
      { status: 401 },
    )

    mocks.requireUser.mockResolvedValueOnce({
      ok: false,
      res: authResponse,
    })

    const response = await POST(
      makeRequest({
        dryRun: true,
        reason: 'User requested deletion.',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(401)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('blocks live self-anonymization', async () => {
    const response = await POST(
      makeRequest({
        dryRun: false,
        reason: 'User requested deletion.',
        confirmUserId: 'admin_1',
      }),
      makeContext('admin_1'),
    )

    expect(response.status).toBe(400)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: {
        code: 'SELF_DELETE_BLOCKED',
        message:
          'Admins cannot delete or anonymize their own account through this route.',
      },
    })

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('requires SUPER_ADMIN permission', async () => {
    const permissionResponse = Response.json(
      {
        ok: false,
        error: 'Forbidden',
      },
      { status: 403 },
    )

    mocks.requireAdminPermission.mockResolvedValueOnce({
      ok: false,
      res: permissionResponse,
    })

    const response = await POST(
      makeRequest({
        dryRun: true,
        reason: 'User requested deletion.',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(403)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: 'Forbidden',
    })

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('defaults to DRY_RUN and writes a dry-run admin audit log', async () => {
    mocks.deleteUserData.mockResolvedValueOnce(makeDeleteResult('DRY_RUN'))

    const response = await POST(
      makeRequest(
        {
          reason: 'User requested deletion.',
        },
        {
          'x-request-id': 'req_123',
        },
      ),
      makeContext(' user_1 '),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    expect(await readJson(response)).toEqual({
      ok: true,
      data: {
        result: {
          executedAt: '2026-05-27T12:00:00.000Z',
          mode: 'DRY_RUN',
          subject: {
            userId: 'user_1',
            clientProfileId: 'client_1',
            professionalProfileId: 'pro_1',
          },
          requestedByUserId: 'admin_1',
          actionCounts: {
            total: 1,
            wouldDelete: 0,
            wouldAnonymize: 1,
            deleted: 0,
            anonymized: 0,
            skipped: 0,
          },
          actions: [
            {
              model: 'User',
              action: 'WOULD_ANONYMIZE',
              count: 1,
            },
          ],
          limitationsCount: 0,
        },
      },
    })

    expect(mocks.deleteUserData).toHaveBeenCalledWith({
      db: mocks.prisma,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'User requested deletion.',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'privacy.user_delete_dry_run',
      note:
        'Privacy delete dry-run for user user_1. Reason: User requested deletion.. Request id: req_123.',
    })
  })

  it('runs ANONYMIZE only when confirmUserId matches the target user id', async () => {
    mocks.deleteUserData.mockResolvedValueOnce(makeDeleteResult('ANONYMIZE'))

    const response = await POST(
      makeRequest({
        dryRun: false,
        reason: 'User requested deletion.',
        confirmUserId: 'user_1',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(200)

    expect(await readJson(response)).toEqual({
      ok: true,
      data: {
        result: {
          executedAt: '2026-05-27T12:00:00.000Z',
          mode: 'ANONYMIZE',
          subject: {
            userId: 'user_1',
            clientProfileId: 'client_1',
            professionalProfileId: 'pro_1',
          },
          requestedByUserId: 'admin_1',
          actionCounts: {
            total: 1,
            wouldDelete: 0,
            wouldAnonymize: 0,
            deleted: 0,
            anonymized: 1,
            skipped: 0,
          },
          actions: [
            {
              model: 'User',
              action: 'ANONYMIZED',
              count: 1,
            },
          ],
          limitationsCount: 0,
        },
      },
    })

    expect(mocks.deleteUserData).toHaveBeenCalledWith({
      db: mocks.prisma,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'User requested deletion.',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'privacy.user_delete',
      note:
        'Privacy delete/anonymize for user user_1. Reason: User requested deletion.. Request id: none.',
    })
  })
})