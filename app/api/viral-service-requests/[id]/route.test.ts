// app/api/viral-service-requests/[id]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPermissionRole, Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const viralRequestListSelect = { __brand: 'viralRequestListSelect' }

  return {
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
    },
    viralRequestListSelect,
    toViralRequestDto: vi.fn(),
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

vi.mock('@/lib/viralRequests', () => ({
  viralRequestListSelect: mocks.viralRequestListSelect,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
}))

import { GET } from './route'

function makeRequest(id = 'request_1') {
  return new Request(`http://localhost/api/viral-service-requests/${id}`)
}

function makeCtx(id: string) {
  return {
    params: { id },
  }
}

function makeUser(overrides?: Partial<{
  id: string
  role: Role
  clientProfile: { id: string } | null
}>) {
  return {
    id: overrides?.id ?? 'user_1',
    role: overrides?.role ?? Role.CLIENT,
    clientProfile:
      overrides && 'clientProfile' in overrides
        ? overrides.clientProfile
        : { id: 'client_1' },
  }
}

function makeRequestRow(overrides?: Partial<{
  id: string
  clientId: string
  requestedCategoryId: string | null
}>) {
  return {
    id: overrides?.id ?? 'request_1',
    clientId: overrides?.clientId ?? 'client_1',
    requestedCategoryId:
      overrides && 'requestedCategoryId' in overrides
        ? overrides.requestedCategoryId
        : 'cat_1',
  }
}

describe('app/api/viral-service-requests/[id]/route.ts', () => {
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

    const res = await GET(makeRequest(), makeCtx('request_1'))

    expect(res).toBe(authRes)
    expect(mocks.prisma.viralServiceRequest.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the request id is missing', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const res = await GET(makeRequest(), makeCtx('   '))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing viral request id.',
      code: 'MISSING_VIRAL_REQUEST_ID',
    })

    expect(mocks.prisma.viralServiceRequest.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the viral request does not exist', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(null)

    const res = await GET(makeRequest(), makeCtx('request_404'))
    const body = await res.json()

    expect(mocks.prisma.viralServiceRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'request_404' },
      select: mocks.viralRequestListSelect,
    })

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Viral request not found.',
      code: 'VIRAL_REQUEST_NOT_FOUND',
    })
  })

  it('allows the requester client to read their own request without admin permission', async () => {
    const requestRow = makeRequestRow({
      id: 'request_1',
      clientId: 'client_1',
      requestedCategoryId: 'cat_1',
    })

    const mapped = {
      id: 'request_1',
      status: 'REQUESTED',
    }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        clientProfile: { id: 'client_1' },
      }),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(requestRow)
    mocks.toViralRequestDto.mockReturnValue(mapped)

    const res = await GET(makeRequest(), makeCtx('request_1'))
    const body = await res.json()

    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.toViralRequestDto).toHaveBeenCalledWith(requestRow)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      request: mapped,
    })
  })

  it('returns 403 for a non-owner non-admin viewer', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        clientProfile: null,
      }),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeRequestRow({
        clientId: 'client_1',
      }),
    )

    const res = await GET(makeRequest(), makeCtx('request_1'))
    const body = await res.json()

    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Forbidden',
      code: 'FORBIDDEN',
    })
  })

  it('checks admin permission with category scope when an admin views the request', async () => {
    const requestRow = makeRequestRow({
      id: 'request_1',
      clientId: 'client_1',
      requestedCategoryId: 'cat_1',
    })

    const mapped = {
      id: 'request_1',
      status: 'REQUESTED',
    }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        id: 'admin_1',
        role: Role.ADMIN,
        clientProfile: null,
      }),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(requestRow)
    mocks.requireAdminPermission.mockResolvedValue({ ok: true })
    mocks.toViralRequestDto.mockReturnValue(mapped)

    const res = await GET(makeRequest(), makeCtx('request_1'))
    const body = await res.json()

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
        AdminPermissionRole.SUPPORT,
      ],
      scope: { categoryId: 'cat_1' },
    })

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      request: mapped,
    })
  })

  it('passes through admin permission failures unchanged', async () => {
    const permissionRes = Response.json(
      { ok: false, error: 'Forbidden' },
      { status: 403 },
    )

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        id: 'admin_1',
        role: Role.ADMIN,
        clientProfile: null,
      }),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(
      makeRequestRow({
        requestedCategoryId: 'cat_1',
      }),
    )

    mocks.requireAdminPermission.mockResolvedValue({
      ok: false,
      res: permissionRes,
    })

    const res = await GET(makeRequest(), makeCtx('request_1'))

    expect(res).toBe(permissionRes)
    expect(mocks.toViralRequestDto).not.toHaveBeenCalled()
  })

  it('returns the mapped dto instead of the raw prisma row', async () => {
    const requestRow = makeRequestRow({
      id: 'request_1',
      clientId: 'client_1',
      requestedCategoryId: null,
    })

    const mapped = {
      id: 'request_1',
      name: 'Wolf Cut',
      requestedCategoryId: null,
      requestedCategory: null,
      status: 'REQUESTED',
    }

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        clientProfile: { id: 'client_1' },
      }),
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(requestRow)
    mocks.toViralRequestDto.mockReturnValue(mapped)

    const res = await GET(makeRequest(), makeCtx('request_1'))
    const body = await res.json()

    expect(body).toEqual({
      ok: true,
      request: mapped,
    })

    expect(body.request).not.toHaveProperty('clientId')
    expect(mocks.toViralRequestDto).toHaveBeenCalledWith(requestRow)
  })
})