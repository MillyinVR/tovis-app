// app/api/v1/pro/offerings/[id]/add-ons/route.test.ts
//
// Covers the pro-facing add-ons editor's `isPreselected` field — the
// pro-controlled "starts ticked" opt-in, independent of `isRecommended`
// (Tori, 2026-08-14).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  offeringFindFirst: vi.fn(),
  serviceFindMany: vi.fn(),
  offeringAddOnFindMany: vi.fn(),
  transaction: vi.fn(),
  txDeleteMany: vi.fn(),
  txCreateMany: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: (ctx: { params: Promise<{ id: string }> }) =>
    ctx.params,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: { findFirst: mocks.offeringFindFirst },
    service: { findMany: mocks.serviceFindMany },
    offeringAddOn: { findMany: mocks.offeringAddOnFindMany },
    $transaction: mocks.transaction,
  },
}))

import { GET, PUT } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const PRO_ID = 'pro_1'
const OFFERING_ID = 'offering_1'
const ctx = { params: Promise.resolve({ id: OFFERING_ID }) }

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/pro/offerings/${OFFERING_ID}/add-ons`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: PRO_ID })

  mocks.jsonFail.mockImplementation((status: number, error: string) =>
    makeJsonResponse(status, { ok: false, error }),
  )
  mocks.jsonOk.mockImplementation((payload: unknown) =>
    makeJsonResponse(200, {
      ok: true,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    }),
  )

  mocks.offeringFindFirst.mockResolvedValue({
    id: OFFERING_ID,
    serviceId: 'svc_base',
  })

  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      offeringAddOn: {
        deleteMany: mocks.txDeleteMany,
        createMany: mocks.txCreateMany,
      },
    }),
  )
})

describe('GET /api/v1/pro/offerings/[id]/add-ons', () => {
  it('reports isPreselected alongside isRecommended for each attached link', async () => {
    mocks.serviceFindMany.mockResolvedValue([])
    mocks.offeringAddOnFindMany.mockResolvedValue([
      {
        id: 'oa_1',
        addOnServiceId: 'svc_addon_1',
        isActive: true,
        isRecommended: true,
        isPreselected: false,
        sortOrder: 1,
        locationType: null,
        priceOverride: null,
        durationOverrideMinutes: null,
        addOnService: {
          name: 'Bond builder',
          addOnGroup: 'Treatment',
          minPrice: '30',
          defaultDurationMinutes: 15,
        },
      },
      {
        id: 'oa_2',
        addOnServiceId: 'svc_addon_2',
        isActive: true,
        isRecommended: false,
        isPreselected: true,
        sortOrder: 2,
        locationType: null,
        priceOverride: null,
        durationOverrideMinutes: null,
        addOnService: {
          name: 'Gloss kit',
          addOnGroup: 'Extras',
          minPrice: '35',
          defaultDurationMinutes: 0,
        },
      },
    ])

    const res = await GET(new NextRequest(`http://localhost/api/v1/pro/offerings/${OFFERING_ID}/add-ons`), ctx)
    const body = (await res.json()) as {
      attached: Array<{ id: string; isRecommended: boolean; isPreselected: boolean }>
    }

    expect(body.attached).toEqual([
      expect.objectContaining({ id: 'oa_1', isRecommended: true, isPreselected: false }),
      expect.objectContaining({ id: 'oa_2', isRecommended: false, isPreselected: true }),
    ])
  })
})

describe('PUT /api/v1/pro/offerings/[id]/add-ons', () => {
  it('persists isPreselected true when the pro turns it on', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'svc_addon_1' }])

    const res = await PUT(
      makePutRequest({
        items: [
          {
            addOnServiceId: 'svc_addon_1',
            isActive: true,
            isRecommended: false,
            isPreselected: true,
            sortOrder: 0,
          },
        ],
      }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(mocks.txCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          addOnServiceId: 'svc_addon_1',
          isPreselected: true,
        }),
      ],
    })
  })

  it('defaults isPreselected to false when the client omits it', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'svc_addon_1' }])

    await PUT(
      makePutRequest({
        items: [
          {
            addOnServiceId: 'svc_addon_1',
            isActive: true,
            sortOrder: 0,
          },
        ],
      }),
      ctx,
    )

    expect(mocks.txCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ isPreselected: false })],
    })
  })
})
