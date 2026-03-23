// app/api/pro/payment-settings/route.ts

// app/api/pro/payment-settings/route.ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type PaymentCollectionTiming = 'AT_BOOKING' | 'AFTER_SERVICE'

type TipSuggestion = {
  label: string
  percent: number
}

function pickBooleanOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickStringOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  return v
}

function pickTrimmedStringOrNullOrUndefined(
  v: unknown,
): string | null | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed ? trimmed : null
}

function normalizeCollectPaymentAt(
  v: unknown,
): PaymentCollectionTiming | undefined {
  if (typeof v !== 'string') return undefined
  const normalized = v.trim().toUpperCase()
  if (normalized === 'AT_BOOKING') return 'AT_BOOKING'
  if (normalized === 'AFTER_SERVICE') return 'AFTER_SERVICE'
  return undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeTipSuggestions(v: unknown): TipSuggestion[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return undefined

  const out: TipSuggestion[] = []

  for (const row of v) {
    if (!isRecord(row)) continue

    const rawLabel = row.label
    const rawPercent = row.percent

    if (typeof rawLabel !== 'string') continue
    if (typeof rawPercent !== 'number' || !Number.isFinite(rawPercent)) continue

    const label = rawLabel.trim()
    const percent = Math.trunc(rawPercent)

    if (!label) continue
    if (percent < 0 || percent > 100) continue

    out.push({ label, percent })
  }

  return out
}

function validateBusinessRules(args: {
  acceptCash: boolean
  acceptCardOnFile: boolean
  acceptTapToPay: boolean
  acceptVenmo: boolean
  acceptZelle: boolean
  acceptAppleCash: boolean
  venmoHandle: string | null
  zelleHandle: string | null
  appleCashHandle: string | null
  tipsEnabled: boolean
  allowCustomTip: boolean
  tipSuggestions: TipSuggestion[]
}): string | null {
  const enabledMethods = [
    args.acceptCash,
    args.acceptCardOnFile,
    args.acceptTapToPay,
    args.acceptVenmo,
    args.acceptZelle,
    args.acceptAppleCash,
  ].filter(Boolean).length

  if (enabledMethods <= 0) {
    return 'Enable at least one accepted payment method.'
  }

  if (args.acceptVenmo && !args.venmoHandle) {
    return 'Add a Venmo handle or turn Venmo off.'
  }

  if (args.acceptZelle && !args.zelleHandle) {
    return 'Add a Zelle contact or turn Zelle off.'
  }

  if (args.acceptAppleCash && !args.appleCashHandle) {
    return 'Add an Apple Cash contact or turn Apple Cash off.'
  }

  if (!args.tipsEnabled && args.allowCustomTip) {
    return 'Custom tip cannot be enabled when tips are turned off.'
  }

  if (args.tipsEnabled && args.tipSuggestions.length <= 0 && !args.allowCustomTip) {
    return 'Add at least one tip option or allow custom tip.'
  }

  return null
}

function prismaErrorToResponse(e: unknown) {
  if (e instanceof Prisma.PrismaClientValidationError) {
    return jsonFail(400, 'Invalid payment settings payload.', {
      detail: e.message,
    })
  }

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return jsonFail(400, 'Database rejected the payment settings update.', {
      code: e.code,
      detail: e.message,
    })
  }

  return null
}

const paymentSettingsSelect = {
  professionalId: true,
  collectPaymentAt: true,

  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,

  tipsEnabled: true,
  allowCustomTip: true,
  tipSuggestions: true,

  venmoHandle: true,
  zelleHandle: true,
  appleCashHandle: true,
  paymentNote: true,

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const settings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId },
      select: paymentSettingsSelect,
    })

    return jsonOk(
      {
        ok: true,
        paymentSettings: settings,
      },
      200,
    )
  } catch (e: unknown) {
    console.error('GET /api/pro/payment-settings error', e)
    return jsonFail(500, 'Failed to load payment settings.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const body = await req.json().catch(() => ({} as Record<string, unknown>))

    const collectPaymentAt =
      normalizeCollectPaymentAt(body.collectPaymentAt) ?? 'AFTER_SERVICE'

    const acceptCash = pickBooleanOrUndefined(body.acceptCash) ?? false
    const acceptCardOnFile =
      pickBooleanOrUndefined(body.acceptCardOnFile) ?? false
    const acceptTapToPay = pickBooleanOrUndefined(body.acceptTapToPay) ?? false
    const acceptVenmo = pickBooleanOrUndefined(body.acceptVenmo) ?? false
    const acceptZelle = pickBooleanOrUndefined(body.acceptZelle) ?? false
    const acceptAppleCash =
      pickBooleanOrUndefined(body.acceptAppleCash) ?? false

    const tipsEnabled = pickBooleanOrUndefined(body.tipsEnabled) ?? true
    const allowCustomTip = pickBooleanOrUndefined(body.allowCustomTip) ?? true

    const tipSuggestions = normalizeTipSuggestions(body.tipSuggestions) ?? []

    const venmoHandle = acceptVenmo
      ? pickTrimmedStringOrNullOrUndefined(body.venmoHandle) ?? null
      : null

    const zelleHandle = acceptZelle
      ? pickTrimmedStringOrNullOrUndefined(body.zelleHandle) ?? null
      : null

    const appleCashHandle = acceptAppleCash
      ? pickTrimmedStringOrNullOrUndefined(body.appleCashHandle) ?? null
      : null

    const paymentNote =
      pickTrimmedStringOrNullOrUndefined(body.paymentNote) ?? null

    const businessRuleError = validateBusinessRules({
      acceptCash,
      acceptCardOnFile,
      acceptTapToPay,
      acceptVenmo,
      acceptZelle,
      acceptAppleCash,
      venmoHandle,
      zelleHandle,
      appleCashHandle,
      tipsEnabled,
      allowCustomTip,
      tipSuggestions,
    })

    if (businessRuleError) {
      return jsonFail(400, businessRuleError)
    }

    const data: Prisma.ProfessionalPaymentSettingsUncheckedCreateInput = {
      professionalId,
      collectPaymentAt,
      acceptCash,
      acceptCardOnFile,
      acceptTapToPay,
      acceptVenmo,
      acceptZelle,
      acceptAppleCash,
      tipsEnabled,
      allowCustomTip,
      tipSuggestions: tipSuggestions as Prisma.InputJsonValue,
      venmoHandle,
      zelleHandle,
      appleCashHandle,
      paymentNote,
    }

    try {
      const updated = await prisma.professionalPaymentSettings.upsert({
        where: { professionalId },
        create: data,
        update: {
          collectPaymentAt,
          acceptCash,
          acceptCardOnFile,
          acceptTapToPay,
          acceptVenmo,
          acceptZelle,
          acceptAppleCash,
          tipsEnabled,
          allowCustomTip,
          tipSuggestions: tipSuggestions as Prisma.InputJsonValue,
          venmoHandle,
          zelleHandle,
          appleCashHandle,
          paymentNote,
        },
        select: paymentSettingsSelect,
      })

      return jsonOk(
        {
          ok: true,
          paymentSettings: updated,
        },
        200,
      )
    } catch (e: unknown) {
      const res = prismaErrorToResponse(e)
      if (res) return res

      console.error('PATCH /api/pro/payment-settings prisma error', e)
      return jsonFail(500, 'Failed to update payment settings.', {
        message: e instanceof Error ? e.message : String(e),
      })
    }
  } catch (e: unknown) {
    console.error('PATCH /api/pro/payment-settings error', e)
    return jsonFail(500, 'Failed to update payment settings.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}