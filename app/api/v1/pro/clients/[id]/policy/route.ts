// app/api/v1/pro/clients/[id]/policy/route.ts
//
// K16 — the pro's booking policy for ONE client. PUT replaces the whole policy;
// DELETE clears it (deleting the row, so "no policy" has exactly one
// representation rather than a row of falses that reads as something set).
//
// 🔴 This route REFUSES requirements the pro cannot back, rather than storing
// them and letting them quietly do nothing at booking time. A deposit switch on
// a pro with no deposit amount configured resolves to a $0 charge; a card-on-file
// switch while the save-card rail is dark asks a client to do something no client
// can do. Both are the same defect — an offered option that cannot be accepted —
// and a stored-but-inert switch is worse than a refusal because the pro believes
// it is protecting them ([[offered-option-must-be-an-accepted-write]]).
//
// The refusal lives HERE, at the write, not only in the UI: hiding a control
// leaves the claim one curl away, which is the correction K15 made for
// CLIENT_TOKEN ([[refuse-the-claim-not-just-the-control]]).
//
// Gated by the EXISTING technical-record flag, not a second one — the whole
// per-client record surface (notes, formulas, consent, and now policy) shares
// one kill switch.

import { OfferingPrepayScope, Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { prisma } from '@/lib/prisma'
import {
  describeCardOnFileRequirementBlocker,
  describeDepositRequirementBlocker,
  describePrepayRequirementBlocker,
  hasUsableDepositConfiguration,
} from '@/lib/proClientPolicy/policy'

export const dynamic = 'force-dynamic'

function pickBoolean(value: unknown): boolean {
  return value === true
}

/** `null` = no prepay requirement; an unknown string is a 400, never a silent null. */
function parsePrepayScope(
  value: unknown,
): { ok: true; value: OfferingPrepayScope | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }

  if (
    typeof value === 'string' &&
    (Object.values(OfferingPrepayScope) as string[]).includes(value)
  ) {
    return { ok: true, value: value as OfferingPrepayScope }
  }

  return { ok: false }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId)) {
      return jsonFail(404, 'Not found.')
    }

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)

    const requireDeposit = pickBoolean(body.requireDeposit)
    const requireCardOnFile = pickBoolean(body.requireCardOnFile)
    const blockSelfServeBooking = pickBoolean(body.blockSelfServeBooking)

    const prepay = parsePrepayScope(body.prepayScope)
    if (!prepay.ok) {
      return jsonFail(
        400,
        'prepayScope must be SERVICE_ONLY, ENTIRE_BOOKING, or null.',
      )
    }

    // Only load the pro's money configuration when a money switch is actually
    // being set — a pro closing self-serve booking should not be blocked by
    // their Stripe state.
    if (requireDeposit || prepay.value != null) {
      const settings = await prisma.professionalPaymentSettings.findUnique({
        where: { professionalId },
        select: {
          depositEnabled: true,
          depositType: true,
          depositFlatAmount: true,
          depositPercent: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      })

      const proStripeReady = Boolean(
        settings?.stripeChargesEnabled && settings?.stripePayoutsEnabled,
      )

      if (prepay.value != null) {
        const blocker = describePrepayRequirementBlocker({ proStripeReady })
        if (blocker) return jsonFail(409, blocker)
      }

      if (requireDeposit) {
        const blocker = describeDepositRequirementBlocker({
          proStripeReady,
          hasUsableDepositConfiguration: settings
            ? hasUsableDepositConfiguration({
                depositEnabled: settings.depositEnabled,
                depositType: settings.depositType,
                depositFlatAmountCents:
                  settings.depositFlatAmount == null
                    ? null
                    : Math.round(Number(settings.depositFlatAmount) * 100),
                depositPercent: settings.depositPercent ?? null,
              })
            : false,
        })
        if (blocker) return jsonFail(409, blocker)
      }
    }

    if (requireCardOnFile) {
      const blocker = describeCardOnFileRequirementBlocker({
        cardOnFileRailEnabled: noShowProtectionEnabled(),
      })
      if (blocker) return jsonFail(409, blocker)
    }

    // Nothing set = no policy. Delete rather than storing four falses, so
    // "a policy exists" and "a policy requires something" never disagree.
    if (
      !requireDeposit &&
      !requireCardOnFile &&
      !blockSelfServeBooking &&
      prepay.value == null
    ) {
      await prisma.proClientPolicy.deleteMany({
        where: { professionalId, clientId },
      })

      return jsonOk({ policy: null }, 200)
    }

    const data = {
      requireDeposit,
      prepayScope: prepay.value,
      requireCardOnFile,
      blockSelfServeBooking,
    } satisfies Prisma.ProClientPolicyUpdateInput

    const policy = await prisma.proClientPolicy.upsert({
      where: { professionalId_clientId: { professionalId, clientId } },
      create: { professionalId, clientId, ...data },
      update: data,
      select: {
        requireDeposit: true,
        prepayScope: true,
        requireCardOnFile: true,
        blockSelfServeBooking: true,
      },
    })

    return jsonOk({ policy }, 200)
  } catch (e) {
    console.error('PUT /api/v1/pro/clients/[id]/policy error', e)
    return jsonFail(500, 'Failed to update client policy.')
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId)) {
      return jsonFail(404, 'Not found.')
    }

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    await prisma.proClientPolicy.deleteMany({
      where: { professionalId, clientId },
    })

    return jsonOk({ policy: null }, 200)
  } catch (e) {
    console.error('DELETE /api/v1/pro/clients/[id]/policy error', e)
    return jsonFail(500, 'Failed to clear client policy.')
  }
}
