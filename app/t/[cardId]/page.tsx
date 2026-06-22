// app/t/[cardId]/page.tsx
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { NfcCardType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { safeNextUrl } from '@/lib/security/safeNextUrl'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { isNonInteractiveTapRequest } from '@/lib/nfc/tapRequest'
import { isNfcTapWithinRateLimit } from '@/lib/nfc/tapRateLimit'
import { recordNfcCardTappedEvent } from '@/lib/nfc/attributionEvents'
import { checkProReadinessForEntryPoint } from '@/lib/pro/readiness/proReadiness'

type IntentType = 'CLAIM_CARD' | 'BOOK_PRO' | 'SALON_WHITE_LABEL'

type TapCard = {
  id: string
  type: NfcCardType
  isActive: boolean
  claimedAt: Date | null
  professionalId: string | null
  tenant: { slug: string }
}

// Resolved routing for a tap. `anonymousRedirect` is where an unauthenticated
// tapper goes (a signup/booking surface); `postAuthNextUrl` is the destination
// stored in the intent payload for an authenticated/claimed tapper (null → let
// consumeTapIntent pick a role-based home). `status: 'unavailable'` means the
// card points at a pro who can't currently be booked.
type TapRouting =
  | { status: 'unavailable' }
  | {
      status: 'ok'
      intentType: IntentType
      payloadJson: Prisma.InputJsonObject
      postAuthNextUrl: string | null
      anonymousRedirect: string
    }

function isUnclaimed(card: Pick<TapCard, 'claimedAt' | 'type'>): boolean {
  return !card.claimedAt || card.type === NfcCardType.UNASSIGNED
}

async function resolveProBooking(
  professionalId: string,
): Promise<{ ok: true; proUrl: string } | { ok: false }> {
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true, handleNormalized: true, isPremium: true },
  })

  if (!pro) return { ok: false }

  // Reuse the canonical bookability evaluator. NFC is an intentional booking
  // entry point, so a pending-but-otherwise-ready pro is allowed, but rejected /
  // not-yet-configured / license-expired pros are not.
  const readiness = await checkProReadinessForEntryPoint({
    professionalId,
    entryPoint: 'NFC_CARD',
  })

  if (!readiness.ok) return { ok: false }

  const proUrl =
    pro.isPremium && pro.handleNormalized
      ? `/p/${pro.handleNormalized}`
      : `/professionals/${pro.id}`

  return { ok: true, proUrl }
}

async function buildTapRouting(card: TapCard): Promise<TapRouting> {
  if (isUnclaimed(card)) {
    return {
      status: 'ok',
      intentType: 'CLAIM_CARD',
      payloadJson: {},
      postAuthNextUrl: null,
      anonymousRedirect: '/signup',
    }
  }

  if (card.type === NfcCardType.PRO_BOOKING && card.professionalId) {
    const booking = await resolveProBooking(card.professionalId)
    if (!booking.ok) return { status: 'unavailable' }

    return {
      status: 'ok',
      intentType: 'BOOK_PRO',
      payloadJson: { professionalId: card.professionalId },
      postAuthNextUrl: booking.proUrl,
      anonymousRedirect: booking.proUrl,
    }
  }

  if (card.type === NfcCardType.SALON_WHITE_LABEL) {
    return {
      status: 'ok',
      intentType: 'SALON_WHITE_LABEL',
      payloadJson: { tenantSlug: card.tenant.slug },
      postAuthNextUrl: null,
      anonymousRedirect: `/signup?salon=${encodeURIComponent(card.tenant.slug)}`,
    }
  }

  // Claimed CLIENT_REFERRAL (or any other claimed state): route to signup so a
  // new tapper creates an account; consumeTapIntent records the referral.
  return {
    status: 'ok',
    intentType: 'CLAIM_CARD',
    payloadJson: {},
    postAuthNextUrl: null,
    anonymousRedirect: '/signup',
  }
}

export default async function TapPage(props: {
  params: Promise<{ cardId: string }>
  searchParams?: Promise<Record<string, string | undefined>>
}) {
  const { cardId } = await props.params
  const searchParams = (await props.searchParams) ?? {}
  const nextOverride = safeNextUrl(searchParams.next ?? null)

  // Abuse guard first — applies to every request (any user agent) so card-id
  // probing is always rate-limited. Fails open if the limiter is unavailable.
  if (!(await isNfcTapWithinRateLimit('nfc:tap'))) {
    redirect('/nfc/invalid?reason=rate')
  }

  const card = await prisma.nfcCard.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      type: true,
      isActive: true,
      claimedAt: true,
      professionalId: true,
      tenant: { select: { slug: true } },
    },
  })

  if (!card || !card.isActive) {
    redirect('/nfc/invalid')
  }

  const routing = await buildTapRouting(card)

  if (routing.status === 'unavailable') {
    redirect('/nfc/invalid?reason=unavailable')
  }

  const postAuthNextUrl = nextOverride ?? routing.postAuthNextUrl
  const anonymousRedirect = routing.anonymousRedirect

  // Link unfurlers, link previews, prefetchers, crawlers: respond (redirect) but
  // do NOT mint a TapIntent or count a tap — they're machines, not a human tap.
  const headerBag = await headers()
  if (isNonInteractiveTapRequest(headerBag)) {
    redirect(anonymousRedirect)
  }

  const user = await getCurrentUser().catch(() => null)

  const expiresAt = new Date(Date.now() + 1000 * 60 * 30)

  const intent = await prisma.tapIntent.create({
    data: {
      cardId: card.id,
      userId: user?.id ?? null,
      intentType: routing.intentType,
      payloadJson: postAuthNextUrl
        ? { ...routing.payloadJson, nextUrl: postAuthNextUrl }
        : routing.payloadJson,
      expiresAt,
    },
    select: {
      id: true,
    },
  })

  // Funnel top — best-effort, never blocks the redirect.
  await recordNfcCardTappedEvent({
    db: prisma,
    cardId: card.id,
    actorUserId: user?.id ?? null,
    meta: { tapIntentId: intent.id, intentType: routing.intentType },
  })

  if (!user) {
    const sep = anonymousRedirect.includes('?') ? '&' : '?'
    redirect(`${anonymousRedirect}${sep}ti=${encodeURIComponent(intent.id)}`)
  }

  // Authenticated tapper: consume now so the claim / referral / attribution all
  // happen even though there's no fresh login or register round-trip to trigger
  // consumeTapIntent. Without this, taps by already-signed-in users (the common
  // case in the PWA) silently drop their referral credit.
  const consumed = await consumeTapIntent({
    tapIntentId: intent.id,
    userId: user.id,
  })

  redirect(consumed.nextUrl ?? postAuthNextUrl ?? anonymousRedirect)
}
