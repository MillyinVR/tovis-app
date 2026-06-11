// app/nfc/invalid/page.tsx
import { redirect } from 'next/navigation'
import { NfcCardType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function safeNextUrl(value: string | null): string | null {
  if (!value) return null

  const normalized = value.trim()

  if (!normalized) return null
  if (!normalized.startsWith('/')) return null
  if (normalized.startsWith('//')) return null

  return normalized
}

type IntentType =
  | 'SIGNUP_CLIENT'
  | 'SIGNUP_PRO'
  | 'BOOK_PRO'
  | 'SALON_WHITE_LABEL'

type NfcCardIntentSource = {
  type: NfcCardType
  professionalId: string | null
  tenant: { slug: string }
}

type BuiltTapIntent = {
  intentType: IntentType
  payloadJson: Prisma.InputJsonObject
  nextUrl: string
}

function buildIntentFromCard(card: NfcCardIntentSource): BuiltTapIntent {
  if (card.type === NfcCardType.PRO_BOOKING && card.professionalId) {
    return {
      intentType: 'BOOK_PRO',
      payloadJson: {
        professionalId: card.professionalId,
      },
      nextUrl: `/professionals/${card.professionalId}`,
    }
  }

  if (card.type === NfcCardType.CLIENT_REFERRAL) {
    return {
      intentType: 'SIGNUP_CLIENT',
      payloadJson: {},
      nextUrl: '/signup?role=CLIENT',
    }
  }

  if (card.type === NfcCardType.SALON_WHITE_LABEL) {
    return {
      intentType: 'SALON_WHITE_LABEL',
      payloadJson: {
        tenantSlug: card.tenant.slug,
      },
      nextUrl: `/signup?salon=${encodeURIComponent(card.tenant.slug)}`,
    }
  }

  return {
    intentType: 'SIGNUP_CLIENT',
    payloadJson: {},
    nextUrl: '/signup?role=CLIENT',
  }
}

export default async function TapPage(props: {
  params: Promise<{ cardId: string }>
  searchParams?: Promise<Record<string, string | undefined>>
}) {
  const { cardId } = await props.params
  const searchParams = (await props.searchParams) ?? {}
  const nextOverride = safeNextUrl(searchParams.next ?? null)

  const card = await prisma.nfcCard.findUnique({
    where: {
      id: cardId,
    },
    select: {
      id: true,
      type: true,
      isActive: true,
      claimedAt: true,
      claimedByUserId: true,
      professionalId: true,
      tenant: { select: { slug: true } },
    },
  })

  if (!card || !card.isActive) {
    redirect('/nfc/invalid')
  }

  const user = await getCurrentUser().catch(() => null)

  const derived = buildIntentFromCard(card)
  const nextUrl = nextOverride ?? derived.nextUrl

  const expiresAt = new Date(Date.now() + 1000 * 60 * 30)

  const intent = await prisma.tapIntent.create({
    data: {
      cardId: card.id,
      userId: user?.id ?? null,
      intentType: derived.intentType,
      payloadJson: {
        ...derived.payloadJson,
        nextUrl,
      },
      expiresAt,
    },
    select: {
      id: true,
    },
  })

  if (!user) {
    redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)
  }

  redirect(
    `${nextUrl}${nextUrl.includes('?') ? '&' : '?'}ti=${encodeURIComponent(
      intent.id,
    )}`,
  )
}