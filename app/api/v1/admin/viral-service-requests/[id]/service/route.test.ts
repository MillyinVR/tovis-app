// What the route itself owns: who may call it, what it will and will not read out
// of the form, and how the write path's refusals become statuses.
//
// The link RULES live in lib/services/viralBaseServiceLinks.ts and are tested
// there; `linkViralLookToCatalogService` is mocked here so a failure points at
// one layer rather than two.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  hasAdminPermission: vi.fn(),
  linkViralLookToCatalogService: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  prisma: {
    viralServiceRequest: { findUnique: vi.fn() },
    service: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))
vi.mock('@/lib/adminPermissions', () => ({
  hasAdminPermission: mocks.hasAdminPermission,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))
vi.mock('@/lib/viralRequests/catalogService', async () => {
  // The error classes are real — the route maps them to statuses, so mocking
  // them would test the mock's inheritance rather than the mapping.
  const actual = await vi.importActual<
    typeof import('@/lib/viralRequests/catalogService')
  >('@/lib/viralRequests/catalogService')
  return { ...actual, linkViralLookToCatalogService: mocks.linkViralLookToCatalogService }
})

import {
  ViralBaseServiceChainError,
  ViralBaseServiceEmptyError,
} from '@/lib/services/viralBaseServiceLinks'
import { ViralCatalogServiceNotFoundError } from '@/lib/viralRequests/catalogService'

import { POST } from './route'

const REQUEST_ID = 'viral_1'
const HAIR_CATEGORY = 'cat_hair'
const HAIRCUT = 'svc_haircut'

function post(fields: Record<string, string>): NextRequest {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)

  return new NextRequest(
    `http://localhost/api/v1/admin/viral-service-requests/${REQUEST_ID}/service`,
    { method: 'POST', body: form },
  )
}

function ctx(id = REQUEST_ID) {
  return { params: Promise.resolve({ id }) }
}

/** The create-mode form that everything else varies from. */
const CREATE = {
  name: 'Wolf Cut',
  categoryId: HAIR_CATEGORY,
  proBreakdown: 'A heavily layered shag.',
  baseServiceIds: HAIRCUT,
}

async function body(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string; service?: unknown }
}

/** Every category id the route ran a scope check on, in call order. */
function scopedCategoryIds(): string[] {
  return mocks.hasAdminPermission.mock.calls.flatMap((call: unknown[]) => {
    const args = call[0]
    if (typeof args !== 'object' || args === null) return []
    const scope = (args as { scope?: { categoryId?: unknown } }).scope
    return typeof scope?.categoryId === 'string' ? [scope.categoryId] : []
  })
}

