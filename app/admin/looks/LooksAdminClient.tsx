'use client'

// Looks/UGC moderation queue island (social-first AM1). Talks to
// /api/v1/admin/looks + /api/v1/admin/look-comments (list) and the per-item
// action routes: .../moderate (approve/reject/remove — reused engine),
// .../dismiss-reports, and looks/[id]/feature (PUT/DELETE curation).

import { useEffect, useState, useTransition } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type ModerationStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REMOVED'
  | 'AUTO_FLAGGED'

type LookStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REMOVED'

type ReportReason =
  | 'SPAM'
  | 'HATE_OR_HARASSMENT'
  | 'NUDITY_OR_SEXUAL_CONTENT'
  | 'VIOLENCE_OR_DANGEROUS_ACTS'
  | 'SCAM_OR_FRAUD'
  | 'COPYRIGHT_OR_IMPERSONATION'
  | 'OTHER'

type LookRow = {
  lookPostId: string
  caption: string | null
  authorKind: 'PRO' | 'CLIENT'
  authorLabel: string
  professionalId: string
  proLabel: string
  proHandle: string | null
  status: LookStatus
  moderationStatus: ModerationStatus
  createdAt: string
  publishedAt: string | null
  thumbUrl: string | null
  mediaType: 'IMAGE' | 'VIDEO' | string
  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number
  viewCount: number
  reportCount: number
  reportReasons: ReportReason[]
  featured: boolean
  featuredAt: string | null
  adminNotes: string | null
  reviewedAt: string | null
}

type CommentRow = {
  lookCommentId: string
  lookPostId: string
  body: string
  authorLabel: string
  createdAt: string
  moderationStatus: ModerationStatus
  removedAt: string | null
  professionalId: string
  proLabel: string
  proHandle: string | null
  reportCount: number
  reportReasons: ReportReason[]
  adminNotes: string | null
  reviewedAt: string | null
}

type TagRow = {
  slug: string
  display: string
  lookCount: number
  banned: boolean
  bannedAt: string | null
  createdAt: string
}

type Tab = 'LOOK' | 'COMMENT' | 'TAG'
type StatusFilter =
  | 'REPORTED'
  | 'PENDING'
  | 'FLAGGED'
  | 'REJECTED'
  | 'REMOVED'
  | 'APPROVED'
  | 'ALL'

type BannedFilter = 'ALL' | 'ACTIVE' | 'BANNED'

const BANNED_FILTERS: { value: BannedFilter; label: string }[] = [
  { value: 'ALL', label: 'All tags' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'BANNED', label: 'Banned' },
]

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'REPORTED', label: 'Reported' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FLAGGED', label: 'Auto-flagged' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REMOVED', label: 'Removed' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ALL', label: 'All' },
]

const REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam',
  HATE_OR_HARASSMENT: 'Hate / harassment',
  NUDITY_OR_SEXUAL_CONTENT: 'Nudity / sexual',
  VIOLENCE_OR_DANGEROUS_ACTS: 'Violence / danger',
  SCAM_OR_FRAUD: 'Scam / fraud',
  COPYRIGHT_OR_IMPERSONATION: 'Copyright / impersonation',
  OTHER: 'Other',
}

function reasonLabel(reason: ReportReason): string {
  return REASON_LABELS[reason] ?? reason
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string
  } | null
  return data?.error || 'Request failed.'
}

function moderationBadgeClass(status: ModerationStatus): string {
  if (status === 'APPROVED')
    return 'border-toneSuccess/50 text-toneSuccess'
  if (status === 'PENDING_REVIEW' || status === 'AUTO_FLAGGED')
    return 'border-toneWarn/50 text-toneWarn'
  return 'border-toneDanger/50 text-toneDanger'
}

