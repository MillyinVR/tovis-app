// app/api/internal/privacy/delete/[userId]/route.test.ts

import { AdminPermissionRole, Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  deleteUserData: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  tx: {
    adminActionLog: {
      create: vi.fn(),
    },
  },
  prisma: {
    $transaction: vi.fn(),
  },
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

type PrivacyDeleteMode = 'DRY_RUN' | 'ANONYMIZE'
type PrivacyDeleteAuditAction =
  | 'privacy.user_delete_dry_run'
  | 'privacy.user_delete'

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

function makeDeleteResult(
  mode: PrivacyDeleteMode,
  overrides?: {
    limitations?: string[]
  },
) {
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
    limitations: overrides?.limitations ?? [],
  }
}

function expectedResultSummary(
  mode: PrivacyDeleteMode,
  overrides?: {
    limitations?: string[]
  },
) {
  const limitations = overrides?.limitations ?? []

  return {
    executedAt: '2026-05-27T12:00:00.000Z',
    mode,
    subject: {
      userId: 'user_1',
      clientProfileId: 'client_1',
      professionalProfileId: 'pro_1',
    },
    requestedByUserId: 'admin_1',
    actionCounts: {
      total: 1,
      wouldDelete: 0,
      wouldAnonymize: mode === 'DRY_RUN' ? 1 : 0,
      deleted: 0,
      anonymized: mode === 'ANONYMIZE' ? 1 : 0,
      skipped: 0,
    },
    actions: [
      {
        model: 'User',
        action: mode === 'DRY_RUN' ? 'WOULD_ANONYMIZE' : 'ANONYMIZED',
        count: 1,
      },
    ],
    version: 1,
    limitations,
    limitationsCount: limitations.length,
    requiresManualFollowUp: limitations.length > 0,
  }
}

function expectedAuditArgs(args: {
  action: PrivacyDeleteAuditAction
  mode: PrivacyDeleteMode
  requestId: string | null
  tx?: unknown
  limitations?: string[]
}) {
  const limitations = args.limitations ?? []

  const base = {
    adminUserId: 'admin_1',
    action: args.action,
    note:
      args.mode === 'DRY_RUN'
        ? `Privacy delete dry-run for user user_1. Reason: User requested deletion.. Request id: ${
            args.requestId ?? 'none'
          }.`
        : `Privacy delete/anonymize for user user_1. Reason: User requested deletion.. Request id: ${
            args.requestId ?? 'none'
          }.`,
    targetType: 'user',
    targetId: 'user_1',
    metadata: {
      requestId: args.requestId,
      mode: args.mode,
      deleteVersion: 1,
      actionCount: 1,
      version: 1,
      limitations,
      limitationsCount: limitations.length,
      requiresManualFollowUp: limitations.length > 0,
      clientProfileId: 'client_1',
      professionalProfileId: 'pro_1',
    },
  }

  return args.tx ? { ...base, tx: args.tx } : base
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

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    )
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('rejects non-boolean dryRun values before auth', async () => {
    const response = await POST(
      makeRequest({
        dryRun: 'true',
        reason: 'User requested deletion.',
        confirmUserId: 'user_1',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await readJson(response)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_DRY_RUN',
        message: 'dryRun must be a boolean when provided.',
      },
    })

    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(response.headers.get('Cache-Control')).toBe('no-store')
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(response.headers.get('Cache-Control')).toBe('no-store')
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.deleteUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('defaults to DRY_RUN and writes a structured dry-run admin audit log outside the live transaction path', async () => {
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
        result: expectedResultSummary('DRY_RUN'),
      },
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()

    expect(mocks.deleteUserData).toHaveBeenCalledWith({
      db: mocks.prisma,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'User requested deletion.',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expectedAuditArgs({
        action: 'privacy.user_delete_dry_run',
        mode: 'DRY_RUN',
        requestId: 'req_123',
      }),
    )
  })

  it('includes limitation metadata when dry-run requires manual follow-up', async () => {
    const limitations = ['Storage object bytes require separate deletion.']

    mocks.deleteUserData.mockResolvedValueOnce(
      makeDeleteResult('DRY_RUN', {
        limitations,
      }),
    )

    const response = await POST(
      makeRequest({
        dryRun: true,
        reason: 'User requested deletion.',
      }),
      makeContext('user_1'),
    )

    expect(response.status).toBe(200)

    expect(await readJson(response)).toEqual({
      ok: true,
      data: {
        result: expectedResultSummary('DRY_RUN', {
          limitations,
        }),
      },
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expectedAuditArgs({
        action: 'privacy.user_delete_dry_run',
        mode: 'DRY_RUN',
        requestId: null,
        limitations,
      }),
    )
  })

  it('runs live ANONYMIZE and audit write in the same outer transaction', async () => {
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
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    expect(await readJson(response)).toEqual({
      ok: true,
      data: {
        result: expectedResultSummary('ANONYMIZE'),
      },
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mocks.deleteUserData).toHaveBeenCalledWith({
      db: mocks.tx,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'User requested deletion.',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expectedAuditArgs({
        action: 'privacy.user_delete',
        mode: 'ANONYMIZE',
        requestId: null,
        tx: mocks.tx,
      }),
    )
  })

  it('does not commit live anonymization without an audit log', async () => {
    const auditError = new Error('Audit write failed')

    mocks.deleteUserData.mockResolvedValueOnce(makeDeleteResult('ANONYMIZE'))
    mocks.writeAdminAuditLog.mockRejectedValueOnce(auditError)

    await expect(
      POST(
        makeRequest({
          dryRun: false,
          reason: 'User requested deletion.',
          confirmUserId: 'user_1',
        }),
        makeContext('user_1'),
      ),
    ).rejects.toThrow(auditError)

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mocks.deleteUserData).toHaveBeenCalledWith({
      db: mocks.tx,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'User requested deletion.',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expectedAuditArgs({
        action: 'privacy.user_delete',
        mode: 'ANONYMIZE',
        requestId: null,
        tx: mocks.tx,
      }),
    )
  })
})