describe('POST /api/v1/admin/viral-service-requests/[id]/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
    mocks.hasAdminPermission.mockResolvedValue(true)
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      removedAt: null,
    })
    mocks.prisma.service.findMany.mockResolvedValue([
      { id: HAIRCUT, categoryId: HAIR_CATEGORY },
    ])
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    )
    mocks.linkViralLookToCatalogService.mockResolvedValue({
      serviceId: 'svc_wolf',
      serviceName: 'Wolf Cut',
      categoryId: HAIR_CATEGORY,
      created: true,
      baseServiceIds: [HAIRCUT],
    })
    mocks.writeAdminAuditLog.mockResolvedValue(undefined)
  })

  it('refuses a caller who is not an admin', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false }, { status: 401 }),
    })

    expect((await POST(post(CREATE), ctx())).status).toBe(401)
    expect(mocks.linkViralLookToCatalogService).not.toHaveBeenCalled()
  })

  it('refuses an admin without SUPER_ADMIN / SUPPORT', async () => {
    mocks.hasAdminPermission.mockResolvedValue(false)

    expect((await POST(post(CREATE), ctx())).status).toBe(403)
    expect(mocks.linkViralLookToCatalogService).not.toHaveBeenCalled()
  })

  it('refuses an admin outside the category scope, before any write', async () => {
    // The first call is the role check; the per-category calls come after. An
    // admin scoped to Nails must not file a look under Hair.
    mocks.hasAdminPermission
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)

    expect((await POST(post(CREATE), ctx())).status).toBe(403)
    expect(mocks.linkViralLookToCatalogService).not.toHaveBeenCalled()
  })

  it('checks the scope of the base services categories too, not just the look', async () => {
    mocks.prisma.service.findMany.mockResolvedValue([
      { id: HAIRCUT, categoryId: 'cat_colour' },
    ])

    await POST(post(CREATE), ctx())

    const scoped = scopedCategoryIds()

    expect(scoped).toContain(HAIR_CATEGORY)
    expect(scoped).toContain('cat_colour')
  })

  it('404s a request that does not exist', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(null)

    expect((await POST(post(CREATE), ctx())).status).toBe(404)
  })

  it('404s a look a moderator has REMOVED', async () => {
    // A pulled look must not gain a catalog service — it is not going live.
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      removedAt: new Date('2026-09-01T00:00:00.000Z'),
    })

    expect((await POST(post(CREATE), ctx())).status).toBe(404)
  })

  it('refuses an ABSENT baseServiceIds field distinctly from an empty one', async () => {
    // Absent means "leave the links alone" everywhere else in the codebase, and
    // that is meaningless here — stating them is this route's whole job.
    const res = await POST(
      post({ name: CREATE.name, categoryId: CREATE.categoryId }),
      ctx(),
    )

    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('Missing baseServiceIds.')
    expect(mocks.linkViralLookToCatalogService).not.toHaveBeenCalled()
  })

  it('refuses both modes at once rather than picking one', async () => {
    // Nothing here is inferred, including which mode the admin meant.
    const res = await POST(
      post({ ...CREATE, serviceId: 'svc_existing' }),
      ctx(),
    )

    expect(res.status).toBe(400)
    expect((await body(res)).error).toContain('not both')
  })

  it('refuses neither mode', async () => {
    const res = await POST(post({ baseServiceIds: HAIRCUT }), ctx())

    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('Missing serviceId or name.')
  })

  it('requires a category when creating', async () => {
    const res = await POST(
      post({ name: 'Wolf Cut', baseServiceIds: HAIRCUT }),
      ctx(),
    )

    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('Missing categoryId.')
  })

  it('refuses a non-positive duration rather than storing one a booking rejects', async () => {
    // `defaultDurationMinutes` is the fallback when a pro leaves theirs blank,
    // and a duration <= 0 makes the booking path throw.
    const res = await POST(post({ ...CREATE, defaultDurationMinutes: '0' }), ctx())

    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('Invalid defaultDurationMinutes.')
  })

  it('names base service ids that do not exist', async () => {
    mocks.prisma.service.findMany.mockResolvedValue([])

    const res = await POST(post({ ...CREATE, baseServiceIds: 'svc_nope' }), ctx())

    expect(res.status).toBe(400)
    expect((await body(res)).error).toContain('svc_nope')
    expect(mocks.linkViralLookToCatalogService).not.toHaveBeenCalled()
  })

  it('passes the parsed create input and the id set through to the write path', async () => {
    const res = await POST(
      post({
        ...CREATE,
        description: 'The shaggy cut all over your feed.',
        defaultDurationMinutes: '75',
        baseServiceIds: `${HAIRCUT}, ${HAIRCUT}`,
      }),
      ctx(),
    )

    expect(res.status).toBe(200)
    expect(mocks.linkViralLookToCatalogService).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId: REQUEST_ID,
        baseServiceIds: [HAIRCUT],
        service: {
          mode: 'create',
          name: 'Wolf Cut',
          categoryId: HAIR_CATEGORY,
          description: 'The shaggy cut all over your feed.',
          proBreakdown: 'A heavily layered shag.',
          defaultDurationMinutes: 75,
        },
      },
    )
  })

  it('attaches an existing service by id, using ITS category for the scope check', async () => {
    mocks.prisma.service.findUnique.mockResolvedValue({
      id: 'svc_existing',
      categoryId: 'cat_nails',
    })
    mocks.linkViralLookToCatalogService.mockResolvedValue({
      serviceId: 'svc_existing',
      serviceName: 'Bubble Gum Nails',
      categoryId: 'cat_nails',
      created: false,
      baseServiceIds: [HAIRCUT],
    })

    const res = await POST(
      post({ serviceId: 'svc_existing', baseServiceIds: HAIRCUT }),
      ctx(),
    )

    expect(res.status).toBe(200)
    expect(mocks.linkViralLookToCatalogService).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId: REQUEST_ID,
        baseServiceIds: [HAIRCUT],
        service: { mode: 'attach', serviceId: 'svc_existing' },
      },
    )

    expect(scopedCategoryIds()).toContain('cat_nails')
  })

  it('404s an attach of a service that does not exist', async () => {
    mocks.prisma.service.findUnique.mockResolvedValue(null)

    const res = await POST(
      post({ serviceId: 'svc_gone', baseServiceIds: HAIRCUT }),
      ctx(),
    )

    expect(res.status).toBe(404)
  })

  it('records which of create / attach happened, for the audit trail', async () => {
    await POST(post(CREATE), ctx())
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VIRAL_LOOK_SERVICE_CREATED' }),
    )

    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
    mocks.hasAdminPermission.mockResolvedValue(true)
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      removedAt: null,
    })
    mocks.prisma.service.findUnique.mockResolvedValue({
      id: 'svc_existing',
      categoryId: HAIR_CATEGORY,
    })
    mocks.prisma.service.findMany.mockResolvedValue([
      { id: HAIRCUT, categoryId: HAIR_CATEGORY },
    ])
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    )
    mocks.linkViralLookToCatalogService.mockResolvedValue({
      serviceId: 'svc_existing',
      serviceName: 'Wolf Cut',
      categoryId: HAIR_CATEGORY,
      created: false,
      baseServiceIds: [HAIRCUT],
    })

    await POST(post({ serviceId: 'svc_existing', baseServiceIds: HAIRCUT }), ctx())
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VIRAL_LOOK_SERVICE_ATTACHED' }),
    )
  })
})

