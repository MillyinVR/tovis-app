// app/nfc/invalid/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function safeNextUrl(v: string | null): string | null {
  if (!v) return null
  const s = v.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

type IntentType = 'SIGNUP_CLIENT' | 'SIGNUP_PRO' | 'BOOK_PRO' | 'SALON_WHITE_LABEL'

function buildIntentFromCard(card: { type: any; professionalId: string | null; salonSlug: string | null }) {
  // Decide what the tap “means”
  // Adjust these rules if you want different behavior
  if (card.type === 'PRO_BOOKING' && card.professionalId) {
    return {
      intentType: 'BOOK_PRO' as IntentType,
      payloadJson: { professionalId: card.professionalId },
      nextUrl: `/professionals/${card.professionalId}`,
    }
  }

  if (card.type === 'CLIENT_REFERRAL') {
    return {
      intentType: 'SIGNUP_CLIENT' as IntentType,
      payloadJson: {},
      nextUrl: `/signup?role=CLIENT`,
    }
  }

  if (card.type === 'SALON_WHITE_LABEL' && card.salonSlug) {
    return {
      intentType: 'SALON_WHITE_LABEL' as IntentType,
      payloadJson: { salonSlug: card.salonSlug },
      nextUrl: `/signup?salon=${encodeURIComponent(card.salonSlug)}`,
    }
  }

  // fallback
  return {
    intentType: 'SIGNUP_CLIENT' as IntentType,
    payloadJson: {},
    nextUrl: '/signup?role=CLIENT',
  }
}

export default async function TapPage(props: { params: Promise<{ cardId: string }>; searchParams?: Promise<Record<string, string>> }) {
  const { cardId } = await props.params
  const sp = (await props.searchParams) ?? {}
  const nextOverride = safeNextUrl(sp.next ?? null)

  const card = await prisma.nfcCard.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      type: true,
      isActive: true,
      claimedAt: true,
      claimedByUserId: true,
      professionalId: true,
      salonSlug: true,
    },
  })

  if (!card || !card.isActive) {
    redirect('/nfc/invalid')
  }

  const user = await getCurrentUser().catch(() => null)

  const derived = buildIntentFromCard(card)
  const nextUrl = nextOverride ?? derived.nextUrl

  // create short-lived TapIntent
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30) // 30 min
  const intent = await prisma.tapIntent.create({
    data: {
      cardId: card.id,
      userId: user?.id ?? null,
      intentType: derived.intentType,
      payloadJson: { ...derived.payloadJson, nextUrl },
      expiresAt,
    },
    select: { id: true },
  })

  // Logged in? We can send them straight to the destination and consume TI later too.
  // But simplest: always route through signup/login with ti, so consumption is consistent.
  if (!user) {
    redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)
  }

  // user exists: send to destination, still include ti so we can credit/claim if needed
  redirect(`${nextUrl}${nextUrl.includes('?') ? '&' : '?'}ti=${encodeURIComponent(intent.id)}`)
}
