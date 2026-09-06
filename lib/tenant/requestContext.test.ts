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

import { DEGRADED_ROOT_TENANT_ID } from './degradedResolution'
import {
  resolveBrandOnlyTenantContextForRequest,
  resolveTenantContextForRequest,
} from './requestContext'
import { clearTenantResolutionCache } from './resolveTenant'

beforeEach(() => {
  vi.clearAllMocks()
  clearTenantResolutionCache()
  mocks.tenantFindUnique.mockResolvedValue({ id: 'tenant_root' })
  mocks.tenantFindFirst.mockResolvedValue(null)
})

describe('resolveTenantContextForRequest', () => {
  it('resolves root for a request without a matching custom domain', async () => {
    const request = new Request('http://localhost/api/v1/search', {
      headers: { host: 'app.tovis.example' },
    })

    const ctx = await resolveTenantContextForRequest(request)

    expect(ctx.isRoot).toBe(true)
  })

  it('resolves a white-label tenant from the request host', async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: 'tenant_a', slug: 'salon-a' })

    const request = new Request('http://localhost/api/v1/search', {
      headers: { host: 'booking.salon-a.com' },
    })

    const ctx = await resolveTenantContextForRequest(request)

    expect(ctx).toEqual({ isRoot: false, tenantId: 'tenant_a', slug: 'salon-a' })
  })

  it('rethrows a failed lookup — the tenant id is load-bearing here', async () => {
    const outage = new Error("Can't reach database server")
    mocks.tenantFindUnique.mockRejectedValue(outage)

    const request = new Request('http://localhost/api/v1/search', {
      headers: { host: 'app.tovis.example' },
    })

    await expect(resolveTenantContextForRequest(request)).rejects.toBe(outage)
  })
})

describe('resolveBrandOnlyTenantContextForRequest', () => {
  it('resolves exactly like the strict resolver when the lookup succeeds', async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: 'tenant_a', slug: 'salon-a' })

    const request = new Request('http://localhost/llms.txt', {
      headers: { host: 'booking.salon-a.com' },
    })

    await expect(
      resolveBrandOnlyTenantContextForRequest(request),
    ).resolves.toEqual({ isRoot: false, tenantId: 'tenant_a', slug: 'salon-a' })
  })

  it('degrades to the sentinel root context when the lookup throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.tenantFindFirst.mockRejectedValue(new Error("Can't reach database server"))

    const request = new Request('http://localhost/llms.txt', {
      headers: { host: 'booking.salon-a.com' },
    })

    const ctx = await resolveBrandOnlyTenantContextForRequest(request)

    expect(ctx.isRoot).toBe(true)
    expect(ctx.tenantId).toBe(DEGRADED_ROOT_TENANT_ID)
    expect(consoleError).toHaveBeenCalledWith(
      'resolveBrandOnlyTenantContextForRequest: falling back to root',
      { error: "Can't reach database server" },
    )
  })
})
