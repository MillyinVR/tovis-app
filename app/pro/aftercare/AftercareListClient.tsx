// app/pro/aftercare/AftercareListClient.tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useMemo,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import AftercareBeforeAfter from '@/app/_components/aftercare/AftercareBeforeAfter'
import { COPY } from '@/lib/copy'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import {
  countProAftercareCards,
  sortProAftercareCards,
  summarizeProAftercareCards,
  type ProAftercareCard,
  type ProAftercareCardStatus,
  type ProAftercareRebookKind,
  type ProAftercareSortMode,
} from '@/lib/aftercare/proAftercareList'

import { nudgeAftercareAction, sendAftercareAction } from './actions'

const C = COPY.proAftercareList

export type ProAftercareListItem = ProAftercareCard & {
  media: BookingBeforeAfterThumbs | null
}

type FilterTab = 'all' | ProAftercareCardStatus

// ── icons (stroke = currentColor) ──────────────────────────────────────────
type IconProps = { className?: string }
const sw = 2

function Icon({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const ChevronIcon = (p: IconProps) => (
  <span className={p.className}>
    <Icon size={15}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  </span>
)
const CalendarIcon = () => (
  <Icon size={12}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </Icon>
)
const CheckIcon = () => (
  <Icon size={12}>
    <path d="M20 6L9 17l-5-5" />
  </Icon>
)
const SparkIcon = () => (
  <Icon size={12}>
    <path d="M12 3l1.7 5.1 5.1 1.7-5.1 1.7L12 18l-1.7-5.1L5.2 11.5l5.1-1.7z" />
  </Icon>
)
const AlertIcon = () => (
  <Icon size={12}>
    <path d="M12 3.5L22 20H2zM12 9.5v5M12 17.1v.1" />
  </Icon>
)
const SearchIcon = () => (
  <Icon size={15}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
)
const CaretIcon = () => (
  <Icon size={14}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)
const SendIcon = () => (
  <Icon size={15}>
    <path d="M21 3L10.5 13.5M21 3l-6.5 18-4-8-8-4z" />
  </Icon>
)
const BellIcon = () => (
  <Icon size={15}>
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.5 21a2 2 0 01-3 0" />
  </Icon>
)

// ── status pill ─────────────────────────────────────────────────────────────
const STATUS_TONE: Record<ProAftercareCardStatus, { dot: string; pill: string }> = {
  draft: { dot: 'bg-gold', pill: 'text-gold border-gold/30 bg-gold/10' },
  sent: { dot: 'bg-peacock', pill: 'text-peacock border-peacock/30 bg-peacock/10' },
  finished: {
    dot: 'bg-accentPrimary',
    pill: 'text-accentPrimary border-accentPrimary/30 bg-accentPrimary/10',
  },
}

const STATUS_LABEL: Record<ProAftercareCardStatus, string> = {
  draft: C.statusDraft,
  sent: C.statusSent,
  finished: C.statusFinished,
}

function StatusPill({ status }: { status: ProAftercareCardStatus }) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] ${tone.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── rebook chip ──────────────────────────────────────────────────────────────
const REBOOK_TONE: Record<ProAftercareRebookKind, string> = {
  recommended: 'text-gold border-gold/30 bg-gold/10',
  next: 'text-accentPrimary border-accentPrimary/30 bg-accentPrimary/10',
  overdue: 'text-toneDanger border-toneDanger/30 bg-toneDanger/10',
}
const REBOOK_LABEL: Record<ProAftercareRebookKind, string> = {
  recommended: C.rebookRecommended,
  next: C.rebookNext,
  overdue: C.rebookOverdue,
}
function RebookIcon({ kind }: { kind: ProAftercareRebookKind }) {
  if (kind === 'next') return <CheckIcon />
  if (kind === 'overdue') return <AlertIcon />
  return <SparkIcon />
}

function RebookChip({ rebook }: { rebook: NonNullable<ProAftercareCard['rebook']> }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 ${REBOOK_TONE[rebook.kind]}`}
    >
      <RebookIcon kind={rebook.kind} />
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] opacity-75">
        {REBOOK_LABEL[rebook.kind]}
      </span>
      <span className="text-[12px] font-semibold">{rebook.value}</span>
    </span>
  )
}

// ── relative-time label ──────────────────────────────────────────────────────
const AGO_VERB: Record<NonNullable<ProAftercareCard['ago']>['verb'], string> = {
  saved: C.agoSaved,
  sent: C.agoSent,
  booked: C.agoBooked,
}
function AgoLabel({ ago }: { ago: NonNullable<ProAftercareCard['ago']> }) {
  const verb = AGO_VERB[ago.verb]
  const text =
    ago.value === 'now' ? `${verb} now` : `${verb} ${ago.value} ${C.agoSuffix}`
  return (
    <span className="whitespace-nowrap font-mono text-[10px] text-textMuted/80">
      {text}
    </span>
  )
}

// ── contextual primary action (Send / Nudge) ────────────────────────────────
function ActionButton({
  action,
  bookingId,
  onError,
}: {
  action: NonNullable<ProAftercareCard['action']>
  bookingId: string
  onError: (message: string | null) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const label = action === 'send' ? C.actionSend : C.actionNudge

  function handleClick(event: ReactMouseEvent) {
    // The whole card is a link to the aftercare editor — keep the button local.
    event.preventDefault()
    event.stopPropagation()
    onError(null)
    startTransition(async () => {
      const run = action === 'send' ? sendAftercareAction : nudgeAftercareAction
      const result = await run(bookingId)
      if (result.ok) {
        router.refresh()
      } else {
        onError(result.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex h-11 items-center justify-center gap-1.5 rounded-[13px] bg-cta px-3.5 font-display text-[13px] font-bold text-onCta transition hover:brightness-105 disabled:opacity-60"
    >
      {action === 'send' ? <SendIcon /> : <BellIcon />}
      <span>{pending ? '…' : label}</span>
    </button>
  )
}

// ── card ─────────────────────────────────────────────────────────────────────
function AftercareCard({
  item,
  onError,
}: {
  item: ProAftercareListItem
  onError: (message: string | null) => void
}) {
  return (
    <Link
      href={item.href}
      className={`group flex flex-col gap-3 rounded-[20px] border bg-bgSecondary p-3.5 transition hover:border-accentPrimary/30 md:flex-row md:items-center md:gap-4 ${
        item.needsAction
          ? 'border-gold/20 ring-1 ring-inset ring-gold/10'
          : 'border-textPrimary/10'
      }`}
    >
      {item.media ? (
        <div className="w-full shrink-0 md:w-52">
          <AftercareBeforeAfter media={item.media} serviceName={item.serviceName} />
        </div>
      ) : null}

      {/* body */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2.5">
          <h3 className="truncate font-display text-[16px] font-bold tracking-[-0.01em] text-textPrimary md:text-[18px]">
            {item.serviceName || C.serviceFallback}
          </h3>
          <StatusPill status={item.status} />
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-plume p-[1.5px]">
            <span className="flex h-full w-full items-center justify-center rounded-full bg-bgSurface font-display text-[10px] font-bold text-textPrimary">
              {item.initials}
            </span>
          </span>
          <span className="truncate text-[13px] text-textSecondary">
            {item.clientName || C.clientFallback}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item.bookingDateLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-textPrimary/10 bg-textPrimary/5 px-2.5 py-1.5 text-textMuted">
              <CalendarIcon />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-textMuted/80">
                {C.bookingChipLabel}
              </span>
              <span className="text-[12px] font-medium text-textSecondary">
                {item.bookingDateLabel}
              </span>
            </span>
          ) : null}

          {item.rebook ? <RebookChip rebook={item.rebook} /> : null}

          {item.ago ? <AgoLabel ago={item.ago} /> : null}
        </div>
      </div>

      {/* actions */}
      <div className="flex w-full flex-none gap-2 *:flex-1 md:w-auto md:min-w-37.5 md:flex-col md:*:flex-none">
        {item.action ? (
          <ActionButton action={item.action} bookingId={item.bookingId} onError={onError} />
        ) : null}
        <span className="flex h-11 items-center justify-center gap-1.5 rounded-[13px] border border-textPrimary/10 bg-textPrimary/5 px-4 font-display text-[13px] font-bold text-textPrimary transition group-hover:bg-accentPrimary group-hover:text-onAccent">
          {C.actionOpen}
          <ChevronIcon className="text-textSecondary group-hover:text-onAccent" />
        </span>
      </div>
    </Link>
  )
}

// ── summary strip dot ────────────────────────────────────────────────────────
function SummaryDot({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      <span className="text-[12.5px] text-textSecondary">{children}</span>
    </span>
  )
}

// ── filter tab ────────────────────────────────────────────────────────────────
function FilterTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-display text-[12.5px] font-semibold transition ${
        active
          ? 'bg-accentPrimary text-onAccent'
          : 'border border-textPrimary/10 bg-textPrimary/5 text-textSecondary hover:text-textPrimary'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 font-mono text-[10px] font-bold ${
          active ? 'bg-onAccent/15' : 'text-textMuted'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

export default function AftercareListClient({
  items,
}: {
  items: ProAftercareListItem[]
}) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProAftercareSortMode>('needs')
  const [actionError, setActionError] = useState<string | null>(null)

  const counts = useMemo(() => countProAftercareCards(items), [items])
  const summary = useMemo(() => summarizeProAftercareCards(items), [items])

  const visible = useMemo(() => {
    let list = items
    if (tab !== 'all') list = list.filter((i) => i.status === tab)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((i) => i.searchText.includes(q))
    return sortProAftercareCards(list, sort)
  }, [items, tab, query, sort])

  return (
    <div className="mx-auto w-full max-w-225 px-4 pb-24 pt-7 text-textPrimary md:px-8">
      {/* header */}
      <div className="mb-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-accentPrimary">
          {C.eyebrow}
        </div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display text-[27px] font-bold tracking-[-0.035em] text-textPrimary md:text-[40px]">
            {C.title}
          </h1>
          <span className="whitespace-nowrap pb-1.5 font-mono text-[11px] font-bold tracking-[0.04em] text-textMuted">
            {counts.all} {C.countSuffix}
          </span>
        </div>
        <p className="mt-1.5 max-w-130 text-[13.5px] leading-relaxed text-textMuted">
          {C.subtitle}
        </p>

        {/* at-a-glance summary */}
        <div className="mt-3.5 flex flex-wrap items-center gap-4">
          <SummaryDot tone="bg-gold">
            <strong className="font-bold text-textPrimary">{summary.drafts}</strong>{' '}
            {C.summaryToSend}
          </SummaryDot>
          <SummaryDot tone="bg-peacock">
            <strong className="font-bold text-textPrimary">{summary.awaiting}</strong>{' '}
            {C.summaryAwaiting}
          </SummaryDot>
          {summary.hasOverdue ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-toneDanger" />
              <span className="text-[12.5px] font-semibold text-toneDanger">
                {summary.overdue} {C.summaryOverdue}
              </span>
            </span>
          ) : null}
        </div>

        {/* search + sort */}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <label className="flex h-11 min-w-48 flex-1 items-center gap-2.5 rounded-[13px] border border-textPrimary/10 bg-textPrimary/5 px-3.5 text-textMuted focus-within:border-accentPrimary/40">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={C.searchPlaceholder}
              aria-label={C.searchLabel}
              className="w-full bg-transparent text-[13px] text-textPrimary placeholder:text-textMuted/70 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'needs' ? 'recent' : 'needs'))}
            className="inline-flex h-11 items-center gap-2.5 rounded-[13px] border border-textPrimary/10 bg-textPrimary/5 px-3.5 text-textSecondary transition hover:text-textPrimary"
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-textMuted">
              {C.sortLabel}
            </span>
            <span className="text-[13px] font-semibold text-textPrimary">
              {sort === 'needs' ? C.sortNeedsAction : C.sortRecent}
            </span>
            <CaretIcon />
          </button>
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap gap-2">
          <FilterTab
            active={tab === 'all'}
            label={C.filterAll}
            count={counts.all}
            onClick={() => setTab('all')}
          />
          <FilterTab
            active={tab === 'draft'}
            label={C.filterDrafts}
            count={counts.draft}
            onClick={() => setTab('draft')}
          />
          <FilterTab
            active={tab === 'sent'}
            label={C.filterSent}
            count={counts.sent}
            onClick={() => setTab('sent')}
          />
          <FilterTab
            active={tab === 'finished'}
            label={C.filterFinished}
            count={counts.finished}
            onClick={() => setTab('finished')}
          />
        </div>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="mb-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-2.5 text-[13px] font-semibold text-toneDanger"
        >
          {actionError}
        </div>
      ) : null}

      {/* list */}
      {visible.length === 0 ? (
        <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
          <div className="text-[15px] font-bold text-textPrimary">
            {counts.all === 0 ? C.emptyTitle : C.emptyFiltered}
          </div>
          {counts.all === 0 ? (
            <div className="mt-1 text-[12px] font-semibold text-textMuted">{C.emptyBody}</div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((item) => (
            <AftercareCard key={item.id} item={item} onError={setActionError} />
          ))}
        </div>
      )}
    </div>
  )
}
