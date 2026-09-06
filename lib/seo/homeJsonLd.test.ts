// lib/seo/homeJsonLd.test.ts
import { describe, expect, it } from 'vitest'

import { defaultHomeCopy } from '@/lib/brand/defaultHomeCopy'
import type { BrandHomeCopy } from '@/lib/brand/types'
import { buildHomeJsonLd, liveHomeFeatures } from './homeJsonLd'

const copy = defaultHomeCopy('ACME')

describe('buildHomeJsonLd', () => {
  it('lists only live features — a rolling-out row never becomes a machine-readable claim', () => {
    const ld = buildHomeJsonLd({ brandDisplayName: 'ACME', url: 'https://acme.example/', copy })
    const featureList = ld.featureList as string[]

    const rollingOut = [
      ...copy.loop.steps,
      ...copy.clients.features,
      ...copy.spotlight.features,
      ...copy.pros.features,
      copy.money,
    ].filter((f) => f.state === 'rolling-out')

    expect(rollingOut.length).toBeGreaterThan(0)
    for (const feature of rollingOut) {
      expect(featureList).not.toContain(feature.title)
    }
    expect(featureList).toEqual(liveHomeFeatures(copy).map((f) => f.title))
    expect(featureList.length).toBeGreaterThan(0)
  })

  it('drops the money row from the feature list while it is rolling out', () => {
    const ld = buildHomeJsonLd({ brandDisplayName: 'ACME', url: 'https://acme.example/', copy })
    expect(copy.money.state).toBe('rolling-out')
    expect(ld.featureList as string[]).not.toContain(copy.money.title)
  })

  it('includes the money row once it is live', () => {
    const live: BrandHomeCopy = { ...copy, money: { ...copy.money, state: 'live' } }
    const ld = buildHomeJsonLd({ brandDisplayName: 'ACME', url: 'https://acme.example/', copy: live })
    expect(ld.featureList as string[]).toContain(copy.money.title)
  })

  it('names the brand it was given, never a hardcoded one', () => {
    const ld = buildHomeJsonLd({ brandDisplayName: 'ACME', url: 'https://acme.example/', copy })
    expect(ld.name).toBe('ACME')
    expect(JSON.stringify(ld)).not.toMatch(/tovis/i)
  })
})
