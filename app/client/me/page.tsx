// app/client/me/page.tsx
import ClientMeDashboard from '../ClientMeDashboard'
import { loadClientMePage } from './_data/loadClientMePage'

export const dynamic = 'force-dynamic'

function formatMemberSince(value: unknown): string | null {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return null

  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const year = date.getFullYear().toString().slice(-2)

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

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null

  return `$${Math.round(parsed)}`
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

function buildFollowingSubtitle(params: {
  professionType: string | null
  location: string | null
}): string | null {
  const parts = [params.professionType, params.location].filter(isNonEmptyString)
  return parts.length > 0 ? parts.join(' · ') : null
}

export default async function ClientMePage() {
  const data = await loadClientMePage()

  const displayName = buildDisplayName({
    firstName: data.profile.firstName,
    email: data.user.email,
  })

  const handle = buildHandle(data.user.email)
  const avatarUrl = data.profile.avatarUrl ?? null
  const memberSince = formatMemberSince(data.user.createdAt)

  const counts = {
    boards: data.counts.boards,
    saved: data.counts.saved,
    booked: data.counts.booked,
  }

  const upcomingNotificationBooking = data.upcomingNotificationBooking
    ? {
        id: data.upcomingNotificationBooking.id,
        title: data.upcomingNotificationBooking.display.title,
        professionalName:
          data.upcomingNotificationBooking.professional?.businessName ?? null,
        scheduledFor: data.upcomingNotificationBooking.scheduledFor,
        timeZone: data.upcomingNotificationBooking.timeZone ?? null,
        totalLabel:
          formatMoneyLabel(data.upcomingNotificationBooking.checkout.totalAmount) ??
          formatMoneyLabel(data.upcomingNotificationBooking.subtotalSnapshot),
      }
    : null

  const boards = data.boards.map((board) => ({
    id: board.id,
    name: board.name,
    itemCount: board.itemCount,
    href: buildBoardHref(board.id),
    previewImageUrls: buildBoardPreviewImageUrls(board),
  }))

  const following = data.following.items.map((item) => ({
    id: item.professional.id,
    href: `/professionals/${encodeURIComponent(item.professional.id)}`,
    name: item.professional.businessName?.trim() || 'Professional',
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
    heroImageUrl: null,
  }))

  return (
    <main className="h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] overflow-hidden">
      <ClientMeDashboard
        displayName={displayName}
        handle={handle}
        avatarUrl={avatarUrl}
        memberSince={memberSince}
        counts={counts}
        upcomingNotificationBooking={upcomingNotificationBooking}
        boards={boards}
        following={following}
        history={history}
        createBoardHref="/client/boards/new"
      />
    </main>
  )
}