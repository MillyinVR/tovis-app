// app/t/[cardId]/page.tsx
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

type IntentType = 'CLAIM_CARD' | 'BOOK_PRO' | 'SALON_WHITE_LABEL'

function isUnclaimed(card: { claimedAt: Date | null; type: any }) {
  // If you add UNASSIGNED to your enum, include it here.
  return !card.claimedAt || card.type === 'UNASSIGNED'
}

function buildIntentFromCard(card: {
  type: any
  claimedAt: Date | null
  professionalId: string | null
  salonSlug: string | null
}) {
  // 1) If unclaimed, always go through claim/signup flow
  if (isUnclaimed(card)) {
    return {
      intentType: 'CLAIM_CARD' as const,
      payloadJson: {},
      nextUrl: '/signup', // signup UI should show role chooser when intentType=CLAIM_CARD
    }
  }

  // 2) Claimed cards behave by type
  if (card.type === 'PRO_BOOKING' && card.professionalId) {
    return {
      intentType: 'BOOK_PRO' as const,
      payloadJson: { professionalId: card.professionalId },
      nextUrl: `/professionals/${card.professionalId}`,
    }
  }

  if (card.type === 'SALON_WHITE_LABEL' && card.salonSlug) {
    return {
      intentType: 'SALON_WHITE_LABEL' as const,
      payloadJson: { salonSlug: card.salonSlug },
      nextUrl: `/signup?salon=${encodeURIComponent(card.salonSlug)}`,
    }
  }

  // 3) Anything else: treat as claim/signup (safer than silently forcing client)
  return {
    intentType: 'CLAIM_CARD' as const,
    payloadJson: {},
    nextUrl: '/signup',
  }
}

export default async function TapPage(props: {
  params: Promise<{ cardId: string }>
  searchParams?: Promise<Record<string, string>>
}) {
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

  // Always go through signup/login when unclaimed so we can claim atomically.
  if (!user) {
    redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)
  }

  // Logged-in user:
  // If card is unclaimed, still send to signup/claim UX (or a dedicated /claim page).
  if (isUnclaimed(card)) {
    redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)
  }

  redirect(`${nextUrl}${nextUrl.includes('?') ? '&' : '?'}ti=${encodeURIComponent(intent.id)}`)
}
