// app/client/ClientMeDashboard.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

type MeTabKey = 'boards' | 'following' | 'history'

type Counts = {
  boards: number
  saved: number
  booked: number
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
  createBoardHref?: string | null
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
          'overflow-hidden rounded-full border border-white/10 bg-bgSecondary',
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
        'grid place-items-center rounded-full border border-white/10 bg-bgSecondary font-black text-textPrimary',
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
    <div className="border-b border-white/10">
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
        'block rounded-[24px] border border-[#3a2418] bg-[rgba(20,12,9,0.9)] px-4 py-4 transition',
        'hover:border-[#5a3523] hover:bg-[rgba(24,15,11,0.95)]',
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] font-black tracking-[0.18em] text-accentPrimary">
        <span className="h-1.5 w-1.5 rounded-full bg-accentPrimary" />
        <span>UPCOMING</span>
        <span>·</span>
        <span>{formatUpcomingDate(booking.scheduledFor, booking.timeZone)}</span>
      </div>

      <div className="flex gap-3">
        <div className="h-[58px] w-[58px] shrink-0 rounded-[16px] border border-white/10 bg-bgSecondary" />

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
      <div className="grid aspect-[1/1] place-items-center rounded-[22px] border border-white/10 bg-bgSecondary text-[12px] font-bold text-textSecondary">
        No preview
      </div>
    )
  }

  return (
    <div className="grid aspect-[1/1] grid-cols-2 gap-[1px] overflow-hidden rounded-[22px] border border-white/10 bg-bgSecondary">
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
        'flex min-h-[48px] items-center gap-3 rounded-[18px] border border-dashed border-white/10 px-4 transition',
        'text-textSecondary hover:border-white/20 hover:text-textPrimary',
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
      className="flex items-center gap-3 rounded-[22px] border border-white/10 px-3 py-3 transition hover:border-white/20"
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
    <Link href={item.href} className="block">
      <div className="overflow-hidden rounded-[24px] border border-white/10">
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
  )
}

function EmptyState(props: {
  title: string
  body: string
  actionHref?: string | null
  actionLabel?: string
}) {
  return (
    <div className="rounded-[24px] border border-white/10 px-4 py-8 text-center">
      <div className="text-[15px] font-black text-textPrimary">{props.title}</div>
      <div className="mt-2 text-[13px] text-textSecondary">{props.body}</div>

      {props.actionHref && props.actionLabel ? (
        <div className="mt-4">
          <Link
            href={props.actionHref}
            className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-4 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/20"
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
  createBoardHref = null,
}: ClientMeDashboardProps) {
  const [tab, setTab] = useState<MeTabKey>('boards')

  const formattedHandle = useMemo(() => {
    const trimmed = handle.trim()
    return trimmed ? (trimmed.startsWith('@') ? trimmed : `@${trimmed}`) : '@you'
  }, [handle])

  return (
    <div className="h-full overflow-y-auto bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-[430px] px-4 pb-28 pt-6">
        <section>
          <div className="text-[11px] font-black tracking-[0.18em] text-textSecondary">
            {formattedHandle.toUpperCase()}
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

              <div className="mt-5 flex items-end gap-7">
                <Stat label="BOARDS" value={counts.boards} />
                <Stat label="SAVED" value={counts.saved} />
                <Stat label="BOOKED" value={counts.booked} />
              </div>
            </div>
          </div>
        </section>

        {upcomingNotificationBooking ? (
          <section className="mt-6">
            <UpcomingCard booking={upcomingNotificationBooking} />
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
              <div className="grid grid-cols-2 gap-x-4 gap-y-6">
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
              <div className="grid gap-3">
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
            {history.length > 0 ? (
              <div className="grid grid-cols-1 gap-5">
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