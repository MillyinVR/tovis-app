// app/client/bookings/[id]/_data/loadProfessionalPaymentSettings.ts
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

const professionalPaymentSettingsSelect = {
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
} satisfies Prisma.ProfessionalPaymentSettingsSelect

export type ClientVisibleProfessionalPaymentSettings =
  Prisma.ProfessionalPaymentSettingsGetPayload<{
    select: typeof professionalPaymentSettingsSelect
  }>

function normalizePublicHandle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePaymentNote(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function loadProfessionalPaymentSettings(args: {
  professionalId: string
}): Promise<ClientVisibleProfessionalPaymentSettings | null> {
  const professionalId = args.professionalId.trim()
  if (!professionalId) return null

  const settings = await prisma.professionalPaymentSettings.findUnique({
    where: { professionalId },
    select: professionalPaymentSettingsSelect,
  })

  if (!settings) return null

  return {
    ...settings,
    venmoHandle: normalizePublicHandle(settings.venmoHandle),
    zelleHandle: normalizePublicHandle(settings.zelleHandle),
    appleCashHandle: normalizePublicHandle(settings.appleCashHandle),
    paymentNote: normalizePaymentNote(settings.paymentNote),
  }
}