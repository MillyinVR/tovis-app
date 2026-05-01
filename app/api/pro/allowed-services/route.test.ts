// app/api/pro/allowed-services/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionType } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const requirePro = vi.fn()

  const prisma = {
    service: {
      findMany: vi.fn(),
    },
    professionalProfile: {
      findUnique: vi.fn(),
    },
    servicePermission: {
      findMany: vi.fn(),
    },
  }

  return {
    requirePro,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/money', () => ({
  moneyToString: (v: unknown) => (v != null ? String(v) : null),
}))

function makeService(id: string, overrides?: Partial<{
  name: string
  isActive: boolean
  category: { name: string; description: string } | null
}>) {
  return {
    id,
    name: overrides?.name ?? `Service ${id}`,
    description: null,
    isActive: overrides?.isActive ?? true,
    defaultDurationMinutes: 60,
    minPrice: '50.00',
    allowMobile: false,
    category: overrides?.category ?? { name: 'Category', description: null },
  }
}

describe('app/api/pro/allowed-services/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
    })
  })

  describe('Suite A — open-access services (no ServicePermission rows)', () => {
    it('returns all services when filter is disabled', async () => {
      vi.stubEnv('ENABLE_SERVICE_PERMISSION_FILTER', 'false')

      const services = [makeService('svc_1'), makeService('svc_2'), makeService('svc_3')]
      mocks.prisma.service.findMany.mockResolvedValue(services)

      const { GET } = await import('./route')
      const res = await GET()
      const body = await res.json()

      expect(body).toHaveLength(3)
      expect(mocks.prisma.professionalProfile.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.servicePermission.findMany).not.toHaveBeenCalled()
    })

    it('returns all 3 services when filter is enabled but no ServicePermission rows exist', async () => {
      vi.stubEnv('ENABLE_SERVICE_PERMISSION_FILTER', 'true')

      const services = [makeService('svc_1'), makeService('svc_2'), makeService('svc_3')]
      mocks.prisma.service.findMany.mockResolvedValue(services)

      mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
        professionType: ProfessionType.COSMETOLOGIST,
        licenseState: 'CA',
      })

      // No ServicePermission rows — all services are open-access
      mocks.prisma.servicePermission.findMany.mockResolvedValue([])

      const { GET } = await import('./route')
      const res = await GET()
      const body = await res.json()

      // All 3 services returned: none are restricted
      expect(body).toHaveLength(3)
    })
  })

  describe('Suite B — state-specific permissions', () => {
    it('filters out services restricted to a different state', async () => {
      vi.stubEnv('ENABLE_SERVICE_PERMISSION_FILTER', 'true')

      // Service A is restricted (has a ServicePermission row), B and C are open-access
      const serviceA = makeService('svc_A')
      const serviceB = makeService('svc_B')
      const serviceC = makeService('svc_C')
      mocks.prisma.service.findMany.mockResolvedValue([serviceA, serviceB, serviceC])

      // Pro is COSMETOLOGIST licensed in TX
      mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
        professionType: ProfessionType.COSMETOLOGIST,
        licenseState: 'TX',
      })

      // Service A has a permission row for (COSMETOLOGIST, CA) — not TX
      // resolveExplicitlyAllowedServiceIds query returns empty (no match for TX)
      mocks.prisma.servicePermission.findMany
        // First call: resolveExplicitlyAllowedServiceIds — returns nothing for TX
        .mockResolvedValueOnce([])
        // Second call: all restricted service IDs (restricted set)
        .mockResolvedValueOnce([{ serviceId: 'svc_A' }])

      const { GET } = await import('./route')
      const res = await GET()
      const body = await res.json()

      // Service A is restricted and pro is not in CA — filtered out
      // Service B and C have no restrictions — allowed
      const ids = body.map((s: { id: string }) => s.id)
      expect(ids).not.toContain('svc_A')
      expect(ids).toContain('svc_B')
      expect(ids).toContain('svc_C')
      expect(body).toHaveLength(2)
    })
  })

  describe('Suite C — professionType = null', () => {
    it('returns all active services when pro has no professionType set', async () => {
      vi.stubEnv('ENABLE_SERVICE_PERMISSION_FILTER', 'true')

      const services = [makeService('svc_1'), makeService('svc_2')]
      mocks.prisma.service.findMany.mockResolvedValue(services)

      // Pro has no professionType — fall back to returning all services
      mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
        professionType: null,
        licenseState: null,
      })

      const { GET } = await import('./route')
      const res = await GET()
      const body = await res.json()

      // All services returned — null guard triggers fallback
      expect(body).toHaveLength(2)
      expect(mocks.prisma.servicePermission.findMany).not.toHaveBeenCalled()
    })
  })
})
