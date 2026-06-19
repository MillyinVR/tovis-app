// app/client/ClientMeDashboard.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Bell } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ClientLookRemix } from '@/lib/creator/creatorProfileStats'
import ToggleSwitch from '@/app/_components/ToggleSwitch'
import LogoutButton from './components/LogoutButton'
import WorkspaceSwitcher from '@/app/_components/WorkspaceSwitcher'
import type { WorkspaceOption } from '@/lib/auth/workspaces'

type MeTabKey = 'boards' | 'following' | 'history'

type Counts = {
  followers: number
  boards: number
  saved: number
  booked: number
}

type CreatorInfo = {
  isCreator: boolean
  savesOnYourLooks: number
  bookedFromYou: number
  remixes: ClientLookRemix[]
}

type UpcomingNotificationBooking = {
  id: string
  title: string
  professionalName: string | null
  scheduledFor: string
  timeZone: string | null
  totalLabel: string | null
} | null

type BoardCardItem = {
  id: string
  name: string
  itemCount: number
  href: string
  previewImageUrls: string[]
}

type FollowingItem = {
  id: string
  href: string
  name: string
  handle: string | null
  subtitle: string | null
  avatarUrl: string | null
}

type HistoryItem = {
  id: string
  href: string
  title: string
  label: string
  heroImageUrl: string | null
  // Set for completed visits → opens the Share-your-look capture sheet.
  shareHref?: string | null
}

type MyLook = {
  id: string
  name: string
  imageUrl: string | null
  isPublic: boolean
}

type PublicProfileInfo = {
  handle: string | null
  isPublic: boolean
}

type ClientMeDashboardProps = {
  displayName: string
  handle: string
  avatarUrl?: string | null
  memberSince?: string | null
  counts: Counts
  upcomingNotificationBooking: UpcomingNotificationBooking
  boards: BoardCardItem[]
  following: FollowingItem[]
  history: HistoryItem[]
  myLooks?: MyLook[]
  publicProfile?: PublicProfileInfo
  activityHref?: string
  activityUnreadCount?: number
  creator?: CreatorInfo
  createBoardHref?: string | null
  workspaces?: WorkspaceOption[]
}

function firstLetter(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized.slice(0, 1).toUpperCase() : 'Y'
}

function formatUpcomingDate(value: string, timeZone: string | null): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || undefined,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
      .format(date)
      .toUpperCase()
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
      .format(date)
      .toUpperCase()
  }
}

function formatUpcomingTime(value: string, timeZone: string | null): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || undefined,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function ProfileAvatar(props: {
  displayName: string
  avatarUrl?: string | null
  sizeClassName?: string
  textClassName?: string
}) {
  const {
    displayName,
    avatarUrl = null,
    sizeClassName = 'h-[86px] w-[86px]',
    textClassName = 'text-[34px]',
  } = props

  if (avatarUrl) {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-full border border-textPrimary/10 bg-bgSecondary',
          sizeClassName,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt={displayName}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'grid place-items-center rounded-full border border-textPrimary/10 bg-bgSecondary font-black text-textPrimary',
        sizeClassName,
        textClassName,
      )}
      aria-hidden="true"
    >
      {firstLetter(displayName)}
    </div>
  )
}

function Stat(props: { label: string; value: number }) {
  return (
    <div className="min-w-[54px]">
      <div className="text-[16px] font-black leading-none text-textPrimary">
        {props.value}
      </div>
      <div className="mt-1 text-[10px] font-bold tracking-[0.18em] text-textSecondary">
        {props.label}
      </div>
    </div>
  )
}

