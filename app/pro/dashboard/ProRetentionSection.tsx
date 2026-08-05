// app/pro/dashboard/ProRetentionSection.tsx
//
// "Retention & rebooking" — the paid `advanced_analytics` surface, sitting on the
// free dashboard rather than on a buried page of its own. The free monthly numbers
// above it stay exactly as they were; this section is additional.
//
// Purely presentational: it renders the DTO built by
// lib/analytics/proRetentionInsights.ts and makes no decisions. Tone comes from a
// semantic status in the DTO and is mapped to classes here at the component
// boundary (never a color in the loader), so it stays white-label + [data-mode]
// safe.
import Link from 'next/link'

import type {
  ProRebookTrendPoint,
  ProRetentionBucket,
  ProRetentionInsightsDTO,
  ProRetentionStatus,
} from '@/lib/analytics/proRetentionInsights'

type ProRetentionSectionProps = {
  insights: ProRetentionInsightsDTO
}

function statusChipClass(status: ProRetentionStatus): string {
  switch (status) {
    case 'ACTION':
      return 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
    case 'ATTENTION':
      return 'border-toneWarn/30 bg-toneWarn/10 text-toneWarn'
    case 'GOOD':
      return 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess'
  }
}

export default function ProRetentionSection({
  insights,
}: ProRetentionSectionProps) {
  return (
    <section
      className="brand-pro-overview-section"
      aria-labelledby="pro-retention-title"
    >
      <div
        id="pro-retention-title"
        className="brand-cap brand-pro-overview-section-title"
      >
        ◆ RETENTION &amp; REBOOKING
      </div>

      {insights.state === 'locked' ? <LockedState /> : null}

      {insights.state === 'empty' ? (
        <div className="brand-pro-overview-muted brand-pro-looks-insights-sub">
          {insights.reason}
        </div>
      ) : null}

      {insights.state === 'ready' ? (
        <>
          <Headline
            ratePct={insights.headlineRebookRatePct}
            deltaPoints={insights.headlineDeltaPoints}
          />

          <Trend trend={insights.trend} />

          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
            {insights.buckets.map((bucket) => (
              <BucketRow key={bucket.key} bucket={bucket} />
            ))}
          </ul>

          <Footnotes
            notEnoughHistoryCount={insights.notEnoughHistoryCount}
            unmeasuredMonths={insights.unmeasuredMonths}
          />
        </>
      ) : null}
    </section>
  )
}

function LockedState() {
  return (
    <div className="rounded-xl border border-textPrimary/10 bg-bgSurface p-4">
      <div className="brand-pro-overview-metric-value text-base">
        See who&rsquo;s due back — and who&rsquo;s slipping away
      </div>
      <p className="brand-pro-overview-muted mt-1 text-[13px]">
        Rebooking rate month over month, plus the clients past their usual gap
        with nothing on the books. Included with a paid membership.
      </p>
      <Link
        href="/pro/membership"
        prefetch={false}
        className="brand-focus mt-3 inline-flex rounded-card border border-accentPrimary/60 bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
      >
        See plans ›
      </Link>
    </div>
  )
}

function Headline({
  ratePct,
  deltaPoints,
}: {
  ratePct: number | null
  deltaPoints: number | null
}) {
  if (ratePct === null) {
    return (
      <div className="brand-pro-overview-muted brand-pro-looks-insights-sub">
        No month in the last six has enough completed visits to measure a
        rebooking rate yet.
      </div>
    )
  }

  // A delta of exactly 0 is real information ("holding steady") and is shown as
  // such rather than being dropped for looking like nothing.
  const deltaLabel =
    deltaPoints === null
      ? 'first measured month'
      : deltaPoints === 0
        ? 'level with the month before'
        : `${deltaPoints > 0 ? '+' : ''}${deltaPoints} pts vs the month before`

  return (
    <div className="brand-pro-looks-insights-sub">
      <span className="brand-pro-overview-metric-value text-2xl">
        {ratePct}%
      </span>{' '}
      <span className="brand-pro-overview-muted">
        of clients left with their next appointment booked · {deltaLabel}
      </span>
    </div>
  )
}

function Trend({ trend }: { trend: ProRebookTrendPoint[] }) {
  return (
    <ul className="mt-4 flex list-none flex-wrap gap-2 p-0">
      {trend.map((point) => (
        <li
          key={point.monthKey}
          className="min-w-[72px] flex-1 rounded-xl border border-textPrimary/10 bg-bgSurface px-3 py-2"
        >
          <div className="brand-cap text-[11px] text-textSecondary">
            {point.monthLabel}
          </div>
          <div className="brand-pro-overview-metric-value text-base">
            {point.rebookRatePct === null ? '—' : `${point.rebookRatePct}%`}
          </div>
          <div className="brand-pro-overview-muted text-[11px]">
            {point.rebookRatePct === null
              ? 'not measured'
              : `${point.clientsSeen} client${point.clientsSeen === 1 ? '' : 's'} · ${point.newClients} new`}
          </div>
        </li>
      ))}
    </ul>
  )
}

function BucketRow({ bucket }: { bucket: ProRetentionBucket }) {
  return (
    <li className="rounded-xl border border-textPrimary/10 bg-bgSurface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="brand-pro-overview-metric-value text-base">
          {bucket.count} {bucket.label}
        </div>
        <span
          className={`brand-cap rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass(
            bucket.status,
          )}`}
        >
          {bucket.status === 'ACTION'
            ? 'Act now'
            : bucket.status === 'ATTENTION'
              ? 'Worth a nudge'
              : 'Healthy'}
        </span>
      </div>

      <p className="brand-pro-overview-muted mt-1 text-[13px]">{bucket.hint}</p>

      {bucket.clients.length > 0 ? (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {bucket.clients.map((client) => (
            <li key={client.clientId} className="text-[13px] text-textPrimary">
              <Link
                href={`/pro/clients/${client.clientId}`}
                prefetch={false}
                className="brand-focus font-black hover:underline"
              >
                {client.displayName}
              </Link>{' '}
              <span className="brand-pro-overview-muted">
                {[client.lastVisitLabel, client.cadenceLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
          {bucket.count > bucket.clients.length ? (
            <li className="brand-pro-overview-muted text-[12px]">
              + {bucket.count - bucket.clients.length} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

function Footnotes({
  notEnoughHistoryCount,
  unmeasuredMonths,
}: {
  notEnoughHistoryCount: number
  unmeasuredMonths: number
}) {
  if (notEnoughHistoryCount === 0 && unmeasuredMonths === 0) return null

  // Sentences are assembled as whole strings rather than as adjacent JSX
  // expressions: `{n === 1 ? ' has' : 's have'} only visited` renders as
  // "…haveonly visited", because JSX drops the newline-leading whitespace
  // between an expression and the text that follows it.
  const historyNote =
    notEnoughHistoryCount === 1
      ? '1 client has only visited once, so there’s no usual gap to judge them by yet.'
      : `${notEnoughHistoryCount} clients have only visited once, so there’s no usual gap to judge them by yet.`

  const monthsNote =
    unmeasuredMonths === 1
      ? '1 month in this window has no completed visits to measure yet — shown as “—” rather than as zero.'
      : `${unmeasuredMonths} months in this window have no completed visits to measure yet — shown as “—” rather than as zero.`

  return (
    <div className="brand-pro-overview-muted mt-3 text-[12px]">
      {notEnoughHistoryCount > 0 ? <div>{historyNote}</div> : null}
      {unmeasuredMonths > 0 ? <div>{monthsNote}</div> : null}
    </div>
  )
}
