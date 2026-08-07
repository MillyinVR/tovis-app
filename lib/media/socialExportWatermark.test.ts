import { describe, expect, it } from 'vitest'

import {
  clientExportWatermark,
  isEmptyWatermark,
  normalizedHandle,
  signature,
} from '@/lib/media/socialExportWatermark'

describe('normalizedHandle', () => {
  it('adds a leading @ to a bare handle', () => {
    expect(normalizedHandle('tori')).toBe('@tori')
  })

  it('collapses repeated leading @s to exactly one', () => {
    expect(normalizedHandle('@@tori')).toBe('@tori')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizedHandle('  @tori  ')).toBe('@tori')
  })

  it('returns null for empty, "@"-only, or missing input', () => {
    expect(normalizedHandle('')).toBeNull()
    expect(normalizedHandle('@')).toBeNull()
    expect(normalizedHandle('   ')).toBeNull()
    expect(normalizedHandle(null)).toBeNull()
    expect(normalizedHandle(undefined)).toBeNull()
  })
})

describe('signature', () => {
  it('prefers the handle over the business name', () => {
    expect(signature('tori', 'Tori Studio')).toBe('@tori')
  })

  it('falls back to the business name when there is no handle', () => {
    expect(signature(null, 'Tori Studio')).toBe('Tori Studio')
    expect(signature('', 'Tori Studio')).toBe('Tori Studio')
  })

  it('never invents a name', () => {
    expect(signature(null, null)).toBeNull()
    expect(signature('', '   ')).toBeNull()
  })
})

describe('clientExportWatermark', () => {
  it('shows the platform mark when the pro does not drop it', () => {
    const w = clientExportWatermark({
      handle: 'dana',
      businessName: null,
      dropsPlatformMark: false,
      platformMark: 'Tovis',
    })
    expect(w).toEqual({ signature: '@dana', showsPlatformMark: true, platformMark: 'Tovis' })
  })

  it('drops the platform mark when the pro does', () => {
    const w = clientExportWatermark({
      handle: 'dana',
      businessName: null,
      dropsPlatformMark: true,
      platformMark: 'Tovis',
    })
    expect(w.showsPlatformMark).toBe(false)
  })

  it('is empty only when there is no signature AND no mark', () => {
    const empty = clientExportWatermark({
      handle: null,
      businessName: null,
      dropsPlatformMark: true,
      platformMark: 'Tovis',
    })
    expect(isEmptyWatermark(empty)).toBe(true)

    const markOnly = clientExportWatermark({
      handle: null,
      businessName: null,
      dropsPlatformMark: false,
      platformMark: 'Tovis',
    })
    expect(isEmptyWatermark(markOnly)).toBe(false)
  })
})