export default function LooksAdminClient() {
  const [tab, setTab] = useState<Tab>('LOOK')
  const [status, setStatus] = useState<StatusFilter>('REPORTED')
  const [bannedFilter, setBannedFilter] = useState<BannedFilter>('ALL')
  const [query, setQuery] = useState('')
  const [looks, setLooks] = useState<LookRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [tags, setTags] = useState<TagRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function load(
    nextTab: Tab,
    nextStatus: StatusFilter,
    nextBanned: BannedFilter,
    q: string,
  ) {
    setError(null)
    setLoaded(false)
    try {
      if (nextTab === 'TAG') {
        const res = await fetch(
          `/api/v1/admin/look-tags?banned=${nextBanned}&q=${encodeURIComponent(q)}`,
        )
        if (!res.ok) throw new Error(await readError(res))
        const data = (await res.json()) as { items: TagRow[] }
        setTags(data.items)
        setLoaded(true)
        return
      }

      const base = nextTab === 'LOOK' ? '/api/v1/admin/looks' : '/api/v1/admin/look-comments'
      const res = await fetch(
        `${base}?status=${nextStatus}&q=${encodeURIComponent(q)}`,
      )
      if (!res.ok) throw new Error(await readError(res))
      if (nextTab === 'LOOK') {
        const data = (await res.json()) as { items: LookRow[] }
        setLooks(data.items)
      } else {
        const data = (await res.json()) as { items: CommentRow[] }
        setComments(data.items)
      }
      setLoaded(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Loading the queue failed.')
      setLoaded(true)
    }
  }

  useEffect(() => {
    // Initial load only; tab/filter/search changes call load() explicitly.
    startTransition(() => load('LOOK', 'REPORTED', 'ALL', ''))
  }, [])

  function refresh() {
    startTransition(() => load(tab, status, bannedFilter, query))
  }

  async function act(run: () => Promise<Response>, failMsg: string) {
    setError(null)
    try {
      const res = await run()
      if (!res.ok) throw new Error(await readError(res))
      await load(tab, status, bannedFilter, query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : failMsg)
    }
  }

  function moderateLook(id: string, action: 'approve' | 'reject' | 'remove') {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/looks/${id}/moderate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          }),
        'Moderation action failed.',
      ),
    )
  }

  function dismissLookReports(id: string) {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/looks/${id}/dismiss-reports`, { method: 'POST' }),
        'Dismissing reports failed.',
      ),
    )
  }

  function featureLook(id: string, featured: boolean) {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/looks/${id}/feature`, {
            method: featured ? 'PUT' : 'DELETE',
          }),
        'Featuring failed.',
      ),
    )
  }

  function moderateComment(
    id: string,
    action: 'approve' | 'reject' | 'remove',
  ) {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/look-comments/${id}/moderate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          }),
        'Moderation action failed.',
      ),
    )
  }

  function dismissCommentReports(id: string) {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/look-comments/${id}/dismiss-reports`, {
            method: 'POST',
          }),
        'Dismissing reports failed.',
      ),
    )
  }

  function tagAction(slug: string, body: Record<string, unknown>, failMsg: string) {
    startTransition(() =>
      act(
        () =>
          fetch(`/api/v1/admin/look-tags/${encodeURIComponent(slug)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        failMsg,
      ),
    )
  }

  function setTagBanned(slug: string, banned: boolean) {
    tagAction(slug, { action: banned ? 'ban' : 'unban' }, 'Updating the tag failed.')
  }

  function renameTag(slug: string, currentDisplay: string) {
    const next = window.prompt(`Rename #${slug} display label`, currentDisplay)
    if (next === null) return
    const display = next.trim()
    if (!display || display === currentDisplay) return
    tagAction(slug, { action: 'rename', display }, 'Renaming the tag failed.')
  }

  function mergeTag(slug: string) {
    const target = window.prompt(
      `Merge #${slug} INTO which tag? Enter the target tag slug — every look on #${slug} moves to it and #${slug} is deleted.`,
    )
    if (target === null) return
    const targetSlug = target.trim()
    if (!targetSlug) return
    tagAction(slug, { action: 'merge', targetSlug }, 'Merging the tag failed.')
  }

  const empty =
    tab === 'LOOK'
      ? looks.length === 0
      : tab === 'COMMENT'
        ? comments.length === 0
        : tags.length === 0

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-card border border-white/15 p-0.5">
          {(['LOOK', 'COMMENT', 'TAG'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t)
                startTransition(() => load(t, status, bannedFilter, query))
              }}
              className={`rounded-card px-3 py-1.5 text-[12px] font-black transition ${
                tab === t
                  ? 'bg-accentPrimary text-bgPrimary'
                  : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              {t === 'LOOK' ? 'Looks' : t === 'COMMENT' ? 'Comments' : 'Tags'}
            </button>
          ))}
        </div>

        {tab === 'TAG' ? (
          <select
            value={bannedFilter}
            onChange={(e) => {
              const next = e.target.value as BannedFilter
              setBannedFilter(next)
              startTransition(() => load(tab, status, next, query))
            }}
            className="rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[12px] text-textPrimary focus:border-accentPrimary/60 focus:outline-none"
          >
            {BANNED_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={status}
            onChange={(e) => {
              const next = e.target.value as StatusFilter
              setStatus(next)
              startTransition(() => load(tab, next, bannedFilter, query))
            }}
            className="rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[12px] text-textPrimary focus:border-accentPrimary/60 focus:outline-none"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            refresh()
          }}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'TAG'
                ? 'Filter by tag slug or label…'
                : 'Filter by pro business, name, or handle…'
            }
            className="min-w-45 flex-1 rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[13px] text-textPrimary placeholder:text-textSecondary focus:border-accentPrimary/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Loading…' : 'Search'}
          </button>
        </form>
      </div>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {tab === 'LOOK'
          ? looks.map((item) => (
              <LookCard
                key={item.lookPostId}
                item={item}
                busy={pending}
                onApprove={() => moderateLook(item.lookPostId, 'approve')}
                onReject={() => moderateLook(item.lookPostId, 'reject')}
                onRemove={() => moderateLook(item.lookPostId, 'remove')}
                onDismiss={() => dismissLookReports(item.lookPostId)}
                onFeature={() => featureLook(item.lookPostId, !item.featured)}
              />
            ))
          : tab === 'COMMENT'
            ? comments.map((item) => (
                <CommentCard
                  key={item.lookCommentId}
                  item={item}
                  busy={pending}
                  onApprove={() => moderateComment(item.lookCommentId, 'approve')}
                  onReject={() => moderateComment(item.lookCommentId, 'reject')}
                  onRemove={() => moderateComment(item.lookCommentId, 'remove')}
                  onDismiss={() => dismissCommentReports(item.lookCommentId)}
                />
              ))
            : tags.map((item) => (
                <TagCard
                  key={item.slug}
                  item={item}
                  busy={pending}
                  onToggleBan={() => setTagBanned(item.slug, !item.banned)}
                  onRename={() => renameTag(item.slug, item.display)}
                  onMerge={() => mergeTag(item.slug)}
                />
              ))}

        {loaded && empty && !error ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-4 text-[13px] text-textSecondary">
            Nothing in this queue.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReportsLine({
  count,
  reasons,
}: {
  count: number
  reasons: ReportReason[]
}) {
  if (count === 0) return null
  return (
    <div className="mt-2 text-[12px] text-toneDanger">
      {count} open report{count === 1 ? '' : 's'}
      {reasons.length > 0
        ? ` · ${reasons.map(reasonLabel).join(', ')}`
        : ''}
    </div>
  )
}

function StatusBadges({
  moderationStatus,
  featured,
}: {
  moderationStatus: ModerationStatus
  featured?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded-card border px-2 py-0.5 text-[11px] font-black uppercase ${moderationBadgeClass(
          moderationStatus,
        )}`}
      >
        {moderationStatus.replace('_', ' ')}
      </span>
      {featured ? (
        <span className="rounded-card border border-accentPrimary/50 px-2 py-0.5 text-[11px] font-black uppercase text-accentPrimary">
          Featured
        </span>
      ) : null}
    </div>
  )
}

