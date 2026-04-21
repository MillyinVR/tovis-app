// lib/looks/serviceOwnership.test.ts
import { describe, expect, it } from 'vitest'

import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from './serviceOwnership'

const fadeService = {
  id: 'service_fade',
  name: 'Fade',
  category: {
    name: 'Hair',
    slug: 'hair',
  },
} as const

const colorService = {
  id: 'service_color',
  name: 'Color',
  category: {
    name: 'Hair',
    slug: 'hair',
  },
} as const

describe('lib/looks/serviceOwnership.ts', () => {
  it('prefers explicit LookPost.service over legacy media-tag data', () => {
    const resolved = resolveLookPrimaryService({
      serviceId: 'service_fade',
      service: fadeService,
      legacyPrimaryService: colorService,
      legacyServiceIds: ['service_color', 'service_fade', 'service_extra'],
    })

    expect(resolved).toEqual({
      source: 'LOOK_POST_SERVICE',
      primaryService: fadeService,
      primaryServiceId: 'service_fade',
      serviceIds: ['service_fade', 'service_color', 'service_extra'],
    })

    expect(toLookPrimaryServiceSummary(resolved)).toEqual({
      id: 'service_fade',
      name: 'Fade',
      categoryName: 'Hair',
      categorySlug: 'hair',
    })
  })

  it('uses explicit LookPost.serviceId without inventing missing service metadata', () => {
    const resolved = resolveLookPrimaryService({
      serviceId: 'service_fade',
      service: null,
    })

    expect(resolved).toEqual({
      source: 'LOOK_POST_SERVICE_ID_ONLY',
      primaryService: null,
      primaryServiceId: 'service_fade',
      serviceIds: ['service_fade'],
    })

    expect(toLookPrimaryServiceSummary(resolved)).toEqual({
      id: 'service_fade',
      name: null,
      categoryName: null,
      categorySlug: null,
    })
  })

  it('allows bounded legacy fallback only when explicit primary data is missing', () => {
    const resolved = resolveLookPrimaryService({
      serviceId: null,
      service: null,
      legacyPrimaryService: colorService,
      legacyServiceIds: ['service_extra', 'service_color', 'service_extra'],
    })

    expect(resolved).toEqual({
      source: 'LEGACY_MEDIA_TAG',
      primaryService: colorService,
      primaryServiceId: 'service_color',
      serviceIds: ['service_color', 'service_extra'],
    })
  })

  it('never lets secondary ids override the primary service and never depends on tag order', () => {
    const resolved = resolveLookPrimaryService({
      serviceId: 'service_fade',
      service: fadeService,
      legacyServiceIds: ['service_z', 'service_a', 'service_fade', 'service_m'],
    })

    expect(resolved.primaryServiceId).toBe('service_fade')
    expect(resolved.serviceIds).toEqual([
      'service_fade',
      'service_a',
      'service_m',
      'service_z',
    ])
  })

  it('returns no primary service when neither explicit nor legacy bridge data exists', () => {
    const resolved = resolveLookPrimaryService({
      serviceId: null,
      service: null,
    })

    expect(resolved).toEqual({
      source: 'NONE',
      primaryService: null,
      primaryServiceId: null,
      serviceIds: [],
    })

    expect(toLookPrimaryServiceSummary(resolved)).toBeNull()
  })
})