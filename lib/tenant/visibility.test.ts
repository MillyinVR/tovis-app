import { describe, expect, it } from 'vitest'

import { rootTenantContext, whiteLabelTenantContext } from './context'
import {
  bookingTenantVisibilityFilter,
  nfcCardTenantVisibilityFilter,
  proDiscoveryVisibilityFilter,
  searchIndexVisibilityFilter,
} from './visibility'

const ROOT = rootTenantContext('tenant_root')
const SALON_A = whiteLabelTenantContext({ tenantId: 'tenant_a', slug: 'salon-a' })

describe('proDiscoveryVisibilityFilter', () => {
  it('does not restrict the root tenant (tovis-root sees all pros)', () => {
    expect(proDiscoveryVisibilityFilter(ROOT)).toEqual({})
  })

  it('confines a white-label tenant to its own home pros', () => {
    expect(proDiscoveryVisibilityFilter(SALON_A)).toEqual({
      homeTenantId: 'tenant_a',
    })
  })

  it('uses an equality filter so un-backfilled NULL rows fail closed', () => {
    const filter = proDiscoveryVisibilityFilter(SALON_A)
    // Equality with a concrete id can never match a NULL column in Postgres;
    // asserting the shape here pins that fail-closed property.
    expect(filter.homeTenantId).toBe('tenant_a')
    expect(filter.homeTenantId).not.toBeNull()
  })
})

describe('searchIndexVisibilityFilter', () => {
  it('does not restrict the root tenant', () => {
    expect(searchIndexVisibilityFilter(ROOT)).toEqual({})
  })

  it('projects the rule through the professional relation', () => {
    expect(searchIndexVisibilityFilter(SALON_A)).toEqual({
      professional: { homeTenantId: 'tenant_a' },
    })
  })
})

describe('bookingTenantVisibilityFilter', () => {
  it('does not restrict the root tenant', () => {
    expect(bookingTenantVisibilityFilter(ROOT)).toEqual({})
  })

  it('scopes by the Pro tenant (revenue attribution)', () => {
    expect(bookingTenantVisibilityFilter(SALON_A)).toEqual({
      proTenantId: 'tenant_a',
    })
  })
})

describe('nfcCardTenantVisibilityFilter', () => {
  it('does not restrict the root tenant', () => {
    expect(nfcCardTenantVisibilityFilter(ROOT)).toEqual({})
  })

  it('scopes by issuing tenant', () => {
    expect(nfcCardTenantVisibilityFilter(SALON_A)).toEqual({
      tenantId: 'tenant_a',
    })
  })
})
