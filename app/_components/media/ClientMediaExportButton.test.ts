import { describe, expect, it } from 'vitest'

import { parseIdentity } from './ClientMediaExportButton'

function response(overrides?: Partial<{ handle: unknown; businessName: unknown; enabled: unknown; dropsPlatformMark: unknown }>) {
  return {
    professional: {
      header: {
        handle: 'dana',
        businessName: 'Plume Studio',
        clientExport: { enabled: true, dropsPlatformMark: true },
        ...overrides,
      },
    },
  }
}

describe('parseIdentity', () => {
  it('extracts handle, businessName, and the clientExport flags', () => {
    expect(parseIdentity(response())).toEqual({
      handle: 'dana',
      businessName: 'Plume Studio',
      enabled: true,
      dropsPlatformMark: true,
    })
  })

  it('treats a missing enabled as false — the consent gate fails CLOSED', () => {
    const data = {
      professional: { header: { clientExport: { dropsPlatformMark: true } } },
    }
    expect(parseIdentity(data)?.enabled).toBe(false)
  })

  // Was "fails generous" while an unbranded export was everyone's default. It is
  // a paid perk now, so an absent field must not hand it out.
  it('treats a missing dropsPlatformMark as false — the paid perk fails CLOSED', () => {
    const data = {
      professional: { header: { clientExport: { enabled: true } } },
    }
    expect(parseIdentity(data)?.dropsPlatformMark).toBe(false)
  })

  it('treats a non-boolean dropsPlatformMark as false rather than truthy', () => {
    const data = {
      professional: {
        header: { clientExport: { enabled: true, dropsPlatformMark: 'yes' } },
      },
    }
    expect(parseIdentity(data)?.dropsPlatformMark).toBe(false)
  })

  it('returns null for a response missing header.clientExport entirely (older backend)', () => {
    const data = { professional: { header: { handle: 'dana' } } }
    expect(parseIdentity(data)).toBeNull()
  })

  it('returns null for garbage input rather than throwing', () => {
    expect(parseIdentity(null)).toBeNull()
    expect(parseIdentity(undefined)).toBeNull()
    expect(parseIdentity('a string')).toBeNull()
    expect(parseIdentity(42)).toBeNull()
    expect(parseIdentity({})).toBeNull()
    expect(parseIdentity({ professional: null })).toBeNull()
  })

  it('nulls out non-string handle/businessName rather than coercing them', () => {
    const data = response({ handle: 123, businessName: [] })
    const identity = parseIdentity(data)
    expect(identity?.handle).toBeNull()
    expect(identity?.businessName).toBeNull()
  })
})
