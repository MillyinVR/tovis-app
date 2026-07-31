// app/api/v1/pro/clients/[id]/policy/route.test.ts
//
// K16 — the write route REFUSES requirements the pro cannot back.
//
// This lives in its own suite for the reason K15 recorded: the integration
// suite asserts database STATE, and a state assertion cannot fail when a ROUTE
// stops refusing. Storing an unbackable switch is not a crash — it is a pro
// who believes they are protected while the requirement resolves to nothing.
//
// The three refusals, each a distinct way to be unbackable:
//   * a deposit with no amount configured  → would ask for $0
//   * any money requirement without Stripe → the pro cannot receive it
//   * a card on file while the rail is dark → no client can save one
//
// RED-PROOF (RUN): delete the `describeDepositRequirementBlocker` check from
// the route → 2 failed | 8 passed. Test 3 ("refuses a deposit a pro has no
// amount for") AND test 4's deposit half both fail with "expected 200 to be
// 409", and the upsert lands the inert switch. Test 4 falls with it because
// that check is also the only thing refusing a DEPOSIT from a pro who cannot
// receive charges — the prepay blocker covers only the prepay branch.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DepositType, OfferingPrepayScope } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(
        JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
  )

  const jsonFail = vi.fn(
    (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const requirePro = vi.fn()
  const assertProCanViewClient = vi.fn()
  const isClientTechnicalRecordEnabled = vi.fn()

  const proClientPolicy = {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  }
  const professionalPaymentSettings = { findUnique: vi.fn() }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    assertProCanViewClient,
    isClientTechnicalRecordEnabled,
    prisma: { proClientPolicy, professionalPaymentSettings },
    proClientPolicy,
    professionalPaymentSettings,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )
  return {
    ...actual,
    jsonOk: mocks.jsonOk,
    jsonFail: mocks.jsonFail,
    requirePro: mocks.requirePro,
  }
})
vi.mock('@/lib/clientVisibility', () => ({
  assertProCanViewClient: mocks.assertProCanViewClient,
}))
vi.mock('@/lib/clients/technicalRecord', () => ({
  isClientTechnicalRecordEnabled: mocks.isClientTechnicalRecordEnabled,
}))

import { GET, PUT } from './route'

const PRO_ID = 'pro_1'
const CLIENT_ID = 'client_1'

function req(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/clients/client_1/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) }

/** A pro who can back everything: Stripe-ready with a usable flat deposit. */
function readyPro() {
  mocks.professionalPaymentSettings.findUnique.mockResolvedValue({
    depositEnabled: true,
    depositType: DepositType.FLAT,
    depositFlatAmount: 40,
    depositPercent: null,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ENABLE_NO_SHOW_PROTECTION

  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: PRO_ID })
  mocks.assertProCanViewClient.mockResolvedValue({ ok: true })
  mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
  mocks.proClientPolicy.upsert.mockResolvedValue({
    requireDeposit: true,
    prepayScope: null,
    requireCardOnFile: false,
    blockSelfServeBooking: false,
  })
  mocks.proClientPolicy.deleteMany.mockResolvedValue({ count: 1 })
  mocks.proClientPolicy.findUnique.mockResolvedValue(null)
  readyPro()
})

// ─── K17-web: the READ path ──────────────────────────────────────────────────
//
// K16 shipped four switches with no way to read them back except the chart
// page's own Prisma query, so the state could not reach a device at all. These
// tests pin the two things that make the read USABLE by a client that has to
// draw the control: what it returns, and what it must never substitute.

describe('GET /api/v1/pro/clients/[id]/policy', () => {
  function getReq(): Request {
    return new Request('http://localhost/api/v1/pro/clients/client_1/policy')
  }

  it('returns null when this pro has set nothing for this client', async () => {
    const res = await GET(getReq(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.policy).toBeNull()
    // "No policy" and "a policy requiring nothing" must not be the same answer.
    expect(body.policy).not.toEqual({})
  })

  it('returns the stored switches', async () => {
    mocks.proClientPolicy.findUnique.mockResolvedValue({
      requireDeposit: true,
      prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
      requireCardOnFile: false,
      blockSelfServeBooking: true,
    })

    const body = await (await GET(getReq(), ctx)).json()

    expect(body.policy).toEqual({
      requireDeposit: true,
      prepayScope: 'ENTIRE_BOOKING',
      requireCardOnFile: false,
      blockSelfServeBooking: true,
    })
  })

  // 🔴 The whole reason this route returns a raw row.
  //
  // `resolveProClientPolicy` zeroes `requiresCardOnFile` while the save-card
  // rail is dark. That is right at BOOKING time and wrong in a CONTROL: a pro
  // would open the form they just set and find the switch off, with nothing to
  // tell them why. The rail state travels separately so the client can disable
  // that one row instead of misreporting its value.
  //
  // RED-PROOF (RUN): swap the handler's `prisma.proClientPolicy.findUnique`
  // result through `resolveProClientPolicy({ policy, cardOnFileRailEnabled })`
  // and return its `requiresCardOnFile` → this test fails with
  // "expected false to be true".
  it('reports a stored card-on-file switch as SET even while the rail is dark', async () => {
    delete process.env.ENABLE_NO_SHOW_PROTECTION
    mocks.proClientPolicy.findUnique.mockResolvedValue({
      requireDeposit: false,
      prepayScope: null,
      requireCardOnFile: true,
      blockSelfServeBooking: false,
    })

    const body = await (await GET(getReq(), ctx)).json()

    expect(body.policy.requireCardOnFile).toBe(true)
    // ...and the capability says why the control must still be disabled.
    expect(body.cardOnFileRailEnabled).toBe(false)
  })

  it('reports the rail as available when the flag is on', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'

    const body = await (await GET(getReq(), ctx)).json()

    expect(body.cardOnFileRailEnabled).toBe(true)
  })

  // The kill switch reaches the READ too, not only the writers: a device that
  // can still fetch the policy would draw a control the PUT route 404s.
  it('404s when the technical-record gate is off, without querying', async () => {
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)

    const res = await GET(getReq(), ctx)

    expect(res.status).toBe(404)
    expect(mocks.proClientPolicy.findUnique).not.toHaveBeenCalled()
  })

  it('403s a pro who cannot view this client', async () => {
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })

    const res = await GET(getReq(), ctx)

    expect(res.status).toBe(403)
    expect(mocks.proClientPolicy.findUnique).not.toHaveBeenCalled()
  })

  it('scopes the read to the AUTHENTICATED pro, never the URL', async () => {
    await GET(getReq(), ctx)

    expect(mocks.proClientPolicy.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          professionalId_clientId: {
            professionalId: PRO_ID,
            clientId: CLIENT_ID,
          },
        },
      }),
    )
  })
})

