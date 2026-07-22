// app/pro/waitlist/WaitlistOutreachClient.tsx
'use client'

import * as React from 'react'
import Link from 'next/link'

import { initialsForName } from '@/lib/initials'
import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

export type OutreachPendingOffer = {
  id: string
  startsAt: string
}

export type OutreachEntry = {
  rank: number
  waitlistEntryId: string
  clientName: string
  avatarUrl: string | null
  preferenceLabel: string
  joinedAt: string
  // A still-confirmable time already offered to this client. Since F14 that
  // offer also reserves the slot, so the badge is what explains the time missing
  // from the pro's own availability.
  pendingOffer: OutreachPendingOffer | null
}

export type OutreachServiceGroup = {
  serviceId: string
  serviceName: string
  entries: OutreachEntry[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; services: OutreachServiceGroup[]; total: number }

// Deterministic brand-gradient avatar fallback (no hardcoded hex), keyed off the
// entry id so a given client always gets the same color.
const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['--accent-primary', '--iris'],
  ['--peacock-blue', '--accent-primary'],
  ['--iris', '--peacock-blue'],
  ['--amber', '--fern'],
]

function avatarGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] ?? [
    '--accent-primary',
    '--iris',
  ]
  return `radial-gradient(130% 120% at 32% 20%, rgb(var(${from})), rgb(var(${to})))`
}

function formatJoinedAt(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatInTimeZone(date, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    month: 'short',
    day: 'numeric',
  })
}

function formatOfferedAt(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatInTimeZone(date, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEntry(raw: unknown): OutreachEntry | null {
  if (!isRecord(raw)) return null
  const rank = raw.rank
  const waitlistEntryId = raw.waitlistEntryId
  const clientName = raw.clientName
  const preferenceLabel = raw.preferenceLabel
  const joinedAt = raw.joinedAt
  if (
    typeof rank !== 'number' ||
    typeof waitlistEntryId !== 'string' ||
    typeof clientName !== 'string' ||
    typeof preferenceLabel !== 'string' ||
    typeof joinedAt !== 'string'
  ) {
    return null
  }
  const offerRaw = raw.pendingOffer
  const pendingOffer =
    isRecord(offerRaw) &&
    typeof offerRaw.id === 'string' &&
    typeof offerRaw.startsAt === 'string'
      ? { id: offerRaw.id, startsAt: offerRaw.startsAt }
      : null

  return {
    rank,
    waitlistEntryId,
    clientName,
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    preferenceLabel,
    joinedAt,
    pendingOffer,
  }
}

function parseServices(raw: unknown): OutreachServiceGroup[] {
  if (!Array.isArray(raw)) return []
  const groups: OutreachServiceGroup[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const serviceId = item.serviceId
    const serviceName = item.serviceName
    if (typeof serviceId !== 'string' || typeof serviceName !== 'string') continue
    const entries = Array.isArray(item.entries)
      ? item.entries.map(parseEntry).filter((e): e is OutreachEntry => e !== null)
      : []
    groups.push({ serviceId, serviceName, entries })
  }
  return groups
}

function messageHref(waitlistEntryId: string): string {
  const params = new URLSearchParams({
    contextType: 'WAITLIST',
    contextId: waitlistEntryId,
  })
  return `/messages/start?${params.toString()}`
}

function WaitlistRow({ entry }: { entry: OutreachEntry }) {
  const joined = formatJoinedAt(entry.joinedAt)
  const offeredAt = entry.pendingOffer
    ? formatOfferedAt(entry.pendingOffer.startsAt)
    : null

  return (
    <div className="flex items-center gap-3 border-b border-textPrimary/10 py-3 last:border-b-0">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bgSecondary/60 font-mono text-[11px] font-bold text-textSecondary">
        {entry.rank}
      </span>

      <div
        className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full text-[12px] font-bold text-onAccent"
        style={{ background: avatarGradient(entry.waitlistEntryId) }}
      >
        {entry.avatarUrl ? (
          <RemoteImage
            src={entry.avatarUrl ?? ''}
            alt={entry.clientName}
            className="h-full w-full object-cover"
            width={40}
            height={40}
          />
        ) : (
          initialsForName(entry.clientName, '?')
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[14px] font-bold text-textPrimary">
          {entry.clientName}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-textMuted">
          {entry.preferenceLabel}
          {joined ? ` · joined ${joined}` : ''}
        </div>
        {offeredAt ? (
          <div className="mt-1 truncate text-[11.5px] font-semibold text-toneInfo">
            {`Offered · ${offeredAt} — that time is held until they answer`}
          </div>
        ) : null}
      </div>

      <Link
        href={messageHref(entry.waitlistEntryId)}
        className="shrink-0 rounded-full border border-textPrimary/16 px-3.5 py-[7px] font-display text-[12px] font-bold text-textSecondary transition hover:border-accentPrimary/40 hover:text-textPrimary"
      >
        Message
      </Link>
    </div>
  )
}

export function WaitlistGroups({
  services,
}: {
  services: OutreachServiceGroup[]
}) {
  return (
    <div className="flex flex-col gap-5">
      {services.map((group) => (
        <section
          key={group.serviceId}
          className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="truncate font-display text-[15px] font-bold text-textPrimary">
              {group.serviceName}
            </h2>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
              {group.entries.length} waiting
            </span>
          </div>

          <div className="flex flex-col">
            {group.entries.map((entry) => (
              <WaitlistRow key={entry.waitlistEntryId} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default function WaitlistOutreachClient() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/v1/pro/waitlist', {
          headers: { Accept: 'application/json' },
        })
        const raw: unknown = await res.json().catch(() => null)
        if (!res.ok || !isRecord(raw) || raw.ok !== true) {
          if (!cancelled) setState({ status: 'error' })
          return
        }
        const services = parseServices(raw.services)
        const total = typeof raw.total === 'number' ? raw.total : 0
        if (!cancelled) setState({ status: 'ready', services, total })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="text-textPrimary">
      <header className="mb-6">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-textMuted">
          Pro mode
        </p>
        <h1 className="mt-1.5 font-display text-[30px] font-bold italic leading-none tracking-[-0.03em] md:text-[36px]">
          Waitlist
        </h1>
        <p className="mt-3 max-w-[520px] text-[13.5px] leading-relaxed text-textSecondary">
          Clients waiting for your services, in the order they joined. Reach out
          to fill a spot — message whoever you like, top of the list first.
        </p>
      </header>

      {state.status === 'loading' ? (
        <div className="rounded-card border border-textPrimary/10 bg-bgSurface px-5 py-6 text-[13px] text-textMuted">
          Loading your waitlist…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="rounded-card border border-textPrimary/10 bg-bgSurface px-5 py-6 text-[13px] text-textMuted">
          We couldn&apos;t load your waitlist just now. Please try again.
        </div>
      ) : null}

      {state.status === 'ready' && state.total === 0 ? (
        <div className="rounded-card border border-textPrimary/10 bg-bgSurface px-5 py-6">
          <div className="font-display text-[15px] font-bold">
            No one on your waitlist yet
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">
            When a client joins your waitlist, they&apos;ll show up here in join
            order so you can offer them an opening.
          </p>
        </div>
      ) : null}

      {state.status === 'ready' && state.total > 0 ? (
        <WaitlistGroups services={state.services} />
      ) : null}
    </div>
  )
}
