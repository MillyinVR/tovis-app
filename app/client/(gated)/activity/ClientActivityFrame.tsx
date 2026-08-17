// app/client/(gated)/activity/ClientActivityFrame.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bookmark,
  Camera,
  CircleDollarSign,
  Flame,
  Heart,
  MessageCircle,
  Repeat2,
  Sparkles,
  Trophy,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

import EmptyState from '@/app/_components/boundaries/EmptyState'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { COPY } from '@/lib/copy'
import { formatRelativeTimeAgo } from '@/lib/time'

import ClientMarkAllReadButton from '../_components/ClientMarkAllReadButton'
import ClientPage from '../_components/ClientPage'

import type {
  ClientActivityCredit,
  ClientActivityTrend,
} from './_data/loadClientActivityPage'
import type {
  ActivityIconKind,
  ClientActivityItem,
} from '@/lib/notifications/activityFeed'

/**
 * How the feed is presented.
 *
 * - `page` — the standalone `/client/activity` route, reached by deep link, a
 *   notification tap, or anyone landing on the URL directly. Keeps the full
 *   ClientPage chrome, which is the only way OUT of a non-tab client page on web.
 * - `sheet` — the overview the Me bell opens: a scrim + panel over the page you
 *   came from, dismissed with Done.
 *
 * Tori (2026-08-17): *"the pop up and done buttons on the iOS version so it
 * feels like its an overview not a full page"*. iOS already presents
 * `ClientActivityView` as a sheet; this is the web half of that parity.
 *
 * Both share ONE component, so the optimistic mark-all-read has one
 * implementation and the two presentations cannot drift.
 */
export type ClientActivityPresentation = 'page' | 'sheet'

type ClientActivityFrameProps = {
  items: ClientActivityItem[]
  unreadCount: number
  markReadEventKeys: string[]
  /**
   * The trending banner. Null is the ordinary case: a client whose looks did not
   * actually move this week sees nothing here, never "+0 saves this week".
   */
  trend?: ClientActivityTrend | null
  /** The credit banner. Null on a zero balance — never "$0.00 banked". */
  credit?: ClientActivityCredit | null
  presentation?: ClientActivityPresentation
  /** Dismisses the sheet. Required for `sheet`, ignored for `page`. */
  onDone?: () => void
}

const ICONS: Record<
  ActivityIconKind,
  { Icon: LucideIcon; tint: string; bg: string }
> = {
  follow: { Icon: UserPlus, tint: 'text-toneInfo', bg: 'bg-toneInfo/15' },
  comment: {
    Icon: MessageCircle,
    tint: 'text-accentPrimary',
    bg: 'bg-accentPrimary/15',
  },
  like: { Icon: Heart, tint: 'text-toneDanger', bg: 'bg-toneDanger/15' },
  save: { Icon: Bookmark, tint: 'text-toneWarn', bg: 'bg-toneWarn/15' },
  'new-look': {
    Icon: Camera,
    tint: 'text-accentPrimary',
    bg: 'bg-accentPrimary/15',
  },
  remix: { Icon: Repeat2, tint: 'text-accentPrimary', bg: 'bg-accentPrimary/15' },
  featured: { Icon: Sparkles, tint: 'text-toneInfo', bg: 'bg-toneInfo/15' },
  milestone: { Icon: Trophy, tint: 'text-toneWarn', bg: 'bg-toneWarn/15' },
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function readFollowing(payload: unknown): boolean | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('following' in payload)) return null
  const value = (payload as Record<string, unknown>).following
  return typeof value === 'boolean' ? value : null
}

function ActivityIcon({ kind }: { kind: ActivityIconKind }) {
  const { Icon, tint, bg } = ICONS[kind]
  return (
    <div
      className={`grid h-[42px] w-[42px] flex-none place-items-center rounded-[12px] ${bg}`}
      aria-hidden="true"
    >
      <Icon className={`h-[18px] w-[18px] ${tint}`} strokeWidth={2.2} />
    </div>
  )
}