function ActionButton({
  label,
  tone,
  busy,
  onClick,
}: {
  label: string
  tone: 'primary' | 'danger' | 'neutral'
  busy: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : tone === 'danger'
        ? 'border-white/15 bg-bgPrimary text-toneDanger hover:border-white/30'
        : 'border-white/15 bg-bgPrimary text-textPrimary hover:border-white/30'
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`rounded-card border px-3 py-1.5 text-[12px] font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {label}
    </button>
  )
}

function LookCard({
  item,
  busy,
  onApprove,
  onReject,
  onRemove,
  onDismiss,
  onFeature,
}: {
  item: LookRow
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onRemove: () => void
  onDismiss: () => void
  onFeature: () => void
}) {
  const dateLabel = formatDate(item.createdAt)
  const hidden =
    item.status === 'REMOVED' ||
    item.moderationStatus === 'REJECTED' ||
    item.moderationStatus === 'REMOVED'

  return (
    <div
      className={`flex gap-3 rounded-card border p-4 ${
        item.reportCount > 0
          ? 'border-toneDanger/40 bg-bgPrimary/20'
          : hidden
            ? 'border-toneWarn/40 bg-bgPrimary/20'
            : 'border-white/10 bg-bgPrimary/40'
      }`}
    >
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgPrimary">
        {item.thumbUrl ? (
          <RemoteImage
            src={item.thumbUrl}
            alt={item.caption ?? 'Look media'}
            width={160}
            height={160}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-textSecondary">
            {item.mediaType === 'VIDEO' ? 'Video' : 'No media'}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[14px] font-black">{item.authorLabel}</span>
            <span className="ml-2 rounded-card border border-white/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-textSecondary">
              {item.authorKind === 'CLIENT' ? 'Client' : 'Pro'}
            </span>
            <span className="ml-2 text-[12px] text-textSecondary">
              on {item.proLabel}
              {item.proHandle ? ` @${item.proHandle}` : ''}
              {dateLabel ? ` · ${dateLabel}` : ''}
            </span>
          </div>
          <StatusBadges
            moderationStatus={item.moderationStatus}
            featured={item.featured}
          />
        </div>

        {item.caption ? (
          <div className="mt-1 whitespace-pre-wrap text-[13px] text-textSecondary">
            {item.caption}
          </div>
        ) : null}

        <div className="mt-2 text-[11px] text-textSecondary">
          {item.viewCount} views · {item.likeCount} likes ·{' '}
          {item.commentCount} comments · {item.saveCount} saves ·{' '}
          {item.shareCount} shares
        </div>

        <ReportsLine count={item.reportCount} reasons={item.reportReasons} />

        {item.adminNotes ? (
          <div className="mt-2 text-[12px] text-toneWarn">
            Admin note: {item.adminNotes}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.moderationStatus !== 'APPROVED' &&
          item.status !== 'REMOVED' ? (
            <ActionButton
              label="Approve"
              tone="primary"
              busy={busy}
              onClick={onApprove}
            />
          ) : null}
          {item.moderationStatus !== 'REJECTED' &&
          item.status !== 'REMOVED' ? (
            <ActionButton
              label="Reject"
              tone="danger"
              busy={busy}
              onClick={onReject}
            />
          ) : null}
          {item.status !== 'REMOVED' ? (
            <ActionButton
              label="Remove"
              tone="danger"
              busy={busy}
              onClick={onRemove}
            />
          ) : null}
          {item.reportCount > 0 ? (
            <ActionButton
              label="Dismiss reports"
              tone="neutral"
              busy={busy}
              onClick={onDismiss}
            />
          ) : null}
          <ActionButton
            label={item.featured ? 'Unfeature' : 'Feature'}
            tone="neutral"
            busy={busy}
            onClick={onFeature}
          />
        </div>
      </div>
    </div>
  )
}

function CommentCard({
  item,
  busy,
  onApprove,
  onReject,
  onRemove,
  onDismiss,
}: {
  item: CommentRow
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onRemove: () => void
  onDismiss: () => void
}) {
  const dateLabel = formatDate(item.createdAt)
  const removed =
    item.moderationStatus === 'REMOVED' ||
    item.moderationStatus === 'REJECTED' ||
    Boolean(item.removedAt)

  return (
    <div
      className={`rounded-card border p-4 ${
        item.reportCount > 0
          ? 'border-toneDanger/40 bg-bgPrimary/20'
          : removed
            ? 'border-toneWarn/40 bg-bgPrimary/20'
            : 'border-white/10 bg-bgPrimary/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[14px] font-black">{item.authorLabel}</span>
          <span className="ml-2 text-[12px] text-textSecondary">
            on {item.proLabel}
            {item.proHandle ? ` @${item.proHandle}` : ''}
            {dateLabel ? ` · ${dateLabel}` : ''}
          </span>
        </div>
        <StatusBadges moderationStatus={item.moderationStatus} />
      </div>

      <div className="mt-1 whitespace-pre-wrap text-[13px] text-textSecondary">
        {item.body}
      </div>

      <ReportsLine count={item.reportCount} reasons={item.reportReasons} />

      {item.adminNotes ? (
        <div className="mt-2 text-[12px] text-toneWarn">
          Admin note: {item.adminNotes}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/looks/${item.lookPostId}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-white/30"
        >
          View look
        </a>
        {item.moderationStatus !== 'APPROVED' ? (
          <ActionButton
            label="Approve"
            tone="primary"
            busy={busy}
            onClick={onApprove}
          />
        ) : null}
        {item.moderationStatus !== 'REJECTED' &&
        item.moderationStatus !== 'REMOVED' ? (
          <ActionButton
            label="Reject"
            tone="danger"
            busy={busy}
            onClick={onReject}
          />
        ) : null}
        {item.moderationStatus !== 'REMOVED' ? (
          <ActionButton
            label="Remove"
            tone="danger"
            busy={busy}
            onClick={onRemove}
          />
        ) : null}
        {item.reportCount > 0 ? (
          <ActionButton
            label="Dismiss reports"
            tone="neutral"
            busy={busy}
            onClick={onDismiss}
          />
        ) : null}
      </div>
    </div>
  )
}

function TagCard({
  item,
  busy,
  onToggleBan,
  onRename,
  onMerge,
}: {
  item: TagRow
  busy: boolean
  onToggleBan: () => void
  onRename: () => void
  onMerge: () => void
}) {
  const createdLabel = formatDate(item.createdAt)

  return (
    <div
      className={`rounded-card border p-4 ${
        item.banned
          ? 'border-toneDanger/40 bg-bgPrimary/20'
          : 'border-white/10 bg-bgPrimary/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <a
            href={`/looks/tags/${encodeURIComponent(item.slug)}`}
            target="_blank"
            rel="noreferrer"
            className="text-[15px] font-black text-textPrimary no-underline hover:underline"
          >
            #{item.display}
          </a>
          <span className="ml-2 text-[12px] text-textSecondary">
            /{item.slug}
            {' · '}
            {item.lookCount} look{item.lookCount === 1 ? '' : 's'}
            {createdLabel ? ` · ${createdLabel}` : ''}
          </span>
        </div>
        {item.banned ? (
          <span className="rounded-card border border-toneDanger/50 px-2 py-0.5 text-[11px] font-black uppercase text-toneDanger">
            Banned
          </span>
        ) : (
          <span className="rounded-card border border-toneSuccess/50 px-2 py-0.5 text-[11px] font-black uppercase text-toneSuccess">
            Active
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton
          label={item.banned ? 'Unban' : 'Ban'}
          tone={item.banned ? 'neutral' : 'danger'}
          busy={busy}
          onClick={onToggleBan}
        />
        <ActionButton
          label="Rename"
          tone="neutral"
          busy={busy}
          onClick={onRename}
        />
        <ActionButton
          label="Merge…"
          tone="neutral"
          busy={busy}
          onClick={onMerge}
        />
      </div>
    </div>
  )
}
