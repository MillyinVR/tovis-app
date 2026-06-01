import { AdminPermissionRole, Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  exportUserData: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  prisma: {},
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))

vi.mock('@/lib/privacy/exportUserData', () => ({
  exportUserData: mocks.exportUserData,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { POST } from './route'

function makeRequest(headers?: HeadersInit): NextRequest {
  return new NextRequest(
    'http://localhost/api/internal/privacy/export/user_1',
    {
      method: 'POST',
      headers,
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

describe('POST /api/internal/privacy/export/[userId]', () => {
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

    mocks.exportUserData.mockResolvedValue({
      exportedAt: '2026-05-27T12:00:00.000Z',
      subject: {
        userId: 'user_1',
        clientProfileId: 'client_1',
        professionalProfileId: 'pro_1',
      },
      data: {
        user: {
          id: 'user_1',
          email: 'person@example.com',
        },
      },
      limitations: [],
    })

    mocks.writeAdminAuditLog.mockResolvedValue({
      id: 'audit_1',
    })
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

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(401)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.exportUserData).not.toHaveBeenCalled()
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

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(403)
    expect(await readJson(response)).toEqual({
      ok: false,
      error: 'Forbidden',
    })

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    expect(mocks.exportUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('rejects a blank target user id', async () => {
    const response = await POST(makeRequest(), makeContext('   '))

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
    expect(mocks.exportUserData).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('returns the privacy export with no-store headers and writes an admin audit log', async () => {
    const response = await POST(
      makeRequest({
        'x-request-id': 'req_123',
      }),
      makeContext(' user_1 '),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    expect(await readJson(response)).toEqual({
      ok: true,
      data: {
        export: {
          exportedAt: '2026-05-27T12:00:00.000Z',
          subject: {
            userId: 'user_1',
            clientProfileId: 'client_1',
            professionalProfileId: 'pro_1',
          },
          data: {
            user: {
              id: 'user_1',
              email: 'person@example.com',
            },
          },
          limitations: [],
        },
      },
    })

    expect(mocks.exportUserData).toHaveBeenCalledWith({
      db: mocks.prisma,
      userId: 'user_1',
    })

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'privacy.user_export',
      note: 'Generated privacy export for user user_1. Request id: req_123.',
      professionalId: 'pro_1',
    })
  })

  it('records request id as none when the header is missing', async () => {
    await POST(makeRequest(), makeContext('user_1'))

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'privacy.user_export',
      note: 'Generated privacy export for user user_1. Request id: none.',
      professionalId: 'pro_1',
    })
  })
})