describe('how the write paths refusals become statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
    mocks.hasAdminPermission.mockResolvedValue(true)
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      removedAt: null,
    })
    mocks.prisma.service.findMany.mockResolvedValue([
      { id: HAIRCUT, categoryId: HAIR_CATEGORY },
    ])
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    )
  })

  it('answers 400 with the reason for a link-rule refusal, not a blank 500', async () => {
    // These are the admin's mistakes, and an admin who gets a 500 has no idea
    // what to change.
    mocks.linkViralLookToCatalogService.mockRejectedValue(
      new ViralBaseServiceEmptyError(),
    )

    const res = await POST(post(CREATE), ctx())
    expect(res.status).toBe(400)
    expect((await body(res)).error).toContain('at least one real service')
  })

  it('passes the chain refusal through with the offending ids named', async () => {
    mocks.linkViralLookToCatalogService.mockRejectedValue(
      new ViralBaseServiceChainError(['svc_shag']),
    )

    const res = await POST(post(CREATE), ctx())
    expect(res.status).toBe(400)
    expect((await body(res)).error).toContain('svc_shag')
  })

  it('answers 404 when the write path cannot find the service', async () => {
    mocks.linkViralLookToCatalogService.mockRejectedValue(
      new ViralCatalogServiceNotFoundError(),
    )

    expect((await POST(post(CREATE), ctx())).status).toBe(404)
  })

  it('answers 500 for an unexpected failure', async () => {
    mocks.linkViralLookToCatalogService.mockRejectedValue(new Error('boom'))

    expect((await POST(post(CREATE), ctx())).status).toBe(500)
  })
})
