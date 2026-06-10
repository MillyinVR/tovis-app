import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
  tenantUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
      upsert: mocks.tenantUpsert,
    },
  },
}))

import { TOVIS_ROOT_TENANT_SLUG } from './constants'
import {
  clearTenantResolutionCache,
  ensureRootTenant,
  getRootTenantId,
  normalizeHost,
  resolveTenantByHost,
  TENANT_HOST_CACHE_TTL_MS,
} from './resolveTenant'

beforeEach(() => {
  vi.clearAllMocks()
  clearTenantResolutionCache()
  mocks.tenantFindUnique.mockResolvedValue({ id: 'tenant_root' })
  mocks.tenantFindFirst.mockResolvedValue(null)
})

describe('normalizeHost', () => {
  it('lowercases and strips port and whitespace', () => {
    expect(normalizeHost(' Salon-A.example.COM:3000 ')).toBe(
      'salon-a.example.com',
    )
  })

  it('returns null for empty or missing hosts', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost(undefined)).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
    expect(normalizeHost(':3000')).toBeNull()
  })
})

describe('resolveTenantByHost', () => {
  it('resolves the root tenant when no custom domain matches', async () => {
    const ctx = await resolveTenantByHost('app.tovis.example')

    expect(ctx).toEqual({
      isRoot: true,
      tenantId: 'tenant_root',
      slug: TOVIS_ROOT_TENANT_SLUG,
    })
  })

  it('resolves a white-label tenant by active custom domain', async () => {
    mocks.tenantFindFirst.mockResolvedValue({
      id: 'tenant_a',
      slug: 'salon-a',
    })

    const ctx = await resolveTenantByHost('Booking.Salon-A.com:443')

    expect(mocks.tenantFindFirst).toHaveBeenCalledWith({
      where: { customDomain: 'booking.salon-a.com', isActive: true },
      select: { id: true, slug: true },
    })
    expect(ctx).toEqual({
      isRoot: false,
      tenantId: 'tenant_a',
      slug: 'salon-a',
    })
  })

  it('resolves root for a null host', async () => {
    const ctx = await resolveTenantByHost(null)

    expect(ctx.isRoot).toBe(true)
    expect(mocks.tenantFindFirst).not.toHaveBeenCalled()
  })

  it('never returns a white-label context for the reserved root slug', async () => {
    mocks.tenantFindFirst.mockResolvedValue({
      id: 'tenant_root',
      slug: TOVIS_ROOT_TENANT_SLUG,
    })

    const ctx = await resolveTenantByHost('tovis.example')

    expect(ctx.isRoot).toBe(true)
  })

  it('throws loudly when the root tenant row is missing', async () => {
    mocks.tenantFindUnique.mockResolvedValue(null)

    await expect(resolveTenantByHost('app.tovis.example')).rejects.toThrow(
      /tovis-root/,
    )
  })
})

describe('tenant resolution caching', () => {
  it('memoizes the root tenant id across calls', async () => {
    await getRootTenantId()
    await getRootTenantId()
    await resolveTenantByHost('app.tovis.example')

    expect(mocks.tenantFindUnique).toHaveBeenCalledTimes(1)
  })

  it('serves repeated host lookups from cache within the TTL', async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: 'tenant_a', slug: 'salon-a' })

    const first = await resolveTenantByHost('booking.salon-a.com')
    const second = await resolveTenantByHost('booking.salon-a.com')

    expect(first).toEqual(second)
    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
  })

  it('caches misses so root-domain traffic does not re-query per request', async () => {
    await resolveTenantByHost('app.tovis.example')
    await resolveTenantByHost('app.tovis.example')

    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
  })

  it('re-queries a host after the TTL expires', async () => {
    vi.useFakeTimers()
    try {
      await resolveTenantByHost('booking.salon-a.com')

      vi.advanceTimersByTime(TENANT_HOST_CACHE_TTL_MS + 1)
      mocks.tenantFindFirst.mockResolvedValue({
        id: 'tenant_a',
        slug: 'salon-a',
      })

      const ctx = await resolveTenantByHost('booking.salon-a.com')

      expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(2)
      expect(ctx.isRoot).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearTenantResolutionCache forces fresh lookups', async () => {
    await resolveTenantByHost('app.tovis.example')
    clearTenantResolutionCache()
    await resolveTenantByHost('app.tovis.example')

    expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(2)
    expect(mocks.tenantFindUnique).toHaveBeenCalledTimes(2)
  })
})

describe('getRootTenantId / ensureRootTenant', () => {
  it('returns the root tenant id when it exists', async () => {
    await expect(getRootTenantId()).resolves.toBe('tenant_root')
  })

  it('ensureRootTenant upserts idempotently by reserved slug', async () => {
    mocks.tenantUpsert.mockResolvedValue({ id: 'tenant_root' })

    await expect(ensureRootTenant()).resolves.toBe('tenant_root')
    expect(mocks.tenantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: TOVIS_ROOT_TENANT_SLUG },
        update: {},
      }),
    )
  })
})
