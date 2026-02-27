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
  return !card.claimedAt || card.type === 'UNASSIGNED'
}

async function proBookingNextUrl(professionalId: string) {
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true, handleNormalized: true, isPremium: true },
  })

  if (!pro) return '/nfc/invalid'

  if (pro.isPremium && pro.handleNormalized) return `/p/${pro.handleNormalized}`
  return `/professionals/${pro.id}` // free + ugly + perfect
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
      professionalId: true,
      salonSlug: true,
    },
  })

  if (!card || !card.isActive) redirect('/nfc/invalid')

  const user = await getCurrentUser().catch(() => null)

  let derived: { intentType: IntentType; payloadJson: any; nextUrl: string }

  // 1) Unclaimed: go claim
  if (isUnclaimed(card)) {
    derived = { intentType: 'CLAIM_CARD', payloadJson: {}, nextUrl: '/signup' }
  } else if (card.type === 'PRO_BOOKING' && card.professionalId) {
    const nextUrl = await proBookingNextUrl(card.professionalId)
    derived = {
      intentType: 'BOOK_PRO',
      payloadJson: { professionalId: card.professionalId },
      nextUrl,
    }
  } else if (card.type === 'SALON_WHITE_LABEL' && card.salonSlug) {
    derived = {
      intentType: 'SALON_WHITE_LABEL',
      payloadJson: { salonSlug: card.salonSlug },
      nextUrl: `/signup?salon=${encodeURIComponent(card.salonSlug)}`,
    }
  } else {
    derived = { intentType: 'CLAIM_CARD', payloadJson: {}, nextUrl: '/signup' }
  }

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

  // If not logged in, always go through signup/login so we can claim/credit cleanly
  if (!user) redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)

  // Logged in but card unclaimed? still go claim
  if (isUnclaimed(card)) redirect(`/signup?ti=${encodeURIComponent(intent.id)}`)

  redirect(`${nextUrl}${nextUrl.includes('?') ? '&' : '?'}ti=${encodeURIComponent(intent.id)}`)
}