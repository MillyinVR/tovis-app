import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
    },
  },
}))

import { resolveTenantContextForRequest } from './requestContext'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tenantFindUnique.mockResolvedValue({ id: 'tenant_root' })
  mocks.tenantFindFirst.mockResolvedValue(null)
})

describe('resolveTenantContextForRequest', () => {
  it('resolves root for a request without a matching custom domain', async () => {
    const request = new Request('http://localhost/api/search', {
      headers: { host: 'app.tovis.example' },
    })

    const ctx = await resolveTenantContextForRequest(request)

    expect(ctx.isRoot).toBe(true)
  })

  it('resolves a white-label tenant from the request host', async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: 'tenant_a', slug: 'salon-a' })

    const request = new Request('http://localhost/api/search', {
      headers: { host: 'booking.salon-a.com' },
    })

    const ctx = await resolveTenantContextForRequest(request)

    expect(ctx).toEqual({ isRoot: false, tenantId: 'tenant_a', slug: 'salon-a' })
  })
})
