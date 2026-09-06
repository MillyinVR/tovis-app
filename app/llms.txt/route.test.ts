// app/llms.txt/route.test.ts
//
// The tenant lookup is this route's only DB touch and is read for the brand
// alone, so a DB outage must degrade to the root brand — not 500 and page
// (Sentry 8b2421fae1654089b0b89878c95e3867, staging, 2026-09-05). The prisma
// client is mocked at the boundary so the real resolver chain
// (requestContext → degradedResolution → resolveTenant) is what runs.
import { PrismaClientInitializationError } from '@prisma/client/runtime/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { tovisBrand } from '@/lib/brand/brands/tovis'
import { DEGRADED_ROOT_TENANT_ID } from '@/lib/tenant/degradedResolution'
import { clearTenantResolutionCache } from '@/lib/tenant/resolveTenant'

import { GET } from './route'

function request(host = 'tovis.app'): Request {
  return new Request(`https://${host}/llms.txt`, { headers: { host } })
}

describe('GET /llms.txt', () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    vi.clearAllMocks()
    clearTenantResolutionCache()
    process.env.NEXT_PUBLIC_APP_URL = 'https://tovis.app'
    mocks.prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_root' })
    mocks.prisma.tenant.findFirst.mockResolvedValue(null)
  })

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
    }
  })

  it('serves the root brand as text/plain when the tenant resolves', async () => {
    const res = await GET(request())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    await expect(res.text()).resolves.toContain(`# ${tovisBrand.displayName}`)
  })

  it('serves the root brand with a 200 when the tenant lookup throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const outage = new PrismaClientInitializationError(
      "Can't reach database server at `db.example.supabase.co:5432`",
      '6.19.0',
    )
    mocks.prisma.tenant.findFirst.mockRejectedValue(outage)
    mocks.prisma.tenant.findUnique.mockRejectedValue(outage)

    const res = await GET(request('booking.salon-a.com'))

    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toContain(`# ${tovisBrand.displayName}`)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      'resolveBrandOnlyTenantContextForRequest: falling back to root',
      { error: outage.message },
    )
  })

  it('never leaks the degraded sentinel id into the response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.prisma.tenant.findUnique.mockRejectedValue(new Error('down'))

    const res = await GET(request())

    await expect(res.text()).resolves.not.toContain(DEGRADED_ROOT_TENANT_ID)
  })
})
