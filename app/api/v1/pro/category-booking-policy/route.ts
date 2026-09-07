// app/api/v1/pro/category-booking-policy/route.ts
//
// P7a-5 — the pro's per-service-category settings: when clients can book, and
// what deposit that category asks for.
//
// GET returns one row per category the pro actually SELLS IN (derived from her
// own offerings), each carrying her setting or the inherited default. That
// shape is deliberate: the settings screen must not offer a pro a control over
// a category she does not work in, and it must not make her hunt for the ones
// she does.
//
// PATCH upserts exactly one category. PARTIAL by `hasOwnProperty`, following
// `PATCH /pro/offerings/[id]`, and NOT the whole-object replace that
// `/pro/payment-settings` performs — a replace that does not echo a field wipes
// it, and this object is small enough that a client sending only the field it
// changed is the normal case.
//
// 🔴 The deposit amount is REFUSED, not silently dropped, when the account
// switch is off or Stripe is not ready (`describeCategoryDepositBlocker`). A
// stored amount that can never produce a charge is a registered policy with no
// call site — the exact shape of the K10-A bug — and the pro would have every
// reason to believe she had set something.

import { Prisma, ProCategoryBookingGate } from '@prisma/client'
import type { DepositType } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { describeCategoryDepositBlocker } from '@/lib/booking/categoryDeposit'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function pickGate(v: unknown): ProCategoryBookingGate | undefined {
  if (typeof v !== 'string') return undefined
  const n = v.trim().toUpperCase()
  if (n === 'INSTANT') return ProCategoryBookingGate.INSTANT
  if (n === 'AFTER_PREP') return ProCategoryBookingGate.AFTER_PREP
  return undefined
}

/** `null` clears the override; `undefined` is "not sent"; a bad value is an error. */
function pickDepositType(v: unknown): DepositType | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  const n = v.trim().toUpperCase()
  if (n === 'FLAT') return 'FLAT'
  if (n === 'PERCENT') return 'PERCENT'
  return undefined
}

/** A positive money amount in dollars as a 2-dp Decimal, or null. */
function pickFlatAmount(v: unknown): Prisma.Decimal | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return new Prisma.Decimal(n.toFixed(2))
}

