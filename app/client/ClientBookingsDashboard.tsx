// app/client/ClientBookingsDashboard.tsx
'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

type MeTab = 'boards' | 'following' | 'history'

type ClientMeCounts = {
  boards: number
  saved: number
  booked: number
}

type ClientMeUpcomingBooking = {
  id: string
  title: string
  professionalName: string | null
  scheduledFor: string
  timeZone: string | null
  totalLabel: string | null
}

type ClientMeBoard = {
  id: string
  name: string
  itemCount: number
  href: string
  previewImageUrls: string[]
}

type ClientMeFollowingItem = {
  id: string
  href: string
  name: string
  handle: string | null
  subtitle: string | null
  avatarUrl: string | null
}

type ClientMeHistoryItem = {
  id: string
  href: string
  title: string
  label: 'BOOKED' | 'UPCOMING'
  heroImageUrl: string | null
}

type ClientMeDashboardProps = {
  displayName: string
  handle: string
  avatarUrl?: string | null
  memberSince?: string | null
  counts?: ClientMeCounts
  upcomingNotificationBooking?: ClientMeUpcomingBooking | null
  boards?: ClientMeBoard[]
  following?: ClientMeFollowingItem[]
  history?: ClientMeHistoryItem[]
  createBoardHref?: string | null
}

const ME_TABS: MeTab[] = ['boards', 'following', 'history']

const EMPTY_COUNTS: ClientMeCounts = {
  boards: 0,
  saved: 0,
  booked: 0,
}

function firstChar(value: string): string {
  return value.trim().charAt(0).toUpperCase()
}

function formatUpcomingDate(scheduledFor: string, timeZone: string | null): string {
  const date = new Date(scheduledFor)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || 'UTC',
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

function formatUpcomingTime(scheduledFor: string, timeZone: string | null): string {
  const date = new Date(scheduledFor)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(date)
      .toLowerCase()
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(date)
      .toLowerCase()
  }
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function HeroThumb(props: { title: string; subtitle?: string | null }) {
  const primary = firstChar(props.title)
  const secondary = firstChar(props.subtitle || '') || primary

  return (
    <div className="relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgPrimary">
      <div className="absolute inset-0 opacity-70 [background:radial-gradient(60px_60px_at_20%_20%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(80px_80px_at_80%_70%,rgba(255,255,255,0.06),transparent_55%)]" />
      <div className="absolute inset-0 bg-surfaceGlass/30" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-baseline gap-1">
          <span className="text-[20px] font-black tracking-tight text-textPrimary">
            {primary}
          </span>
          <span className="text-[13px] font-black tracking-tight text-textSecondary">
            {secondary}
          </span>
        </div>
      </div>
    </div>
  )
}

function BoardMosaic(props: { previewImageUrls: string[]; name: string }) {
  const cells = useMemo(
    () => [0, 1, 2, 3].map((index) => props.previewImageUrls[index] ?? null),
    [props.previewImageUrls],
  )

  return (
    <div className="grid aspect-square grid-cols-2 gap-0.5 overflow-hidden rounded-card bg-bgSecondary">
      {cells.map((imageUrl, index) => (
        <div
          key={`${props.name}-${index}`}
          className="relative overflow-hidden bg-gradient-to-br from-bgSurface to-bgPrimary"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%,rgba(255,255,255,0.03))]" />
          )}
        </div>
      ))}
    </div>
  )
}

function FollowingAvatar(props: { name: string; avatarUrl: string | null }) {
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt={props.name}
        className="h-12 w-12 rounded-full border border-white/10 object-cover"
      />
    )
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-bgSurface to-bgSecondary">
      <span className="font-display text-[18px] font-semibold italic text-accentPrimary">
        {props.name.charAt(0).toUpperCase()}
      </span>
    </div>
  )
}