function SectionTabs(props: {
  value: MeTabKey
  onChange: (value: MeTabKey) => void
}) {
  const tabs: Array<{ key: MeTabKey; label: string }> = [
    { key: 'boards', label: 'BOARDS' },
    { key: 'following', label: 'FOLLOWING' },
    { key: 'history', label: 'HISTORY' },
  ]

  return (
    <div className="border-b border-textPrimary/10">
      <div className="flex items-center gap-7">
        {tabs.map((tab) => {
          const active = tab.key === props.value

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => props.onChange(tab.key)}
              className={cn(
                'relative pb-4 pt-1 text-[12px] font-black tracking-[0.08em] transition',
                active
                  ? 'text-textPrimary'
                  : 'text-textSecondary hover:text-textPrimary',
              )}
            >
              {tab.label}
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accentPrimary" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function UpcomingCard(props: {
  booking: NonNullable<UpcomingNotificationBooking>
}) {
  const { booking } = props

  return (
    <Link
      href={`/client/bookings/${encodeURIComponent(booking.id)}?step=overview`}
      className={cn(
        'block rounded-[24px] border border-accentPrimary/25 bg-accentPrimary/6 px-4 py-4 transition',
        'hover:border-accentPrimary/40 hover:bg-accentPrimary/10',
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] font-black tracking-[0.18em] text-accentPrimary">
        <span className="h-1.5 w-1.5 rounded-full bg-accentPrimary" />
        <span>UPCOMING</span>
        <span>·</span>
        <span>{formatUpcomingDate(booking.scheduledFor, booking.timeZone)}</span>
      </div>

      <div className="flex gap-3">
        <div className="h-[58px] w-[58px] shrink-0 rounded-[16px] border border-textPrimary/10 bg-bgSecondary" />

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-black text-textPrimary">
            {booking.title}
          </div>
          <div className="mt-1 text-[13px] text-textSecondary">
            {booking.professionalName ?? 'Professional'} ·{' '}
            {formatUpcomingTime(booking.scheduledFor, booking.timeZone)}
            {booking.totalLabel ? ` · ${booking.totalLabel}` : ''}
          </div>
        </div>
      </div>
    </Link>
  )
}

function PrototypeThumb(props: {
  title: string
  previewImageUrls: string[]
}) {
  const previews = props.previewImageUrls.slice(0, 4)

  if (previews.length === 0) {
    return (
      <div className="grid aspect-[1/1] place-items-center rounded-[22px] border border-textPrimary/10 bg-bgSecondary text-[12px] font-bold text-textSecondary">
        No preview
      </div>
    )
  }

  return (
    <div className="grid aspect-[1/1] grid-cols-2 gap-[1px] overflow-hidden rounded-[22px] border border-textPrimary/10 bg-bgSecondary">
      {previews.map((src, index) => (
        <div key={`${src}-${index}`} className="min-h-0 min-w-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={props.title}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      ))}

      {Array.from({ length: Math.max(0, 4 - previews.length) }).map((_, index) => (
        <div key={`empty-${index}`} className="bg-bgSecondary" aria-hidden="true" />
      ))}
    </div>
  )
}

function CreateBoardRow(props: { href: string }) {
  return (
    <Link
      href={props.href}
      className={cn(
        'flex min-h-[48px] items-center gap-3 rounded-[18px] border border-dashed border-textPrimary/10 px-4 transition',
        'text-textSecondary hover:border-textPrimary/20 hover:text-textPrimary',
      )}
    >
      <span className="text-[22px] leading-none">+</span>
      <span className="text-[13px] font-semibold">Create new board</span>
    </Link>
  )
}

function BoardCard(props: { board: BoardCardItem }) {
  const { board } = props

  return (
    <Link href={board.href} className="block">
      <PrototypeThumb
        title={board.name}
        previewImageUrls={board.previewImageUrls}
      />
      <div className="mt-3">
        <div className="truncate text-[14px] font-black text-textPrimary">
          {board.name}
        </div>
        <div className="mt-1 text-[11px] tracking-[0.12em] text-textSecondary">
          {board.itemCount} SAVED
        </div>
      </div>
    </Link>
  )
}

function FollowingCard(props: { item: FollowingItem }) {
  const { item } = props

  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-[22px] border border-textPrimary/10 px-3 py-3 transition hover:border-textPrimary/20"
    >
      <ProfileAvatar
        displayName={item.name}
        avatarUrl={item.avatarUrl}
        sizeClassName="h-14 w-14"
        textClassName="text-lg"
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-black text-textPrimary">
          {item.name}
        </div>
        {item.handle ? (
          <div className="mt-1 text-[12px] text-textSecondary">@{item.handle}</div>
        ) : null}
        {item.subtitle ? (
          <div className="mt-1 truncate text-[12px] text-textSecondary">
            {item.subtitle}
          </div>
        ) : null}
      </div>
    </Link>
  )
}

function HistoryCard(props: { item: HistoryItem }) {
  const { item } = props

  return (
    <div className="block">
      <Link href={item.href} className="block">
        <div className="overflow-hidden rounded-[24px] border border-textPrimary/10">
          <div className="aspect-[1.18/1] bg-bgSecondary">
            {item.heroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.heroImageUrl}
                alt={item.title}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="grid h-full place-items-center px-5 text-center">
                <div>
                  <div className="text-[11px] font-black tracking-[0.12em] text-textSecondary">
                    {item.label}
                  </div>
                  <div className="mt-2 text-[15px] font-black text-textPrimary">
                    {item.title}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="truncate text-[14px] font-black text-textPrimary">
            {item.title}
          </div>
          <div className="mt-1 text-[11px] tracking-[0.12em] text-textSecondary">
            {item.label}
          </div>
        </div>
      </Link>

      {item.shareHref ? (
        <Link
          href={item.shareHref}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accentPrimary/30 bg-accentPrimary/8 px-3 py-1.5 text-[12px] font-black text-accentPrimary transition hover:bg-accentPrimary/15"
        >
          <span aria-hidden="true">✦</span>
          Share your look
        </Link>
      ) : null}
    </div>
  )
}

function CreatorStat(props: { label: string; value: number; withBorder?: boolean }) {
  return (
    <div
      className={cn(
        'flex-1',
        props.withBorder ? 'border-l border-textPrimary/10 pl-3' : '',
      )}
    >
      <div className="text-[16px] font-black leading-none text-textPrimary">
        {props.value.toLocaleString()}
      </div>
      <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-textSecondary">
        {props.label}
      </div>
    </div>
  )
}

/**
 * Real-data creator metrics. The gamified influence tier / level / progress bar
 * from the design is intentionally omitted — it needs product-defined thresholds
 * (deferred). This card shows only numbers derived live from Prisma.
 */
function CreatorStatusCard(props: { creator: CreatorInfo }) {
  const { creator } = props
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-textPrimary/10 bg-bgSecondary p-[18px]">
      <div className="mb-3.5 flex items-center gap-2">
        <span aria-hidden="true" className="text-[13px] text-accentPrimary">
          ✦
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-textSecondary">
          Your influence
        </span>
      </div>
      <div className="flex gap-3 border-t border-textPrimary/10 pt-3.5">
        <CreatorStat label="Saves on your looks" value={creator.savesOnYourLooks} />
        <CreatorStat label="Booked from you" value={creator.bookedFromYou} withBorder />
      </div>
    </div>
  )
}

function formatRemixTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 35) return `${Math.floor(days / 7)}w ago`
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** "Your looks, remixed" — appointments others booked from this client's looks. */
function RemixesCard(props: { remixes: ClientLookRemix[] }) {
  const { remixes } = props
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-textPrimary/10 bg-bgSecondary p-[18px]">
      <div className="mb-1.5 flex items-center gap-2">
        <span aria-hidden="true" className="text-[13px] text-accentPrimary">
          ⟲
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-textSecondary">
          Your looks, remixed
        </span>
      </div>
      <p className="mb-1 text-[12.5px] leading-relaxed text-textSecondary">
        Appointments others booked, inspired by a look in your history.
      </p>
      <div className="flex flex-col">
        {remixes.map((remix, index) => (
          <div
            key={remix.id}
            className={cn(
              'flex items-center gap-3 py-3',
              index !== remixes.length - 1 ? 'border-b border-textPrimary/10' : '',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] leading-snug text-textPrimary">
                <span className="font-black">{remix.who}</span> booked your{' '}
                <span className="font-bold text-accentPrimary">
                  {remix.lookName}
                </span>
              </div>
              <div className="mt-0.5 text-[11.5px] text-textSecondary">
                with {remix.proName} · {formatRemixTime(remix.bookedAt)}
              </div>
            </div>
            <span
              aria-hidden="true"
              className="flex-none text-[10px] font-black uppercase tracking-[0.08em] text-accentPrimary"
            >
              +1 ✦
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MyLookCard(props: { look: MyLook }) {
  const [isPublic, setIsPublic] = useState(props.look.isPublic)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { look } = props

  async function toggle() {
    if (busy) return
    const next = !isPublic
    setBusy(true)
    setError(false)
    setIsPublic(next) // optimistic
    try {
      const res = await fetch(`/api/client/looks/${encodeURIComponent(look.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setIsPublic(!next) // revert
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="block">
      <div className="overflow-hidden rounded-[22px] border border-textPrimary/10">
        <div className="aspect-[1/1] bg-bgSecondary">
          {look.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={look.imageUrl}
              alt={look.name}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="grid h-full place-items-center px-4 text-center text-[13px] font-black text-textPrimary">
              {look.name}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black text-textPrimary">
            {look.name}
          </div>
          <div className="mt-0.5 text-[10px] font-bold tracking-[0.12em] text-textSecondary">
            {error ? 'COULDN’T SAVE' : isPublic ? 'PUBLIC' : 'PRIVATE'}
          </div>
        </div>
        <ToggleSwitch
          checked={isPublic}
          onChange={toggle}
          label={`Make ${look.name} ${isPublic ? 'private' : 'public'}`}
          size="sm"
          disabled={busy}
        />
      </div>
    </div>
  )
}

function EmptyState(props: {
  title: string
  body: string
  actionHref?: string | null
  actionLabel?: string
}) {
  return (
    <div className="mx-auto max-w-[640px] rounded-[24px] border border-textPrimary/10 px-4 py-8 text-center">
      <div className="text-[15px] font-black text-textPrimary">{props.title}</div>
      <div className="mt-2 text-[13px] text-textSecondary">{props.body}</div>

      {props.actionHref && props.actionLabel ? (
        <div className="mt-4">
          <Link
            href={props.actionHref}
            className="inline-flex min-h-11 items-center rounded-full border border-textPrimary/10 px-4 py-2 text-[12px] font-black text-textPrimary transition hover:border-textPrimary/20"
          >
            {props.actionLabel}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export default function ClientMeDashboard({
  displayName,
  handle,
  avatarUrl = null,
  memberSince = null,
  counts,
  upcomingNotificationBooking,
  boards,
  following,
  history,
  myLooks = [],
  publicProfile,
  activityHref,
  activityUnreadCount = 0,
  creator,
  createBoardHref = null,
  workspaces = [],
}: ClientMeDashboardProps) {
  const [tab, setTab] = useState<MeTabKey>('boards')

  const formattedHandle = useMemo(() => {
    const trimmed = handle.trim()
    return trimmed ? (trimmed.startsWith('@') ? trimmed : `@${trimmed}`) : '@you'
  }, [handle])

  return (
    <div className="h-full overflow-y-auto bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-[1040px] px-5 pb-28 pt-6 md:px-8 lg:px-10">
        <section>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-black tracking-[0.18em] text-textSecondary">
              {formattedHandle.toUpperCase()}
            </div>

            <div className="flex items-center gap-2">
              {activityHref ? (
                <Link
                  href={activityHref}
                  aria-label={
                    activityUnreadCount > 0
                      ? `Activity, ${activityUnreadCount} unread`
                      : 'Activity'
                  }
                  className="relative grid h-9 w-9 place-items-center rounded-full border border-textPrimary/10 bg-bgSecondary text-textPrimary transition hover:border-textPrimary/25"
                >
                  <Bell className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  {activityUnreadCount > 0 ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-accentPrimary px-1 text-[9px] font-black leading-none text-onAccent"
                      aria-hidden="true"
                    >
                      {activityUnreadCount > 9 ? '9+' : activityUnreadCount}
                    </span>
                  ) : null}
                </Link>
              ) : null}
              <WorkspaceSwitcher options={workspaces} />
              <LogoutButton />
            </div>
          </div>

          <div className="mt-5 flex items-start gap-4">
            <ProfileAvatar displayName={displayName} avatarUrl={avatarUrl} />

            <div className="min-w-0 flex-1 pt-1">
              <h1 className="truncate font-display text-[28px] font-semibold italic leading-none text-textPrimary">
                {displayName}
              </h1>

              {memberSince ? (
                <div className="mt-2 text-[14px] text-textSecondary">
                  joined {memberSince}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-end gap-x-7 gap-y-3">
                {/* FOLLOWERS only matters once the client is publicly followable. */}
                {publicProfile?.isPublic ? (
                  <Stat label="FOLLOWERS" value={counts.followers} />
                ) : null}
                <Stat label="BOARDS" value={counts.boards} />
                <Stat label="SAVED" value={counts.saved} />
                <Stat label="BOOKED" value={counts.booked} />
              </div>

              {publicProfile ? (
                <div className="mt-4">
                  {publicProfile.isPublic && publicProfile.handle ? (
                    <Link
                      href={`/u/${encodeURIComponent(publicProfile.handle)}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accentPrimary/30 bg-accentPrimary/8 px-3 py-1.5 text-[12px] font-black text-accentPrimary transition hover:bg-accentPrimary/15"
                    >
                      View public profile
                      <span aria-hidden="true">→</span>
                    </Link>
                  ) : (
                    <Link
                      href="/client/settings"
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-textPrimary/15 px-3 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-textPrimary/25"
                    >
                      Set up public profile
                    </Link>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {creator?.isCreator ? (
          <section className="mt-6 max-w-[640px]">
            <CreatorStatusCard creator={creator} />
          </section>
        ) : null}

        {upcomingNotificationBooking ? (
          <section className="mt-6 max-w-[640px]">
            <UpcomingCard booking={upcomingNotificationBooking} />
          </section>
        ) : null}

        {myLooks.length > 0 ? (
          <section className="mt-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[12px] font-black tracking-[0.08em] text-textPrimary">
                YOUR LOOKS
              </h2>
              <span className="text-[11px] tracking-[0.12em] text-textSecondary">
                {myLooks.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
              {myLooks.map((look) => (
                <MyLookCard key={look.id} look={look} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <SectionTabs value={tab} onChange={setTab} />
        </section>

        {tab === 'boards' ? (
          <section className="mt-4">
            {createBoardHref ? (
              <div className="mb-4">
                <CreateBoardRow href={createBoardHref} />
              </div>
            ) : null}

            {boards.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
                {boards.map((board) => (
                  <BoardCard key={board.id} board={board} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No boards yet"
                body="Save looks from the feed to start building boards."
                actionHref={createBoardHref}
                actionLabel="Create board"
              />
            )}
          </section>
        ) : null}

        {tab === 'following' ? (
          <section className="mt-5">
            {following.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {following.map((item) => (
                  <FollowingCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No follows yet"
                body="When you follow a pro, they’ll show up here."
              />
            )}
          </section>
        ) : null}

        {tab === 'history' ? (
          <section className="mt-5">
            {creator && creator.remixes.length > 0 ? (
              <div className="mb-5">
                <RemixesCard remixes={creator.remixes} />
              </div>
            ) : null}
            {history.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {history.map((item) => (
                  <HistoryCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No history yet"
                body="Your upcoming and past visits will appear here."
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}