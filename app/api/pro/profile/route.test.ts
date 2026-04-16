// app/api/pro/profile/route.test.ts 

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionType, VerificationStatus } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn(
    (status: number, message: string, extra?: Record<string, unknown>) => {
      return new Response(
        JSON.stringify({
          ok: false,
          error: message,
          ...(extra ?? {}),
        }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  )

  const requirePro = vi.fn()

  const prisma = {
    professionalProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { PATCH } from './route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/pro/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function makeCurrentProfile(args?: {
  verificationStatus?: VerificationStatus
  handle?: string | null
  handleNormalized?: string | null
}) {
  return {
    id: 'pro_1',
    verificationStatus: args?.verificationStatus ?? VerificationStatus.APPROVED,
    handle: args?.handle ?? 'tovisstudio',
    handleNormalized: args?.handleNormalized ?? 'tovisstudio',
  }
}

function makeUpdatedProfile(args?: {
  businessName?: string | null
  handle?: string | null
  bio?: string | null
  location?: string | null
  avatarUrl?: string | null
  professionType?: ProfessionType | null
}) {
  return {
    id: 'pro_1',
    businessName: args?.businessName ?? 'TOVIS Studio',
    handle: args?.handle ?? 'tovisstudio',
    bio: args?.bio ?? null,
    location: args?.location ?? null,
    avatarUrl: args?.avatarUrl ?? null,
    professionType: args?.professionType ?? null,
    isPremium: false,
  }
}

describe('app/api/pro/profile/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
    })

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makeCurrentProfile(),
    )

    mocks.prisma.professionalProfile.update.mockResolvedValue(
      makeUpdatedProfile(),
    )
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mocks.requirePro.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await PATCH(makeRequest({ businessName: 'Ignored' }))

    expect(mocks.requirePro).toHaveBeenCalled()
    expect(result).toBe(res)
    expect(result.status).toBe(401)
    expect(mocks.prisma.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalProfile.update).not.toHaveBeenCalled()
  })

  it('returns 403 when a pending pro tries to change their handle', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makeCurrentProfile({
        verificationStatus: VerificationStatus.PENDING,
        handle: 'tovisstudio',
        handleNormalized: 'tovisstudio',
      }),
    )

    const result = await PATCH(
      makeRequest({
        handle: 'new-handle',
      }),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Your public profile link becomes available after approval.',
    })

    expect(mocks.prisma.professionalProfile.update).not.toHaveBeenCalled()
  })

  it('allows a pending pro to update non-handle fields', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makeCurrentProfile({
        verificationStatus: VerificationStatus.PENDING,
      }),
    )

    mocks.prisma.professionalProfile.update.mockResolvedValue(
      makeUpdatedProfile({
        businessName: 'TOVIS Studio LA',
      }),
    )

    const result = await PATCH(
      makeRequest({
        businessName: 'TOVIS Studio LA',
      }),
    )

    const body = await readJson<{
      ok: true
      profile: ReturnType<typeof makeUpdatedProfile>
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        businessName: 'TOVIS Studio LA',
      },
      select: {
        id: true,
        businessName: true,
        handle: true,
        bio: true,
        location: true,
        avatarUrl: true,
        professionType: true,
        isPremium: true,
      },
    })

    expect(body).toEqual({
      ok: true,
      profile: {
        id: 'pro_1',
        businessName: 'TOVIS Studio LA',
        handle: 'tovisstudio',
        bio: null,
        location: null,
        avatarUrl: null,
        professionType: null,
        isPremium: false,
      },
    })
  })

  it('does not block a pending pro when the submitted handle is unchanged', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makeCurrentProfile({
        verificationStatus: VerificationStatus.PENDING,
        handle: 'tovisstudio',
        handleNormalized: 'tovisstudio',
      }),
    )

    mocks.prisma.professionalProfile.update.mockResolvedValue(
      makeUpdatedProfile({
        businessName: 'TOVIS Studio Updated',
        handle: 'tovisstudio',
      }),
    )

    const result = await PATCH(
      makeRequest({
        businessName: 'TOVIS Studio Updated',
        handle: 'TOVISStudio',
      }),
    )

    const body = await readJson<{
      ok: true
      profile: ReturnType<typeof makeUpdatedProfile>
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        businessName: 'TOVIS Studio Updated',
      },
      select: {
        id: true,
        businessName: true,
        handle: true,
        bio: true,
        location: true,
        avatarUrl: true,
        professionType: true,
        isPremium: true,
      },
    })

    expect(body.ok).toBe(true)
  })

  it('allows an approved pro to change their handle', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makeCurrentProfile({
        verificationStatus: VerificationStatus.APPROVED,
        handle: 'tovisstudio',
        handleNormalized: 'tovisstudio',
      }),
    )

    mocks.prisma.professionalProfile.update.mockResolvedValue(
      makeUpdatedProfile({
        handle: 'new-handle',
      }),
    )

    const result = await PATCH(
      makeRequest({
        handle: 'New-Handle',
      }),
    )

    const body = await readJson<{
      ok: true
      profile: ReturnType<typeof makeUpdatedProfile>
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.prisma.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        handle: 'new-handle',
        handleNormalized: 'new-handle',
      },
      select: {
        id: true,
        businessName: true,
        handle: true,
        bio: true,
        location: true,
        avatarUrl: true,
        professionType: true,
        isPremium: true,
      },
    })

    expect(body).toEqual({
      ok: true,
      profile: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'new-handle',
        bio: null,
        location: null,
        avatarUrl: null,
        professionType: null,
        isPremium: false,
      },
    })
  })

  it('rejects an invalid profession type', async () => {
    const result = await PATCH(
      makeRequest({
        professionType: 'NOT_A_REAL_PROFESSION',
      }),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid profession type.',
    })

    expect(mocks.prisma.professionalProfile.update).not.toHaveBeenCalled()
  })
})