export default function ClientMeDashboard({
  displayName,
  handle,
  avatarUrl = null,
  memberSince = null,
  counts = EMPTY_COUNTS,
  upcomingNotificationBooking = null,
  boards = [],
  following = [],
  history = [],
  createBoardHref = null,
}: ClientMeDashboardProps) {
  const [meTab, setMeTab] = useState<MeTab>('boards')

  const handleShare = useCallback(async () => {
    const url = globalThis.location.href

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: `${displayName} on TOVIS`,
          url,
        })
        return
      }
    } catch {
      // fall through to clipboard copy
    }

    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // ignore clipboard failures for now
    }
  }, [displayName])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="looksNoScrollbar flex-1 overflow-y-auto">
        <div className="px-5 pb-5 pt-12">
          <div className="mb-5 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-widest text-textMuted">
              @{handle}
            </span>

            <button
              type="button"
              aria-label="Share profile"
              onClick={() => void handleShare()}
              className="text-textMuted transition hover:text-textSecondary"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bgSecondary">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-bgSurface to-bgSecondary">
                  <span className="font-display italic text-[28px] font-semibold leading-none text-accentPrimary">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="font-display italic text-[26px] font-semibold leading-tight tracking-tight text-textPrimary">
                {displayName}
              </div>

              {memberSince ? (
                <div className="mt-1 text-[12px] text-textSecondary">
                  Joined {memberSince}
                </div>
              ) : null}

              <div className="mt-3 flex gap-[18px]">
                {[
                  { label: 'BOARDS', value: String(counts.boards) },
                  { label: 'SAVED', value: String(counts.saved) },
                  { label: 'BOOKED', value: String(counts.booked) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-[16px] font-bold text-textPrimary">
                      {value}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-textMuted">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {upcomingNotificationBooking ? (
          <Link
            href={`/client/bookings/${encodeURIComponent(upcomingNotificationBooking.id)}?step=overview`}
            className={cn(
              'mx-5 mb-5 block w-[calc(100%-2.5rem)] rounded-card border border-accentPrimary/25',
              'bg-accentPrimary/5 p-3.5 text-left transition hover:border-accentPrimary/40 hover:bg-accentPrimary/10',
            )}
            aria-label={`Open upcoming appointment: ${upcomingNotificationBooking.title}`}
          >
            <div className="mb-2 font-mono text-[9px] uppercase tracking-widest text-accentPrimaryHover">
              ◆ Upcoming ·{' '}
              {formatUpcomingDate(
                upcomingNotificationBooking.scheduledFor,
                upcomingNotificationBooking.timeZone,
              )}
            </div>

            <div className="flex items-center gap-3">
              <HeroThumb
                title={upcomingNotificationBooking.title}
                subtitle={upcomingNotificationBooking.professionalName}
              />

              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-textPrimary">
                  {upcomingNotificationBooking.title}
                </div>

                <div className="mt-0.5 truncate text-[12px] text-textSecondary">
                  {[
                    upcomingNotificationBooking.professionalName,
                    formatUpcomingTime(
                      upcomingNotificationBooking.scheduledFor,
                      upcomingNotificationBooking.timeZone,
                    ),
                    upcomingNotificationBooking.totalLabel,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          </Link>
        ) : null}

        <div className="flex gap-6 border-b border-white/10 px-5">
          {ME_TABS.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setMeTab(tabKey)}
              className={cn(
                '-mb-px pb-3 pt-1 text-[13px] font-bold capitalize transition',
                meTab === tabKey
                  ? 'border-b-2 border-[rgb(var(--accent-primary))] text-textPrimary'
                  : 'border-b-2 border-transparent text-textMuted hover:text-textSecondary',
              )}
            >
              {tabKey}
            </button>
          ))}
        </div>

        <div className="px-5 pb-24 pt-4">
          {meTab === 'boards' ? (
            <div>
              {createBoardHref ? (
                <Link
                  href={createBoardHref}
                  className="mb-3 flex w-full items-center gap-2 rounded-card border border-dashed border-white/[0.16] p-3.5 text-[13px] text-textMuted transition hover:border-white/25 hover:text-textSecondary"
                >
                  <span className="text-[18px] leading-none">+</span>
                  Create new board
                </Link>
              ) : (
                <div className="mb-3 flex w-full items-center gap-2 rounded-card border border-dashed border-white/[0.16] p-3.5 text-[13px] text-textMuted/70">
                  <span className="text-[18px] leading-none">+</span>
                  Create new board
                </div>
              )}

              {boards.length === 0 ? (
                <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
                  Save looks to boards from the feed.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {boards.map((board) => (
                    <Link key={board.id} href={board.href} className="block">
                      <BoardMosaic
                        previewImageUrls={board.previewImageUrls}
                        name={board.name}
                      />
                      <div className="mt-2.5 text-[15px] font-bold text-textPrimary">
                        {board.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-textMuted">
                        {countLabel(board.itemCount, 'saved', 'saved')}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {meTab === 'following' ? (
            following.length === 0 ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
                Pros you follow will appear here.{' '}
                <span className="font-semibold text-textSecondary">
                  Discover them on the Looks feed.
                </span>
              </div>
            ) : (
              <div className="grid gap-3">
                {following.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-3 rounded-card border border-white/10 bg-bgSecondary p-3 transition hover:border-white/20"
                  >
                    <FollowingAvatar
                      name={item.name}
                      avatarUrl={item.avatarUrl}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-textPrimary">
                        {item.name}
                      </div>

                      <div className="mt-0.5 truncate text-[12px] text-textSecondary">
                        {[item.handle ? `@${item.handle}` : null, item.subtitle]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : null}

          {meTab === 'history' ? (
            history.length === 0 ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
                No history yet — your completed bookings will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {history.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="relative overflow-hidden bg-bgSecondary"
                    style={{ aspectRatio: '3 / 4' }}
                  >
                    {item.heroImageUrl ? (
                      <img
                        src={item.heroImageUrl}
                        alt={item.title}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-bgSurface to-bgPrimary" />
                    )}

                    <div className="absolute inset-0 bg-black/10" />

                    {!item.heroImageUrl ? (
                      <div className="absolute inset-0 grid place-items-center">
                        <span className="font-display italic text-[36px] font-semibold text-textMuted/30">
                          {item.title.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    ) : null}

                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bgPrimary/90 to-transparent" />
                    <div className="absolute bottom-1.5 left-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-textPrimary">
                      {item.label}
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}