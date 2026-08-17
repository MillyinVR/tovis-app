// app/client/me/page.tsx
import { isNonEmptyString } from '@/lib/guards'
import { formatRoundedDollars } from '@/lib/money'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildWorkspaceOptions,
  workspaceCapabilityOf,
  type WorkspaceOption,
} from '@/lib/auth/workspaces'
import { formatInTimeZone } from '@/lib/time'
import { formatProfileSubtitle } from '@/lib/profiles/publicProfileFormatting'
import type { ProfessionType } from '@prisma/client'

import ClientMeDashboard from '../ClientMeDashboard'
import { loadClientMePage } from './_data/loadClientMePage'

export const dynamic = 'force-dynamic'

function formatMemberSince(value: unknown): string | null {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return null

  // Member-since label — not an appointment, so there's no booking tz. This is
  // a server component, so the prior no-tz Intl rendered in the server's zone
  // (UTC on Vercel); preserve that explicitly.
  const month = formatInTimeZone(date, 'UTC', { month: 'short' })
  const year = formatInTimeZone(date, 'UTC', { year: '2-digit' })

  return `${month} '${year}`
}

function buildHandle(email: string | null | undefined): string {
  const raw = email?.split('@')[0] ?? 'you'
  const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]/g, '')
  return normalized || 'you'
}

function buildDisplayName(params: {
  firstName: string | null | undefined
  email: string | null | undefined
}): string {
  const firstName = params.firstName?.trim()
  if (firstName) return firstName

  const emailPrefix = params.email?.split('@')[0]?.trim()
  if (emailPrefix) return emailPrefix

  return 'You'
}

function formatMoneyLabel(value: string | null | undefined): string | null {
  if (!value) return null

  return formatRoundedDollars(value)
}

function buildBoardHref(boardId: string): string {
  return `/client/boards/${encodeURIComponent(boardId)}`
}

function buildBoardPreviewImageUrls(board: {
  items: Array<{
    lookPost: {
      primaryMedia: {
        thumbUrl: string | null
        url: string | null
      } | null
    } | null
  }>
}): string[] {
  return board.items
    .map(
      (item) =>
        item.lookPost?.primaryMedia?.thumbUrl ??
        item.lookPost?.primaryMedia?.url ??
        null,
    )
    .filter(isNonEmptyString)
}

/**
 * "Manicurist · Brooklyn, NY".
 *
 * This used to join the RAW `professionType` enum, so the card read
 * "MANICURIST · Brooklyn, NY" — and iOS had copied the same hand-rolled join.
 * `formatProfileSubtitle` already existed and already mapped the enum; the
 * duplicate simply never got the mapping. It returns the neutral noun rather
 * than nothing when the type is missing, so the empty case is handled by the
 * location check below rather than by the label.
 */
function buildFollowingSubtitle(params: {
  professionType: ProfessionType | null
  location: string | null
}): string | null {
  if (!params.professionType && !isNonEmptyString(params.location)) return null
  return formatProfileSubtitle(params)
}

export default async function ClientMePage() {
  const data = await loadClientMePage()

  const currentUser = await getCurrentUser().catch(() => null)
  const workspaces: WorkspaceOption[] = currentUser
    ? buildWorkspaceOptions(workspaceCapabilityOf(currentUser), currentUser.role)
    : []

  const displayName = buildDisplayName({
    firstName: data.profile.firstName,
    email: data.user.email,
  })

  const handle = buildHandle(data.user.email)
  // Prefer the claimed public handle for display; fall back to the email-derived one.
  const displayHandle = data.profile.handle ?? handle
  const avatarUrl = data.profile.avatarUrl ?? null
  const memberSince = formatMemberSince(data.user.createdAt)

  const counts = {
    followers: data.counts.followers,
    boards: data.counts.boards,
    saved: data.counts.saved,
    booked: data.counts.booked,
  }

  const upcomingNotificationBooking = data.upcomingNotificationBooking
    ? {
        id: data.upcomingNotificationBooking.id,
        title: data.upcomingNotificationBooking.display.title,
        professionalId:
          data.upcomingNotificationBooking.professional?.id ?? null,
        professionalName: formatProfessionalPublicDisplayName(
          data.upcomingNotificationBooking.professional,
        ),
        scheduledFor: data.upcomingNotificationBooking.scheduledFor,
        timeZone: data.upcomingNotificationBooking.timeZone ?? null,
        totalLabel:
          formatMoneyLabel(data.upcomingNotificationBooking.checkout.totalAmount) ??
          formatMoneyLabel(data.upcomingNotificationBooking.subtotalSnapshot),
        heroImageUrl: data.upcomingNotificationHeroImageUrl,
      }
    : null

  const boards = data.boards.map((board) => ({
    id: board.id,
    name: board.name,
    itemCount: board.itemCount,
    href: buildBoardHref(board.id),
    previewImageUrls: buildBoardPreviewImageUrls(board),
    // The DTO has carried this all along; the card shape simply dropped it, so
    // a private board and a shared one were indistinguishable to their owner.
    visibility: board.visibility,
  }))

  const following = data.following.items.map((item) => ({
    id: item.professional.id,
    href: `/professionals/${encodeURIComponent(item.professional.id)}`,
    name: formatProfessionalPublicDisplayName(item.professional),
    handle: item.professional.handle ?? null,
    subtitle: buildFollowingSubtitle({
      professionType: item.professional.professionType,
      location: item.professional.location,
    }),
    avatarUrl: item.professional.avatarUrl ?? null,
  }))

  const history = data.history.map((item) => ({
    id: item.booking.id,
    href: `/client/bookings/${encodeURIComponent(item.booking.id)}?step=${
      item.label === 'UPCOMING' ? 'overview' : 'aftercare'
    }`,
    title: item.booking.display.title,
    label: item.label,
    heroImageUrl: item.heroImageUrl,
    // Completed visits can be turned into a shareable look.
    shareHref:
      item.kind === 'completed'
        ? `/client/looks/share/${encodeURIComponent(item.booking.id)}`
        : null,
    // The look this visit produced — carries the visibility switch that used to
    // live on the separate "Your looks" grid.
    look: item.look,
  }))

  return (
    <main className="h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] overflow-hidden">
      <ClientMeDashboard
        displayName={displayName}
        handle={displayHandle}
        avatarUrl={avatarUrl}
        memberSince={memberSince}
        counts={counts}
        upcomingNotificationBooking={upcomingNotificationBooking}
        boards={boards}
        following={following}
        history={history}
        publicProfile={{
          handle: data.profile.handle ?? null,
          isPublic: data.profile.isPublicProfile,
        }}
        standing={data.standing}
        activityHref="/client/activity"
        activityUnreadCount={data.activityUnreadCount}
        creator={data.creator}
        createBoardHref="/client/boards/new"
        workspaces={workspaces}
      />
    </main>
  )
}