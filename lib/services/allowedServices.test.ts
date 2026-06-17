// lib/services/allowedServices.test.ts
//
// Gate semantics: fail-closed (only explicitly-allowed services are offerable)
// with DENY overriding ALLOW. Prisma is mocked; the servicePermission rows
// returned already reflect the (profession, null/own-state) WHERE filter the
// real query applies, so the test exercises the ALLOW − DENY logic in JS.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serviceFindMany: vi.fn(),
  profileFindUnique: vi.fn(),
  permissionFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    service: { findMany: mocks.serviceFindMany },
    professionalProfile: { findUnique: mocks.profileFindUnique },
    servicePermission: { findMany: mocks.permissionFindMany },
  },
}))

import { loadAllowedServices } from './allowedServices'

function svc(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    category: null,
    defaultDurationMinutes: 60,
    minPrice: null,
    allowMobile: true,
    isActive: true,
  }
}

const CATALOG = [svc('s_bal', 'Balayage'), svc('s_lash', 'Lash Lift'), svc('s_micro', 'Microblading')]

beforeEach(() => {
  mocks.serviceFindMany.mockResolvedValue(CATALOG)
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.ENABLE_SERVICE_PERMISSION_FILTER
})

describe('loadAllowedServices', () => {
  it('returns the full catalog when the filter flag is off', async () => {
    const out = await loadAllowedServices('pro_1')
    expect(out.map((s) => s.name)).toEqual(['Balayage', 'Lash Lift', 'Microblading'])
    expect(mocks.profileFindUnique).not.toHaveBeenCalled()
  })

  it('returns the full catalog when the pro has no profession yet', async () => {
    process.env.ENABLE_SERVICE_PERMISSION_FILTER = '1'
    mocks.profileFindUnique.mockResolvedValue({ professionType: null, licenseState: null })
    const out = await loadAllowedServices('pro_1')
    expect(out).toHaveLength(3)
  })

  it('is fail-closed: only explicitly-allowed services are offerable', async () => {
    process.env.ENABLE_SERVICE_PERMISSION_FILTER = '1'
    mocks.profileFindUnique.mockResolvedValue({
      professionType: 'COSMETOLOGIST',
      licenseState: 'CA',
    })
    // Balayage allowed; Lash Lift allowed; Microblading has NO row → hidden.
    mocks.permissionFindMany.mockResolvedValue([
      { serviceId: 's_bal', mode: 'ALLOW' },
      { serviceId: 's_lash', mode: 'ALLOW' },
    ])
    const out = await loadAllowedServices('pro_1')
    expect(out.map((s) => s.name)).toEqual(['Balayage', 'Lash Lift'])
  })

  it('DENY overrides a matching ALLOW (AZ lash carve-out)', async () => {
    process.env.ENABLE_SERVICE_PERMISSION_FILTER = '1'
    mocks.profileFindUnique.mockResolvedValue({
      professionType: 'COSMETOLOGIST',
      licenseState: 'AZ',
    })
    // Baseline ALLOW (null state) + AZ DENY both match an AZ cosmetologist.
    mocks.permissionFindMany.mockResolvedValue([
      { serviceId: 's_bal', mode: 'ALLOW' },
      { serviceId: 's_lash', mode: 'ALLOW' },
      { serviceId: 's_lash', mode: 'DENY' },
    ])
    const out = await loadAllowedServices('pro_1')
    expect(out.map((s) => s.name)).toEqual(['Balayage'])
  })
})