/** An integer percent in [1, 100], or null. */
function pickPercent(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i >= 1 && i <= 100 ? i : null
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    // The categories this pro sells in, from her own menu. `distinct` on the
    // category rather than a category table scan: a pro who offers colour and
    // cutting should see two rows, not the platform's whole taxonomy.
    const [offerings, policies, paymentSettings] = await Promise.all([
      prisma.professionalServiceOffering.findMany({
        where: { professionalId },
        select: {
          service: {
            select: { categoryId: true, category: { select: { name: true } } },
          },
        },
      }),
      prisma.proCategoryBookingPolicy.findMany({
        where: { professionalId },
        select: {
          serviceCategoryId: true,
          bookingGate: true,
          depositType: true,
          depositFlatAmount: true,
          depositPercent: true,
        },
      }),
      prisma.professionalPaymentSettings.findUnique({
        where: { professionalId },
        select: {
          depositEnabled: true,
          depositType: true,
          depositFlatAmount: true,
          depositPercent: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      }),
    ])

    const byCategory = new Map(policies.map((p) => [p.serviceCategoryId, p]))
    const seen = new Map<string, string>()
    for (const offering of offerings) {
      seen.set(offering.service.categoryId, offering.service.category.name)
    }

    const categories = [...seen.entries()]
      .map(([id, name]) => {
        const policy = byCategory.get(id) ?? null
        return {
          serviceCategoryId: id,
          categoryName: name,
          bookingGate: policy?.bookingGate ?? ProCategoryBookingGate.INSTANT,
          depositType: policy?.depositType ?? null,
          depositFlatAmount: policy?.depositFlatAmount?.toString() ?? null,
          depositPercent: policy?.depositPercent ?? null,
        }
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName))

    const stripeReady = Boolean(
      paymentSettings?.stripeChargesEnabled && paymentSettings?.stripePayoutsEnabled,
    )

    return jsonOk(
      {
        ok: true,
        categories,
        // What a category inherits when it states nothing of its own — so the
        // screen can SHOW the fallback ("Your usual $40") rather than an empty
        // field the pro has to remember the meaning of.
        accountDeposit: {
          depositEnabled: paymentSettings?.depositEnabled ?? false,
          depositType: paymentSettings?.depositType ?? null,
          depositFlatAmount: paymentSettings?.depositFlatAmount?.toString() ?? null,
          depositPercent: paymentSettings?.depositPercent ?? null,
          stripeReady,
        },
        depositBlocker: describeCategoryDepositBlocker({
          accountDepositEnabled: paymentSettings?.depositEnabled ?? false,
          proStripeReady: stripeReady,
        }),
      },
      200,
    )
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/category-booking-policy error', e)
    return jsonFail(500, 'Failed to load your category settings.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = (await req
      .json()
      .catch(() => ({}))) as Record<string, unknown>

    const serviceCategoryId =
      typeof body.serviceCategoryId === 'string' ? body.serviceCategoryId.trim() : ''
    if (!serviceCategoryId) {
      return jsonFail(400, 'Pick a service category.')
    }

    // 🔴 The pro must actually sell in this category. Without this, a hand-made
    // request could create policy rows for the entire platform taxonomy — rows
    // that are harmless today but become live money configuration the moment
    // she adds a service in one of them.
    const sellsHere = await prisma.professionalServiceOffering.findFirst({
      where: { professionalId, service: { categoryId: serviceCategoryId } },
      select: { id: true },
    })
    if (!sellsHere) {
      return jsonFail(404, 'You don’t offer any services in that category.')
    }

    // A PLAIN field bag, not `…UncheckedUpdateInput`: Prisma's update types
    // allow `{ set: … }` operation objects, which the create branch cannot
    // take, and the compiler says so. One shape that both branches accept is
    // the honest fix — casting the create branch would have hidden a real
    // difference between the two.
    const data: {
      bookingGate?: ProCategoryBookingGate
      depositType?: DepositType | null
      depositFlatAmount?: Prisma.Decimal | null
      depositPercent?: number | null
    } = {}

    if (has(body, 'bookingGate')) {
      const gate = pickGate(body.bookingGate)
      if (!gate) return jsonFail(400, 'bookingGate must be INSTANT or AFTER_PREP.')
      data.bookingGate = gate
    }

    if (has(body, 'depositType')) {
      const type = pickDepositType(body.depositType)
      if (type === undefined) {
        return jsonFail(400, 'depositType must be FLAT, PERCENT, or null.')
      }

      if (type === null) {
        // Clearing the override also clears both amounts — leaving a stale
        // figure beside a null type is two columns encoding one fact, and the
        // pair can disagree.
        data.depositType = null
        data.depositFlatAmount = null
        data.depositPercent = null
      } else {
        const settings = await prisma.professionalPaymentSettings.findUnique({
          where: { professionalId },
          select: {
            depositEnabled: true,
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
          },
        })
        const blocker = describeCategoryDepositBlocker({
          accountDepositEnabled: settings?.depositEnabled ?? false,
          proStripeReady: Boolean(
            settings?.stripeChargesEnabled && settings?.stripePayoutsEnabled,
          ),
        })
        if (blocker) return jsonFail(409, blocker)

        if (type === 'FLAT') {
          const amount = pickFlatAmount(body.depositFlatAmount)
          if (!amount) {
            return jsonFail(400, 'Enter a deposit amount greater than $0.')
          }
          data.depositType = 'FLAT'
          data.depositFlatAmount = amount
          data.depositPercent = null
        } else {
          const percent = pickPercent(body.depositPercent)
          if (percent == null) {
            return jsonFail(400, 'Enter a deposit percent between 1 and 100.')
          }
          data.depositType = 'PERCENT'
          data.depositPercent = percent
          data.depositFlatAmount = null
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return jsonFail(400, 'Nothing to update.')
    }

    const policy = await prisma.proCategoryBookingPolicy.upsert({
      where: {
        professionalId_serviceCategoryId: { professionalId, serviceCategoryId },
      },
      // The create branch takes the same fields; anything not sent falls to the
      // column default (INSTANT) or to null, which is the inherit-the-account
      // behaviour a pro who has never touched this already has.
      create: { professionalId, serviceCategoryId, ...data },
      update: data,
      select: {
        serviceCategoryId: true,
        bookingGate: true,
        depositType: true,
        depositFlatAmount: true,
        depositPercent: true,
      },
    })

    return jsonOk(
      {
        ok: true,
        policy: {
          ...policy,
          depositFlatAmount: policy.depositFlatAmount?.toString() ?? null,
        },
      },
      200,
    )
  } catch (e: unknown) {
    console.error('PATCH /api/v1/pro/category-booking-policy error', e)
    return jsonFail(500, 'Failed to save your category settings.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
