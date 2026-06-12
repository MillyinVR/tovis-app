// lib/availability/data/cache.test.ts
import { ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  buildOtherProsCacheKey,
  buildSummaryCacheKey,
} from './cache'

describe('availability cache keys', () => {
  it('partitions other-pro and summary caches by tenant scope', () => {
    const rootOtherProsKey = buildOtherProsCacheKey({
      tenantScope: 'root',
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'pro_1',
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      limit: 6,
    })

    const tenantOtherProsKey = buildOtherProsCacheKey({
      tenantScope: 'tenant:tenant_salon_a',
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'pro_1',
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      limit: 6,
    })

    expect(rootOtherProsKey).not.toBe(tenantOtherProsKey)
    expect(tenantOtherProsKey).toContain('tenant:tenant_salon_a')

    const rootSummaryKey = buildSummaryCacheKey({
      tenantScope: 'root',
      professionalId: 'pro_1',
      serviceId: 'service_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      timeZone: 'America/Los_Angeles',
      windowStartDate: '2026-06-11',
      windowEndDate: '2026-06-18',
      windowDays: 7,
      stepMinutes: 30,
      leadTimeMinutes: 60,
      locationBufferMinutes: 15,
      maxAdvanceDays: 30,
      includeOtherPros: true,
      scheduleVersion: 1,
      scheduleConfigVersion: 2,
      addOnIds: [],
      viewerLat: 32.715736,
      viewerLng: -117.161087,
      radiusMiles: 15,
      clientAddressId: null,
    })

    const tenantSummaryKey = buildSummaryCacheKey({
      tenantScope: 'tenant:tenant_salon_a',
      professionalId: 'pro_1',
      serviceId: 'service_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      timeZone: 'America/Los_Angeles',
      windowStartDate: '2026-06-11',
      windowEndDate: '2026-06-18',
      windowDays: 7,
      stepMinutes: 30,
      leadTimeMinutes: 60,
      locationBufferMinutes: 15,
      maxAdvanceDays: 30,
      includeOtherPros: true,
      scheduleVersion: 1,
      scheduleConfigVersion: 2,
      addOnIds: [],
      viewerLat: 32.715736,
      viewerLng: -117.161087,
      radiusMiles: 15,
      clientAddressId: null,
    })

    expect(rootSummaryKey).not.toBe(tenantSummaryKey)
    expect(tenantSummaryKey).toContain('tenant:tenant_salon_a')
  })
})
