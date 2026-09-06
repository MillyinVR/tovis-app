import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantByHost: vi.fn(),
}))

vi.mock('./resolveTenant', () => ({
  resolveTenantByHost: mocks.resolveTenantByHost,
}))

import { TOVIS_ROOT_TENANT_SLUG } from './constants'
import {
  DEGRADED_ROOT_TENANT_ID,
  resolveTenantByHostOrDegraded,
} from './degradedResolution'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveTenantByHostOrDegraded', () => {
  it('passes a successful resolution through untouched', async () => {
    const ctx = { isRoot: false, tenantId: 'tenant_a', slug: 'salon-a' }
    mocks.resolveTenantByHost.mockResolvedValue(ctx)

    await expect(
      resolveTenantByHostOrDegraded('booking.salon-a.com', 'caller'),
    ).resolves.toBe(ctx)
    expect(mocks.resolveTenantByHost).toHaveBeenCalledWith(
      'booking.salon-a.com',
    )
  })

  it('degrades to the sentinel root context and logs under the caller name', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.resolveTenantByHost.mockRejectedValue(
      new Error('database connection refused'),
    )

    const ctx = await resolveTenantByHostOrDegraded('tovis.app', 'someCaller')

    expect(ctx).toEqual({
      isRoot: true,
      tenantId: DEGRADED_ROOT_TENANT_ID,
      slug: TOVIS_ROOT_TENANT_SLUG,
    })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      'someCaller: falling back to root',
      { error: 'database connection refused' },
    )
  })

  it('stringifies a non-Error rejection into the log line', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.resolveTenantByHost.mockRejectedValue('boom')

    await resolveTenantByHostOrDegraded(null, 'someCaller')

    expect(consoleError).toHaveBeenCalledWith(
      'someCaller: falling back to root',
      { error: 'boom' },
    )
  })
})
