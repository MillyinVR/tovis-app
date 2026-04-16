import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  AdminPermissionRole,
  Role,
  VerificationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(
      JSON.stringify({
        ok: true,
        ...((data as Record<string, unknown>) ?? {}),
      }),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    )
  })

  const jsonFail = vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) => {
      return new Response(
        JSON.stringify({
          ok: false,
          error,
          ...(extra ?? {}),
        }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  )

  const requireUser = vi.fn()
  const requireAdminPermission = vi.fn()

  const professionalProfile = {
    findUnique: vi.fn(),
    update: vi.fn(),
  }

  const professionalLocation = {
    updateMany: vi.fn(),
  }

  const adminActionLog = {
    create: vi.fn(),
  }

  const prisma = {
    professionalProfile,
    professionalLocation,
    adminActionLog,
    $transaction: vi.fn(),
  }

  return {
    jsonOk,
    jsonFail,
    requireUser,
    requireAdminPermission,
    professionalProfile,
    professionalLocation,
    adminActionLog,
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
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

import { PATCH } from './route'

type RouteCtx = {
  params: { id: string } | Promise<{ id: string }>
}

function makeRequest(
  body: unknown,
  contentType = 'application/json',
): NextRequest {
  return new NextRequest(
    'http://localhost/api/admin/professionals/pro_1',
    {
      method: 'PATCH',
      headers: {
        'content-type': contentType,
      },
      body: JSON.stringify(body),
    },
  )
}

function makeCtx(id = 'pro_1'): RouteCtx {
  return {
    params: { id },
  }
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

describe('app/api/admin/professionals/[id]/route.ts', () => {
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
    })

    mocks.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
    })

    mocks.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
    })

    mocks.professionalLocation.updateMany.mockResolvedValue({
      count: 1,
    })

    mocks.adminActionLog.create.mockResolvedValue({
      id: 'log_1',
    })

    mocks.prisma.$transaction.mockImplementation(
      async (
        fn: (tx: {
          professionalProfile: typeof mocks.professionalProfile
          professionalLocation: typeof mocks.professionalLocation
        }) => Promise<unknown>,
      ) =>
        fn({
          professionalProfile: mocks.professionalProfile,
          professionalLocation: mocks.professionalLocation,
        }),
    )
  })

  it('passes through failed auth unchanged', async () => {
    const authRes = new Response(null, { status: 401 })

    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: authRes,
    })

    const result = await PATCH(
      makeRequest({ verificationStatus: 'APPROVED' }),
      makeCtx(),
    )

    expect(result).toBe(authRes)
    expect(result.status).toBe(401)
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when professional id is missing', async () => {
    const result = await PATCH(
      makeRequest({ verificationStatus: 'APPROVED' }),
      makeCtx('   '),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing professional id.',
    })

    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('passes through failed admin permission unchanged', async () => {
    const permRes = new Response(null, { status: 403 })

    mocks.requireAdminPermission.mockResolvedValue({
      ok: false,
      res: permRes,
    })

    const result = await PATCH(
      makeRequest({ verificationStatus: 'APPROVED' }),
      makeCtx(),
    )

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: { professionalId: 'pro_1' },
    })

    expect(result).toBe(permRes)
    expect(result.status).toBe(403)
    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 415 for non-json content type', async () => {
    const result = await PATCH(
      makeRequest({ verificationStatus: 'APPROVED' }, 'text/plain'),
      makeCtx(),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })

    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid verificationStatus', async () => {
    const result = await PATCH(
      makeRequest({ verificationStatus: 'NOT_A_REAL_STATUS' }),
      makeCtx(),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error:
        'Invalid verificationStatus. Use PENDING, APPROVED, REJECTED, or NEEDS_INFO.',
    })

    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when nothing is provided to update', async () => {
    const result = await PATCH(makeRequest({}), makeCtx())

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Nothing to update.',
    })

    expect(mocks.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 404 when the professional does not exist', async () => {
    mocks.professionalProfile.findUnique.mockResolvedValue(null)

    const result = await PATCH(
      makeRequest({ verificationStatus: 'APPROVED' }),
      makeCtx(),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
    })

    expect(mocks.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { id: true },
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('approves the professional and flips locations to bookable', async () => {
    mocks.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
    })

    const result = await PATCH(
      makeRequest({
        verificationStatus: 'APPROVED',
        licenseVerified: true,
      }),
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      professional: {
        id: string
        verificationStatus: VerificationStatus
        licenseVerified: boolean
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { id: true },
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        verificationStatus: VerificationStatus.APPROVED,
        licenseVerified: true,
      },
      select: {
        id: true,
        verificationStatus: true,
        licenseVerified: true,
      },
    })

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      data: { isBookable: true },
    })

    expect(mocks.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        professionalId: 'pro_1',
        action: 'PRO_VERIFICATION_UPDATED',
        note: 'status=APPROVED licenseVerified=true',
      },
    })

    expect(body).toEqual({
      ok: true,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.APPROVED,
        licenseVerified: true,
      },
    })
  })

  it('updates only licenseVerified without flipping locations', async () => {
    mocks.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      verificationStatus: VerificationStatus.PENDING,
      licenseVerified: false,
    })

    const result = await PATCH(
      makeRequest({
        licenseVerified: false,
      }),
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      professional: {
        id: string
        verificationStatus: VerificationStatus
        licenseVerified: boolean
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        licenseVerified: false,
      },
      select: {
        id: true,
        verificationStatus: true,
        licenseVerified: true,
      },
    })

    expect(mocks.professionalLocation.updateMany).not.toHaveBeenCalled()

    expect(mocks.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        professionalId: 'pro_1',
        action: 'PRO_VERIFICATION_UPDATED',
        note: 'status=UNCHANGED licenseVerified=false',
      },
    })

    expect(body).toEqual({
      ok: true,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.PENDING,
        licenseVerified: false,
      },
    })
  })

  it('updates a non-approved status without flipping locations', async () => {
    mocks.professionalProfile.update.mockResolvedValue({
      id: 'pro_1',
      verificationStatus: VerificationStatus.REJECTED,
      licenseVerified: false,
    })

    const result = await PATCH(
      makeRequest({
        verificationStatus: 'REJECTED',
      }),
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      professional: {
        id: string
        verificationStatus: VerificationStatus
        licenseVerified: boolean
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        verificationStatus: VerificationStatus.REJECTED,
      },
      select: {
        id: true,
        verificationStatus: true,
        licenseVerified: true,
      },
    })

    expect(mocks.professionalLocation.updateMany).not.toHaveBeenCalled()

    expect(mocks.adminActionLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        professionalId: 'pro_1',
        action: 'PRO_VERIFICATION_UPDATED',
        note: 'status=REJECTED licenseVerified=UNCHANGED',
      },
    })

    expect(body).toEqual({
      ok: true,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.REJECTED,
        licenseVerified: false,
      },
    })
  })

  it('does not fail the request if admin action log write fails', async () => {
    mocks.adminActionLog.create.mockRejectedValue(new Error('log write failed'))

    const result = await PATCH(
      makeRequest({
        verificationStatus: 'APPROVED',
        licenseVerified: true,
      }),
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      professional: {
        id: string
        verificationStatus: VerificationStatus
        licenseVerified: boolean
      }
    }>(result)

    expect(result.status).toBe(200)
    expect(body.ok).toBe(true)

    expect(mocks.professionalProfile.update).toHaveBeenCalled()
    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      data: { isBookable: true },
    })
  })

  it('returns 500 when the transaction throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.prisma.$transaction.mockRejectedValue(new Error('db exploded'))

    const result = await PATCH(
      makeRequest({
        verificationStatus: 'APPROVED',
      }),
      makeCtx(),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'db exploded',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'PATCH /api/admin/professionals/[id] error',
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })
})