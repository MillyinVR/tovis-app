import { describe, expect, it, vi } from 'vitest'

import {
  rootTenantContext,
  whiteLabelTenantContext,
} from '@/lib/tenant/context'

import { tovisBrand } from './brands/tovis'
import { getBrandForTenantContext } from './forTenant'

describe('getBrandForTenantContext', () => {
  it('resolves the TOVIS brand for the root tenant', () => {
    const brand = getBrandForTenantContext(rootTenantContext('tenant_root'))

    expect(brand).toBe(tovisBrand)
  })

  it('falls back to the TOVIS brand for white-label tenants without a registered BrandConfig', () => {
    const brand = getBrandForTenantContext(
      whiteLabelTenantContext({ tenantId: 'tenant_a', slug: 'salon-a' }),
    )

    expect(brand).toBe(tovisBrand)
  })

  it('never lets NEXT_PUBLIC_BRAND decide an unregistered white-label tenant brand', () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND', 'some-other-brand')

    try {
      const brand = getBrandForTenantContext(
        whiteLabelTenantContext({ tenantId: 'tenant_a', slug: 'salon-a' }),
      )

      expect(brand).toBe(tovisBrand)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