function FollowBackButton({ handle }: { handle: string }) {
  const [following, setFollowing] = useState(false)
  const [loading, setLoading] = useState(false)

  const toggle = useCallback(async () => {
    if (loading) return
    const next = !following
    setLoading(true)
    setFollowing(next)
    try {
      const response = await fetch(
        `/api/v1/client/follow/${encodeURIComponent(handle)}`,
        { method: 'POST', headers: { Accept: 'application/json' } },
      )
      const payload = await readJsonSafely(response)
      if (!response.ok) throw new Error('failed')
      const server = readFollowing(payload)
      if (server !== null) setFollowing(server)
    } catch {
      setFollowing(!next) // roll back
    } finally {
      setLoading(false)
    }
  }, [following, handle, loading])

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={following}
      className={[
        'flex-none rounded-full px-3.5 py-2 text-[11.5px] font-bold transition brand-focus',
        following
          ? 'border border-textPrimary/15 bg-bgSecondary text-textPrimary hover:border-textPrimary/30'
          : 'bg-accentPrimary text-onAccent hover:opacity-90',
        loading ? 'cursor-wait opacity-75' : 'cursor-pointer',
      ].join(' ')}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

/**
 * "Your Lived-in blonde is trending · +84 saves this week · top 3% in Brooklyn".
 *
 * Every number in `detail` is composed server-side from a `ClientLookTrendStat`
 * row (lib/clients/lookTrend.ts), so the two platforms cannot word the same
 * momentum differently — and the row only exists because the look cleared a real
 * floor, which is why this component has no "is it worth showing?" branch of its
 * own. The city half is simply absent from `detail` when the scorer declined to
 * rank the city.
 */
function TrendBanner({ trend }: { trend: ClientActivityTrend }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-[18px] border border-accentPrimary/30 bg-accentPrimary/8 px-4 py-3.5">
      <div className="grid h-[42px] w-[42px] flex-none place-items-center overflow-hidden rounded-[12px] bg-accentPrimary/15">
        {trend.imageUrl ? (
          <RemoteImage
            src={trend.imageUrl}
            alt={trend.lookName}
            className="h-full w-full object-cover"
            loading="lazy"
            width={84}
            height={84}
          />
        ) : (
          <Flame
            className="h-[18px] w-[18px] text-accentPrimary"
            strokeWidth={2.2}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold leading-snug text-textPrimary">
          {COPY.clientActivity.trendHeadlinePrefix}{' '}
          <span className="text-accentPrimary">{trend.lookName}</span>{' '}
          {COPY.clientActivity.trendHeadlineSuffix}
        </div>
        <div className="mt-0.5 text-[12.5px] text-textSecondary">
          {trend.detail}
        </div>
      </div>

      <Link
        href={trend.href}
        className="brand-focus flex-none rounded-full bg-accentPrimary px-3.5 py-2 text-[11.5px] font-bold text-onAccent transition hover:opacity-90"
      >
        {COPY.clientActivity.trendCta}
      </Link>
    </div>
  )
}

/**
 * "You earned $7.50 credit · @jade booked your Lived-in blonde · $30.00 banked
 * total".
 *
 * The booker is named only when they are publicly addressable — the same PII
 * rule every row above follows, and the answer to the question the design's own
 * §7 left open.
 *
 * The "Use" pill renders ONLY when there is an open checkout to spend the
 * balance on. An affordance that says "Use" and leads to nothing to use it on is
 * a dead end, and an unspent balance is a perfectly ordinary steady state:
 * redemption is a manual per-booking choice, so nothing here nags.
 */
function CreditBanner({ credit }: { credit: ClientActivityCredit }) {
  return (
    <div className="mb-5 flex items-center gap-3 rounded-[16px] border border-toneWarn/30 bg-toneWarn/8 px-4 py-3.5">
      <div
        className="grid h-10 w-10 flex-none place-items-center rounded-full bg-toneWarn/15"
        aria-hidden="true"
      >
        <CircleDollarSign className="h-[19px] w-[19px] text-toneWarn" strokeWidth={2.2} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold leading-snug text-textPrimary">
          {COPY.clientActivity.creditHeadlinePrefix}{' '}
          <span className="text-toneWarn">{credit.earnedLabel}</span>{' '}
          {COPY.clientActivity.creditHeadlineSuffix}
        </div>
        <div className="mt-0.5 text-[12.5px] text-textSecondary">
          {credit.earnedDetail} · {credit.balanceLabel}{' '}
          {COPY.clientActivity.creditBankedSuffix}
        </div>
      </div>

      {credit.useHref ? (
        <Link
          href={credit.useHref}
          className="brand-focus flex-none rounded-full border border-textPrimary/15 px-3 py-1.5 text-[11.5px] font-bold text-textSecondary transition hover:border-textPrimary/30 hover:text-textPrimary"
        >
          {COPY.clientActivity.creditCta}
        </Link>
      ) : null}
    </div>
  )
}

function ActivityRow({
  item,
  withDivider,
}: {
  item: ClientActivityItem
  withDivider: boolean
}) {
  const time = formatRelativeTimeAgo(item.timestamp)

  return (
    <div
      className={[
        'flex items-center gap-3 py-3.5',
        withDivider ? 'border-b border-textPrimary/10' : '',
      ].join(' ')}
    >
      <ActivityIcon kind={item.iconKind} />

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-snug text-textPrimary">
          <span className="font-black">{item.who}</span> {item.action}
          {item.highlight ? (
            <>
              {' '}
              <span className="font-bold text-accentPrimary">
                {item.highlight}
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {item.unread ? (
            <span
              className="h-1.5 w-1.5 flex-none rounded-full bg-accentPrimary"
              aria-label="Unread"
            />
          ) : null}
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-textSecondary">
            {time}
          </span>
        </div>
      </div>

      {item.followBack && !item.followBack.alreadyFollowing ? (
        <FollowBackButton handle={item.followBack.handle} />
      ) : item.href ? (
        <Link
          href={item.href}
          className="flex-none rounded-full border border-textPrimary/15 px-3 py-1.5 text-[11.5px] font-bold text-textSecondary transition hover:border-textPrimary/30 hover:text-textPrimary"
        >
          View
        </Link>
      ) : null}
    </div>
  )
}

export default function ClientActivityFrame({
  items,
  unreadCount,
  markReadEventKeys,
  trend = null,
  credit = null,
  presentation = 'page',
  onDone,
}: ClientActivityFrameProps) {
  const [rows, setRows] = useState(items)
  const [unread, setUnread] = useState(Math.max(0, unreadCount))

  // Optimistic: clear the badge + unread dots the moment the button is pressed.
  // Zeroing `unread` also disables the button, which is what prevents a second
  // submit while the request is in flight.
  const clearUnreadOptimistically = useCallback(() => {
    setUnread(0)
    setRows((current) => current.map((row) => ({ ...row, unread: false })))
  }, [])

  // Put them back so the client can retry.
  const restoreUnread = useCallback(() => {
    setUnread(Math.max(0, unreadCount))
    setRows(items)
  }, [items, unreadCount])

  const lastIndex = useMemo(() => rows.length - 1, [rows.length])

  const markAllRead = (
    <ClientMarkAllReadButton
      unreadCount={unread}
      eventKeys={markReadEventKeys}
      onOptimistic={clearUnreadOptimistically}
      onRollback={restoreUnread}
      // The rows are already cleared in state, so a refresh would only
      // re-fetch what this page is deliberately holding itself.
      onSuccess={() => {}}
    />
  )

  // The two banners sit ABOVE the feed and outside its empty state: they are
  // standings, not events. A client with no unread rows can still be trending
  // and still hold a balance, and hiding either behind "No activity yet" would
  // make a true thing invisible for an unrelated reason.
  const banners =
    trend || credit ? (
      <>
        {trend ? <TrendBanner trend={trend} /> : null}
        {credit ? <CreditBanner credit={credit} /> : null}
      </>
    ) : null

  const body = (
    <>
      {banners}
      {rows.length > 0 ? (
        <div className="flex flex-col">
          {rows.map((item, index) => (
            <ActivityRow
              key={item.id}
              item={item}
              withDivider={index !== lastIndex}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={COPY.clientActivity.emptyTitle}
          description={COPY.clientActivity.emptyBody}
          action={{ label: COPY.clientActivity.emptyCta, href: '/looks' }}
        />
      )}
    </>
  )

  if (presentation === 'sheet') {
    return (
      <>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-textPrimary/10 px-4 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-textSecondary/60">
              {COPY.clientActivity.eyebrow}
            </div>
            {/* 18px, not the modal convention's 20px: at 430px the actions
                beside it push "What's happening" onto a second line mid-phrase. */}
            <h1 className="mt-1 text-[18px] font-bold leading-tight text-textPrimary">
              {COPY.clientActivity.title}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {markAllRead}
            {/*
              Done, not an ×. Tori asked for the iOS sheet's affordance, and on
              iOS this is a labelled Done button — an unlabelled glyph is a
              different control that happens to dismiss the same thing.
            */}
            <button
              type="button"
              onClick={onDone}
              className="brand-focus tap-target-keep rounded-full border border-textPrimary/15 px-3.5 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-textPrimary/30"
            >
              {COPY.common.done}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-2">
          {body}
        </div>
      </>
    )
  }

  return (
    <ClientPage
      eyebrow={COPY.clientActivity.eyebrow}
      title={COPY.clientActivity.title}
      back={{ href: '/client', label: 'Home' }}
      action={markAllRead}
    >
      {body}
    </ClientPage>
  )
}
