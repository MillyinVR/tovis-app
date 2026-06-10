import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headersGet: vi.fn(),
  resolveTenantByHost: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: mocks.headersGet })),
}))

vi.mock('./resolveTenant', () => ({
  resolveTenantByHost: mocks.resolveTenantByHost,
}))

import { TOVIS_ROOT_TENANT_SLUG } from './constants'
import { resolveTenantContextForLayout } from './layoutContext'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersGet.mockReturnValue(null)
  mocks.resolveTenantByHost.mockResolvedValue({
    isRoot: true,
    tenantId: 'tenant_root',
    slug: TOVIS_ROOT_TENANT_SLUG,
  })
})

describe('resolveTenantContextForLayout', () => {
  it('resolves by x-forwarded-host before host', async () => {
    mocks.headersGet.mockImplementation((name: string) =>
      name === 'x-forwarded-host' ? 'booking.salon-a.com' : 'internal.host',
    )
    mocks.resolveTenantByHost.mockResolvedValue({
      isRoot: false,
      tenantId: 'tenant_a',
      slug: 'salon-a',
    })

    const ctx = await resolveTenantContextForLayout()

    expect(mocks.resolveTenantByHost).toHaveBeenCalledWith(
      'booking.salon-a.com',
    )
    expect(ctx).toEqual({
      isRoot: false,
      tenantId: 'tenant_a',
      slug: 'salon-a',
    })
  })

  it('falls back to the host header when x-forwarded-host is absent', async () => {
    mocks.headersGet.mockImplementation((name: string) =>
      name === 'host' ? 'tovis.app' : null,
    )

    await resolveTenantContextForLayout()

    expect(mocks.resolveTenantByHost).toHaveBeenCalledWith('tovis.app')
  })

  it('returns a degraded root context instead of throwing on resolver errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      mocks.resolveTenantByHost.mockRejectedValue(
        new Error('database connection refused'),
      )

      const ctx = await resolveTenantContextForLayout()

      expect(ctx.isRoot).toBe(true)
      expect(ctx.slug).toBe(TOVIS_ROOT_TENANT_SLUG)
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})
