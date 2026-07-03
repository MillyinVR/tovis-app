// app/client/(gated)/activity/ClientActivityFrame.tsx
'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Heart,
  MessageCircle,
  Repeat2,
  Sparkles,
  Trophy,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

import { formatRelativeTimeAgo } from '@/lib/time'

import type {
  ActivityIconKind,
  ClientActivityItem,
} from '@/lib/notifications/activityFeed'

type ClientActivityFrameProps = {
  items: ClientActivityItem[]
  unreadCount: number
  markReadEventKeys: string[]
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
  save: { Icon: Heart, tint: 'text-toneDanger', bg: 'bg-toneDanger/15' },
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
}: ClientActivityFrameProps) {
  const [rows, setRows] = useState(items)
  const [unread, setUnread] = useState(Math.max(0, unreadCount))
  const [marking, setMarking] = useState(false)
  const markedRef = useRef(false)

  const hasUnread = unread > 0

  const markAllRead = useCallback(async () => {
    if (marking || !hasUnread || markedRef.current) return
    setMarking(true)
    // Optimistic: clear the badge + unread dots immediately.
    setUnread(0)
    setRows((current) => current.map((row) => ({ ...row, unread: false })))
    try {
      const response = await fetch('/api/v1/client/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ eventKeys: markReadEventKeys }),
      })
      if (!response.ok) throw new Error('failed')
      markedRef.current = true
    } catch {
      // Roll back so the user can retry.
      setUnread(Math.max(0, unreadCount))
      setRows(items)
    } finally {
      setMarking(false)
    }
  }, [hasUnread, items, marking, markReadEventKeys, unreadCount])

  const lastIndex = useMemo(() => rows.length - 1, [rows.length])

  return (
    <div className="h-full overflow-y-auto bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-[600px] px-[18px] pb-28 pt-6 sm:px-[30px] lg:px-[40px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-black tracking-[-0.02em] text-textPrimary">
            Activity
          </h1>
          <button
            type="button"
            onClick={markAllRead}
            disabled={!hasUnread || marking}
            className={[
              'text-[12.5px] font-bold transition brand-focus',
              hasUnread
                ? 'cursor-pointer text-accentPrimary hover:opacity-80'
                : 'cursor-default text-textSecondary/50',
            ].join(' ')}
          >
            Mark all read
          </button>
        </div>

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
          <div className="mt-6 rounded-[22px] border border-textPrimary/10 bg-bgSecondary px-5 py-12 text-center">
            <div className="text-[15px] font-black text-textPrimary">
              No activity yet
            </div>
            <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-textSecondary">
              When someone follows you or engages with your looks, it’ll show up
              here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
