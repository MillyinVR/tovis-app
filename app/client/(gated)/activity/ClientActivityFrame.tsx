// app/client/(gated)/activity/ClientActivityFrame.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bookmark,
  Camera,
  Heart,
  MessageCircle,
  Repeat2,
  Sparkles,
  Trophy,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

import EmptyState from '@/app/_components/boundaries/EmptyState'
import { COPY } from '@/lib/copy'
import { formatRelativeTimeAgo } from '@/lib/time'

import ClientMarkAllReadButton from '../_components/ClientMarkAllReadButton'
import ClientPage from '../_components/ClientPage'

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

  const body =
    rows.length > 0 ? (
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