describe('PUT /api/v1/pro/clients/[id]/policy', () => {
  it('1. 404s when the technical-record gate is off', async () => {
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)

    const res = await PUT(req({ blockSelfServeBooking: true }), ctx)

    expect(res.status).toBe(404)
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  it('2. stores a self-serve block without asking about money at all', async () => {
    const res = await PUT(req({ blockSelfServeBooking: true }), ctx)

    expect(res.status).toBe(200)
    // A pro closing online booking must not be gated on their Stripe state.
    expect(mocks.professionalPaymentSettings.findUnique).not.toHaveBeenCalled()
  })

  // 🔴 The $0 refusal.
  it('3. refuses a deposit a pro has no amount for', async () => {
    mocks.professionalPaymentSettings.findUnique.mockResolvedValue({
      depositEnabled: false,
      depositType: DepositType.FLAT,
      depositFlatAmount: 40,
      depositPercent: null,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    })

    const res = await PUT(req({ requireDeposit: true }), ctx)
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/\$0/)
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  it('4. refuses any money requirement from a pro who cannot receive charges', async () => {
    mocks.professionalPaymentSettings.findUnique.mockResolvedValue({
      depositEnabled: true,
      depositType: DepositType.FLAT,
      depositFlatAmount: 40,
      depositPercent: null,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    })

    const deposit = await PUT(req({ requireDeposit: true }), ctx)
    expect(deposit.status).toBe(409)

    const prepay = await PUT(
      req({ prepayScope: OfferingPrepayScope.ENTIRE_BOOKING }),
      ctx,
    )
    expect(prepay.status).toBe(409)

    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  // 🔴 The rail refusal — the pro cannot claim a requirement no client can meet.
  it('5. refuses a card-on-file requirement while the save-card rail is dark', async () => {
    delete process.env.ENABLE_NO_SHOW_PROTECTION

    const res = await PUT(req({ requireCardOnFile: true }), ctx)

    expect(res.status).toBe(409)
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  it('6. accepts a card-on-file requirement once the rail is live', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'

    const res = await PUT(req({ requireCardOnFile: true }), ctx)

    expect(res.status).toBe(200)
    expect(mocks.proClientPolicy.upsert).toHaveBeenCalled()
  })

  // Prepay sizes itself from the bill, so an unconfigured deposit is irrelevant
  // to it — the asymmetry, enforced at the control as well as at the resolver.
  it('7. allows prepay for a Stripe-ready pro with no deposit configured', async () => {
    mocks.professionalPaymentSettings.findUnique.mockResolvedValue({
      depositEnabled: false,
      depositType: DepositType.FLAT,
      depositFlatAmount: null,
      depositPercent: null,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    })

    const res = await PUT(
      req({ prepayScope: OfferingPrepayScope.ENTIRE_BOOKING }),
      ctx,
    )

    expect(res.status).toBe(200)
  })

  it('8. rejects an unknown prepay scope instead of silently storing null', async () => {
    const res = await PUT(req({ prepayScope: 'WHOLE_YEAR' }), ctx)

    expect(res.status).toBe(400)
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  // "No policy" has exactly ONE representation: no row. A row of four falses
  // would make "a policy exists" and "a policy requires something" disagree.
  it('9. deletes the row when every switch is cleared', async () => {
    const res = await PUT(
      req({
        requireDeposit: false,
        prepayScope: null,
        requireCardOnFile: false,
        blockSelfServeBooking: false,
      }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(mocks.proClientPolicy.deleteMany).toHaveBeenCalled()
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })

  it('10. refuses a client this pro cannot see', async () => {
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })

    const res = await PUT(req({ blockSelfServeBooking: true }), ctx)

    expect(res.status).toBe(403)
    expect(mocks.proClientPolicy.upsert).not.toHaveBeenCalled()
  })
})
