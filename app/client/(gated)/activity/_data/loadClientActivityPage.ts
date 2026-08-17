// app/client/(gated)/activity/_data/loadClientActivityPage.ts
import 'server-only'

import { redirect } from 'next/navigation'

import { NotificationEventKey } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  ACTIVITY_FEED_EVENT_KEYS,
  listClientActivity,
  type ClientActivityItem,
} from '@/lib/notifications/activityFeed'
import { getClientLookTrend } from '@/lib/clients/lookTrend'
import {
  findSpendableCheckoutBookingId,
  getClientCreditSummary,
  spendCreditHref,
} from '@/lib/credit/clientCredit'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { formatCents } from '@/lib/money'
import { DISPLAY_LOCALE } from '@/lib/locale'
import { COPY } from '@/lib/copy'

type CurrentUserResult = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<CurrentUserResult> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

function isAuthedClientUser(
  user: CurrentUserResult | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

/**
 * The "Your Lived-in blonde is trending" banner.
 *
 * Null whenever nothing of the client's actually moved this week — the whole
 * honest-signals rule for this surface lives in the ABSENCE of a
 * `ClientLookTrendStat` row (see lib/clients/lookTrend.ts), so there is no floor
 * re-implemented here to forget.
 *
 * `lookName` travels separately from `detail` on purpose: each client wraps the
 * name in its own "Your … is trending" headline, but the NUMBERS — the only part
 * that could disagree between platforms — are composed once, here.
 */
export type ClientActivityTrend = {
  lookPostId: string
  lookName: string
  imageUrl: string | null
  /** "+84 saves this week · top 3% in Brooklyn" — the city half only when real. */
  detail: string
  href: string
}

/**
 * The "You earned $7.50 credit · $30.00 banked total" banner.
 *
 * Null on a zero balance. A currency glyph over "$0.00 banked" is a bright
 * promise about nothing, which is the `incentiveLabel` bug wearing a new icon.
 */
export type ClientActivityCredit = {
  /** "$7.50" — the most recent mint. */
  earnedLabel: string
  /** "@jade booked your Lived-in blonde" — PII-safe, handles only. */
  earnedDetail: string
  /** "$30.00" — spendable balance. */
  balanceLabel: string
  /** Where "Use" goes. Null when there is no open checkout to spend it on. */
  useHref: string | null
}

export type ClientActivityPageData = {
  items: ClientActivityItem[]
  unreadCount: number
  /** The event keys "Mark all read" should clear (the activity allowlist). */
  markReadEventKeys: NotificationEventKey[]
  trend: ClientActivityTrend | null
  credit: ClientActivityCredit | null
}

async function loadTrendBanner(
  clientId: string,
): Promise<ClientActivityTrend | null> {
  const trend = await getClientLookTrend(prisma, clientId)
  if (!trend) return null

  // Scoped to a look this client authored — the stat row's `clientId` is the
  // author — so reading it by id here is not a cross-tenant discovery read.
  const look = await prisma.lookPost.findFirst({
    where: { id: trend.lookPostId, clientAuthorId: clientId },
    select: {
      caption: true,
      primaryMediaAsset: {
        select: {
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          url: true,
          thumbUrl: true,
        },
      },
    },
  })

  // The job replaced the table an instant before the look was removed. Nothing
  // to name and nothing to link — say nothing.
  if (!look) return null

  const { renderUrl, renderThumbUrl } = await renderMediaUrls(
    look.primaryMediaAsset,
  )

  // Each half only when it is real: the delta always is (a row exists only
  // because it cleared the floor); the city clause is dropped whenever the
  // scorer declined to rank the city, rather than padded with a placeholder.
  const detail = [
    `+${trend.weeklySaves.toLocaleString(DISPLAY_LOCALE)} ${
      trend.weeklySaves === 1
        ? COPY.clientActivity.trendSaveOne
        : COPY.clientActivity.trendSaves
    } ${COPY.clientActivity.trendThisWeek}`,
    trend.topPercent !== null && trend.city
      ? `${COPY.publicProfile.topPercentPrefix} ${trend.topPercent}% ${COPY.clientActivity.trendInCity} ${trend.city}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    lookPostId: trend.lookPostId,
    lookName: lookNameFromCaption(look.caption, COPY.clientActivity.trendFallbackLookName),
    imageUrl: renderThumbUrl ?? renderUrl,
    detail,
    href: `/looks/${encodeURIComponent(trend.lookPostId)}`,
  }
}

async function loadCreditBanner(
  clientId: string,
): Promise<ClientActivityCredit | null> {
  const summary = await getClientCreditSummary(prisma, clientId)
  if (!summary?.latestEarned) return null

  const { latestEarned } = summary
  const lookName = latestEarned.lookName
    ? lookNameFromCaption(latestEarned.lookName, COPY.clientActivity.trendFallbackLookName)
    : null

  // Same PII rule as every activity row: a booker is named only when they are
  // publicly addressable, and never by legal name. This is the answer to the
  // designer's open "who is named to whom" — the rest of this surface already
  // gives it.
  const who = latestEarned.bookerHandle
    ? `@${latestEarned.bookerHandle}`
    : COPY.clientActivity.creditSomeone

  return {
    earnedLabel: formatCents(latestEarned.amountCents),
    earnedDetail: lookName
      ? `${who} ${COPY.clientActivity.creditBookedYour} ${lookName}`
      : `${who} ${COPY.clientActivity.creditBookedOneOfYourLooks}`,
    balanceLabel: formatCents(summary.balanceCents),
    useHref: await findSpendableCheckoutBookingId(prisma, clientId).then((id) =>
      id ? spendCreditHref(id) : null,
    ),
  }
}

export async function loadClientActivityPage(): Promise<ClientActivityPageData> {
  // The (gated) layout already enforces an active, verified CLIENT session; this
  // is a belt-and-suspenders guard matching the Me-page loader.
  const user = await getCurrentUser().catch(() => null)
  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/activity')
  }

  const clientId = user.clientProfile.id

  const [feed, trend, credit] = await Promise.all([
    listClientActivity(prisma, { clientId }),
    loadTrendBanner(clientId),
    loadCreditBanner(clientId),
  ])

  return {
    items: feed.items,
    unreadCount: feed.unreadCount,
    markReadEventKeys: [...ACTIVITY_FEED_EVENT_KEYS],
    trend,
    credit,
  }
}
